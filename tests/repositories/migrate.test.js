const fs = require('fs');
const os = require('os');
const path = require('path');
const { runMigrations, archivosDeMigracion } = require('../../db/migrate');
const { getTestContainer, getTestPool } = require('../helpers/container');
const { closeDb } = require('../helpers/db');

afterAll(async () => {
  await closeDb();
});

// Cubre E6. El runner reemplaza el `CREATE TABLE IF NOT EXISTS` en cada arranque
// más los `ALTER TABLE` dentro de try/catch vacíos: ahora queda registro de qué
// se aplicó, y un error del ALTER deja de confundirse con "ya existía".
describe('runner de migraciones', () => {
  const config = () => getTestContainer().config.db;

  // Directorio temporal por test: así se prueba el comportamiento del runner
  // —orden, idempotencia, qué pasa si una falla— sin escribir en db/migrations,
  // que es estado global y compartido con el resto de la suite.
  function dirTemporal(archivos) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migra-'));
    for (const [nombre, sql] of Object.entries(archivos)) {
      fs.writeFileSync(path.join(dir, nombre), sql);
    }
    return dir;
  }

  const silencioso = { info: () => {}, debug: () => {} };

  async function limpiarControl(nombres) {
    const pool = getTestPool();
    for (const n of nombres) {
      await pool.query('DELETE FROM schema_migrations WHERE name = ?', [n]);
    }
  }

  describe('las migraciones reales del proyecto', () => {
    test('están todas aplicadas en la base de test', async () => {
      const { aplicadas } = await runMigrations(config(), silencioso);
      // La suite ya las aplicó al arrancar, así que no debería quedar ninguna.
      expect(aplicadas).toEqual([]);
    });

    test('quedan registradas en schema_migrations', async () => {
      const [filas] = await getTestPool().query('SELECT name FROM schema_migrations');
      const registradas = filas.map(f => f.name).sort();

      expect(registradas).toEqual(archivosDeMigracion());
    });

    // Con `1_`, `2_` … `10_` el orden alfabético pondría la 10 antes de la 2, y
    // las migraciones se aplicarían en el orden equivocado sin que nada avise.
    test('todas usan prefijo numérico de 3 dígitos', () => {
      for (const archivo of archivosDeMigracion()) {
        expect(archivo).toMatch(/^\d{3}_[a-z0-9_]+\.sql$/);
      }
    });

    test('el orden de aplicación es el numérico', () => {
      const numeros = archivosDeMigracion().map(f => Number(f.slice(0, 3)));
      expect(numeros).toEqual([...numeros].sort((a, b) => a - b));
    });
  });

  describe('idempotencia', () => {
    test('correr dos veces aplica una sola', async () => {
      const dir = dirTemporal({
        '900_tabla_prueba.sql': 'CREATE TABLE IF NOT EXISTS prueba_migra (id INT PRIMARY KEY);'
      });

      const primera = await runMigrations(config(), silencioso, { dir });
      const segunda = await runMigrations(config(), silencioso, { dir });

      expect(primera.aplicadas).toEqual(['900_tabla_prueba.sql']);
      expect(segunda.aplicadas).toEqual([]);

      await getTestPool().query('DROP TABLE IF EXISTS prueba_migra');
      await limpiarControl(['900_tabla_prueba.sql']);
    });
  });

  describe('cuando una migración falla', () => {
    test('el error dice qué archivo fue', async () => {
      const dir = dirTemporal({
        '901_rota.sql': 'ALTER TABLE tabla_inexistente_xyz ADD COLUMN x INT;'
      });

      await expect(runMigrations(config(), silencioso, { dir }))
        .rejects.toThrow(/Falló la migración 901_rota\.sql/);
    });

    // Si se registrara, el próximo arranque la saltearía y la base quedaría sin
    // el cambio para siempre, en silencio.
    test('NO queda registrada, así que se reintenta al próximo arranque', async () => {
      const dir = dirTemporal({
        '902_rota.sql': 'ALTER TABLE tabla_inexistente_xyz ADD COLUMN x INT;'
      });

      await expect(runMigrations(config(), silencioso, { dir })).rejects.toThrow();

      const [filas] = await getTestPool().query(
        'SELECT name FROM schema_migrations WHERE name = ?', ['902_rota.sql']
      );
      expect(filas).toHaveLength(0);
    });

    // Aplicar migraciones fuera de orden sobre un schema a medias deja la base
    // en un estado que nadie puede razonar.
    test('se corta ahí y no aplica las siguientes', async () => {
      const dir = dirTemporal({
        '903_rota.sql': 'ALTER TABLE tabla_inexistente_xyz ADD COLUMN x INT;',
        '904_posterior.sql': 'CREATE TABLE IF NOT EXISTS no_deberia_existir (id INT PRIMARY KEY);'
      });

      await expect(runMigrations(config(), silencioso, { dir })).rejects.toThrow(/903_rota/);

      const [filas] = await getTestPool().query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = 'no_deberia_existir'`
      );
      expect(filas).toHaveLength(0);
    });
  });

  describe('varias sentencias por archivo', () => {
    // 002 necesita SET + PREPARE + EXECUTE porque MySQL no tiene
    // `ADD COLUMN IF NOT EXISTS`. Si el runner no soportara multi-sentencia,
    // esa migración fallaría.
    test('un archivo con varias sentencias se aplica completo', async () => {
      const dir = dirTemporal({
        '905_multi.sql': `
          CREATE TABLE IF NOT EXISTS multi_a (id INT PRIMARY KEY);
          CREATE TABLE IF NOT EXISTS multi_b (id INT PRIMARY KEY);
        `
      });

      await runMigrations(config(), silencioso, { dir });

      const [filas] = await getTestPool().query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name IN ('multi_a','multi_b')`
      );
      expect(filas).toHaveLength(2);

      await getTestPool().query('DROP TABLE IF EXISTS multi_a, multi_b');
      await limpiarControl(['905_multi.sql']);
    });
  });
});

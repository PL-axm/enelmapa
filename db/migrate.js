const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// Antes no había migraciones (hallazgo E6): el schema se creaba con
// `CREATE TABLE IF NOT EXISTS` en cada arranque, y los cambios posteriores eran
// `ALTER TABLE` dentro de un try/catch vacío. Eso funcionaba, pero:
//
//   - no quedaba registro de qué se había aplicado ni cuándo;
//   - el try/catch vacío se tragaba cualquier error del ALTER, no sólo el
//     "la columna ya existe" que se quería ignorar;
//   - no había forma de saber si dos bases tenían el mismo schema.
//
// El runner es a propósito chico: aplica los .sql en orden alfabético y anota
// cada uno en `schema_migrations`. No hay rollback, y no es un olvido — en MySQL
// el DDL es auto-commit, así que un `ALTER` a medias no se puede revertir con una
// transacción. La defensa es que cada migración sea chica e idempotente.

const DIR = path.join(__dirname, 'migrations');

async function crearTablaDeControl(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

function archivosDeMigracion(dir = DIR) {
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    // Orden alfabético, que con el prefijo numérico es el orden de aplicación.
    // Por eso los archivos van 001_, 002_: con 1_, 2_ … 10_ el orden se rompería
    // en el décimo.
    .sort();
}

// `dir` es inyectable sólo para poder testear el runner —orden, idempotencia,
// qué pasa cuando una migración falla— sin escribir archivos en el directorio
// real de migraciones. La app nunca lo pasa.
async function runMigrations(dbConfig, logger = console, { dir = DIR } = {}) {
  // Conexión propia y efímera, con `multipleStatements` habilitado: las
  // migraciones necesitan varias sentencias por archivo (002 usa PREPARE), y el
  // pool de la app NO lo tiene ni lo va a tener. Habilitarlo ahí convertiría
  // cualquier inyección en la posibilidad de encadenar sentencias arbitrarias.
  const conn = await mysql.createConnection({
    host: dbConfig.host,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    multipleStatements: true
  });

  try {
    await crearTablaDeControl(conn);

    const [filas] = await conn.query('SELECT name FROM schema_migrations');
    const yaAplicadas = new Set(filas.map(f => f.name));

    const pendientes = archivosDeMigracion(dir).filter(f => !yaAplicadas.has(f));

    if (pendientes.length === 0) {
      logger.debug?.('Base al día, sin migraciones pendientes', {
        aplicadas: yaAplicadas.size
      });
      return { aplicadas: [], yaEstaban: yaAplicadas.size };
    }

    const aplicadas = [];
    for (const archivo of pendientes) {
      const sql = fs.readFileSync(path.join(dir, archivo), 'utf8');

      try {
        await conn.query(sql);
      } catch (err) {
        // Se corta acá y no se sigue con las siguientes: aplicar migraciones
        // fuera de orden sobre un schema a medias deja la base en un estado que
        // nadie puede razonar.
        err.message = 'Falló la migración ' + archivo + ': ' + err.message;
        throw err;
      }

      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [archivo]);
      aplicadas.push(archivo);
      logger.info?.('Migración aplicada', { archivo });
    }

    return { aplicadas, yaEstaban: yaAplicadas.size };
  } finally {
    await conn.end();
  }
}

module.exports = { runMigrations, archivosDeMigracion };

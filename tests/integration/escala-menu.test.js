const request = require('supertest');
const { createTestApp, getTestPool } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createBusiness } = require('../helpers/fixtures');
const { loginAdmin } = require('../helpers/sesion');
const tema = require('../../theme');
const { ESCALAS } = require('../../theme/escalas');

const app = createTestApp();

afterAll(async () => {
  await closeDb();
});

describe('escala del menú, de punta a punta', () => {
  let business;

  beforeEach(async () => {
    await resetDb();
    business = await createBusiness({
      slug: 'test-escala',
      name: 'Test Escala',
      adminEmail: 'escala@test.local',
      adminPassword: 'password-escala-123'
    });
  });

  test('un negocio nuevo arranca en la escala por defecto', async () => {
    const [filas] = await getTestPool().query(
      'SELECT menu_scale FROM businesses WHERE id = ?', [business.businessId]
    );

    expect(filas[0].menu_scale).toBe(tema.ESCALA_POR_DEFECTO);
  });

  test('el menú emite el factor de la escala guardada', async () => {
    for (const id of tema.idsDeEscalas()) {
      await getTestPool().query(
        'UPDATE businesses SET menu_scale = ? WHERE id = ?', [id, business.businessId]
      );

      const res = await request(app).get('/s/test-escala');

      expect(res.status).toBe(200);
      expect(res.text).toContain('--escala: ' + ESCALAS[id].factor + ';');
    }
  });

  test('los tamaños del contenido se multiplican por la escala', async () => {
    const res = await request(app).get('/s/test-escala');

    // Los px afinados siguen ahí; lo que cambia es que están dentro del calc.
    expect(res.text).toContain('font-size: calc(14.5px * var(--escala))');
    expect(res.text).toContain('font-size: calc(12.5px * var(--escala))');
    expect(res.text).toContain('font-size: calc(18px * var(--escala))');
    // Y el modal, que muestra el mismo contenido.
    expect(res.text).toContain('font-size: calc(20px * var(--escala))');
  });

  test('el chrome NO escala', async () => {
    const res = await request(app).get('/s/test-escala');

    // La nav es sticky y con alto propio; el buscador y los horarios son interfaz.
    // Si alguien los mete en el calc, esto avisa.
    expect(res.text).toContain('.cat-nav-btn { background: none; border: none; font-family: inherit; font-size: 13px;');
    expect(res.text).toMatch(/\.search-input \{[^}]*font-size: 15px/);
  });

  test('hay una red de seguridad si el factor no llegara', async () => {
    // Sin `--escala` definida, todos los calc quedarían inválidos y el navegador
    // caería a su tamaño por defecto: el menú se vería roto, no apenas distinto.
    const res = await request(app).get('/s/test-escala');

    expect(res.text).toMatch(/--escala:\s*1;[\s\S]*?\}/);
  });

  test('una escala inválida en la base no rompe el menú', async () => {
    for (const valor of ['gigante', '', 'DROP TABLE', '1; }']) {
      await getTestPool().query(
        'UPDATE businesses SET menu_scale = ? WHERE id = ?', [valor, business.businessId]
      );

      const res = await request(app).get('/s/test-escala');

      expect(res.status).toBe(200);
      expect(res.text).toContain('--escala: ' + ESCALAS[tema.ESCALA_POR_DEFECTO].factor + ';');
      // Y sobre todo: nada de lo guardado llegó al CSS.
      expect(res.text).not.toContain('DROP TABLE');
      expect(res.text).not.toContain('1; }');
    }
  });

  test('el dueño puede cambiarla desde Configuración', async () => {
    const agent = await loginAdmin(app, {
      email: business.adminEmail,
      password: business.adminPassword
    });

    const res = await agent.post('/api/settings').type('form').send({
      name: business.name,
      menu_scale: 'grande'
    });

    expect(res.status).toBe(200);

    const [filas] = await getTestPool().query(
      'SELECT menu_scale FROM businesses WHERE id = ?', [business.businessId]
    );
    expect(filas[0].menu_scale).toBe('grande');

    const menu = await request(app).get('/s/test-escala');
    expect(menu.text).toContain('--escala: ' + ESCALAS.grande.factor + ';');
  });

  test('el panel ofrece todas las escalas y marca la actual', async () => {
    await getTestPool().query(
      'UPDATE businesses SET menu_scale = ? WHERE id = ?', ['extra', business.businessId]
    );

    const agent = await loginAdmin(app, {
      email: business.adminEmail,
      password: business.adminPassword
    });
    const res = await agent.get('/admin/settings');

    for (const id of tema.idsDeEscalas()) {
      expect(res.text).toContain('name="menu_scale" value="' + id + '"');
    }
    expect(res.text).toMatch(/name="menu_scale" value="extra" checked/);
  });

  test('la escala no se lleva por delante a la paleta', async () => {
    // Los tres ejes son independientes: cambiar uno no puede pisar otro. Es el
    // tipo de cosa que se rompe cuando el update se arma con toda la fila.
    await getTestPool().query(
      'UPDATE businesses SET menu_theme = ?, menu_scale = ? WHERE id = ?',
      ['navy', 'compacto', business.businessId]
    );

    const res = await request(app).get('/s/test-escala');

    expect(res.text).toContain('--bg: #1a1a2e;');
    expect(res.text).toContain('--escala: ' + ESCALAS.compacto.factor + ';');
  });
});

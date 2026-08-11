const request = require('supertest');
const { createTestApp, getTestPool } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createBusiness } = require('../helpers/fixtures');
const { loginAdmin, loginSuperadmin, extraerToken } = require('../helpers/sesion');

const app = createTestApp();

afterAll(async () => {
  await closeDb();
});

// Cubre S4. El escenario que esto impide: con la cookie de sesión en el
// navegador, una página de terceros disparaba un POST a /superadmin/delete/3 y
// el servidor lo aceptaba como legítimo. El atacante puede lograr que el
// navegador mande la cookie, pero no puede leer el token.
describe('protección CSRF (S4)', () => {
  let business;

  beforeEach(async () => {
    await resetDb();
    business = await createBusiness({
      slug: 'test-csrf', name: 'Test CSRF',
      adminEmail: 'csrf@test.local', adminPassword: 'password-csrf-123'
    });
  });

  async function agenteCrudo() {
    const agent = request.agent(app);
    await agent.post('/admin/login').type('form')
      .send({ email: business.adminEmail, password: business.adminPassword });
    return agent;
  }

  describe('mutaciones sin token', () => {
    test('un POST sin token se rechaza con 403', async () => {
      const agent = await agenteCrudo();
      const res = await agent.post('/api/categories').send({ name: 'Sin token' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Token de seguridad/);
    });

    test('y no escribe nada', async () => {
      const agent = await agenteCrudo();
      await agent.post('/api/categories').send({ name: 'Sin token' });

      const [rows] = await getTestPool().query(
        'SELECT id FROM categories WHERE name = ?', ['Sin token']
      );
      expect(rows).toHaveLength(0);
    });

    test('DELETE y PUT también se rechazan', async () => {
      const agent = await agenteCrudo();

      expect((await agent.delete('/api/categories/' + business.categoryId)).status).toBe(403);
      expect((await agent.put('/api/categories/' + business.categoryId)
        .send({ name: 'X' })).status).toBe(403);
    });

    test('un token de otra sesión no sirve', async () => {
      const otro = await createBusiness({
        slug: 'test-csrf-2', name: 'Otro',
        adminEmail: 'csrf2@test.local', adminPassword: 'password-csrf2-123'
      });
      const sesionOtro = await loginAdmin(app, {
        email: otro.adminEmail, password: otro.adminPassword
      });

      const agent = await agenteCrudo();
      const res = await agent.post('/api/categories')
        .set('X-CSRF-Token', sesionOtro.token)
        .send({ name: 'Token ajeno' });

      expect(res.status).toBe(403);
    });

    test('un token inventado del largo correcto tampoco', async () => {
      const agent = await agenteCrudo();
      const res = await agent.post('/api/categories')
        .set('X-CSRF-Token', 'f'.repeat(64))
        .send({ name: 'Inventado' });

      expect(res.status).toBe(403);
    });
  });

  describe('mutaciones con token', () => {
    test('con el token de su sesión, la operación pasa', async () => {
      const agent = await loginAdmin(app, {
        email: business.adminEmail, password: business.adminPassword
      });
      const res = await agent.post('/api/categories').send({ name: 'Con token' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    // Los formularios con imagen se envían como multipart, que el servidor no
    // parsea hasta multer — o sea después de la verificación. Por eso el token
    // va por header y no en el cuerpo.
    test('funciona también en multipart, donde el cuerpo no está parseado', async () => {
      const agent = await loginAdmin(app, {
        email: business.adminEmail, password: business.adminPassword
      });
      const res = await agent.post('/api/products')
        .field('name', 'Producto multipart')
        .field('price', '1000')
        .field('category_id', String(business.categoryId));

      expect(res.status).toBe(200);
    });
  });

  describe('las lecturas no se tocan', () => {
    test('un GET sin token funciona normalmente', async () => {
      const agent = await agenteCrudo();

      expect((await agent.get('/admin/dashboard')).status).toBe(200);
      expect((await agent.get('/api/qr')).status).toBe(200);
    });

    test('el menú público sigue abierto y sin token', async () => {
      expect((await request(app).get('/s/' + business.slug)).status).toBe(200);
    });
  });

  // Sin esto, el visitante anónimo del menú público —la ruta de más tráfico—
  // dejaría una fila en `sessions` por cada visita, porque tocar req.session
  // obliga a persistirla con saveUninitialized en false.
  describe('no crea sesiones para visitantes anónimos', () => {
    test('ver el menú público no deja una sesión en la base', async () => {
      await getTestPool().query('DELETE FROM sessions');

      await request(app).get('/s/' + business.slug);
      await request(app).get('/s/' + business.slug);

      const [rows] = await getTestPool().query('SELECT COUNT(*) as n FROM sessions');
      expect(Number(rows[0].n)).toBe(0);
    });

    test('ver la pantalla de login tampoco', async () => {
      await getTestPool().query('DELETE FROM sessions');
      await request(app).get('/admin/login');

      const [rows] = await getTestPool().query('SELECT COUNT(*) as n FROM sessions');
      expect(Number(rows[0].n)).toBe(0);
    });
  });

  // Los logins son la única mutación que ocurre SIN sesión previa: exigir token
  // ahí obligaría a persistir una sesión por cada visita a la pantalla de login.
  describe('los logins están exentos', () => {
    test('el login de /admin funciona sin token', async () => {
      const res = await request(app).post('/admin/login').type('form')
        .send({ email: business.adminEmail, password: business.adminPassword });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/admin/dashboard');
    });

    test('el login de /superadmin funciona sin token', async () => {
      const res = await request(app).post('/superadmin/login').type('form')
        .send({ email: 'admin@enelmapa.co', password: 'super2026' });

      expect(res.status).toBe(302);
    });
  });

  describe('el token llega a las vistas', () => {
    test('el panel lo publica en un meta', async () => {
      const agent = await agenteCrudo();
      const res = await agent.get('/admin/dashboard');

      expect(extraerToken(res.text)).toMatch(/^[0-9a-f]{64}$/);
    });

    test('los formularios del superadmin lo llevan en un campo oculto', async () => {
      const sesion = await loginSuperadmin(app);
      const res = await sesion.get('/superadmin/create');

      expect(res.text).toContain('name="_csrf"');
      expect(extraerToken(res.text)).toBe(sesion.token);
    });

    // El superadmin manda formularios urlencoded, así que ahí el token viaja en
    // el cuerpo y no por header. Los dos caminos tienen que funcionar.
    test('el superadmin puede crear un negocio con el token en el cuerpo', async () => {
      const sesion = await loginSuperadmin(app);
      const res = await sesion.sinCsrf.post('/superadmin/create').type('form').send({
        _csrf: sesion.token,
        slug: 'creado-con-csrf',
        name: 'Creado con CSRF',
        admin_email: 'nuevo-csrf@test.local',
        admin_password: 'clave12345'
      });

      expect(res.status).toBe(302);

      const [rows] = await getTestPool().query(
        'SELECT id FROM businesses WHERE slug = ?', ['creado-con-csrf']
      );
      expect(rows).toHaveLength(1);
    });

    test('y sin el token en el cuerpo se rechaza', async () => {
      const sesion = await loginSuperadmin(app);
      const res = await sesion.sinCsrf.post('/superadmin/create').type('form').send({
        slug: 'sin-csrf', name: 'Sin CSRF',
        admin_email: 'sin-csrf@test.local', admin_password: 'clave12345'
      });

      expect(res.status).toBe(403);

      const [rows] = await getTestPool().query(
        'SELECT id FROM businesses WHERE slug = ?', ['sin-csrf']
      );
      expect(rows).toHaveLength(0);
    });
  });
});

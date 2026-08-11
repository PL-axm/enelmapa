const request = require('supertest');
const { createTestApp } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createBusiness } = require('../helpers/fixtures');
const { loginAdmin } = require('../helpers/sesion');

const app = createTestApp();

describe('auth de /admin', () => {
  let business;

  beforeEach(async () => {
    await resetDb();
    business = await createBusiness({
      slug: 'test-negocio',
      name: 'Test Negocio',
      adminEmail: 'admin@test.local',
      adminPassword: 'password-correcto-123'
    });
  });

  afterAll(async () => {
    await closeDb();
  });

  test('login con credenciales válidas redirige a /admin/dashboard y setea cookie de sesión', async () => {
    const res = await request(app)
      .post('/admin/login')
      .type('form')
      .send({ email: business.adminEmail, password: business.adminPassword });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/dashboard');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  test('login con password incorrecta no redirige ni setea cookie', async () => {
    const res = await request(app)
      .post('/admin/login')
      .type('form')
      .send({ email: business.adminEmail, password: 'password-incorrecto' });

    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.text).toContain('Credenciales incorrectas');
  });

  test('login con email inexistente responde igual que password incorrecta (no filtra si el email existe)', async () => {
    const resEmailInexistente = await request(app)
      .post('/admin/login')
      .type('form')
      .send({ email: 'no-existe@test.local', password: 'lo-que-sea' });
    const resPasswordIncorrecta = await request(app)
      .post('/admin/login')
      .type('form')
      .send({ email: business.adminEmail, password: 'password-incorrecto' });

    expect(resEmailInexistente.status).toBe(resPasswordIncorrecta.status);
    expect(resEmailInexistente.text).toContain('Credenciales incorrectas');
  });

  test('GET /admin/dashboard sin sesión redirige a /admin/login', async () => {
    const res = await request(app).get('/admin/dashboard');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/login');
  });

  test('GET /admin/dashboard con sesión válida responde 200 con los datos del negocio correcto', async () => {
    const agent = request.agent(app);
    await agent
      .post('/admin/login')
      .type('form')
      .send({ email: business.adminEmail, password: business.adminPassword });

    const res = await agent.get('/admin/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).toContain(business.name);
  });

  // El logout pasó de GET a POST: con GET, un tercero podía desloguear a
  // cualquiera con un `<img src="/admin/logout">`.
  test('logout destruye la sesión: request posterior a /admin/dashboard vuelve a redirigir a login', async () => {
    const agent = await loginAdmin(app, {
      email: business.adminEmail, password: business.adminPassword
    });

    const logoutRes = await agent.post('/admin/logout');
    expect(logoutRes.status).toBe(302);
    expect(logoutRes.headers.location).toBe('/admin/login');

    const res = await agent.get('/admin/dashboard');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/login');
  });

  test('el logout por GET ya no existe', async () => {
    const agent = await loginAdmin(app, {
      email: business.adminEmail, password: business.adminPassword
    });

    expect((await agent.get('/admin/logout')).status).toBe(404);
    // y la sesión sigue viva: el GET no deslogueó a nadie
    expect((await agent.get('/admin/dashboard')).status).toBe(200);
  });
});

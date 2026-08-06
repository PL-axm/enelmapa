const request = require('supertest');
const app = require('../../app');
const { resetDb, closeDb } = require('../helpers/db');
const { createBusiness } = require('../helpers/fixtures');

// Cubre B6/B7 y S8: hasta la Fase 2 no había error handler central (un throw
// async colgaba la request o mataba el proceso) y /api respondía con un
// redirect HTML al login en vez de JSON.
describe('manejo de errores', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('formato según el contrato de cada zona', () => {
    test('una ruta inexistente bajo /api responde JSON', async () => {
      const res = await request(app).get('/api/no-existe').set('Host', 'localhost');

      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/json/);
      expect(res.body.ok).toBe(false);
    });

    test('una página inexistente responde HTML', async () => {
      const res = await request(app).get('/pagina-que-no-existe').set('Host', 'localhost');

      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/html/);
    });

    test('un negocio inexistente da 404 y no cuelga la request', async () => {
      const res = await request(app).get('/s/negocio-que-no-existe').set('Host', 'localhost');

      expect(res.status).toBe(404);
      expect(res.text).toContain('Negocio no encontrado');
    });
  });

  describe('S8 — /api sin sesión responde 401 JSON, no un redirect al login', () => {
    test('GET /api/qr', async () => {
      const res = await request(app).get('/api/qr').set('Host', 'localhost');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ ok: false, error: 'No autenticado' });
    });

    test('POST /api/categories', async () => {
      const res = await request(app).post('/api/categories').send({ name: 'x' }).set('Host', 'localhost');

      expect(res.status).toBe(401);
      expect(res.body.ok).toBe(false);
    });

    test('las páginas de /admin siguen redirigiendo al login', async () => {
      const res = await request(app).get('/admin/dashboard').set('Host', 'localhost');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/admin/login');
    });
  });

  describe('errores de validación', () => {
    test('un :id inválido devuelve 400 JSON y la app sigue viva', async () => {
      const business = await createBusiness({
        slug: 'test-errores',
        name: 'Test Errores',
        adminEmail: 'admin-errores@test.local',
        adminPassword: 'password-errores-123'
      });

      const agent = request.agent(app);
      await agent.post('/admin/login').type('form')
        .send({ email: business.adminEmail, password: business.adminPassword });

      const res = await agent.delete('/api/products/no-soy-un-numero');
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);

      const despues = await agent.get('/admin/dashboard');
      expect(despues.status).toBe(200);
    });
  });
});

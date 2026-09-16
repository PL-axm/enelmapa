const request = require('supertest');
const { createTestApp } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createBusiness } = require('../helpers/fixtures');
const { loginAdmin } = require('../helpers/sesion');

const app = createTestApp();

// Un dueño cambiaba un precio y no lo veía reflejado. La app no mandaba NINGUNA
// cabecera de caché en el HTML, así que cada navegador y cada proxy decidía por
// su cuenta cuánto tiempo guardar una página.
//
// El criterio: lo privado no se guarda nunca; lo público se guarda pero se
// revalida siempre; y las imágenes, que tienen nombre aleatorio irrepetible, se
// guardan un año.

describe('cabeceras de caché', () => {
  beforeEach(async () => {
    await resetDb();
    await createBusiness({
      slug: 'test-cache',
      name: 'Test Cache',
      adminEmail: 'admin-cache@test.local',
      adminPassword: 'password-cache-123'
    });
  });

  afterAll(async () => {
    await closeDb();
  });

  test('el menú público se revalida: un cambio de precio se ve enseguida', async () => {
    const res = await request(app).get('/s/test-cache').set('Host', 'localhost');
    expect(res.headers['cache-control']).toBe('no-cache');
    // El ETag es lo que abarata la revalidación: si nada cambió, 304 sin cuerpo.
    expect(res.headers.etag).toBeDefined();
  });

  test('la landing también se revalida', async () => {
    const res = await request(app).get('/').set('Host', 'localhost');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  test('sin cambios, la revalidación devuelve 304 y no vuelve a mandar la página', async () => {
    const primera = await request(app).get('/s/test-cache').set('Host', 'localhost');
    const segunda = await request(app)
      .get('/s/test-cache')
      .set('Host', 'localhost')
      .set('If-None-Match', primera.headers.etag);

    expect(segunda.status).toBe(304);
    expect(segunda.text).toBeFalsy();
  });

  test('el panel no se guarda nunca: son datos privados del negocio', async () => {
    const agent = await loginAdmin(app, {
      email: 'admin-cache@test.local',
      password: 'password-cache-123'
    });
    const res = await agent.get('/admin/settings');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('la API tampoco', async () => {
    const res = await request(app).get('/api/locations').set('Host', 'localhost');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('/salud no se guarda: un caché podría responder "ok" por un sitio caído', async () => {
    const res = await request(app).get('/salud').set('Host', 'localhost');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

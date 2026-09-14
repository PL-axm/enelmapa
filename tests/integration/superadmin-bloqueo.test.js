const request = require('supertest');
const { createApp } = require('../../app');
const { getTestContainer, createTestApp } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createBusiness } = require('../helpers/fixtures');

// En producción el superadmin usaba la contraseña por defecto, que está
// publicada en el repositorio. Con esa configuración su acceso queda bloqueado.
//
// Lo que más importa de estos tests no es que el login se bloquee, sino que
// NADA MÁS se rompa. La primera idea fue que el servidor no arrancara, y eso
// habría tirado los menús de todos los clientes por un problema de una sola
// puerta — la misma forma que tuvo la caída del 2026-09-09.

// La misma app que corre en producción, con la única diferencia de la bandera.
// Se arma sobre el container de los tests para compartir base y sesiones con
// la app normal: así se puede probar qué pasa con una sesión abierta ANTES del
// bloqueo.
function appBloqueada() {
  const container = getTestContainer();
  const config = {
    ...container.config,
    superadmin: { ...container.config.superadmin, bloqueado: true }
  };
  return createApp({ ...container, config });
}

describe('superadmin bloqueado por contraseña por defecto', () => {
  let bloqueada;

  beforeAll(() => {
    bloqueada = appBloqueada();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  test('la pantalla de login explica que el acceso está deshabilitado', async () => {
    const res = await request(bloqueada).get('/superadmin/login').set('Host', 'localhost');
    expect(res.status).toBe(403);
    expect(res.text).toContain('SUPER_PASS_HASH');
  });

  test('las credenciales por defecto ya no abren sesión', async () => {
    const agente = request.agent(bloqueada);
    const login = await agente
      .post('/superadmin/login')
      .set('Host', 'localhost')
      .type('form')
      .send({ email: 'admin@enelmapa.co', password: 'super2026' });
    expect(login.status).toBe(403);

    const panel = await agente.get('/superadmin').set('Host', 'localhost');
    expect(panel.status).toBe(403);
  });

  test('una sesión abierta ANTES del bloqueo pierde el acceso', async () => {
    // Las sesiones viven en MySQL y sobreviven a un deploy. Sin esto, quien
    // hubiera entrado con la contraseña publicada seguiría adentro.
    const normal = createTestApp();
    const login = await request(normal)
      .post('/superadmin/login')
      .set('Host', 'localhost')
      .type('form')
      .send({ email: 'admin@enelmapa.co', password: 'super2026' });
    const cookie = login.headers['set-cookie'];
    expect(cookie).toBeDefined();

    // Con la app normal, la sesión funciona.
    const antes = await request(normal).get('/superadmin').set('Host', 'localhost').set('Cookie', cookie);
    expect(antes.status).toBe(200);

    // La app bloqueada la rechaza...
    const bloqueo = await request(bloqueada).get('/superadmin').set('Host', 'localhost').set('Cookie', cookie);
    expect(bloqueo.status).toBe(403);

    // ...y le quita la marca: aunque se levante el bloqueo, esa sesión ya no
    // sirve y hay que volver a entrar.
    const despues = await request(normal).get('/superadmin').set('Host', 'localhost').set('Cookie', cookie);
    expect(despues.status).toBe(302);
    expect(despues.headers.location).toBe('/superadmin/login');
  });

  describe('el resto de la plataforma sigue funcionando', () => {
    test('la landing responde', async () => {
      const res = await request(bloqueada).get('/').set('Host', 'localhost');
      expect(res.status).toBe(200);
    });

    test('el menú de un negocio responde', async () => {
      await createBusiness({
        slug: 'bloqueo-menu',
        name: 'Negocio del bloqueo',
        adminEmail: 'admin-bloqueo@test.local',
        adminPassword: 'password-bloqueo-123'
      });
      const res = await request(bloqueada).get('/s/bloqueo-menu').set('Host', 'localhost');
      expect(res.status).toBe(200);
    });

    test('el panel de un negocio sigue permitiendo iniciar sesión', async () => {
      await createBusiness({
        slug: 'bloqueo-admin',
        name: 'Negocio admin',
        adminEmail: 'admin-panel@test.local',
        adminPassword: 'password-panel-123'
      });
      const res = await request(bloqueada)
        .post('/admin/login')
        .set('Host', 'localhost')
        .type('form')
        .send({ email: 'admin-panel@test.local', password: 'password-panel-123' });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/admin/dashboard');
    });
  });
});

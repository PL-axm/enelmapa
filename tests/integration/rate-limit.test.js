const request = require('supertest');
const { loadConfig } = require('../../config');
const { createApp } = require('../../app');
const { getTestContainer, getTestPool } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createBusiness } = require('../helpers/fixtures');

// El resto de la suite corre con el limitador desactivado (ver
// tests/env.setup.js): hace decenas de logins desde la misma IP y chocaría
// contra un límite pensado para atacantes.
//
// Acá se arma una app aparte, con la misma DB pero un límite chico, para
// probar el limitador de verdad en vez de darlo por bueno.
function appConLimite({ loginMax = 3, superMax = 2 } = {}) {
  const { repos, services, sessionStore, logger } = getTestContainer();
  const config = loadConfig({
    ...process.env,
    RATE_LIMIT_LOGIN_MAX: String(loginMax),
    RATE_LIMIT_SUPER_MAX: String(superMax),
    RATE_LIMIT_WINDOW_MIN: '15'
  });
  return createApp({ repos, services, config, sessionStore, logger });
}

describe('rate limiting de los logins (S5)', () => {
  let business;

  beforeEach(async () => {
    await resetDb();
    business = await createBusiness({
      slug: 'test-rate',
      name: 'Test Rate',
      adminEmail: 'rate@test.local',
      adminPassword: 'password-correcto-123'
    });
  });

  afterAll(async () => {
    await closeDb();
  });

  async function intentarLogin(app, password) {
    return request(app).post('/admin/login').type('form')
      .send({ email: business.adminEmail, password });
  }

  test('los primeros intentos fallidos pasan, y a partir del límite responde 429', async () => {
    const app = appConLimite({ loginMax: 3 });

    for (let i = 0; i < 3; i++) {
      const res = await intentarLogin(app, 'mala');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Credenciales incorrectas');
    }

    const bloqueado = await intentarLogin(app, 'mala');
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.text).toContain('Demasiados intentos');
  });

  // Si contara también los aciertos, una oficina detrás de una sola IP se
  // quedaría sin poder entrar por usarlo normalmente.
  test('los logins exitosos no gastan cupo', async () => {
    const app = appConLimite({ loginMax: 3 });

    for (let i = 0; i < 6; i++) {
      const res = await intentarLogin(app, business.adminPassword);
      expect(res.status).toBe(302);
    }

    // Después de 6 aciertos el cupo sigue entero: 3 fallos todavía pasan.
    for (let i = 0; i < 3; i++) {
      expect((await intentarLogin(app, 'mala')).status).toBe(200);
    }
    expect((await intentarLogin(app, 'mala')).status).toBe(429);
  });

  test('el superadmin tiene su propio cupo, más estricto', async () => {
    const app = appConLimite({ loginMax: 3, superMax: 2 });
    const intento = () => request(app).post('/superadmin/login').type('form')
      .send({ email: 'admin@enelmapa.co', password: 'mala' });

    expect((await intento()).status).toBe(200);
    expect((await intento()).status).toBe(200);
    expect((await intento()).status).toBe(429);
  });

  test('con max=0 el limitador queda desactivado (lo que usa la suite)', async () => {
    const app = appConLimite({ loginMax: 0 });

    for (let i = 0; i < 12; i++) {
      expect((await intentarLogin(app, 'mala')).status).toBe(200);
    }
  });

  // El 429 sale del error handler central, así que respeta el mismo contrato
  // que el resto: JSON para /api, HTML para las páginas.
  test('el 429 respeta el formato pedido por el cliente', async () => {
    const app = appConLimite({ loginMax: 1 });

    await intentarLogin(app, 'mala');
    const res = await request(app).post('/admin/login')
      .set('Accept', 'application/json')
      .type('form')
      .send({ email: business.adminEmail, password: 'mala' });

    expect(res.status).toBe(429);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/Demasiados intentos/);
  });
});

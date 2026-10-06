const request = require('supertest');
const { loadConfig } = require('../../config');
const { createApp } = require('../../app');
const { createTestApp, getTestContainer, getTestPool, getTestRepos } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createTwoBusinesses } = require('../helpers/fixtures');
const { loginAdmin } = require('../helpers/sesion');

const app = createTestApp();

const NAVEGADOR = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

// El beacon de estadísticas del menú público (routes/eventos.js). Lo manda
// cualquier visitante, sin sesión: estos tests cuidan que sume lo que tiene que
// sumar, que descarte lo que no, y que no se convierta en una puerta para ver o
// tocar datos de otro negocio.

function evento(slug, datos, { ua = NAVEGADOR } = {}) {
  return request(app)
    .post('/s/' + slug + '/evento')
    .set('User-Agent', ua)
    .type('form')
    .send(datos);
}

async function eventosDe(businessId) {
  const [filas] = await getTestPool().query(
    'SELECT tipo, product_id, origen, visitante, dia, hora FROM menu_events WHERE business_id = ? ORDER BY id',
    [businessId]
  );
  return filas;
}

describe('beacon de estadísticas: POST /s/:slug/evento', () => {
  let businessA;
  let businessB;

  beforeEach(async () => {
    await resetDb();
    ({ businessA, businessB } = await createTwoBusinesses());
  });

  afterAll(async () => {
    await closeDb();
  });

  test('una visita responde 204 y queda registrada con día, hora y visitante', async () => {
    const res = await evento(businessA.slug, { tipo: 'visita' });
    expect(res.status).toBe(204);

    const filas = await eventosDe(businessA.businessId);
    expect(filas).toHaveLength(1);
    expect(filas[0].tipo).toBe('visita');
    expect(filas[0].origen).toBe('directo');
    expect(filas[0].visitante).toMatch(/^[0-9a-f]{16}$/);
    expect(filas[0].hora).toBeGreaterThanOrEqual(0);
    expect(filas[0].hora).toBeLessThanOrEqual(23);
  });

  test('la marca del QR queda como origen', async () => {
    await evento(businessA.slug, { tipo: 'visita', o: 'qr' });
    const [fila] = await eventosDe(businessA.businessId);
    expect(fila.origen).toBe('qr');
  });

  test('el referrer se clasifica en el servidor', async () => {
    await evento(businessA.slug, { tipo: 'visita', ref: 'l.instagram.com' });
    const [fila] = await eventosDe(businessA.businessId);
    expect(fila.origen).toBe('instagram');
  });

  test('un producto visto guarda el producto y no lleva origen', async () => {
    await evento(businessA.slug, { tipo: 'producto', product_id: businessA.productId, o: 'qr' });
    const [fila] = await eventosDe(businessA.businessId);
    expect(fila.tipo).toBe('producto');
    expect(fila.product_id).toBe(businessA.productId);
    expect(fila.origen).toBeNull();
  });

  test('un clic a WhatsApp no guarda producto aunque venga uno', async () => {
    await evento(businessA.slug, { tipo: 'whatsapp', product_id: businessA.productId });
    const [fila] = await eventosDe(businessA.businessId);
    expect(fila.tipo).toBe('whatsapp');
    expect(fila.product_id).toBeNull();
  });

  test('el mismo visitante da la misma huella dos veces en el día', async () => {
    await evento(businessA.slug, { tipo: 'visita' });
    await evento(businessA.slug, { tipo: 'visita' });
    const filas = await eventosDe(businessA.businessId);
    expect(filas[0].visitante).toBe(filas[1].visitante);
  });

  describe('validación', () => {
    test('un tipo desconocido es 400 y no inserta nada', async () => {
      const res = await evento(businessA.slug, { tipo: 'compra' });
      expect(res.status).toBe(400);
      expect(await eventosDe(businessA.businessId)).toHaveLength(0);
    });

    test('un producto visto sin producto es 400', async () => {
      const res = await evento(businessA.slug, { tipo: 'producto' });
      expect(res.status).toBe(400);
    });

    test('un product_id que no es número es 400', async () => {
      const res = await evento(businessA.slug, { tipo: 'producto', product_id: 'abc' });
      expect(res.status).toBe(400);
    });

    test('un referrer larguísimo es 400', async () => {
      const res = await evento(businessA.slug, { tipo: 'visita', ref: 'x'.repeat(300) });
      expect(res.status).toBe(400);
    });

    test('acepta JSON además de formulario', async () => {
      const res = await request(app)
        .post('/s/' + businessA.slug + '/evento')
        .set('User-Agent', NAVEGADOR)
        .send({ tipo: 'visita' });
      expect(res.status).toBe(204);
      expect(await eventosDe(businessA.businessId)).toHaveLength(1);
    });
  });

  describe('lo que se descarta en silencio', () => {
    // Un 404 acá diría qué slugs existen: el endpoint se volvería un
    // enumerador de clientes de la plataforma.
    test('un slug inexistente responde 204 igual, y no inserta nada', async () => {
      const res = await evento('no-existe-este-negocio', { tipo: 'visita' });
      expect(res.status).toBe(204);

      const [[{ total }]] = await getTestPool().query('SELECT COUNT(*) AS total FROM menu_events');
      expect(total).toBe(0);
    });

    test('un bot responde 204 y no cuenta', async () => {
      const res = await evento(businessA.slug, { tipo: 'visita' }, { ua: 'Googlebot/2.1 (+http://www.google.com/bot.html)' });
      expect(res.status).toBe(204);
      expect(await eventosDe(businessA.businessId)).toHaveLength(0);
    });

    test('sin user-agent no cuenta', async () => {
      const res = await evento(businessA.slug, { tipo: 'visita' }, { ua: '' });
      expect(res.status).toBe(204);
      expect(await eventosDe(businessA.businessId)).toHaveLength(0);
    });
  });

  describe('tenant scoping', () => {
    test('el evento cae en el negocio del slug, y en ningún otro', async () => {
      await evento(businessA.slug, { tipo: 'visita' });
      expect(await eventosDe(businessA.businessId)).toHaveLength(1);
      expect(await eventosDe(businessB.businessId)).toHaveLength(0);
    });

    // Mandar el id de un producto de B al slug de A no toca nada de B: el
    // evento queda en A, y las lecturas (fase 2) hacen JOIN scopeado, así que
    // nunca va a aparecer en el tablero de nadie.
    test('un product_id de otro negocio queda en el negocio del slug, no en el del producto', async () => {
      await evento(businessA.slug, { tipo: 'producto', product_id: businessB.productId });
      expect(await eventosDe(businessA.businessId)).toHaveLength(1);
      expect(await eventosDe(businessB.businessId)).toHaveLength(0);
    });

    test('borrar el negocio borra sus eventos (cascada)', async () => {
      await evento(businessA.slug, { tipo: 'visita' });
      await getTestPool().query('DELETE FROM businesses WHERE id = ?', [businessA.businessId]);
      const [[{ total }]] = await getTestPool().query('SELECT COUNT(*) AS total FROM menu_events');
      expect(total).toBe(0);
    });

    test('el repo no se puede usar sin negocio', () => {
      const repos = getTestRepos();
      expect(repos.events.registrar).toBeUndefined();
      expect(() => repos.events.forBusiness(null)).toThrow();
      expect(() => repos.events.forBusiness('1')).toThrow();
    });
  });

  // El beacon no lleva token CSRF —el visitante no tiene sesión—, pero un
  // dueño logueado que mira su propio menú en /s/slug SÍ la tiene, y sin la
  // exención cada evento le daría 403.
  test('pasa sin token CSRF aunque haya una sesión de admin', async () => {
    const admin = await loginAdmin(app, { email: businessA.adminEmail, password: businessA.adminPassword });
    const res = await admin.sinCsrf
      .post('/s/' + businessA.slug + '/evento')
      .set('User-Agent', NAVEGADOR)
      .type('form')
      .send({ tipo: 'visita' });

    expect(res.status).toBe(204);
  });

  // La exención es SÓLO para el beacon: el resto de las mutaciones con sesión
  // siguen exigiendo token.
  test('la exención no se extiende a otras rutas', async () => {
    const admin = await loginAdmin(app, { email: businessA.adminEmail, password: businessA.adminPassword });
    const res = await admin.sinCsrf.post('/api/categories').send({ name: 'Sin token' });
    expect(res.status).toBe(403);
  });

  describe('rate limit', () => {
    function appConLimite(max) {
      const { repos, services, sessionStore, logger } = getTestContainer();
      const config = loadConfig({ ...process.env, RATE_LIMIT_EVENTOS_MAX: String(max) });
      return createApp({ repos, services, config, sessionStore, logger });
    }

    test('a partir del límite responde 429 y deja de contar', async () => {
      const limitada = appConLimite(3);
      const enviar = () => request(limitada)
        .post('/s/' + businessA.slug + '/evento')
        .set('User-Agent', NAVEGADOR)
        .type('form')
        .send({ tipo: 'visita' });

      for (let i = 0; i < 3; i++) {
        expect((await enviar()).status).toBe(204);
      }
      expect((await enviar()).status).toBe(429);
      expect(await eventosDe(businessA.businessId)).toHaveLength(3);
    });
  });

  // El menú tiene que traer el beacon, en los dos skins: va en el shell, no en
  // cada skin, justamente para que ninguno quede sin medir.
  test('el menú público incluye el beacon de su propio negocio', async () => {
    const res = await request(app).get('/s/' + businessA.slug);
    expect(res.status).toBe(200);
    expect(res.text).toContain("'/s/' + encodeURIComponent(\"test-negocio-a\") + '/evento'");
    expect(res.text).toContain("registrarEvento({ tipo: 'visita'");
    expect(res.text).toContain("registrarEvento({ tipo: 'producto'");
  });
});

const request = require('supertest');
const { createTestApp, getTestPool, getTestContainer } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');

const app = createTestApp();

// La raíz del dominio es la landing de la plataforma: la única página que ve
// alguien que todavía no es cliente. Antes era un listado plano de todos los
// negocios.
//
// `Host: localhost` en cada petición no es adorno. Un host con tres partes
// (127.0.0.1, por ejemplo) hace que getSubdomain lo lea como el slug de un
// negocio y la request termine en un 404 de tenant en vez de en la landing.

async function crearNegocios(cantidad, { conLogo = true } = {}) {
  const db = getTestPool();
  for (let i = 1; i <= cantidad; i++) {
    const n = String(i).padStart(2, '0');
    await db.query(
      'INSERT INTO businesses (slug, name, logo_img, is_open) VALUES (?, ?, ?, 1)',
      ['negocio-' + n, 'Negocio ' + n, conLogo ? '/uploads/1/logo-' + n + '.png' : null]
    );
  }
}

function pedirLanding() {
  return request(app).get('/').set('Host', 'localhost');
}

describe('landing de la plataforma', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeDb();
  });

  test('GET / renderiza la landing, no un menú', async () => {
    const res = await pedirLanding();
    expect(res.status).toBe(200);
    expect(res.text).toContain('EnElMapa');
    expect(res.text).toContain('id="contenido"');
  });

  test('ofrece iniciar sesión, que es la puerta del cliente que ya compró', async () => {
    const res = await pedirLanding();
    expect(res.text).toContain('/admin/login');
  });

  test('el CTA lleva al WhatsApp configurado', async () => {
    const { config } = getTestContainer();
    const res = await pedirLanding();

    // Contra el valor de config, no contra un número escrito acá: si mañana
    // cambia el contacto, este test no tiene por qué fallar.
    expect(res.text).toContain('wa.me/' + config.contacto.whatsapp);
    expect(res.text).toContain(config.contacto.email);
  });

  test('funciona sin ningún negocio cargado', async () => {
    // La plataforma recién instalada no tiene clientes, y la landing es
    // justamente lo que se muestra para conseguirlos. `businesses[0]` sin
    // guarda reventaría acá.
    const res = await pedirLanding();
    expect(res.status).toBe(200);
    expect(res.text).toContain('wa.me/');
  });

  describe('franja de negocios', () => {
    test('el tope de 12 lo pone el SQL, no la vista', async () => {
      await crearNegocios(15);

      // Recortar en el EJS no evitaría traer las 15 filas, sólo las
      // escondería — y la consulta seguiría creciendo con la cartera.
      const { repos } = getTestContainer();
      const filas = await repos.businesses.platform.listForHome();
      expect(filas).toHaveLength(12);
    });

    test('la página muestra como mucho 12 negocios', async () => {
      await crearNegocios(15);

      const res = await pedirLanding();

      // Se cuentan los ítems de la franja y no los enlaces a /s/, porque el
      // botón "Ver uno real" del hero también apunta a un negocio y sumaba uno
      // de más.
      const items = res.text.match(/class="logo-item/g) || [];
      expect(items.length).toBeLessThanOrEqual(12);
      expect(items.length).toBeGreaterThan(0);
    });

    test('los que tienen logo van primero', async () => {
      const db = getTestPool();
      await db.query(
        "INSERT INTO businesses (slug, name, logo_img, is_open) VALUES ('zzz-con-logo', 'ZZZ Con Logo', '/uploads/1/z.png', 1)"
      );
      await db.query(
        "INSERT INTO businesses (slug, name, logo_img, is_open) VALUES ('aaa-sin-logo', 'AAA Sin Logo', NULL, 1)"
      );

      const { repos } = getTestContainer();
      const filas = await repos.businesses.platform.listForHome();

      // Alfabéticamente 'AAA' iría primero; el logo lo desempata antes que el
      // nombre porque es el que se ve bien en la franja.
      expect(filas[0].slug).toBe('zzz-con-logo');
    });
  });

  test('un nombre de negocio con HTML no se ejecuta', async () => {
    const db = getTestPool();
    // El mismo payload que rompió el menú público en su momento. Acá el nombre
    // va a texto y a un atributo alt, así que tiene que salir escapado.
    await db.query(
      'INSERT INTO businesses (slug, name, logo_img, is_open) VALUES (?, ?, ?, 1)',
      ['malicioso', '</script><img src=x onerror=window.__xss=1>', '/uploads/1/x.png']
    );

    const res = await pedirLanding();

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<img src=x onerror=');
    expect(res.text).toContain('&lt;/script&gt;');
  });

  test('el menú de un negocio sigue estando en /s/:slug', async () => {
    await crearNegocios(1);

    // La landing se metió en la raíz; esto verifica que no se llevó puesta la
    // resolución de tenants por ruta.
    const res = await request(app).get('/s/negocio-01').set('Host', 'localhost');
    expect(res.status).toBe(200);
  });

  test('una ruta que no existe sigue dando 404', async () => {
    const res = await request(app).get('/no-existe').set('Host', 'localhost');
    expect(res.status).toBe(404);
  });
});

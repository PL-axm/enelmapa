const request = require('supertest');
const { createTestApp, getTestPool } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createBusiness } = require('../helpers/fixtures');
const tema = require('../../theme');

const app = createTestApp();

afterAll(async () => {
  await closeDb();
});

// La Fase 2 partió views/menu.ejs en armazón + skin. Estos tests fijan la parte
// del corte que un cambio futuro podría deshacer sin que nada más se queje: que
// el skin efectivamente se incluya, que el contrato exista, y que el valor de la
// columna no pueda elegir un archivo arbitrario.
describe('skins del menú', () => {
  let business;

  beforeEach(async () => {
    await resetDb();
    business = await createBusiness({
      slug: 'test-skins',
      name: 'Test Skins',
      adminEmail: 'skins@test.local',
      adminPassword: 'password-skins-123'
    });
  });

  test('el menú incluye el skin y su contrato', async () => {
    const res = await request(app).get('/s/test-skins');

    expect(res.status).toBe(200);
    expect(res.text).toContain('window.SKIN');
    expect(res.text).toContain('tarjetaProducto');
    expect(res.text).toContain('contenedorProductos');
  });

  test('el CSS de las tarjetas viene del skin, el del chrome del armazón', async () => {
    const res = await request(app).get('/s/test-skins');

    // Las dos mitades tienen que estar presentes; si el include se rompiera, el
    // menú se vería sin estilos de producto y con el chrome intacto.
    expect(res.text).toContain('.product-card');
    expect(res.text).toContain('.cat-nav');
  });

  test('un negocio nuevo arranca en el skin por defecto', async () => {
    const [filas] = await getTestPool().query(
      'SELECT menu_template FROM businesses WHERE id = ?', [business.businessId]
    );

    expect(filas[0].menu_template).toBe(tema.TEMPLATE_POR_DEFECTO);
  });

  // Este es el que importa de seguridad: la columna es un VARCHAR y nada impide
  // escribirle cualquier cosa por fuera de la app (una consulta a mano, una
  // restauración vieja). El menú tiene que seguir renderizando el skin por
  // defecto, no intentar incluir ese path.
  test('un menu_template inválido en la base cae al por defecto y no rompe', async () => {
    for (const valor of ['../../package', 'noExiste', '', 'clasico/../../app']) {
      await getTestPool().query(
        'UPDATE businesses SET menu_template = ? WHERE id = ?', [valor, business.businessId]
      );

      const res = await request(app).get('/s/test-skins');

      expect(res.status).toBe(200);
      expect(res.text).toContain('window.SKIN');
      expect(res.text).toContain('.product-card');
    }
  });

  test('el buscador y el menú usan el mismo constructor de tarjeta', async () => {
    // Antes había dos: el del menú con `textContent` y el de la búsqueda con
    // `innerHTML` concatenando el nombre del producto. La forma de que no vuelvan
    // a divergir es que haya una sola llamada por lugar y ninguna construcción
    // de tarjeta a mano en el armazón.
    const res = await request(app).get('/s/test-skins');

    const usos = (res.text.match(/SKIN\.tarjetaProducto\(/g) || []).length;
    expect(usos).toBe(2);   // el menú y la búsqueda

    // Y que no haya quedado un `innerHTML` armando product-name en el camino.
    expect(res.text).not.toMatch(/innerHTML\s*=\s*'<div class="product-name"/);
  });
});

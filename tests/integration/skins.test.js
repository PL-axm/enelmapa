const request = require('supertest');
const { createTestApp, getTestPool } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createBusiness } = require('../helpers/fixtures');
const { loginAdmin } = require('../helpers/sesion');
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

// === Fase 7: el skin en cuadrícula ===
describe('skin en cuadrícula', () => {
  let business;

  beforeEach(async () => {
    await resetDb();
    business = await createBusiness({
      slug: 'test-grilla',
      name: 'Test Grilla',
      adminEmail: 'grilla@test.local',
      adminPassword: 'password-grilla-123'
    });
  });

  const usarGrilla = () => getTestPool().query(
    'UPDATE businesses SET menu_template = ? WHERE id = ?', ['grilla', business.businessId]
  );

  test('está declarado en el registro y tiene su archivo', () => {
    expect(tema.esTemplateValido('grilla')).toBe(true);
    expect(tema.plantillaOPorDefecto('grilla')).toBe('grilla');
  });

  test('el menú carga el skin de grilla cuando está elegido', async () => {
    await usarGrilla();

    const res = await request(app).get('/s/test-grilla');

    expect(res.status).toBe(200);
    expect(res.text).toContain('.product-grid');
    expect(res.text).toContain('grid-template-columns: repeat(2, 1fr)');
    // Y no el del clásico: son excluyentes, se incluye uno solo.
    expect(res.text).not.toContain('.product-card:last-child { border-bottom: none; }');
  });

  test('con el clásico elegido no aparece nada de la grilla', async () => {
    const res = await request(app).get('/s/test-grilla');

    expect(res.text).not.toContain('.product-grid');
    expect(res.text).toContain('.product-card:last-child');
  });

  test('los dos skins cumplen el mismo contrato', async () => {
    for (const id of tema.idsDeTemplates()) {
      await getTestPool().query(
        'UPDATE businesses SET menu_template = ? WHERE id = ?', [id, business.businessId]
      );

      const res = await request(app).get('/s/test-grilla');

      expect(res.text).toContain('window.SKIN');
      expect(res.text).toContain('contenedorProductos');
      expect(res.text).toContain('tarjetaProducto');
    }
  });

  // El armazón usa `.product-price-old` y `.promo-badge` en el modal de producto,
  // y esas clases estaban declaradas en el skin clásico: con un segundo skin que
  // no las declarara, el modal habría quedado sin estilo. Se movieron al armazón.
  test('los estilos del precio en promoción están en el armazón, no en el skin', async () => {
    for (const id of tema.idsDeTemplates()) {
      await getTestPool().query(
        'UPDATE businesses SET menu_template = ? WHERE id = ?', [id, business.businessId]
      );

      const res = await request(app).get('/s/test-grilla');

      expect(res.text).toContain('.product-price-old {');
      expect(res.text).toContain('.promo-badge {');
    }
  });

  test('la grilla también aplica a los resultados de la búsqueda', async () => {
    // El armazón mete esas tarjetas directo en #searchResults sin pasar por
    // `contenedorProductos()`, así que el skin tiene que declarar la grilla ahí
    // también o quedarían a ancho completo con la foto gigante.
    await usarGrilla();

    const res = await request(app).get('/s/test-grilla');

    expect(res.text).toMatch(/\.search-results \{[^}]*display: grid/);
  });

  test('un producto sin foto usa el cuadrado con la inicial', async () => {
    await usarGrilla();

    const res = await request(app).get('/s/test-grilla');

    expect(res.text).toContain('product-img-vacia');
    expect(res.text).toContain("charAt(0).toUpperCase()");
  });

  describe('el selector del panel', () => {
    test('ofrece los dos skins y marca el actual', async () => {
      await usarGrilla();

      const agent = await loginAdmin(app, {
        email: business.adminEmail,
        password: business.adminPassword
      });
      const res = await agent.get('/admin/settings');

      for (const id of tema.idsDeTemplates()) {
        expect(res.text).toContain('name="menu_template" value="' + id + '"');
      }
      expect(res.text).toMatch(/name="menu_template" value="grilla" checked/);
    });

    test('el dueño puede cambiarlo y el menú lo refleja', async () => {
      const agent = await loginAdmin(app, {
        email: business.adminEmail,
        password: business.adminPassword
      });

      const guardado = await agent.post('/api/settings').type('form')
        .send({ name: business.name, menu_template: 'grilla' });
      expect(guardado.status).toBe(200);

      const [filas] = await getTestPool().query(
        'SELECT menu_template FROM businesses WHERE id = ?', [business.businessId]
      );
      expect(filas[0].menu_template).toBe('grilla');

      const menu = await request(app).get('/s/test-grilla');
      expect(menu.text).toContain('.product-grid');
    });

    test('rechaza un skin inventado', async () => {
      const agent = await loginAdmin(app, {
        email: business.adminEmail,
        password: business.adminPassword
      });

      const res = await agent.post('/api/settings').type('form')
        .send({ name: business.name, menu_template: 'rappi' });

      expect(res.status).toBe(400);
    });
  });

  test('el skin es independiente de la paleta y de la escala', async () => {
    // Los tres ejes se combinan libremente: si elegir uno pisara otro, esto falla.
    await getTestPool().query(
      'UPDATE businesses SET menu_template = ?, menu_theme = ?, menu_scale = ? WHERE id = ?',
      ['grilla', 'navy', 'compacto', business.businessId]
    );

    const res = await request(app).get('/s/test-grilla');

    expect(res.text).toContain('.product-grid');
    expect(res.text).toContain('--bg: #1a1a2e;');
    expect(res.text).toContain('--escala: 0.92;');
  });
});

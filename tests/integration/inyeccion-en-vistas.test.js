const request = require('supertest');
const { createTestApp, getTestPool } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createBusiness } = require('../helpers/fixtures');
const { loginAdmin } = require('../helpers/sesion');

const app = createTestApp();

afterAll(async () => {
  await closeDb();
});

// El nombre que rompía el menú público. `JSON.stringify` no escapa `<`, y
// views/menu.ejs inyectaba su salida cruda dentro de un `<script>`: esto cerraba
// la etiqueta y el resto se parseaba como HTML, o sea ejecución en el navegador
// de cualquier visitante del menú, en el mismo origen que el panel. El nombre lo
// escribe el dueño del negocio.
const PAYLOAD_SCRIPT = '</script><img src=x onerror=window.__xss=1>';

// Y el que rompe el panel: es la descripción REAL de un producto de El Silvestre
// ("pico e' gallo"). La comilla simple cerraba el atributo `onclick='…'`.
const DESC_CON_APOSTROFO = "Papas francesas, ropa vieja, pico e' gallo";

async function crearProducto(business, { name, description }) {
  const db = getTestPool();
  const [r] = await db.query(
    'INSERT INTO products (business_id, category_id, name, description, price, sort_order) VALUES (?, ?, ?, ?, ?, 1)',
    [business.businessId, business.categoryId, name, description, 15000]
  );
  return r.insertId;
}

describe('inyección a través de datos del negocio', () => {
  let business;

  beforeEach(async () => {
    await resetDb();
    business = await createBusiness({
      slug: 'test-inyeccion',
      name: 'Test Inyección',
      adminEmail: 'inyeccion@test.local',
      adminPassword: 'password-iny-123'
    });
  });

  describe('menú público', () => {
    test('un nombre con </script> no cierra la etiqueta', async () => {
      await crearProducto(business, { name: PAYLOAD_SCRIPT, description: '' });

      const res = await request(app).get('/s/test-inyeccion');

      expect(res.status).toBe(200);
      // La prueba de fondo: el payload NO aparece crudo en ninguna parte.
      expect(res.text).not.toContain('</script><img');
      expect(res.text).toContain('\\u003c/script\\u003e');
    });

    test('las etiquetas <script> quedan balanceadas', async () => {
      // Más directo que buscar el payload: un `</script>` que venga del dato no
      // tiene apertura, así que las cuentas se desbalancean. Se comparan entre sí
      // en vez de fijar un número, porque desde la Fase 2 la página trae el
      // script del armazón más el del skin, y van a ser más cuando haya otros.
      await crearProducto(business, { name: PAYLOAD_SCRIPT, description: '' });

      const res = await request(app).get('/s/test-inyeccion');
      const aperturas = (res.text.match(/<script[\s>]/g) || []).length;
      const cierres = (res.text.match(/<\/script>/g) || []).length;

      expect(cierres).toBe(aperturas);
      expect(aperturas).toBeGreaterThan(0);
    });

    test('el dato sigue llegando entero al cliente', async () => {
      // No alcanza con que no se ejecute: el nombre tiene que verse bien. Se
      // parsea el JSON como lo haría el navegador y se compara con lo guardado.
      await crearProducto(business, { name: PAYLOAD_SCRIPT, description: DESC_CON_APOSTROFO });

      const res = await request(app).get('/s/test-inyeccion');
      const json = res.text.match(/const menuData = (.+);/)[1];
      const data = JSON.parse(json);

      const productos = data.flatMap(c => c.products);
      const elNuestro = productos.find(p => p.name === PAYLOAD_SCRIPT);

      expect(elNuestro).toBeDefined();
      expect(elNuestro.desc).toBe(DESC_CON_APOSTROFO);
    });

    test('un comentario HTML tampoco se cuela', async () => {
      await crearProducto(business, { name: '<!--', description: '-->' });

      const res = await request(app).get('/s/test-inyeccion');

      expect(res.text).not.toContain('<!--');
      expect(res.text).not.toContain('-->');
    });
  });

  describe('panel de productos', () => {
    test('un apóstrofo en la descripción no corta el atributo onclick', async () => {
      await crearProducto(business, { name: 'Cazuela', description: DESC_CON_APOSTROFO });

      const agent = await loginAdmin(app, {
        email: business.adminEmail,
        password: business.adminPassword
      });
      const res = await agent.get('/admin/products');

      expect(res.status).toBe(200);
      // Si el apóstrofo saliera crudo, el atributo terminaría en `pico e'`.
      expect(res.text).not.toContain("pico e' gallo");
      expect(res.text).toContain('pico e\\u0027 gallo');
    });

    test('cada botón Editar tiene su atributo completo', async () => {
      // Se extrae el atributo COMO LO CORTA EL NAVEGADOR: el valor termina en la
      // primera comilla simple después de `onclick='`. Eso es lo que hace que el
      // bug importe, y buscar el JSON con un regex tolerante no lo detecta —un
      // apóstrofo crudo adentro de un string JSON es JSON perfectamente válido,
      // así que un test que sólo hiciera `JSON.parse` pasaría con el bug puesto.
      await crearProducto(business, { name: 'Con apóstrofo', description: DESC_CON_APOSTROFO });
      await crearProducto(business, { name: PAYLOAD_SCRIPT, description: 'normal' });

      const agent = await loginAdmin(app, {
        email: business.adminEmail,
        password: business.adminPassword
      });
      const res = await agent.get('/admin/products');

      const atributos = [...res.text.matchAll(/onclick='([^']*)'/g)].map(m => m[1]);
      expect(atributos.length).toBe(3);   // el del fixture + los dos de acá

      for (const valor of atributos) {
        // Truncado en `pico e` esto no cierra, y es exactamente el síntoma.
        expect(valor).toMatch(/^editProd\(\{.*\}\)$/);
        expect(() => JSON.parse(valor.slice('editProd('.length, -1))).not.toThrow();
      }
    });
  });
});

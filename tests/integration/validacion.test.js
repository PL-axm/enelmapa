const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createTestApp, getTestPool } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createBusiness } = require('../helpers/fixtures');
const { loginAdmin } = require('../helpers/sesion');

const app = createTestApp();

// Un solo cierre por ARCHIVO, no por describe: el afterAll de un describe corre
// al terminar ese bloque, así que cerrar el pool ahí dejaría al siguiente
// describe del mismo archivo sin conexión.
afterAll(async () => {
  await closeDb();
});

// Verifica el efecto de la validación a través de HTTP: qué status sale y qué
// NO llega a la base.
describe('validación en el borde', () => {
  let business;
  let agent;

  beforeEach(async () => {
    await resetDb();
    business = await createBusiness({
      slug: 'test-val', name: 'Test Validación',
      adminEmail: 'val@test.local', adminPassword: 'password-val-123'
    });

    agent = await loginAdmin(app, { email: business.adminEmail, password: business.adminPassword });
  });

  async function contarProductos() {
    const [rows] = await getTestPool().query(
      'SELECT COUNT(*) as n FROM products WHERE business_id = ?', [business.businessId]
    );
    return Number(rows[0].n);
  }

  // Antes de esto, un precio no numérico llegaba como NaN a una columna DECIMAL
  // y MySQL respondía con error: un 500 por un dato mal escrito.
  describe('precio inválido (B5)', () => {
    test('un precio no numérico responde 400, no 500', async () => {
      const antes = await contarProductos();

      const res = await agent.post('/api/products')
        .field('name', 'Producto')
        .field('price', 'veinte mil')
        .field('category_id', String(business.categoryId));

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/número/);
      expect(await contarProductos()).toBe(antes);
    });

    test('un precio negativo responde 400', async () => {
      const res = await agent.post('/api/products')
        .field('name', 'Producto').field('price', '-100')
        .field('category_id', String(business.categoryId));

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/negativo/);
    });

    test('un precio válido sigue entrando y queda como número', async () => {
      const res = await agent.post('/api/products')
        .field('name', 'Producto OK').field('price', '20000')
        .field('category_id', String(business.categoryId));

      expect(res.status).toBe(200);
      const [rows] = await getTestPool().query('SELECT price FROM products WHERE id = ?', [res.body.id]);
      expect(Number(rows[0].price)).toBe(20000);
    });
  });

  describe('nombres', () => {
    test('una categoría sin nombre responde 400', async () => {
      const res = await agent.post('/api/categories').send({ name: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/vacío/);
    });

    test('un nombre se guarda recortado', async () => {
      const res = await agent.post('/api/categories').send({ name: '  Bebidas  ' });
      const [rows] = await getTestPool().query('SELECT name FROM categories WHERE id = ?', [res.body.id]);

      expect(rows[0].name).toBe('Bebidas');
    });
  });

  describe('reorder', () => {
    test('un "order" que no es array responde 400', async () => {
      expect((await agent.put('/api/categories/reorder').send({ order: 'reorder' })).status).toBe(400);
      expect((await agent.put('/api/categories/reorder').send({})).status).toBe(400);
    });

    test('un array de ids válidos sigue funcionando', async () => {
      expect((await agent.put('/api/categories/reorder')
        .send({ order: [business.categoryId] })).status).toBe(200);
    });
  });

  describe('horarios en settings', () => {
    test('un JSON malformado responde 400 con mensaje claro', async () => {
      const res = await agent.post('/api/settings')
        .field('name', 'Negocio').field('hours', '{roto');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/JSON válido/);
    });

    test('una hora inválida responde 400', async () => {
      const res = await agent.post('/api/settings')
        .field('name', 'Negocio')
        .field('hours', JSON.stringify([{ day_index: 1, open_time: '99:99', close_time: '20:00' }]));

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Hora inválida/);
    });

    test('un tema inventado responde 400', async () => {
      const res = await agent.post('/api/settings')
        .field('name', 'Negocio').field('menu_theme', 'fucsia');

      expect(res.status).toBe(400);
    });
  });

  // La validación de productos corre DESPUÉS de multer, así que cuando rechaza,
  // el archivo ya está escrito. Sin limpieza quedaría huérfano: ningún producto
  // lo referencia y nada lo borra nunca.
  describe('archivos huérfanos', () => {
    const dirDe = (id) => path.join(__dirname, '..', '..', 'uploads', String(id));

    function contarArchivos(id) {
      try { return fs.readdirSync(dirDe(id)).length; } catch (e) { return 0; }
    }

    test('un precio inválido con imagen adjunta no deja el archivo en disco', async () => {
      const png = Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a4944415478' +
        '9c6300010000050001' + '0d0a2db4' + '0000000049454e44ae426082', 'hex'
      );

      const antes = contarArchivos(business.businessId);

      const res = await agent.post('/api/products')
        .field('name', 'Con imagen').field('price', 'no-numerico')
        .field('category_id', String(business.categoryId))
        .attach('image', png, 'foto.png');

      expect(res.status).toBe(400);
      expect(contarArchivos(business.businessId)).toBe(antes);
    });
  });
});

// El mensaje que ve el usuario. Un campo simple no debe arrastrar el nombre
// técnico del campo; uno anidado sí, porque saber qué día de los siete falló
// es la mitad de la información.
describe('forma del mensaje de error', () => {
  let business;
  let agent;

  beforeEach(async () => {
    await resetDb();
    business = await createBusiness({
      slug: 'test-msg', name: 'Test Mensajes',
      adminEmail: 'msg@test.local', adminPassword: 'password-msg-123'
    });
    agent = await loginAdmin(app, { email: business.adminEmail, password: business.adminPassword });
  });

  test('un campo simple da un mensaje limpio, sin el nombre técnico', async () => {
    const res = await agent.post('/api/products')
      .field('name', 'X').field('price', 'abc')
      .field('category_id', String(business.categoryId));

    expect(res.body.error).toBe('El precio debe ser un número');
    expect(res.body.error).not.toMatch(/price/);
  });

  test('un campo anidado sí dice dónde falló', async () => {
    const res = await agent.post('/api/settings')
      .field('name', 'Negocio')
      .field('hours', JSON.stringify([
        { day_index: 0, open_time: '08:00', close_time: '20:00' },
        { day_index: 1, open_time: 'nope', close_time: '20:00' }
      ]));

    expect(res.body.error).toMatch(/Hora inválida/);
    expect(res.body.error).toMatch(/hours\.1\.open_time/);
  });
});

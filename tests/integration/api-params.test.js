const request = require('supertest');
const { createTestApp, getTestPool } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createBusiness } = require('../helpers/fixtures');
const { loginAdmin } = require('../helpers/sesion');

const app = createTestApp();

// Cubre B1: `PUT /api/categories/reorder` caía en el handler de
// `/categories/:id` (registrado antes) y ejecutaba
// `UPDATE categories SET name = NULL WHERE id = 'reorder'`. MySQL responde
// ER_TRUNCATED_WRONG_VALUE, nadie lo atrapa, y Node mata el proceso entero:
// un admin arrastrando una categoría desloguea a toda la plataforma.
//
// Estos tests cubren las dos mitades del arreglo: que /reorder llegue a su
// handler, y que ningún :id no numérico llegue nunca al SQL.
describe('parámetros y orden de rutas en /api', () => {
  let business;
  let agent;

  beforeEach(async () => {
    await resetDb();
    business = await createBusiness({
      slug: 'test-params',
      name: 'Test Params',
      adminEmail: 'admin-params@test.local',
      adminPassword: 'password-params-123'
    });

    agent = await loginAdmin(app, { email: business.adminEmail, password: business.adminPassword });
  });

  afterAll(async () => {
    await closeDb();
  });

  test('PUT /api/categories/reorder reordena de verdad (no cae en /:id)', async () => {
    const db = getTestPool();
    const [segunda] = await db.query(
      'INSERT INTO categories (business_id, name, sort_order) VALUES (?, ?, 1)',
      [business.businessId, 'Segunda categoría']
    );

    // La fixture crea la primera con sort_order 0; pedimos el orden invertido.
    const ordenInvertido = [segunda.insertId, business.categoryId];
    const res = await agent.put('/api/categories/reorder').send({ order: ordenInvertido });
    expect(res.status).toBe(200);

    const [rows] = await db.query(
      'SELECT id FROM categories WHERE business_id = ? ORDER BY sort_order',
      [business.businessId]
    );
    expect(rows.map(r => r.id)).toEqual(ordenInvertido);
  });

  test('el nombre de la categoría no se pisa al reordenar', async () => {
    await agent.put('/api/categories/reorder').send({ order: [business.categoryId] });

    const db = getTestPool();
    const [rows] = await db.query('SELECT name FROM categories WHERE id = ?', [business.categoryId]);
    expect(rows[0].name).toBe(business.name + ' categoría');
  });

  test('PUT /api/products/reorder reordena de verdad', async () => {
    const db = getTestPool();
    const [segundo] = await db.query(
      'INSERT INTO products (business_id, category_id, name, description, price, sort_order) VALUES (?, ?, ?, ?, ?, 1)',
      [business.businessId, business.categoryId, 'Segundo producto', '', 5000]
    );

    const ordenInvertido = [segundo.insertId, business.productId];
    const res = await agent.put('/api/products/reorder').send({ order: ordenInvertido });
    expect(res.status).toBe(200);

    const [rows] = await db.query(
      'SELECT id FROM products WHERE business_id = ? ORDER BY sort_order',
      [business.businessId]
    );
    expect(rows.map(r => r.id)).toEqual(ordenInvertido);
  });

  test('un "order" que no es array se rechaza con 400', async () => {
    const res = await agent.put('/api/categories/reorder').send({ order: 'reorder' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  // Sin el guard de :id, cada uno de estos llega al SQL como
  // `WHERE id = 'abc'` y tumba el proceso. El servidor tiene que seguir
  // en pie después de los cuatro.
  test.each([
    ['PUT', '/api/categories/abc'],
    ['DELETE', '/api/categories/abc'],
    ['PUT', '/api/products/abc'],
    ['DELETE', '/api/products/abc']
  ])('%s %s responde 400 en vez de tumbar el proceso', async (method, path) => {
    const res = await agent[method.toLowerCase()](path).send({ name: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('la app sigue respondiendo después de todos los ids inválidos', async () => {
    await agent.delete('/api/products/undefined');
    await agent.put('/api/categories/null').send({ name: 'x' });

    const res = await agent.get('/admin/dashboard');
    expect(res.status).toBe(200);
  });
});

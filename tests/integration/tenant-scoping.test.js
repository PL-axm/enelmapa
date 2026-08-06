const request = require('supertest');
const app = require('../../app');
const { getPool } = require('../../db/schema');
const { resetDb, closeDb } = require('../helpers/db');
const { createTwoBusinesses } = require('../helpers/fixtures');

// Cubre el riesgo #1 de BEST_PRACTICES.md: el filtro de business_id es
// manual en cada query (no hay repository/ORM que lo fuerce). Estos tests
// prueban que ese filtro manual efectivamente aísla los datos entre dos
// negocios distintos.
describe('tenant scoping (business_id)', () => {
  let businessA;
  let businessB;
  let agentA;
  let agentB;

  beforeEach(async () => {
    await resetDb();
    const businesses = await createTwoBusinesses();
    businessA = businesses.businessA;
    businessB = businesses.businessB;

    agentA = request.agent(app);
    await agentA.post('/admin/login').type('form')
      .send({ email: businessA.adminEmail, password: businessA.adminPassword });

    agentB = request.agent(app);
    await agentB.post('/admin/login').type('form')
      .send({ email: businessB.adminEmail, password: businessB.adminPassword });
  });

  afterAll(async () => {
    await closeDb();
  });

  test('GET /admin/categories de A nunca trae categorías de B', async () => {
    const res = await agentA.get('/admin/categories');
    expect(res.status).toBe(200);
    expect(res.text).toContain(businessA.name + ' categoría');
    expect(res.text).not.toContain(businessB.name + ' categoría');
  });

  test('POST /api/categories de A inserta con el business_id de A', async () => {
    const res = await agentA.post('/api/categories').send({ name: 'Nueva categoría de A' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const db = getPool();
    const [rows] = await db.query('SELECT business_id FROM categories WHERE id = ?', [res.body.id]);
    expect(rows[0].business_id).toBe(businessA.businessId);
  });

  test('PUT /api/categories/:id de A sobre una categoría de B no la modifica', async () => {
    const res = await agentA
      .put('/api/categories/' + businessB.categoryId)
      .send({ name: 'Hackeado por A' });

    // El WHERE incluye "AND business_id = ?" — no matchea ninguna fila de
    // A, así que el UPDATE afecta 0 filas, pero la ruta igual responde
    // {ok:true} (no distingue "actualizó algo" de "no encontró nada").
    // Lo que importa para la seguridad es el estado real en DB, no el
    // código HTTP.
    expect(res.status).toBe(200);

    const db = getPool();
    const [rows] = await db.query('SELECT name FROM categories WHERE id = ?', [businessB.categoryId]);
    expect(rows[0].name).toBe(businessB.name + ' categoría');
  });

  test('DELETE /api/categories/:id de A sobre una categoría de B no la borra', async () => {
    const res = await agentA.delete('/api/categories/' + businessB.categoryId);
    expect(res.status).toBe(200);

    const db = getPool();
    const [rows] = await db.query('SELECT id FROM categories WHERE id = ?', [businessB.categoryId]);
    expect(rows.length).toBe(1);
  });

  test('POST /api/products de A inserta con el business_id de A', async () => {
    const res = await agentA.post('/api/products')
      .field('name', 'Producto nuevo de A')
      .field('description', '')
      .field('price', '5000')
      .field('category_id', String(businessA.categoryId));

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const db = getPool();
    const [rows] = await db.query('SELECT business_id FROM products WHERE id = ?', [res.body.id]);
    expect(rows[0].business_id).toBe(businessA.businessId);
  });

  test('PUT /api/products/:id de A sobre un producto de B no lo modifica', async () => {
    // Con una categoría propia de A: pasa la validación de pertenencia y lo
    // único que protege es el `AND business_id = ?` del WHERE.
    const res = await agentA
      .put('/api/products/' + businessB.productId)
      .field('name', 'Hackeado por A')
      .field('description', '')
      .field('price', '1')
      .field('category_id', String(businessA.categoryId));

    expect(res.status).toBe(200);

    const db = getPool();
    const [rows] = await db.query('SELECT name FROM products WHERE id = ?', [businessB.productId]);
    expect(rows[0].name).toBe(businessB.name + ' producto');
  });

  test('DELETE /api/products/:id de A sobre un producto de B no lo borra', async () => {
    const res = await agentA.delete('/api/products/' + businessB.productId);
    expect(res.status).toBe(200);

    const db = getPool();
    const [rows] = await db.query('SELECT id FROM products WHERE id = ?', [businessB.productId]);
    expect(rows.length).toBe(1);
  });

  test('request sin sesión a /api/categories redirige a /admin/login (no 401 JSON)', async () => {
    const res = await request(app).get('/api/qr');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/login');
  });

  // El `AND business_id = ?` del WHERE protege las filas que ya existen, pero
  // no sirve para un category_id que viene del cliente y se va a ESCRIBIR.
  // Estos dos casos eran posibles hasta el fix de la Fase 1: el primero
  // estaba documentado como [BUG CONOCIDO] y el segundo ni siquiera se había
  // detectado.
  test('POST /api/products de A rechaza un category_id de B', async () => {
    const res = await agentA.post('/api/products')
      .field('name', 'Producto cruzado')
      .field('description', '')
      .field('price', '1000')
      .field('category_id', String(businessB.categoryId));

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);

    const db = getPool();
    const [rows] = await db.query('SELECT id FROM products WHERE category_id = ? AND business_id = ?',
      [businessB.categoryId, businessA.businessId]);
    expect(rows).toHaveLength(0);
  });

  test('PUT /api/products/:id de A no puede mover un producto propio a una categoría de B', async () => {
    const res = await agentA
      .put('/api/products/' + businessA.productId)
      .field('name', businessA.name + ' producto')
      .field('description', '')
      .field('price', '10000')
      .field('category_id', String(businessB.categoryId));

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);

    const db = getPool();
    const [rows] = await db.query('SELECT category_id FROM products WHERE id = ?', [businessA.productId]);
    expect(rows[0].category_id).toBe(businessA.categoryId);
  });

  test('POST /api/products con un category_id inexistente se rechaza', async () => {
    const res = await agentA.post('/api/products')
      .field('name', 'Producto huérfano')
      .field('description', '')
      .field('price', '1000')
      .field('category_id', '999999');

    expect(res.status).toBe(403);
  });
});

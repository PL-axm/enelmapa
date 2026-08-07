const bcrypt = require('bcryptjs');
const { getTestPool } = require('./container');

// Crea un negocio completo (con admin, categoría y producto) para usar en
// tests de tenant-scoping. Password en texto plano se devuelve para poder
// loguearse en el test; en DB queda hasheado igual que en producción.
async function createBusiness({ slug, name, adminEmail, adminPassword }) {
  const db = getTestPool();

  const [bizResult] = await db.query(
    'INSERT INTO businesses (slug, name, is_open) VALUES (?, ?, 1)',
    [slug, name]
  );
  const businessId = bizResult.insertId;

  const passwordHash = bcrypt.hashSync(adminPassword, 10);
  const [userResult] = await db.query(
    'INSERT INTO users (business_id, email, password_hash, name) VALUES (?, ?, ?, ?)',
    [businessId, adminEmail, passwordHash, 'Admin de prueba']
  );

  const [catResult] = await db.query(
    'INSERT INTO categories (business_id, name, sort_order) VALUES (?, ?, 0)',
    [businessId, name + ' categoría']
  );
  const categoryId = catResult.insertId;

  const [prodResult] = await db.query(
    'INSERT INTO products (business_id, category_id, name, description, price, sort_order) VALUES (?, ?, ?, ?, ?, 0)',
    [businessId, categoryId, name + ' producto', '', 10000]
  );
  const productId = prodResult.insertId;

  return {
    businessId,
    userId: userResult.insertId,
    categoryId,
    productId,
    slug,
    name,
    adminEmail,
    adminPassword
  };
}

// Los dos negocios estándar usados por los tests de tenant-scoping.
async function createTwoBusinesses() {
  const businessA = await createBusiness({
    slug: 'test-negocio-a',
    name: 'Test Negocio A',
    adminEmail: 'admin-a@test.local',
    adminPassword: 'password-a-123'
  });
  const businessB = await createBusiness({
    slug: 'test-negocio-b',
    name: 'Test Negocio B',
    adminEmail: 'admin-b@test.local',
    adminPassword: 'password-b-123'
  });
  return { businessA, businessB };
}

module.exports = { createBusiness, createTwoBusinesses };

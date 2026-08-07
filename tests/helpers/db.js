const { initDb } = require('../../db/schema');
const { getTestContainer, getTestPool } = require('./container');

// Aísla cada test: initDb() es idempotente (CREATE TABLE IF NOT EXISTS), y
// borrar `businesses` limpia todo lo demás en cascada (business_hours,
// categories, products, users — ver los ON DELETE CASCADE en db/schema.js).
async function resetDb() {
  const pool = getTestPool();
  await initDb(pool);
  await pool.query('DELETE FROM businesses');
}

async function closeDb() {
  await getTestContainer().close();
}

module.exports = { resetDb, closeDb };

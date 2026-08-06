const { getPool, initDb } = require('../../db/schema');

// Aísla cada test: initDb() es idempotente (CREATE TABLE IF NOT EXISTS), y
// borrar `businesses` limpia todo lo demás en cascada (business_hours,
// categories, products, users — ver los ON DELETE CASCADE en db/schema.js).
async function resetDb() {
  await initDb();
  const db = getPool();
  await db.query('DELETE FROM businesses');
}

async function closeDb() {
  await getPool().end();
}

module.exports = { resetDb, closeDb };

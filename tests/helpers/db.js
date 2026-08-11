const { runMigrations } = require('../../db/migrate');
const { getTestContainer, getTestPool } = require('./container');

// Aísla cada test. Las migraciones son idempotentes y sólo se aplican una vez
// (quedan anotadas en `schema_migrations`), así que llamarlas en cada test es
// barato: de la segunda vez en adelante no hacen nada.
//
// Borrar `businesses` limpia todo lo demás en cascada (business_hours,
// categories, products, users — ver los ON DELETE CASCADE de 001_initial.sql).
// `sessions` no cuelga de un negocio, así que se limpia aparte.
async function resetDb() {
  const { config } = getTestContainer();
  await runMigrations(config.db, { info: () => {}, debug: () => {} });

  const pool = getTestPool();
  await pool.query('DELETE FROM businesses');
}

async function closeDb() {
  await getTestContainer().close();
}

module.exports = { resetDb, closeDb };

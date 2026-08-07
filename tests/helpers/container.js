const { loadConfig } = require('../../config');
const { createContainer } = require('../../container');
const { createApp } = require('../../app');

// Un container por archivo de test. Jest le da a cada archivo su propio
// registro de módulos, así que esto es un pool por archivo — el mismo
// comportamiento que tenía el singleton `getPool()`, pero ahora explícito y
// cerrable desde el test (`closeDb`).
//
// La config sale de `process.env`, que `tests/env.setup.js` ya forzó a
// enelmapa_test antes de que corra nada. Esa red se queda: que la DI permita
// inyectar otra base no significa que convenga dejar la puerta abierta a que
// `npm test` apunte a producción (regla no-negociable #1 del skill).
let container = null;

function getTestContainer() {
  if (!container) {
    container = createContainer(loadConfig(process.env));
  }
  return container;
}

function getTestPool() {
  return getTestContainer().pool;
}

// Cada test de integración arma su propia app sobre el container compartido.
function createTestApp() {
  const { pool, config } = getTestContainer();
  return createApp({ pool, config });
}

module.exports = { getTestContainer, getTestPool, createTestApp };

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
//
// Se le pasa el container entero, igual que hace server.js — a propósito. Si
// acá enumeráramos las dependencias por separado, este cableado y el real
// podrían divergir, y la suite quedaría verde con la app de producción rota.
// Ya pasó una vez, al agregar `repos` en la Fase 4.
function createTestApp() {
  return createApp(getTestContainer());
}

function getTestRepos() {
  return getTestContainer().repos;
}

module.exports = { getTestContainer, getTestPool, getTestRepos, createTestApp };

const { createPool } = require('./db/pool');
const { createSessionStore } = require('./db/sessionStore');
const categoryRepository = require('./repositories/categoryRepository');
const productRepository = require('./repositories/productRepository');
const businessRepository = require('./repositories/businessRepository');
const userRepository = require('./repositories/userRepository');
const authService = require('./services/authService');
const businessService = require('./services/businessService');
const qrService = require('./services/qrService');
const menuService = require('./services/menuService');

// Composition root: el ÚNICO lugar del código que construye dependencias.
// Todo lo demás las recibe.
//
// La contrapartida de esa regla, y la razón de que este archivo sea tan corto:
// el container no se pasa hacia abajo. `createApp` lo destructura y cada
// router/middleware recibe solamente lo que usa. Si en vez de eso le
// pasáramos el container entero a cada pieza, tendríamos un service locator
// disfrazado de DI: las dependencias dejarían de estar declaradas en la firma
// y cualquier test volvería a necesitar el mundo completo para arrancar.

// `db` es un ejecutor: el pool, o una PoolConnection cuando estamos adentro de
// una transacción. Los dos tienen la misma `.query()`, así que los repos no
// necesitan enterarse — por eso `withTransaction` puede rearmar el juego
// entero atado a la conexión en vez de agregar un `{ conn }` opcional a los
// ~25 métodos de los cinco repos.
//
// Los colaboradores se INYECTAN, nunca se construyen adentro de un repo: si
// productRepository hiciera `categoryRepository(db)` por su cuenta, volveríamos
// a tener una dependencia oculta que ningún test puede reemplazar.
function buildRepos(db) {
  const categories = categoryRepository(db);
  const products = productRepository(db, categories);
  const businesses = businessRepository(db);
  const users = userRepository(db);

  return { categories, products, businesses, users };
}

function createContainer(config) {
  const pool = createPool(config.db);
  const repos = buildRepos(pool);

  // El store de sesión se arma acá y no en config/ porque necesita el pool, y
  // config no sabe nada de conexiones — sólo lee variables de entorno.
  const sessionStore = createSessionStore(pool);

  // Sólo para invariantes que abarcan más de una escritura. No es el default:
  // una transacción abierta retiene una conexión de un pool de 10, así que
  // nunca envolver subida de imágenes ni generación de QR — sólo el tramo de
  // escrituras.
  async function withTransaction(fn) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(buildRepos(conn));
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // Los servicios se cablean después de los repos porque dependen de ellos, y
  // businessService además de withTransaction y de auth. Igual que con los
  // repos: los colaboradores se inyectan, nunca se construyen adentro.
  const auth = authService({ repos });
  const services = {
    auth,
    qr: qrService({ config }),
    menu: menuService(),
    businesses: businessService({ repos, withTransaction, auth })
  };

  return {
    config,
    pool,
    repos,
    services,
    sessionStore,
    withTransaction,
    // El store tiene su propio timer de limpieza de sesiones vencidas: si no
    // se cierra, el proceso (y Jest) quedan colgados esperándolo.
    async close() {
      await new Promise(resolve => sessionStore.close(resolve));
      await pool.end();
    }
  };
}

module.exports = { createContainer, buildRepos };

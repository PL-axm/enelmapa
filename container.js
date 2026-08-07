const { createPool } = require('./db/pool');

// Composition root: el ÚNICO lugar del código que construye dependencias.
// Todo lo demás las recibe.
//
// La contrapartida de esa regla, y la razón de que este archivo sea tan corto:
// el container no se pasa hacia abajo. `createApp` lo destructura y cada
// router/middleware recibe solamente lo que usa. Si en vez de eso le
// pasáramos el container entero a cada pieza, tendríamos un service locator
// disfrazado de DI: las dependencias dejarían de estar declaradas en la firma
// y cualquier test volvería a necesitar el mundo completo para arrancar.
//
// En la Fase 4 los repositories se cablean acá (pool → repos → services), y
// los routers pasan a recibir repos en vez del pool crudo.
function createContainer(config) {
  const pool = createPool(config.db);

  return {
    config,
    pool,
    async close() {
      await pool.end();
    }
  };
}

module.exports = { createContainer };

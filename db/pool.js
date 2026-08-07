const mysql = require('mysql2/promise');

// Factory, no singleton. Antes `getPool()` guardaba el pool en una variable de
// módulo y lo creaba leyendo `process.env` directo, así que los seis archivos
// que hacían `require('../db/schema')` quedaban atados a esa única instancia:
// no había forma de inyectar otro pool sin manipular el registro de módulos
// (hallazgo E2).
//
// Quién crea el pool y cuándo es ahora decisión del composition root
// (container.js), que es el único que sabe de dónde salió la config.
function createPool(dbConfig) {
  return mysql.createPool({
    host: dbConfig.host,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4'
  });
}

module.exports = { createPool };

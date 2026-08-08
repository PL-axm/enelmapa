const MySQLStore = require('express-mysql-session')(require('express-session'));

// La sesión vivía en el MemoryStore por defecto de express-session, que guarda
// todo en la RAM del proceso. Bajo Passenger eso es un problema concreto y no
// teórico: el servidor recicla procesos Node, así que una sesión válida
// desaparece sin aviso cuando la request cae en un proceso que arrancó después
// de que el usuario se logueó. Es la causa raíz confirmada de los 302
// aleatorios — el usuario está logueado, pero el proceso que lo atiende no se
// enteró nunca (hallazgo S9).
//
// Con la sesión en MySQL, el estado deja de estar atado a la vida del proceso:
// cualquiera que atienda la request lee la misma tabla. Además sobrevive a los
// reinicios, así que un deploy ya no desloguea a todos.
//
// Se reusa el pool que ya existe en vez de abrir conexiones aparte: son las
// mismas credenciales y la misma base, y así el límite de conexiones sigue
// siendo uno solo y predecible.
function createSessionStore(pool) {
  return new MySQLStore({
    // La tabla se crea sola si no está. Es la única excepción al "no hay
    // migraciones": la maneja la librería, y el schema versionado de la fase
    // final va a tener que tenerla en cuenta.
    createDatabaseTable: true,

    // Barrido de sesiones vencidas. Sin esto la tabla crece para siempre,
    // porque expirar una cookie no borra su fila.
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,  // cada 15 min
    expiration: 24 * 60 * 60 * 1000,          // igual que maxAge de la cookie

    schema: {
      tableName: 'sessions',
      columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' }
    }
  }, pool);
}

module.exports = { createSessionStore };

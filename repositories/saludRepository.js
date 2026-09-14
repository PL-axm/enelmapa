// La única consulta del chequeo de salud. Vive acá y no en la ruta porque no
// hay SQL fuera de repositories/ — ni siquiera un `SELECT 1`: que el pool
// aparezca en un router es la señal de que algo se saltó esta capa.
//
// No tiene scope de negocio porque no lee datos de nadie: sólo confirma que la
// base responde.
function buildSaludRepository(db) {
  return {
    async ping() {
      await db.query('SELECT 1');
    }
  };
}

module.exports = buildSaludRepository;

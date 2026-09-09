// Las ubicaciones de un negocio. Igual que el resto de los repos con tenant,
// la única puerta de entrada es `forBusiness(businessId)`: no hay variante sin
// scope que se pueda llamar por error.
//
// Hubo una `platform.getByBusinessId(businessId)` que era exactamente la misma
// consulta que `forBusiness(businessId).getAll()` pero sin la guarda del id —
// o sea, la variante sin scope que esta regla existe para que no exista. Con
// un id nulo emitía `WHERE business_id = NULL`, que en MySQL no matchea nada:
// devolvía `[]` y el negocio parecía no tener ubicaciones. No la llamaba nadie.
//
// Acá sólo hay SQL. Las reglas de negocio —que siempre haya exactamente una
// principal, y que no se pueda borrar la última— viven en services/locationService.js.
function buildLocationRepository(db) {
  return {
    forBusiness(businessId) {
      if (!Number.isInteger(businessId) || businessId <= 0) {
        throw new Error('businessId must be a positive integer');
      }

      return {
        // La principal primero: la vista pública toma `locations[0]` como la
        // dirección que muestra en el encabezado.
        async getAll() {
          const [rows] = await db.query(
            `SELECT id, address, is_primary
               FROM business_locations
              WHERE business_id = ?
              ORDER BY is_primary DESC, created_at ASC, id ASC`,
            [businessId]
          );
          return rows;
        },

        async get(locationId) {
          const [rows] = await db.query(
            'SELECT id, address, is_primary FROM business_locations WHERE id = ? AND business_id = ?',
            [locationId, businessId]
          );
          return rows[0] || null;
        },

        async count() {
          const [rows] = await db.query(
            'SELECT COUNT(*) AS total FROM business_locations WHERE business_id = ?',
            [businessId]
          );
          return rows[0].total;
        },

        async create(address, isPrimary) {
          const [result] = await db.query(
            'INSERT INTO business_locations (business_id, address, is_primary) VALUES (?, ?, ?)',
            [businessId, address, isPrimary ? 1 : 0]
          );
          return result.insertId;
        },

        async update(locationId, { address, isPrimary }) {
          const [result] = await db.query(
            'UPDATE business_locations SET address = ?, is_primary = ? WHERE id = ? AND business_id = ?',
            [address, isPrimary ? 1 : 0, locationId, businessId]
          );
          return result.affectedRows > 0;
        },

        async delete(locationId) {
          const [result] = await db.query(
            'DELETE FROM business_locations WHERE id = ? AND business_id = ?',
            [locationId, businessId]
          );
          return result.affectedRows > 0;
        },

        // Deja en cero el flag de todas menos `exceptoId`. Se usa siempre junto
        // con marcar otra, y por eso el service lo envuelve en una transacción:
        // sueltas, si la segunda escritura falla el negocio queda sin ninguna
        // principal.
        async desmarcarPrincipales(exceptoId = null) {
          const [result] = exceptoId === null
            ? await db.query(
                'UPDATE business_locations SET is_primary = 0 WHERE business_id = ?',
                [businessId]
              )
            : await db.query(
                'UPDATE business_locations SET is_primary = 0 WHERE business_id = ? AND id != ?',
                [businessId, exceptoId]
              );
          return result.affectedRows;
        },

        // Asciende la ubicación más vieja que quede. Hace falta después de
        // borrar la principal: si no, el negocio queda con ubicaciones y
        // ninguna marcada, y la vista pública muestra como dirección principal
        // lo que caiga primero en el orden.
        async promoverMasAntigua() {
          const [result] = await db.query(
            `UPDATE business_locations
                SET is_primary = 1
              WHERE business_id = ?
              ORDER BY created_at ASC, id ASC
              LIMIT 1`,
            [businessId]
          );
          return result.affectedRows > 0;
        }
      };
    }
  };
}

module.exports = buildLocationRepository;

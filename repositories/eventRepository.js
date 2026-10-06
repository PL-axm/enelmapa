// Los eventos de uso del menú público (visitas, productos vistos, clics a
// redes). Como el resto de los repos con tenant, la única entrada es
// `forBusiness(businessId)`.
//
// Acá sólo hay SQL. Qué es un bot, de dónde vino la visita y cómo se arma el
// visitante lo decide services/estadisticas.js antes de llegar acá.
function buildEventRepository(db) {
  return {
    forBusiness(businessId) {
      if (!Number.isInteger(businessId) || businessId <= 0) {
        throw new Error('businessId must be a positive integer');
      }

      return {
        async registrar({ tipo, productId = null, origen = null, visitante, dia, hora }) {
          await db.query(
            `INSERT INTO menu_events (business_id, tipo, product_id, origen, visitante, dia, hora)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [businessId, tipo, productId, origen, visitante, dia, hora]
          );
        }
      };
    }
  };
}

module.exports = buildEventRepository;

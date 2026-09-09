const { ValidationError, NotFoundError } = require('../errors');

// Las decisiones sobre ubicaciones, fuera del repo y fuera de las rutas.
//
// Hay un invariante que sostener y que se rompe en tres lugares distintos:
// **un negocio con ubicaciones tiene exactamente una principal**. La vista
// pública muestra `locations[0]` como la dirección del encabezado y el panel
// le dibuja el rótulo "Principal", así que "ninguna principal" no es un estado
// neutro: es una dirección elegida al azar por el ORDER BY.
//
// Se rompía de tres maneras, todas reales:
//
//   * la PRIMERA ubicación no quedaba principal, porque sólo se marcaba cuando
//     el formulario pedía marcarla;
//   * marcar una principal eran dos escrituras sueltas —desmarcar el resto,
//     marcar ésta—: si fallaba la segunda quedaban cero;
//   * borrar la principal no ascendía a ninguna otra.
//
// Por eso cada operación va dentro de `withTransaction`: o queda el invariante
// entero o no queda nada. Es el mismo motivo por el que existe
// businessService.createWithDefaults.
function locationService({ withTransaction }) {
  return {
    // Devuelve el id de la ubicación creada.
    async crear(businessId, { address, isPrimary }) {
      return withTransaction(async (tx) => {
        const repo = tx.locations.forBusiness(businessId);

        // La primera es principal aunque no lo hayan pedido: un negocio con
        // una sola dirección y ninguna marcada no tiene sentido, y es el caso
        // que más se da (se carga una y listo).
        const principal = isPrimary || (await repo.count()) === 0;

        if (principal) {
          await repo.desmarcarPrincipales();
        }

        return repo.create(address, principal);
      });
    },

    async actualizar(businessId, locationId, { address, isPrimary }) {
      return withTransaction(async (tx) => {
        const repo = tx.locations.forBusiness(businessId);

        if (isPrimary) {
          await repo.desmarcarPrincipales(locationId);
        }

        const afectó = await repo.update(locationId, { address, isPrimary });

        // Si le quitaron el flag a la única principal, alguna tiene que
        // quedar. Se asciende la más antigua.
        if (afectó && !isPrimary) {
          const restantes = await repo.getAll();
          if (restantes.length > 0 && !restantes.some((u) => u.is_primary)) {
            await repo.promoverMasAntigua();
          }
        }

        return afectó;
      });
    },

    async eliminar(businessId, locationId) {
      return withTransaction(async (tx) => {
        const repo = tx.locations.forBusiness(businessId);

        // El orden importa. Se mira PRIMERO si la ubicación existe y es de
        // este negocio: preguntando antes por el total, borrar un id
        // inexistente en un negocio de una sola ubicación respondía "no se
        // puede borrar la última" en vez de 404.
        const ubicación = await repo.get(locationId);
        if (!ubicación) {
          throw new NotFoundError('Ubicación no encontrada');
        }

        if ((await repo.count()) <= 1) {
          throw new ValidationError(
            'No se puede eliminar la última ubicación. El negocio debe tener al menos una.'
          );
        }

        await repo.delete(locationId);

        if (ubicación.is_primary) {
          await repo.promoverMasAntigua();
        }

        return true;
      });
    }
  };
}

module.exports = locationService;

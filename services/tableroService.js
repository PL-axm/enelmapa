const estadisticas = require('./estadisticas');

// Arma los tableros de estadísticas: hace las consultas y le pasa el resultado
// a `estadisticas.armarTablero`, que es puro. La fecha de hoy se recibe, nunca
// se lee acá adentro — la calcula el router en la zona del negocio, igual que
// con las promos.
function tableroService({ repos }) {
  return {
    // El tablero de UN negocio. Lo usan el dueño (con su businessId de sesión)
    // y el superadmin (con el id de la URL): es la misma función y el mismo
    // partial, así que los dos ven exactamente lo mismo.
    async deNegocio(businessId, { dias, hoy }) {
      const rango = estadisticas.rangoValido(dias);
      const { actual, anterior } = estadisticas.periodos(hoy, rango);
      const eventos = repos.events.forBusiness(businessId);

      const [resumen, resumenAnterior, porDia, porHora, topProductos, origenes] = await Promise.all([
        eventos.resumen(actual),
        eventos.resumen(anterior),
        eventos.porDia(actual),
        eventos.porHora(actual),
        eventos.topProductos({ ...actual, limite: 10 }),
        eventos.origenes(actual)
      ]);

      return estadisticas.armarTablero({
        dias: rango, periodo: actual, resumen, resumenAnterior, porDia, porHora, topProductos, origenes
      });
    },

    // Para la tarjeta del dashboard del dueño: sólo los últimos 7 días.
    async visitasRecientes(businessId, { hoy }) {
      const { actual } = estadisticas.periodos(hoy, 7);
      const resumen = await repos.events.forBusiness(businessId).resumen(actual);
      return resumen.visitas;
    },

    // La tabla del superadmin: todos los negocios, últimos 7 y 30 días, y la
    // variación de los 30 contra los 30 anteriores. Ordenada por visitas del
    // mes, así los menús que nadie abre quedan abajo, juntos y a la vista.
    async plataforma({ hoy }) {
      const semana = estadisticas.periodos(hoy, 7).actual;
      const { actual: mes, anterior: mesAnterior } = estadisticas.periodos(hoy, 30);

      const [filasSemana, filasMes, filasAnterior] = await Promise.all([
        repos.events.platform.resumenPorNegocio(semana),
        repos.events.platform.resumenPorNegocio(mes),
        repos.events.platform.resumenPorNegocio(mesAnterior)
      ]);

      const porId = (filas) => new Map(filas.map(f => [f.id, f]));
      const deSemana = porId(filasSemana);
      const delAnterior = porId(filasAnterior);

      const negocios = filasMes.map(f => {
        const anterior = delAnterior.get(f.id);
        const semanaFila = deSemana.get(f.id);
        return {
          id: f.id,
          name: f.name,
          slug: f.slug,
          visitas7: semanaFila ? semanaFila.visitas : 0,
          visitas30: f.visitas,
          visitantes30: f.visitantes,
          whatsapp30: f.whatsapp,
          tasaClic: estadisticas.porcentaje(f.whatsapp, f.visitas),
          variacion: estadisticas.variacion(f.visitas, anterior ? anterior.visitas : 0)
        };
      }).sort((a, b) => b.visitas30 - a.visitas30 || b.visitas7 - a.visitas7 || a.name.localeCompare(b.name));

      const totales = negocios.reduce((t, x) => ({
        visitas7: t.visitas7 + x.visitas7,
        visitas30: t.visitas30 + x.visitas30,
        whatsapp30: t.whatsapp30 + x.whatsapp30
      }), { visitas7: 0, visitas30: 0, whatsapp30: 0 });

      return {
        negocios,
        totales,
        activos: negocios.filter(x => x.visitas30 > 0).length,
        periodo: mes
      };
    }
  };
}

module.exports = tableroService;

// Los eventos de uso del menú público (visitas, productos vistos, clics a
// redes). Como el resto de los repos con tenant, la única entrada es
// `forBusiness(businessId)`; lo que cruza negocios —el tablero del
// superadmin— vive aparte, bajo `platform`.
//
// Acá sólo hay SQL. Qué es un bot, de dónde vino la visita y cómo se arma el
// visitante lo decide services/estadisticas.js antes de llegar acá; cómo se
// dibuja, también.
//
// Las fechas entran y salen como texto 'YYYY-MM-DD'. Por eso `DATE_FORMAT` en
// vez de devolver la columna: mysql2 entrega un DATE como `Date` a medianoche
// LOCAL del proceso, y esa es la trampa que ya corrió un día las promos.

// mysql2 devuelve SUM() como texto (DECIMAL) y NULL cuando no hay filas.
const n = (v) => Number(v) || 0;

// "Visitantes" = visitantes únicos POR DÍA, sumados. La huella cambia cada día
// a propósito (ver huellaVisitante), así que contar distintos en todo el
// período sin el día daría lo mismo — pero así queda escrito qué se cuenta.
const COLUMNAS_RESUMEN = `
  SUM(tipo = 'visita') AS visitas,
  COUNT(DISTINCT CASE WHEN tipo = 'visita' THEN CONCAT(dia, visitante) END) AS visitantes,
  SUM(tipo = 'producto') AS productos,
  SUM(tipo = 'whatsapp') AS whatsapp,
  SUM(tipo = 'instagram') AS instagram,
  SUM(tipo = 'facebook') AS facebook`;

function resumenDeFila(fila = {}) {
  return {
    visitas: n(fila.visitas),
    visitantes: n(fila.visitantes),
    productos: n(fila.productos),
    whatsapp: n(fila.whatsapp),
    instagram: n(fila.instagram),
    facebook: n(fila.facebook)
  };
}

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
        },

        async resumen({ desde, hasta }) {
          const [rows] = await db.query(
            `SELECT ${COLUMNAS_RESUMEN}
               FROM menu_events
              WHERE business_id = ? AND dia BETWEEN ? AND ?`,
            [businessId, desde, hasta]
          );
          return resumenDeFila(rows[0]);
        },

        async porDia({ desde, hasta }) {
          const [rows] = await db.query(
            `SELECT DATE_FORMAT(dia, '%Y-%m-%d') AS dia,
                    COUNT(*) AS visitas,
                    COUNT(DISTINCT visitante) AS visitantes
               FROM menu_events
              WHERE business_id = ? AND tipo = 'visita' AND dia BETWEEN ? AND ?
              GROUP BY dia
              ORDER BY dia`,
            [businessId, desde, hasta]
          );
          return rows.map(r => ({ dia: r.dia, visitas: n(r.visitas), visitantes: n(r.visitantes) }));
        },

        async porHora({ desde, hasta }) {
          const [rows] = await db.query(
            `SELECT hora, COUNT(*) AS visitas
               FROM menu_events
              WHERE business_id = ? AND tipo = 'visita' AND dia BETWEEN ? AND ?
              GROUP BY hora`,
            [businessId, desde, hasta]
          );
          return rows.map(r => ({ hora: n(r.hora), visitas: n(r.visitas) }));
        },

        // El JOIN exige que el producto sea DE ESTE negocio. Es lo que hace
        // inofensivo que `menu_events.product_id` no tenga FK: un id de otro
        // negocio mandado a mano al beacon nunca aparece acá, y un producto
        // borrado tampoco.
        async topProductos({ desde, hasta, limite = 10 }) {
          const [rows] = await db.query(
            `SELECT p.id, p.name, COUNT(*) AS vistas
               FROM menu_events e
               JOIN products p ON p.id = e.product_id AND p.business_id = e.business_id
              WHERE e.business_id = ? AND e.tipo = 'producto' AND e.dia BETWEEN ? AND ?
              GROUP BY p.id, p.name
              ORDER BY vistas DESC, p.name
              LIMIT ?`,
            [businessId, desde, hasta, limite]
          );
          return rows.map(r => ({ id: r.id, name: r.name, vistas: n(r.vistas) }));
        },

        async origenes({ desde, hasta }) {
          const [rows] = await db.query(
            `SELECT COALESCE(origen, 'directo') AS origen, COUNT(*) AS visitas
               FROM menu_events
              WHERE business_id = ? AND tipo = 'visita' AND dia BETWEEN ? AND ?
              GROUP BY COALESCE(origen, 'directo')`,
            [businessId, desde, hasta]
          );
          return rows.map(r => ({ origen: r.origen, visitas: n(r.visitas) }));
        }
      };
    },

    platform: {
      // Sin scope A PROPÓSITO: es la vista del superadmin, que compara todos
      // los negocios. LEFT JOIN para que un negocio sin una sola visita
      // aparezca igual, con ceros — los menús muertos son justamente lo que
      // esa tabla tiene que mostrar.
      async resumenPorNegocio({ desde, hasta }) {
        const [rows] = await db.query(
          `SELECT b.id, b.name, b.slug,
                  SUM(e.tipo = 'visita') AS visitas,
                  COUNT(DISTINCT CASE WHEN e.tipo = 'visita' THEN CONCAT(e.dia, e.visitante) END) AS visitantes,
                  SUM(e.tipo = 'producto') AS productos,
                  SUM(e.tipo = 'whatsapp') AS whatsapp,
                  SUM(e.tipo = 'instagram') AS instagram,
                  SUM(e.tipo = 'facebook') AS facebook
             FROM businesses b
             LEFT JOIN menu_events e
                    ON e.business_id = b.id AND e.dia BETWEEN ? AND ?
            GROUP BY b.id, b.name, b.slug`,
          [desde, hasta]
        );
        return rows.map(r => ({ id: r.id, name: r.name, slug: r.slug, ...resumenDeFila(r) }));
      }
    }
  };
}

module.exports = buildEventRepository;

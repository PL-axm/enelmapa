const promos = require('./promos');

// El armado de `menuData` vivía dentro del handler de routes/public.js. Es la
// única transformación con reglas propias de todo el flujo público —qué
// categorías se muestran, con qué forma salen los productos— y estaba mezclada
// con el ruteo, así que no se podía probar sin levantar Express.
//
// Acá es una función pura: entra lo que trae el middleware de tenant, sale lo
// que consume la vista. `hoy` también ENTRA, no se lee adentro: si acá hubiera
// un `new Date()`, un test de "promo de martes" pasaría hoy y fallaría el
// jueves.

// En MAYÚSCULAS porque las categorías de los negocios suelen estar así —"ENTRADAS
// 🥞", "BOWLS CLÁSICOS 🍜"— y al lado "Promociones" se veía en minúsculas.
//
// La alternativa era un `text-transform: uppercase` en `.category-title`, y es
// peor: las categorías están en mayúsculas porque el DUEÑO las escribió así, no
// por CSS, así que transformarlas cambiaría cómo se ven las de todos los
// negocios, incluidos los que las escribieron en mixto a propósito (CAFICULTOR
// tiene "Desayunos & Brunch 🥞"). Esta sección es la única cuyo nombre elegimos
// nosotros, así que se escribe como se quiere ver.
const NOMBRE_SECCION_PROMOS = 'PROMOCIONES';

function menuService() {
  // La forma en que la vista consume un producto. Se arma en un solo lugar
  // porque el mismo producto sale en su categoría Y en la sección de promos:
  // dos mapeos distintos serían dos oportunidades de que difieran.
  // `promosEnabled` apaga la promoción ENTERA, no sólo la sección: sin él, un
  // negocio que quiere terminar la promo del mes vería el precio tachado en cada
  // tarjeta hasta editar producto por producto. Un interruptor que deja la mitad
  // encendida no sirve para lo que se usa.
  function paraLaVista(p, hoy, promosEnabled) {
    const enPromo = promosEnabled && hoy && promos.estaActiva(p, hoy);

    return {
      id: p.id,
      name: p.name,
      desc: p.description,
      price: p.price,
      img: p.image || '',
      // `null` y no un objeto vacío: el skin pregunta `if (p.promo)`, y un
      // objeto siempre presente obligaría a mirar adentro para saber si hay
      // promoción.
      promo: enPromo
        ? { price: p.promo_price, label: p.promo_label || '' }
        : null
    };
  }

  return {
    // Devuelve `{ promos, categorias }` en vez del array que devolvía antes.
    //
    // `promos` es `null` cuando la sección está apagada, cuando no hay ninguna
    // promoción vigente hoy, o cuando no se pasó la fecha. Así **la decisión de
    // mostrar la sección vive en un solo lugar** en vez de repartida entre este
    // servicio y la vista: el armazón sólo pregunta si vino o no.
    //
    // Las categorías vacías NO se muestran. Es una decisión de producto, no un
    // efecto secundario: un negocio que crea "Postres" y todavía no le cargó
    // nada no debería mostrarle al cliente una sección vacía. La sección de
    // promociones sigue la misma regla, por eso `null` cuando no hay ninguna.
    buildMenu({ categories, products, promosEnabled = false, hoy = null }) {
      const categorias = categories
        .map(cat => ({
          id: cat.id,
          name: cat.name,
          products: products
            .filter(p => p.category_id === cat.id)
            .map(p => paraLaVista(p, hoy, promosEnabled))
        }))
        .filter(cat => cat.products.length > 0);

      // Un producto en promoción aparece en la sección Y en su categoría. La
      // sección es un atajo, no una mudanza: quien navega "Entradas" tiene que
      // seguir viéndolo ahí.
      //
      // Se recorren las categorías ya armadas y no `products` directo, para
      // heredar los mismos filtros: si un producto está en una categoría que no
      // se muestra, tampoco tiene por qué aparecer en promociones.
      const enPromo = categorias
        .flatMap(cat => cat.products)
        .filter(p => p.promo !== null);

      const seccionPromos = enPromo.length > 0
        ? { id: 'promos', name: NOMBRE_SECCION_PROMOS, esPromo: true, products: enPromo }
        : null;

      return { promos: seccionPromos, categorias };
    }
  };
}

module.exports = menuService;
module.exports.NOMBRE_SECCION_PROMOS = NOMBRE_SECCION_PROMOS;

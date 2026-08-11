// El armado de `menuData` vivía dentro del handler de routes/public.js. Es la
// única transformación con reglas propias de todo el flujo público —qué
// categorías se muestran, con qué forma salen los productos— y estaba mezclada
// con el ruteo, así que no se podía probar sin levantar Express.
//
// Acá es una función pura: entra lo que trae el middleware de tenant, sale lo
// que consume la vista.

function menuService() {
  return {
    // Las categorías vacías NO se muestran. Es una decisión de producto, no un
    // efecto secundario: un negocio que crea "Postres" y todavía no le cargó
    // nada no debería mostrarle al cliente una sección vacía.
    buildMenu({ categories, products }) {
      return categories
        .map(cat => ({
          id: cat.id,
          name: cat.name,
          products: products
            .filter(p => p.category_id === cat.id)
            .map(p => ({
              id: p.id,
              name: p.name,
              desc: p.description,
              price: p.price,
              img: p.image || ''
            }))
        }))
        .filter(cat => cat.products.length > 0);
    }
  };
}

module.exports = menuService;

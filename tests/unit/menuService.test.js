const menuService = require('../../services/menuService');

// Antes esto vivía dentro del handler de routes/public.js, así que no se podía
// probar sin levantar Express. Es una función pura: entra lo del middleware de
// tenant, sale lo que consume la vista.
describe('menuService.buildMenu', () => {
  const menu = menuService();

  const cat = (id, name) => ({ id, name, business_id: 1, sort_order: id });
  const prod = (id, category_id, over = {}) => ({
    id, category_id, name: 'Producto ' + id,
    description: 'Desc ' + id, price: '1000.00', image: '/uploads/1/' + id + '.jpg',
    ...over
  });

  test('agrupa los productos bajo su categoría', () => {
    const res = menu.buildMenu({
      categories: [cat(1, 'Entradas'), cat(2, 'Bebidas')],
      products: [prod(10, 1), prod(11, 1), prod(20, 2)]
    });

    expect(res.categorias.map(c => c.name)).toEqual(['Entradas', 'Bebidas']);
    expect(res.categorias[0].products.map(p => p.id)).toEqual([10, 11]);
    expect(res.categorias[1].products.map(p => p.id)).toEqual([20]);
  });

  // Decisión de producto: un negocio que crea "Postres" y no le cargó nada
  // todavía no debería mostrarle al cliente una sección vacía.
  test('esconde las categorías sin productos', () => {
    const res = menu.buildMenu({
      categories: [cat(1, 'Con productos'), cat(2, 'Vacía')],
      products: [prod(10, 1)]
    });

    expect(res.categorias.map(c => c.name)).toEqual(['Con productos']);
  });

  test('respeta el orden en que vienen las categorías', () => {
    const res = menu.buildMenu({
      categories: [cat(3, 'Tercera'), cat(1, 'Primera')],
      products: [prod(30, 3), prod(10, 1)]
    });

    expect(res.categorias.map(c => c.name)).toEqual(['Tercera', 'Primera']);
  });

  test('renombra los campos a la forma que espera la vista', () => {
    const { categorias } = menu.buildMenu({
      categories: [cat(1, 'X')],
      products: [prod(10, 1)]
    });

    expect(Object.keys(categorias[0].products[0]).sort())
      .toEqual(['desc', 'id', 'img', 'name', 'price', 'promo']);
  });

  // Un producto sin imagen tiene que salir con cadena vacía y no con null: la
  // vista lo mete directo en un `src`, y un null se renderizaría como "null".
  test('un producto sin imagen sale con cadena vacía', () => {
    const { categorias } = menu.buildMenu({
      categories: [cat(1, 'X')],
      products: [prod(10, 1, { image: null })]
    });

    expect(categorias[0].products[0].img).toBe('');
  });

  test('sin categorías ni productos devuelve una lista vacía', () => {
    expect(menu.buildMenu({ categories: [], products: [] }))
      .toEqual({ promos: null, categorias: [] });
  });

  // Los productos inactivos ya vienen filtrados por el repo (listActive), pero
  // si llegara uno de otra categoría no debe aparecer en ninguna.
  test('los productos cuya categoría no está no aparecen', () => {
    const res = menu.buildMenu({
      categories: [cat(1, 'X')],
      products: [prod(10, 1), prod(99, 77)]
    });

    expect(res.categorias[0].products.map(p => p.id)).toEqual([10]);
    expect(res.categorias).toHaveLength(1);
  });
});

// === la sección de promociones ===
//
// La regla de fondo: la decisión de MOSTRAR la sección vive acá y en ningún otro
// lado. El armazón sólo pregunta si `promos` vino o no; si además re-evaluara
// algo, habría dos criterios que pueden discrepar.
describe('menuService.buildMenu — promociones', () => {
  const menu = menuService();

  const cat = (id, name) => ({ id, name, business_id: 1, sort_order: id });
  const prod = (id, category_id, over = {}) => ({
    id, category_id, name: 'Producto ' + id,
    description: 'Desc ' + id, price: '20000.00', image: '',
    promo_price: null, promo_label: '', promo_from: null, promo_to: null,
    promo_days: '1111111',
    ...over
  });

  // 2026-09-15, martes.
  const HOY = { fecha: '2026-09-15', dia: 2 };

  const conPromo = (id, catId, over = {}) =>
    prod(id, catId, { promo_price: '15000.00', ...over });

  const armar = (products, opts = {}) => menu.buildMenu({
    categories: [cat(1, 'Entradas'), cat(2, 'Bebidas')],
    products,
    promosEnabled: true,
    hoy: HOY,
    ...opts
  });

  test('la sección junta los productos con promo vigente', () => {
    const res = armar([conPromo(10, 1), prod(11, 1), conPromo(20, 2)]);

    expect(res.promos.name).toBe('Promociones');
    expect(res.promos.products.map(p => p.id)).toEqual([10, 20]);
  });

  // La sección es un atajo, no una mudanza: quien navega "Entradas" tiene que
  // seguir viendo el producto ahí.
  test('el producto en promo sigue apareciendo en su categoría', () => {
    const res = armar([conPromo(10, 1)]);

    expect(res.categorias[0].products.map(p => p.id)).toEqual([10]);
    expect(res.promos.products.map(p => p.id)).toEqual([10]);
  });

  test('con la sección apagada no hay promos, aunque haya precios cargados', () => {
    const res = armar([conPromo(10, 1)], { promosEnabled: false });

    expect(res.promos).toBeNull();
    // Y tampoco se anuncia la promo en la tarjeta: apagar la sección apaga la
    // promoción entera, que es lo que el dueño espera del interruptor.
    expect(res.categorias[0].products[0].promo).toBeNull();
  });

  test('encendida pero sin promos vigentes no aparece una sección vacía', () => {
    // Misma regla que las categorías vacías, que ya se escondían.
    const res = armar([prod(10, 1)]);

    expect(res.promos).toBeNull();
  });

  test('una promo vencida no entra en la sección', () => {
    const res = armar([conPromo(10, 1, { promo_to: '2026-09-01' })]);

    expect(res.promos).toBeNull();
    expect(res.categorias[0].products[0].promo).toBeNull();
  });

  test('una promo programada tampoco', () => {
    const res = armar([conPromo(10, 1, { promo_from: '2026-10-01' })]);

    expect(res.promos).toBeNull();
  });

  test('una promo de otro día tampoco', () => {
    // '0100000' es sólo lunes; HOY es martes.
    const res = armar([conPromo(10, 1, { promo_days: '0100000' })]);

    expect(res.promos).toBeNull();
  });

  test('el producto lleva precio promocional y etiqueta', () => {
    const res = armar([conPromo(10, 1, { promo_label: '2x1' })]);

    expect(res.promos.products[0].promo).toEqual({ price: '15000.00', label: '2x1' });
    // El precio normal se conserva: es el que se muestra tachado.
    expect(res.promos.products[0].price).toBe('20000.00');
  });

  test('sin etiqueta, la etiqueta es cadena vacía y no null', () => {
    const res = armar([conPromo(10, 1, { promo_label: null })]);

    expect(res.promos.products[0].promo.label).toBe('');
  });

  test('sin fecha no se evalúa ninguna promoción', () => {
    // Defensa: si un llamador se olvidara de pasar `hoy`, es preferible no
    // mostrar promos a mostrarlas todas sin mirar la vigencia.
    const res = armar([conPromo(10, 1)], { hoy: null });

    expect(res.promos).toBeNull();
    expect(res.categorias[0].products[0].promo).toBeNull();
  });

  test('un producto en una categoría que no se muestra no entra en promos', () => {
    // Hereda los filtros de las categorías en vez de recorrer `products` suelto.
    const res = menu.buildMenu({
      categories: [cat(1, 'Entradas')],
      products: [conPromo(99, 77)],
      promosEnabled: true,
      hoy: HOY
    });

    expect(res.promos).toBeNull();
    expect(res.categorias).toEqual([]);
  });
});

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

    expect(res.map(c => c.name)).toEqual(['Entradas', 'Bebidas']);
    expect(res[0].products.map(p => p.id)).toEqual([10, 11]);
    expect(res[1].products.map(p => p.id)).toEqual([20]);
  });

  // Decisión de producto: un negocio que crea "Postres" y no le cargó nada
  // todavía no debería mostrarle al cliente una sección vacía.
  test('esconde las categorías sin productos', () => {
    const res = menu.buildMenu({
      categories: [cat(1, 'Con productos'), cat(2, 'Vacía')],
      products: [prod(10, 1)]
    });

    expect(res.map(c => c.name)).toEqual(['Con productos']);
  });

  test('respeta el orden en que vienen las categorías', () => {
    const res = menu.buildMenu({
      categories: [cat(3, 'Tercera'), cat(1, 'Primera')],
      products: [prod(30, 3), prod(10, 1)]
    });

    expect(res.map(c => c.name)).toEqual(['Tercera', 'Primera']);
  });

  test('renombra los campos a la forma que espera la vista', () => {
    const [categoria] = menu.buildMenu({
      categories: [cat(1, 'X')],
      products: [prod(10, 1)]
    });

    expect(Object.keys(categoria.products[0]).sort()).toEqual(['desc', 'id', 'img', 'name', 'price']);
  });

  // Un producto sin imagen tiene que salir con cadena vacía y no con null: la
  // vista lo mete directo en un `src`, y un null se renderizaría como "null".
  test('un producto sin imagen sale con cadena vacía', () => {
    const [categoria] = menu.buildMenu({
      categories: [cat(1, 'X')],
      products: [prod(10, 1, { image: null })]
    });

    expect(categoria.products[0].img).toBe('');
  });

  test('sin categorías ni productos devuelve una lista vacía', () => {
    expect(menu.buildMenu({ categories: [], products: [] })).toEqual([]);
  });

  // Los productos inactivos ya vienen filtrados por el repo (listActive), pero
  // si llegara uno de otra categoría no debe aparecer en ninguna.
  test('los productos cuya categoría no está no aparecen', () => {
    const res = menu.buildMenu({
      categories: [cat(1, 'X')],
      products: [prod(10, 1), prod(99, 77)]
    });

    expect(res[0].products.map(p => p.id)).toEqual([10]);
    expect(res).toHaveLength(1);
  });
});

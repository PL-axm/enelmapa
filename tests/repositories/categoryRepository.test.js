const categoryRepository = require('../../repositories/categoryRepository');
const { getTestPool } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createTwoBusinesses } = require('../helpers/fixtures');

// Los tests de integración prueban el aislamiento a través de HTTP. Estos lo
// prueban un nivel más abajo, contra el repo directo: si alguien más adelante
// llama al repo desde un servicio o un script (no desde una ruta), el
// aislamiento tiene que seguir en pie sin depender de la sesión ni del
// middleware de auth.
describe('categoryRepository', () => {
  let repo;
  let businessA;
  let businessB;

  beforeEach(async () => {
    await resetDb();
    const businesses = await createTwoBusinesses();
    businessA = businesses.businessA;
    businessB = businesses.businessB;
    repo = categoryRepository(getTestPool());
  });

  afterAll(async () => {
    await closeDb();
  });

  // Lo que hace que el scoping sea estructural y no una convención: la única
  // forma de llegar a las operaciones es pasando por forBusiness.
  describe('no hay forma de saltearse forBusiness', () => {
    test('el repo no expone ninguna operación de tabla directamente', () => {
      expect(Object.keys(repo)).toEqual(['forBusiness']);
    });

    test('forBusiness sin businessId lanza en vez de devolver algo usable', () => {
      expect(() => repo.forBusiness(undefined)).toThrow(/businessId inválido/);
      expect(() => repo.forBusiness(null)).toThrow(/businessId inválido/);
      expect(() => repo.forBusiness(0)).toThrow(/businessId inválido/);
      expect(() => repo.forBusiness('7')).toThrow(/businessId inválido/);
    });
  });

  describe('lecturas', () => {
    test('listOrdered sólo trae las categorías del negocio pedido', async () => {
      const deA = await repo.forBusiness(businessA.businessId).listOrdered();
      const deB = await repo.forBusiness(businessB.businessId).listOrdered();

      expect(deA.map(c => c.id)).toEqual([businessA.categoryId]);
      expect(deB.map(c => c.id)).toEqual([businessB.categoryId]);
    });

    test('listWithProductCount tampoco cruza negocios y cuenta bien', async () => {
      const deA = await repo.forBusiness(businessA.businessId).listWithProductCount();

      expect(deA).toHaveLength(1);
      expect(deA[0].id).toBe(businessA.categoryId);
      expect(Number(deA[0].product_count)).toBe(1);
    });

    test('count no suma las de otro negocio', async () => {
      await repo.forBusiness(businessA.businessId).create({ name: 'Segunda de A' });

      expect(await repo.forBusiness(businessA.businessId).count()).toBe(2);
      expect(await repo.forBusiness(businessB.businessId).count()).toBe(1);
    });

    test('exists es falso para una categoría de otro negocio', async () => {
      const scopeA = repo.forBusiness(businessA.businessId);

      expect(await scopeA.exists(businessA.categoryId)).toBe(true);
      expect(await scopeA.exists(businessB.categoryId)).toBe(false);
      expect(await scopeA.exists(999999)).toBe(false);
    });

    test('exists rechaza basura sin llegar al SQL', async () => {
      const scopeA = repo.forBusiness(businessA.businessId);

      expect(await scopeA.exists('reorder')).toBe(false);
      expect(await scopeA.exists(-1)).toBe(false);
      expect(await scopeA.exists(undefined)).toBe(false);
    });
  });

  describe('escrituras', () => {
    test('create inserta con el business_id del scope, no con el que se pida', async () => {
      const id = await repo.forBusiness(businessA.businessId).create({ name: 'Nueva de A' });

      const [rows] = await getTestPool().query('SELECT business_id FROM categories WHERE id = ?', [id]);
      expect(rows[0].business_id).toBe(businessA.businessId);
    });

    test('create arranca el sort_order después del último del negocio', async () => {
      const scopeA = repo.forBusiness(businessA.businessId);
      const primera = await scopeA.create({ name: 'Primera' });
      const segunda = await scopeA.create({ name: 'Segunda' });

      const [rows] = await getTestPool().query(
        'SELECT id, sort_order FROM categories WHERE id IN (?, ?) ORDER BY sort_order',
        [primera, segunda]
      );
      expect(rows.map(r => r.id)).toEqual([primera, segunda]);
    });

    test('rename sobre una categoría ajena no la toca y avisa que no afectó nada', async () => {
      const afectó = await repo.forBusiness(businessA.businessId)
        .rename(businessB.categoryId, 'Hackeado por A');

      expect(afectó).toBe(false);

      const [rows] = await getTestPool().query('SELECT name FROM categories WHERE id = ?', [businessB.categoryId]);
      expect(rows[0].name).toBe(businessB.name + ' categoría');
    });

    test('rename sobre una propia sí la cambia', async () => {
      const afectó = await repo.forBusiness(businessA.businessId)
        .rename(businessA.categoryId, 'Renombrada');

      expect(afectó).toBe(true);

      const [rows] = await getTestPool().query('SELECT name FROM categories WHERE id = ?', [businessA.categoryId]);
      expect(rows[0].name).toBe('Renombrada');
    });

    test('remove sobre una categoría ajena no la borra', async () => {
      const afectó = await repo.forBusiness(businessA.businessId).remove(businessB.categoryId);

      expect(afectó).toBe(false);

      const [rows] = await getTestPool().query('SELECT id FROM categories WHERE id = ?', [businessB.categoryId]);
      expect(rows).toHaveLength(1);
    });

    // El caso más sutil: reorder recibe una lista de ids del cliente, así que
    // es la puerta más fácil para colar un id ajeno.
    test('reorder ignora los ids que no son del negocio', async () => {
      const scopeA = repo.forBusiness(businessA.businessId);
      const otraDeA = await scopeA.create({ name: 'Otra de A' });

      const [antes] = await getTestPool().query(
        'SELECT sort_order FROM categories WHERE id = ?', [businessB.categoryId]
      );

      // A manda su propio orden con la categoría de B intercalada.
      await scopeA.reorder([otraDeA, businessB.categoryId, businessA.categoryId]);

      const [despues] = await getTestPool().query(
        'SELECT sort_order FROM categories WHERE id = ?', [businessB.categoryId]
      );
      expect(despues[0].sort_order).toBe(antes[0].sort_order);

      // Y las suyas sí se reordenaron.
      const deA = await scopeA.listOrdered();
      expect(deA.map(c => c.id)).toEqual([otraDeA, businessA.categoryId]);
    });
  });
});

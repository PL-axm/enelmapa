const categoryRepository = require('../../repositories/categoryRepository');
const productRepository = require('../../repositories/productRepository');
const { ForbiddenError } = require('../../errors');
const { getTestPool } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createTwoBusinesses } = require('../helpers/fixtures');

describe('productRepository', () => {
  let repo;
  let businessA;
  let businessB;

  beforeEach(async () => {
    await resetDb();
    const businesses = await createTwoBusinesses();
    businessA = businesses.businessA;
    businessB = businesses.businessB;

    const pool = getTestPool();
    // El colaborador se inyecta, igual que en container.js.
    repo = productRepository(pool, categoryRepository(pool));
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('no hay forma de saltearse forBusiness', () => {
    test('el repo no expone ninguna operación de tabla directamente', () => {
      expect(Object.keys(repo)).toEqual(['forBusiness']);
    });

    test('forBusiness sin businessId válido lanza', () => {
      expect(() => repo.forBusiness(undefined)).toThrow(/businessId inválido/);
      expect(() => repo.forBusiness(0)).toThrow(/businessId inválido/);
      expect(() => repo.forBusiness('7')).toThrow(/businessId inválido/);
    });
  });

  describe('lecturas', () => {
    test('listActive sólo trae productos del negocio pedido', async () => {
      const deA = await repo.forBusiness(businessA.businessId).listActive();
      const deB = await repo.forBusiness(businessB.businessId).listActive();

      expect(deA.map(p => p.id)).toEqual([businessA.productId]);
      expect(deB.map(p => p.id)).toEqual([businessB.productId]);
    });

    test('listActive esconde los inactivos', async () => {
      await getTestPool().query('UPDATE products SET is_active = 0 WHERE id = ?', [businessA.productId]);

      expect(await repo.forBusiness(businessA.businessId).listActive()).toHaveLength(0);
      // pero el panel sí los sigue viendo
      expect(await repo.forBusiness(businessA.businessId).listWithCategory()).toHaveLength(1);
    });

    test('listWithCategory trae el nombre de la categoría y no cruza negocios', async () => {
      const deA = await repo.forBusiness(businessA.businessId).listWithCategory();

      expect(deA).toHaveLength(1);
      expect(deA[0].category_name).toBe(businessA.name + ' categoría');
    });

    test('count no suma los de otro negocio', async () => {
      expect(await repo.forBusiness(businessA.businessId).count()).toBe(1);
      expect(await repo.forBusiness(businessB.businessId).count()).toBe(1);
    });
  });

  // El corazón de la fase: estos casos eran posibles cuando la validación vivía
  // en un helper del router y había que acordarse de llamarlo.
  describe('pertenencia de la categoría al escribir (B2 / B3)', () => {
    test('create rechaza una categoría de otro negocio', async () => {
      await expect(
        repo.forBusiness(businessA.businessId).create({
          name: 'Producto cruzado', price: 1000, categoryId: businessB.categoryId
        })
      ).rejects.toThrow(ForbiddenError);

      expect(await repo.forBusiness(businessA.businessId).count()).toBe(1);
    });

    test('create rechaza una categoría inexistente', async () => {
      await expect(
        repo.forBusiness(businessA.businessId).create({
          name: 'Huérfano', price: 1000, categoryId: 999999
        })
      ).rejects.toThrow(ForbiddenError);
    });

    test('create rechaza un categoryId que no es un entero', async () => {
      for (const basura of ['reorder', -1, null, undefined, '']) {
        await expect(
          repo.forBusiness(businessA.businessId).create({ name: 'X', price: 1, categoryId: basura })
        ).rejects.toThrow(ForbiddenError);
      }
    });

    test('update no puede mover un producto propio a una categoría ajena', async () => {
      await expect(
        repo.forBusiness(businessA.businessId).update(businessA.productId, {
          name: 'Movido', price: 1000, categoryId: businessB.categoryId, isActive: true
        })
      ).rejects.toThrow(ForbiddenError);

      const [rows] = await getTestPool().query('SELECT category_id FROM products WHERE id = ?', [businessA.productId]);
      expect(rows[0].category_id).toBe(businessA.categoryId);
    });

    test('con su propia categoría, create y update sí funcionan', async () => {
      const scopeA = repo.forBusiness(businessA.businessId);

      const id = await scopeA.create({ name: 'Propio', price: 5000, categoryId: businessA.categoryId });
      const [rows] = await getTestPool().query('SELECT business_id, category_id FROM products WHERE id = ?', [id]);
      expect(rows[0].business_id).toBe(businessA.businessId);
      expect(rows[0].category_id).toBe(businessA.categoryId);

      expect(await scopeA.update(id, {
        name: 'Propio editado', price: 6000, categoryId: businessA.categoryId, isActive: true
      })).toBe(true);
    });
  });

  describe('escrituras sobre filas ajenas', () => {
    test('update sobre un producto de otro negocio no lo toca', async () => {
      // Con una categoría propia: pasa el chequeo de pertenencia, y lo único
      // que protege es el `AND business_id = ?` del WHERE.
      const afectó = await repo.forBusiness(businessA.businessId).update(businessB.productId, {
        name: 'Hackeado por A', price: 1, categoryId: businessA.categoryId, isActive: true
      });

      expect(afectó).toBe(false);

      const [rows] = await getTestPool().query('SELECT name FROM products WHERE id = ?', [businessB.productId]);
      expect(rows[0].name).toBe(businessB.name + ' producto');
    });

    test('remove sobre un producto ajeno no lo borra', async () => {
      expect(await repo.forBusiness(businessA.businessId).remove(businessB.productId)).toBe(false);

      const [rows] = await getTestPool().query('SELECT id FROM products WHERE id = ?', [businessB.productId]);
      expect(rows).toHaveLength(1);
    });

    test('reorder ignora los ids que no son del negocio', async () => {
      const [antes] = await getTestPool().query('SELECT sort_order FROM products WHERE id = ?', [businessB.productId]);

      await repo.forBusiness(businessA.businessId).reorder([businessB.productId, businessA.productId]);

      const [despues] = await getTestPool().query('SELECT sort_order FROM products WHERE id = ?', [businessB.productId]);
      expect(despues[0].sort_order).toBe(antes[0].sort_order);
    });
  });

  // Guardar sin subir archivo no debe borrar la foto que ya tenía.
  test('update sin image no pisa la imagen existente', async () => {
    const scopeA = repo.forBusiness(businessA.businessId);
    await getTestPool().query('UPDATE products SET image = ? WHERE id = ?', ['/uploads/1/foto.jpg', businessA.productId]);

    await scopeA.update(businessA.productId, {
      name: 'Sin imagen nueva', price: 1000, categoryId: businessA.categoryId, isActive: true
    });

    const [rows] = await getTestPool().query('SELECT image FROM products WHERE id = ?', [businessA.productId]);
    expect(rows[0].image).toBe('/uploads/1/foto.jpg');
  });
});

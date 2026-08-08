const businessRepository = require('../../repositories/businessRepository');
const { getTestPool } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createTwoBusinesses } = require('../helpers/fixtures');

describe('businessRepository', () => {
  let repo;
  let businessA;
  let businessB;

  beforeEach(async () => {
    await resetDb();
    const businesses = await createTwoBusinesses();
    businessA = businesses.businessA;
    businessB = businesses.businessB;
    repo = businessRepository(getTestPool());
  });

  afterAll(async () => {
    await closeDb();
  });

  test('forBusiness sin businessId válido lanza', () => {
    expect(() => repo.forBusiness(undefined)).toThrow(/businessId inválido/);
    expect(() => repo.forBusiness('7')).toThrow(/businessId inválido/);
  });

  describe('superficie scopeada (el dueño toca lo suyo)', () => {
    test('get devuelve el negocio propio y null si no existe', async () => {
      const biz = await repo.forBusiness(businessA.businessId).get();
      expect(biz.slug).toBe(businessA.slug);

      expect(await repo.forBusiness(999999).get()).toBeNull();
    });

    test('update cambia sólo el negocio del scope', async () => {
      await repo.forBusiness(businessA.businessId).update({ name: 'Nombre nuevo de A' });

      const [rows] = await getTestPool().query('SELECT id, name FROM businesses ORDER BY id');
      const a = rows.find(r => r.id === businessA.businessId);
      const b = rows.find(r => r.id === businessB.businessId);
      expect(a.name).toBe('Nombre nuevo de A');
      expect(b.name).toBe(businessB.name);
    });

    // Sin la lista blanca, un formulario manipulado desde /admin/settings
    // podría cambiar el slug del negocio — que es su dirección pública — o
    // pisar el id.
    test('update ignora los campos que no están en la lista blanca', async () => {
      await repo.forBusiness(businessA.businessId).update({
        name: 'Legítimo',
        slug: 'slug-robado',
        id: 999
      });

      const biz = await repo.forBusiness(businessA.businessId).get();
      expect(biz.name).toBe('Legítimo');
      expect(biz.slug).toBe(businessA.slug);
      expect(biz.id).toBe(businessA.businessId);
    });

    test('update sin campos válidos no rompe ni escribe', async () => {
      expect(await repo.forBusiness(businessA.businessId).update({ slug: 'x' })).toBe(false);
    });

    test('hours y updateHours quedan dentro del negocio', async () => {
      const scopeA = repo.forBusiness(businessA.businessId);
      await repo.forBusiness(businessA.businessId).update({ name: 'A' });

      // El fixture no crea horarios, así que se insertan los 7 por defecto.
      await repo.platform.createDefaultHours(businessA.businessId);
      await repo.platform.createDefaultHours(businessB.businessId);

      await scopeA.updateHours([{ day_index: 1, open_time: '09:15', close_time: '18:00', is_closed: false }]);

      const deA = await scopeA.hours();
      expect(deA).toHaveLength(7);
      expect(deA[1].open_time).toBe('09:15');

      const deB = await repo.forBusiness(businessB.businessId).hours();
      expect(deB[1].open_time).toBe('08:00');
    });
  });

  describe('superficie de plataforma (cruza negocios a propósito)', () => {
    test('findBySlug resuelve el tenant y devuelve null si no existe', async () => {
      expect((await repo.platform.findBySlug(businessB.slug)).id).toBe(businessB.businessId);
      expect(await repo.platform.findBySlug('no-existe')).toBeNull();
    });

    test('listForHome trae sólo los campos de la portada', async () => {
      const rows = await repo.platform.listForHome();

      expect(rows).toHaveLength(2);
      expect(Object.keys(rows[0]).sort()).toEqual(['logo_img', 'name', 'slug']);
    });

    test('listWithCounts cuenta categorías y productos de cada negocio', async () => {
      const rows = await repo.platform.listWithCounts();
      const a = rows.find(r => r.id === businessA.businessId);

      expect(Number(a.cat_count)).toBe(1);
      expect(Number(a.prod_count)).toBe(1);
      expect(a.admin_email).toBe(businessA.adminEmail);
    });

    test('slugExists detecta duplicados antes de insertar', async () => {
      expect(await repo.platform.slugExists(businessA.slug)).toBe(true);
      expect(await repo.platform.slugExists('libre')).toBe(false);
    });

    test('create inserta abierto y con los opcionales vacíos', async () => {
      const id = await repo.platform.create({ slug: 'nuevo', name: 'Negocio Nuevo' });
      const biz = await repo.platform.findById(id);

      expect(biz.slug).toBe('nuevo');
      expect(biz.is_open).toBe(1);
      expect(biz.address).toBe('');
    });

    // La diferencia deliberada entre las dos superficies.
    test('platform.update SÍ puede cambiar el slug, a diferencia del dueño', async () => {
      await repo.platform.update(businessA.businessId, { slug: 'slug-cambiado-por-super' });

      const biz = await repo.platform.findById(businessA.businessId);
      expect(biz.slug).toBe('slug-cambiado-por-super');
    });

    test('remove borra el negocio y arrastra sus datos en cascada', async () => {
      expect(await repo.platform.remove(businessA.businessId)).toBe(true);

      const pool = getTestPool();
      for (const tabla of ['categories', 'products', 'users', 'business_hours']) {
        const [rows] = await pool.query(
          'SELECT id FROM ' + tabla + ' WHERE business_id = ?', [businessA.businessId]
        );
        expect(rows).toHaveLength(0);
      }
      // y el otro negocio sigue intacto
      expect(await repo.platform.findById(businessB.businessId)).not.toBeNull();
    });

    test('createDefaultHours crea los 7 días con los nombres en orden', async () => {
      await repo.platform.createDefaultHours(businessA.businessId);
      const hours = await repo.forBusiness(businessA.businessId).hours();

      expect(hours.map(h => h.day_name)).toEqual(businessRepository.DAYS);
    });
  });
});

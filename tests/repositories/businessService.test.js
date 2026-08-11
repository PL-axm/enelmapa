const { ValidationError } = require('../../errors');
const { getTestContainer, getTestPool } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createBusiness } = require('../helpers/fixtures');

// El bug que motivó la transacción, reproducido contra enelmapa_dev antes de
// arreglarlo: si el email del admin ya existía, el negocio quedaba creado sin
// admin ni horarios y con el slug ocupado — inaccesible, y sin poder reintentar
// con el mismo slug.
describe('businessService.createWithDefaults', () => {
  let services;

  beforeEach(async () => {
    await resetDb();
    services = getTestContainer().services;
  });

  afterAll(async () => {
    await closeDb();
  });

  async function contar(tabla, businessId) {
    const [rows] = await getTestPool().query(
      'SELECT COUNT(*) as n FROM ' + tabla + ' WHERE business_id = ?', [businessId]
    );
    return Number(rows[0].n);
  }

  const alta = (over = {}) => ({
    business: { slug: 'nuevo-negocio', name: 'Negocio Nuevo', ...over.business },
    admin: { email: 'admin-nuevo@test.local', password: 'clave-123', name: 'Admin', ...over.admin }
  });

  test('crea negocio, admin y los 7 horarios de una vez', async () => {
    const id = await services.businesses.createWithDefaults(alta());

    expect(await contar('users', id)).toBe(1);
    expect(await contar('business_hours', id)).toBe(7);

    const [rows] = await getTestPool().query('SELECT slug, is_open FROM businesses WHERE id = ?', [id]);
    expect(rows[0].slug).toBe('nuevo-negocio');
    expect(rows[0].is_open).toBe(1);
  });

  test('la contraseña queda hasheada, nunca en texto plano', async () => {
    const id = await services.businesses.createWithDefaults(alta());
    const [rows] = await getTestPool().query('SELECT password_hash FROM users WHERE business_id = ?', [id]);

    expect(rows[0].password_hash).not.toBe('clave-123');
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/);
  });

  test('un slug repetido se rechaza con un error de formulario', async () => {
    await createBusiness({
      slug: 'ocupado', name: 'Ya existe',
      adminEmail: 'otro@test.local', adminPassword: 'x'
    });

    await expect(
      services.businesses.createWithDefaults(alta({ business: { slug: 'ocupado' } }))
    ).rejects.toThrow(ValidationError);
  });

  // El corazón de la fase: antes esto dejaba el negocio a medias.
  describe('cuando el email del admin ya existe', () => {
    let existente;

    beforeEach(async () => {
      existente = await createBusiness({
        slug: 'primero', name: 'Primero',
        adminEmail: 'repetido@test.local', adminPassword: 'x'
      });
    });

    test('se rechaza con un mensaje que nombra el email', async () => {
      await expect(
        services.businesses.createWithDefaults(alta({ admin: { email: 'repetido@test.local' } }))
      ).rejects.toThrow(/repetido@test\.local/);
    });

    test('NO queda ningún negocio a medias: la transacción revierte todo', async () => {
      await expect(
        services.businesses.createWithDefaults(alta({ admin: { email: 'repetido@test.local' } }))
      ).rejects.toThrow(ValidationError);

      const [rows] = await getTestPool().query('SELECT id FROM businesses WHERE slug = ?', ['nuevo-negocio']);
      expect(rows).toHaveLength(0);
    });

    // La consecuencia práctica del bug viejo: el slug quedaba quemado y el
    // operador no podía reintentar. Ahora sí puede.
    test('el slug queda libre para reintentar con otro email', async () => {
      await expect(
        services.businesses.createWithDefaults(alta({ admin: { email: 'repetido@test.local' } }))
      ).rejects.toThrow();

      const id = await services.businesses.createWithDefaults(alta());
      expect(id).toBeGreaterThan(0);
      expect(await contar('users', id)).toBe(1);
      expect(await contar('business_hours', id)).toBe(7);
    });

    test('el negocio que ya existía no se toca', async () => {
      await expect(
        services.businesses.createWithDefaults(alta({ admin: { email: 'repetido@test.local' } }))
      ).rejects.toThrow();

      expect(await contar('users', existente.businessId)).toBe(1);
      expect(await contar('categories', existente.businessId)).toBe(1);
    });
  });
});

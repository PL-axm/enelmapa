const bcrypt = require('bcryptjs');
const userRepository = require('../../repositories/userRepository');
const { getTestPool } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createTwoBusinesses } = require('../helpers/fixtures');

describe('userRepository', () => {
  let repo;
  let businessA;
  let businessB;

  beforeEach(async () => {
    await resetDb();
    const businesses = await createTwoBusinesses();
    businessA = businesses.businessA;
    businessB = businesses.businessB;
    repo = userRepository(getTestPool());
  });

  afterAll(async () => {
    await closeDb();
  });

  test('forBusiness sin businessId válido lanza', () => {
    expect(() => repo.forBusiness(undefined)).toThrow(/businessId inválido/);
    expect(() => repo.forBusiness('7')).toThrow(/businessId inválido/);
  });

  describe('superficie scopeada', () => {
    test('list sólo trae los usuarios del negocio pedido', async () => {
      const deA = await repo.forBusiness(businessA.businessId).list();
      const deB = await repo.forBusiness(businessB.businessId).list();

      expect(deA.map(u => u.email)).toEqual([businessA.adminEmail]);
      expect(deB.map(u => u.email)).toEqual([businessB.adminEmail]);
    });

    // El hash no sale de la DB en las lecturas de listado: es más barato que
    // acordarse de no renderizarlo en cada vista.
    test('list no expone el password_hash', async () => {
      const [user] = await repo.forBusiness(businessA.businessId).list();

      expect(Object.keys(user).sort()).toEqual(['email', 'id', 'name']);
      expect(user.password_hash).toBeUndefined();
    });

    test('create inserta con el business_id del scope', async () => {
      const id = await repo.forBusiness(businessA.businessId).create({
        email: 'segundo@test.local',
        passwordHash: bcrypt.hashSync('x', 10),
        name: 'Segundo admin'
      });

      const [rows] = await getTestPool().query('SELECT business_id FROM users WHERE id = ?', [id]);
      expect(rows[0].business_id).toBe(businessA.businessId);

      // y no aparece en el otro negocio
      expect(await repo.forBusiness(businessB.businessId).list()).toHaveLength(1);
    });

    test('create sin nombre cae al default', async () => {
      const id = await repo.forBusiness(businessA.businessId).create({
        email: 'sinnombre@test.local',
        passwordHash: 'x'
      });

      const user = await repo.platform.findById(id);
      expect(user.name).toBe('Administrador');
    });
  });

  describe('superficie de plataforma', () => {
    test('findByEmailWithBusiness trae el negocio en el mismo viaje', async () => {
      const user = await repo.platform.findByEmailWithBusiness(businessA.adminEmail);

      expect(user.business_id).toBe(businessA.businessId);
      expect(user.business_name).toBe(businessA.name);
      expect(user.slug).toBe(businessA.slug);
    });

    // Es el único método que devuelve el hash, y lo necesita: es quien compara.
    test('findByEmailWithBusiness sí devuelve el hash, para poder comparar', async () => {
      const user = await repo.platform.findByEmailWithBusiness(businessA.adminEmail);

      expect(bcrypt.compareSync(businessA.adminPassword, user.password_hash)).toBe(true);
    });

    test('findByEmailWithBusiness devuelve null si el email no existe', async () => {
      expect(await repo.platform.findByEmailWithBusiness('no-existe@test.local')).toBeNull();
    });

    test('setPassword cambia sólo la del usuario pedido', async () => {
      const nuevo = bcrypt.hashSync('clave-nueva', 10);
      expect(await repo.platform.setPassword(businessA.userId, nuevo)).toBe(true);

      const a = await repo.platform.findByEmailWithBusiness(businessA.adminEmail);
      const b = await repo.platform.findByEmailWithBusiness(businessB.adminEmail);

      expect(bcrypt.compareSync('clave-nueva', a.password_hash)).toBe(true);
      expect(bcrypt.compareSync(businessB.adminPassword, b.password_hash)).toBe(true);
    });

    test('setPassword sobre un usuario inexistente no afecta nada', async () => {
      expect(await repo.platform.setPassword(999999, 'x')).toBe(false);
    });

    test('findById no expone el hash', async () => {
      const user = await repo.platform.findById(businessA.userId);

      expect(user.business_id).toBe(businessA.businessId);
      expect(user.password_hash).toBeUndefined();
    });
  });
});

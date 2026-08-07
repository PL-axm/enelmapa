const { getTestContainer, getTestPool } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createBusiness } = require('../helpers/fixtures');

// La costura que va a usar la Fase 5 para que el alta de negocio+admin+horarios
// sea atómica. Se prueba ahora, con el único repo que existe, porque el valor
// está en la forma: los repos que recibe `fn` están atados a la conexión de la
// transacción, no al pool — si eso se rompe, las escrituras se irían por fuera
// y el rollback no revertiría nada.
describe('withTransaction', () => {
  let business;

  beforeEach(async () => {
    await resetDb();
    business = await createBusiness({
      slug: 'test-tx',
      name: 'Test TX',
      adminEmail: 'tx@test.local',
      adminPassword: 'password-tx-123'
    });
  });

  afterAll(async () => {
    await closeDb();
  });

  async function contarCategorias() {
    const [rows] = await getTestPool().query(
      'SELECT COUNT(*) as n FROM categories WHERE business_id = ?', [business.businessId]
    );
    return Number(rows[0].n);
  }

  test('commitea las escrituras cuando fn termina bien', async () => {
    const { withTransaction } = getTestContainer();
    const antes = await contarCategorias();

    await withTransaction(async (tx) => {
      const scope = tx.categories.forBusiness(business.businessId);
      await scope.create({ name: 'Una' });
      await scope.create({ name: 'Otra' });
    });

    expect(await contarCategorias()).toBe(antes + 2);
  });

  // El caso que motivó todo esto: hoy `POST /superadmin/create` inserta el
  // negocio, falla al insertar el usuario (email UNIQUE duplicado) y deja un
  // negocio huérfano sin admin ni horarios, con el slug ya ocupado.
  test('revierte TODO si fn lanza a mitad de camino', async () => {
    const { withTransaction } = getTestContainer();
    const antes = await contarCategorias();

    await expect(withTransaction(async (tx) => {
      const scope = tx.categories.forBusiness(business.businessId);
      await scope.create({ name: 'Se escribe' });
      throw new Error('algo explotó después de la primera escritura');
    })).rejects.toThrow('algo explotó');

    expect(await contarCategorias()).toBe(antes);
  });

  test('propaga el error original, no uno del rollback', async () => {
    const { withTransaction } = getTestContainer();
    const original = new Error('el error de negocio');

    await expect(withTransaction(async () => { throw original; })).rejects.toBe(original);
  });

  test('devuelve lo que devuelve fn', async () => {
    const { withTransaction } = getTestContainer();

    const id = await withTransaction(async (tx) =>
      tx.categories.forBusiness(business.businessId).create({ name: 'Con valor de retorno' })
    );

    expect(Number.isInteger(id)).toBe(true);
  });

  // Si la conexión no se devolviera al pool, unas pocas transacciones fallidas
  // dejarían la app sin conexiones y las requests colgadas esperando una libre.
  test('libera la conexión aunque fn haya fallado', async () => {
    const { withTransaction } = getTestContainer();

    for (let i = 0; i < 12; i++) {
      await expect(withTransaction(async () => { throw new Error('falla ' + i); }))
        .rejects.toThrow('falla ' + i);
    }

    // El pool es de 10: si no se liberaran, esto quedaría colgado.
    expect(await contarCategorias()).toBe(1);
  });
});

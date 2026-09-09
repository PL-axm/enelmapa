const request = require('supertest');
const { createTestApp, getTestPool } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createBusiness } = require('../helpers/fixtures');
const { loginAdmin } = require('../helpers/sesion');

const app = createTestApp();

// Un negocio puede tener varias direcciones. La feature llegó sin un solo test
// —la suite pasaba en verde sin mirarla— y traía cuatro fallas que sólo se ven
// escribiéndolos:
//
//   * la PRIMERA ubicación no quedaba principal;
//   * marcar una principal eran dos escrituras sueltas, así que podían quedar
//     cero;
//   * borrar la principal no ascendía a ninguna otra;
//   * borrar un id inexistente en un negocio de una sola ubicación respondía
//     "no se puede borrar la última" en vez de 404.
//
// El invariante que atan casi todos estos tests es uno solo: **un negocio con
// ubicaciones tiene exactamente una principal**. No es cosmético: la vista
// pública toma `locations[0]` como la dirección del encabezado, así que "cero
// principales" significa mostrar una dirección elegida por el ORDER BY.

async function principalesDe(businessId) {
  const [filas] = await getTestPool().query(
    'SELECT id, address, is_primary FROM business_locations WHERE business_id = ? ORDER BY id',
    [businessId]
  );
  return filas;
}

describe('ubicaciones de un negocio', () => {
  let business;
  let agent;

  beforeEach(async () => {
    await resetDb();
    business = await createBusiness({
      slug: 'test-ubicaciones',
      name: 'Test Ubicaciones',
      adminEmail: 'admin-ubi@test.local',
      adminPassword: 'password-ubi-123'
    });

    agent = await loginAdmin(app, { email: business.adminEmail, password: business.adminPassword });
  });

  afterAll(async () => {
    await closeDb();
  });

  test('la primera ubicación queda principal aunque no se pida', async () => {
    const res = await agent.post('/api/locations').send({ address: 'Calle 1 #2-3' });
    expect(res.status).toBe(200);

    const filas = await principalesDe(business.businessId);
    expect(filas).toHaveLength(1);
    expect(filas[0].is_primary).toBe(1);
  });

  test('marcar una nueva como principal deja exactamente una', async () => {
    await agent.post('/api/locations').send({ address: 'Primera' });
    await agent.post('/api/locations').send({ address: 'Segunda', is_primary: true });

    const filas = await principalesDe(business.businessId);
    expect(filas).toHaveLength(2);
    expect(filas.filter((f) => f.is_primary === 1)).toHaveLength(1);
    expect(filas.find((f) => f.is_primary === 1).address).toBe('Segunda');
  });

  test('is_primary como texto "false" NO la marca principal', async () => {
    await agent.post('/api/locations').send({ address: 'Primera' });
    // `z.coerce.boolean()` daba `true` acá —Boolean("false") es true— y le
    // robaba el rótulo a la que sí era principal.
    await agent.post('/api/locations').send({ address: 'Segunda', is_primary: 'false' });

    const filas = await principalesDe(business.businessId);
    expect(filas.find((f) => f.address === 'Segunda').is_primary).toBe(0);
    expect(filas.find((f) => f.address === 'Primera').is_primary).toBe(1);
  });

  test('quitarle el flag a la única principal asciende a otra', async () => {
    const primera = await agent.post('/api/locations').send({ address: 'Primera' });
    await agent.post('/api/locations').send({ address: 'Segunda' });

    const res = await agent
      .put('/api/locations/' + primera.body.id)
      .send({ address: 'Primera', is_primary: false });
    expect(res.status).toBe(200);

    const filas = await principalesDe(business.businessId);
    expect(filas.filter((f) => f.is_primary === 1)).toHaveLength(1);
  });

  test('borrar la principal asciende a la más antigua que queda', async () => {
    const primera = await agent.post('/api/locations').send({ address: 'Primera' });
    await agent.post('/api/locations').send({ address: 'Segunda' });
    await agent.post('/api/locations').send({ address: 'Tercera' });

    const res = await agent.delete('/api/locations/' + primera.body.id);
    expect(res.status).toBe(200);

    const filas = await principalesDe(business.businessId);
    expect(filas).toHaveLength(2);
    expect(filas.filter((f) => f.is_primary === 1)).toHaveLength(1);
    expect(filas.find((f) => f.is_primary === 1).address).toBe('Segunda');
  });

  test('no se puede borrar la última ubicación', async () => {
    const única = await agent.post('/api/locations').send({ address: 'La única' });

    const res = await agent.delete('/api/locations/' + única.body.id);
    expect(res.status).toBe(400);

    expect(await principalesDe(business.businessId)).toHaveLength(1);
  });

  test('borrar un id inexistente da 404, no "última ubicación"', async () => {
    await agent.post('/api/locations').send({ address: 'La única' });

    // Con una sola ubicación cargada, el chequeo del total corría ANTES que el
    // de existencia y contestaba 400 "no se puede borrar la última" para un id
    // que ni siquiera existe.
    const res = await agent.delete('/api/locations/999999');
    expect(res.status).toBe(404);
  });

  test('el listado devuelve la principal primero', async () => {
    await agent.post('/api/locations').send({ address: 'Primera' });
    await agent.post('/api/locations').send({ address: 'Segunda', is_primary: true });

    const res = await agent.get('/api/locations');
    expect(res.status).toBe(200);
    expect(res.body.locations[0].address).toBe('Segunda');
  });

  test('una dirección vacía se rechaza', async () => {
    const res = await agent.post('/api/locations').send({ address: '   ' });
    expect(res.status).toBe(400);
  });

  describe('aislamiento entre negocios', () => {
    let otro;
    let ubicaciónAjena;

    beforeEach(async () => {
      otro = await createBusiness({
        slug: 'test-ubicaciones-otro',
        name: 'Test Ubicaciones Otro',
        adminEmail: 'admin-ubi-otro@test.local',
        adminPassword: 'password-otro-123'
      });

      const agenteAjeno = await loginAdmin(app, {
        email: otro.adminEmail,
        password: otro.adminPassword
      });
      await agenteAjeno.post('/api/locations').send({ address: 'Primera del otro' });
      const res = await agenteAjeno.post('/api/locations').send({ address: 'Segunda del otro' });
      ubicaciónAjena = res.body.id;
    });

    // 404 y no 403 a propósito: un 403 confirmaría que la fila existe y
    // convertiría el endpoint en un enumerador de ids.
    test('no se puede editar la ubicación de otro negocio', async () => {
      const res = await agent
        .put('/api/locations/' + ubicaciónAjena)
        .send({ address: 'Secuestrada', is_primary: true });
      expect(res.status).toBe(404);
    });

    test('no se puede borrar la ubicación de otro negocio', async () => {
      const res = await agent.delete('/api/locations/' + ubicaciónAjena);
      expect(res.status).toBe(404);

      expect(await principalesDe(otro.businessId)).toHaveLength(2);
    });

    test('el listado sólo muestra las propias', async () => {
      await agent.post('/api/locations').send({ address: 'Propia' });

      const res = await agent.get('/api/locations');
      expect(res.body.locations).toHaveLength(1);
      expect(res.body.locations[0].address).toBe('Propia');
    });
  });

  test('sin sesión no se puede tocar nada', async () => {
    const anónimo = request(app);

    expect((await anónimo.get('/api/locations')).status).toBe(401);
    expect((await anónimo.post('/api/locations').send({ address: 'X' })).status).toBe(401);
  });
});

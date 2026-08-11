const { getTestContainer } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createTwoBusinesses } = require('../helpers/fixtures');

// bcrypt salió de las rutas: elegir el algoritmo y el costo es una decisión de
// seguridad, no de ruteo. Este test fija el contrato del servicio.
describe('authService', () => {
  let auth;
  let businessA;
  let businessB;

  beforeEach(async () => {
    await resetDb();
    const businesses = await createTwoBusinesses();
    businessA = businesses.businessA;
    businessB = businesses.businessB;
    auth = getTestContainer().services.auth;
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('hashPassword', () => {
    test('produce un hash bcrypt, no el texto plano', () => {
      const hash = auth.hashPassword('mi-clave');

      expect(hash).not.toBe('mi-clave');
      expect(hash).toMatch(/^\$2[aby]\$/);
    });

    // Si el mismo texto diera siempre el mismo hash, dos usuarios con la misma
    // contraseña serían identificables mirando la tabla.
    test('dos hashes de la misma clave son distintos (salt)', () => {
      expect(auth.hashPassword('igual')).not.toBe(auth.hashPassword('igual'));
    });
  });

  describe('verifyAdmin', () => {
    test('devuelve el usuario con los datos de su negocio', async () => {
      const user = await auth.verifyAdmin({
        email: businessA.adminEmail,
        password: businessA.adminPassword
      });

      expect(user.business_id).toBe(businessA.businessId);
      expect(user.business_name).toBe(businessA.name);
      expect(user.slug).toBe(businessA.slug);
    });

    test('rechaza la contraseña incorrecta', async () => {
      expect(await auth.verifyAdmin({
        email: businessA.adminEmail, password: 'incorrecta'
      })).toBeNull();
    });

    // Misma respuesta para las dos cosas: distinguirlas le diría a un atacante
    // qué emails están registrados.
    test('un email inexistente responde igual que una clave incorrecta', async () => {
      const inexistente = await auth.verifyAdmin({ email: 'no-existe@x.local', password: 'x' });
      const claveMala = await auth.verifyAdmin({ email: businessA.adminEmail, password: 'x' });

      expect(inexistente).toBeNull();
      expect(claveMala).toBeNull();
    });

    test('no explota con credenciales ausentes', async () => {
      expect(await auth.verifyAdmin({})).toBeNull();
      expect(await auth.verifyAdmin({ email: null, password: undefined })).toBeNull();
    });

    // La contraseña de un negocio no sirve para el otro: es obvio, pero es la
    // clase de cosa que un refactor de auth puede romper sin que se note.
    test('la clave de un negocio no entra en el otro', async () => {
      expect(await auth.verifyAdmin({
        email: businessB.adminEmail,
        password: businessA.adminPassword
      })).toBeNull();
    });

    test('el hash que produce hashPassword sirve para verificar después', async () => {
      const repos = getTestContainer().repos;
      const hash = auth.hashPassword('clave-nueva-456');
      await repos.users.platform.setPassword(businessA.userId, hash);

      const user = await auth.verifyAdmin({
        email: businessA.adminEmail, password: 'clave-nueva-456'
      });
      expect(user).not.toBeNull();
    });
  });
});

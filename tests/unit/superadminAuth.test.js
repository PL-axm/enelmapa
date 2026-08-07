const bcrypt = require('bcryptjs');
const { verifySuperadmin, safeEqual } = require('../../services/superadminAuth');

// Cubre S3: el superadmin se autenticaba con `password === SUPER_PASS`
// (texto plano, comparación con short-circuit), siendo la cuenta con más
// privilegios de toda la plataforma.
// Recibe `config.superadmin` en vez de un objeto de entorno (Fase 3): la
// lectura de SUPER_EMAIL/SUPER_PASS/SUPER_PASS_HASH y sus defaults quedaron
// en config/index.js, este módulo sólo compara.
describe('verifySuperadmin', () => {
  const conf = { email: 'jefe@enelmapa.co', passwordHash: null, password: 'clave-correcta' };

  test('acepta las credenciales correctas', () => {
    expect(verifySuperadmin({ email: 'jefe@enelmapa.co', password: 'clave-correcta' }, conf)).toBe(true);
  });

  test('rechaza password incorrecta', () => {
    expect(verifySuperadmin({ email: 'jefe@enelmapa.co', password: 'otra' }, conf)).toBe(false);
  });

  test('rechaza email incorrecto aunque la password sea correcta', () => {
    expect(verifySuperadmin({ email: 'otro@enelmapa.co', password: 'clave-correcta' }, conf)).toBe(false);
  });

  test('rechaza credenciales ausentes sin explotar', () => {
    expect(verifySuperadmin({}, conf)).toBe(false);
    expect(verifySuperadmin({ email: null, password: undefined }, conf)).toBe(false);
  });

  test('un prefijo correcto de la password no alcanza', () => {
    expect(verifySuperadmin({ email: 'jefe@enelmapa.co', password: 'clave-correct' }, conf)).toBe(false);
  });

  describe('con SUPER_PASS_HASH (bcrypt, forma preferida)', () => {
    const hashedConf = {
      email: 'jefe@enelmapa.co',
      passwordHash: bcrypt.hashSync('clave-hasheada', 10),
      password: null
    };

    test('acepta la password que corresponde al hash', () => {
      expect(verifySuperadmin({ email: 'jefe@enelmapa.co', password: 'clave-hasheada' }, hashedConf)).toBe(true);
    });

    test('rechaza cualquier otra', () => {
      expect(verifySuperadmin({ email: 'jefe@enelmapa.co', password: 'clave-correcta' }, hashedConf)).toBe(false);
    });

    test('el hash gana sobre SUPER_PASS en texto plano si están los dos', () => {
      const ambos = { ...hashedConf, password: 'clave-plana' };
      expect(verifySuperadmin({ email: 'jefe@enelmapa.co', password: 'clave-plana' }, ambos)).toBe(false);
      expect(verifySuperadmin({ email: 'jefe@enelmapa.co', password: 'clave-hasheada' }, ambos)).toBe(true);
    });
  });
});

describe('safeEqual', () => {
  test('compara por contenido', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
  });

  test('largos distintos devuelven false sin lanzar (timingSafeEqual los rechaza)', () => {
    expect(safeEqual('abc', 'abcdef')).toBe(false);
    expect(safeEqual('', 'abc')).toBe(false);
  });
});

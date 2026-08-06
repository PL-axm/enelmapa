const bcrypt = require('bcryptjs');
const { verifySuperadmin, safeEqual } = require('../../services/superadminAuth');

// Cubre S3: el superadmin se autenticaba con `password === SUPER_PASS`
// (texto plano, comparación con short-circuit), siendo la cuenta con más
// privilegios de toda la plataforma.
describe('verifySuperadmin', () => {
  const env = { SUPER_EMAIL: 'jefe@enelmapa.co', SUPER_PASS: 'clave-correcta' };

  test('acepta las credenciales correctas', () => {
    expect(verifySuperadmin({ email: 'jefe@enelmapa.co', password: 'clave-correcta' }, env)).toBe(true);
  });

  test('rechaza password incorrecta', () => {
    expect(verifySuperadmin({ email: 'jefe@enelmapa.co', password: 'otra' }, env)).toBe(false);
  });

  test('rechaza email incorrecto aunque la password sea correcta', () => {
    expect(verifySuperadmin({ email: 'otro@enelmapa.co', password: 'clave-correcta' }, env)).toBe(false);
  });

  test('rechaza credenciales ausentes sin explotar', () => {
    expect(verifySuperadmin({}, env)).toBe(false);
    expect(verifySuperadmin({ email: null, password: undefined }, env)).toBe(false);
  });

  test('un prefijo correcto de la password no alcanza', () => {
    expect(verifySuperadmin({ email: 'jefe@enelmapa.co', password: 'clave-correct' }, env)).toBe(false);
  });

  describe('con SUPER_PASS_HASH (bcrypt, forma preferida)', () => {
    const hashedEnv = {
      SUPER_EMAIL: 'jefe@enelmapa.co',
      SUPER_PASS_HASH: bcrypt.hashSync('clave-hasheada', 10)
    };

    test('acepta la password que corresponde al hash', () => {
      expect(verifySuperadmin({ email: 'jefe@enelmapa.co', password: 'clave-hasheada' }, hashedEnv)).toBe(true);
    });

    test('rechaza cualquier otra', () => {
      expect(verifySuperadmin({ email: 'jefe@enelmapa.co', password: 'clave-correcta' }, hashedEnv)).toBe(false);
    });

    test('el hash gana sobre SUPER_PASS en texto plano si están los dos', () => {
      const ambos = { ...hashedEnv, SUPER_PASS: 'clave-plana' };
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

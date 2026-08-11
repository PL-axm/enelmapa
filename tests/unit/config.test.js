const { loadConfig } = require('../../config');

// Cubre S2/E4: SESSION_SECRET tenía un default hardcodeado en el fuente, y
// los mismos `process.env.X || default` estaban repetidos en varios archivos.
describe('loadConfig', () => {
  test('usa los defaults en desarrollo', () => {
    const config = loadConfig({});
    expect(config.domain).toBe('enelmapa.co');
    expect(config.port).toBe(3000);
    expect(config.isProduction).toBe(false);
    expect(config.nodeEnv).toBe('development');
  });

  test('respeta las env vars cuando están', () => {
    const config = loadConfig({ DOMAIN: 'otro.co', PORT: '8080', NODE_ENV: 'staging' });
    expect(config.domain).toBe('otro.co');
    expect(config.port).toBe(8080);
    expect(config.isProduction).toBe(false);
  });

  test('un PORT no numérico cae al default en vez de propagar NaN', () => {
    expect(loadConfig({ PORT: 'abc' }).port).toBe(3000);
  });

  test('en producción falla si falta SESSION_SECRET', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/SESSION_SECRET/);
  });

  test('en producción arranca si SESSION_SECRET está definida', () => {
    const config = loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'un-secreto-real' });
    expect(config.isProduction).toBe(true);
    expect(config.session.secret).toBe('un-secreto-real');
    expect(config.session.cookie.secure).toBe(true);
  });

  test('fuera de producción no exige SESSION_SECRET', () => {
    expect(() => loadConfig({ NODE_ENV: 'development' })).not.toThrow();
  });

  // Fase 3: la config de DB y las credenciales del superadmin salieron de
  // db/pool.js y services/superadminAuth.js, que leían process.env por su
  // cuenta. Acá se verifica que el traslado no perdió ningún default.
  describe('db', () => {
    test('toma las env vars de conexión', () => {
      const { db } = loadConfig({ DB_HOST: 'h', DB_USER: 'u', DB_PASS: 'p', DB_NAME: 'n' });
      expect(db).toEqual({ host: 'h', user: 'u', password: 'p', database: 'n' });
    });

    test('mantiene los defaults de desarrollo local', () => {
      const { db } = loadConfig({});
      expect(db).toEqual({ host: 'localhost', user: 'root', password: '', database: 'enelmapa' });
    });
  });

  describe('superadmin', () => {
    test('prefiere el hash cuando está definido', () => {
      const { superadmin } = loadConfig({ SUPER_EMAIL: 'jefe@x.co', SUPER_PASS_HASH: '$2a$hash' });
      expect(superadmin.email).toBe('jefe@x.co');
      expect(superadmin.passwordHash).toBe('$2a$hash');
    });

    test('sin SUPER_PASS_HASH el hash queda en null (no undefined) y cae al texto plano', () => {
      const { superadmin } = loadConfig({ SUPER_PASS: 'clave' });
      expect(superadmin.passwordHash).toBeNull();
      expect(superadmin.password).toBe('clave');
    });

    test('conserva los defaults inseguros de local documentados en el skill', () => {
      const { superadmin } = loadConfig({});
      expect(superadmin.email).toBe('admin@enelmapa.co');
      expect(superadmin.password).toBe('super2026');
    });
  });
});

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
});

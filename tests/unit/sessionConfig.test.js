const { buildSessionOptions, resolveSecureCookie } = require('../../config/session');

// Cubre S1: `cookie.secure` estaba hardcodeado en false, así que la cookie de
// sesión del admin viajaba en claro también en producción.
describe('resolveSecureCookie', () => {
  test('en producción la cookie es secure', () => {
    expect(resolveSecureCookie({ NODE_ENV: 'production' })).toBe(true);
  });

  test('en desarrollo no lo es (si no, no se puede entrar por http://localhost)', () => {
    expect(resolveSecureCookie({ NODE_ENV: 'development' })).toBe(false);
    expect(resolveSecureCookie({})).toBe(false);
  });

  test('COOKIE_SECURE gana sobre NODE_ENV en ambas direcciones', () => {
    // Escape hatch por si Apache/Passenger no reenvía X-Forwarded-Proto y
    // nadie puede loguearse en producción.
    expect(resolveSecureCookie({ NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toBe(false);
    expect(resolveSecureCookie({ NODE_ENV: 'development', COOKIE_SECURE: 'true' })).toBe(true);
  });
});

describe('buildSessionOptions', () => {
  test('la cookie es httpOnly y sameSite lax', () => {
    const { cookie } = buildSessionOptions({});
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('lax');
  });

  test('usa SESSION_SECRET cuando está definido', () => {
    expect(buildSessionOptions({ SESSION_SECRET: 'un-secreto' }).secret).toBe('un-secreto');
  });

  test('no persiste sesiones vacías', () => {
    const options = buildSessionOptions({});
    expect(options.resave).toBe(false);
    expect(options.saveUninitialized).toBe(false);
  });
});

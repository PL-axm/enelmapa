// Configuración de la sesión, aislada para poder testearla sin levantar la app.
// (En la Fase 2 del refactor esto se absorbe en config/index.js — ver
// plans/refactor-arquitectura-repository-di.md.)

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// `secure: true` hace que el navegador solo mande la cookie por HTTPS. Estaba
// hardcodeado en `false`, así que en producción la cookie de sesión de un
// admin viajaba en claro.
//
// Se activa solo en producción, y con `COOKIE_SECURE` como escape hatch: el
// despliegue es cPanel/Passenger detrás de Apache, y si el proxy no reenvía
// `X-Forwarded-Proto: https` el navegador nunca devolvería la cookie y nadie
// podría entrar a /admin. Ante ese caso, `COOKIE_SECURE=false` destraba sin
// tener que revertir el deploy.
function resolveSecureCookie(env) {
  if (env.COOKIE_SECURE !== undefined) return env.COOKIE_SECURE === 'true';
  return env.NODE_ENV === 'production';
}

function buildSessionOptions(env = process.env) {
  return {
    secret: env.SESSION_SECRET || 'enelmapa-dev-secret-change-in-prod',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: ONE_DAY_MS,
      httpOnly: true,
      secure: resolveSecureCookie(env),
      sameSite: 'lax'
    }
  };
}

module.exports = { buildSessionOptions, resolveSecureCookie };

const { buildSessionOptions } = require('./session');

// Fuente única de configuración. Antes cada archivo hacía su propio
// `process.env.X || default` — `DOMAIN` estaba escrito en tres lugares
// distintos, así que cambiar el default en uno y olvidarse de otro era
// cuestión de tiempo (hallazgo E4 de BEST_PRACTICES.md).
//
// Fase 3: este módulo exporta SOLO la función. Antes exportaba también
// `config: loadConfig()`, o sea que un `require` podía lanzar — por eso
// server.js necesitaba un try/catch alrededor de un import, que es un lugar
// raro para manejar un error. Ahora quien arranca el proceso llama
// `loadConfig()` cuando quiere y se lo pasa al container.

const DEFAULT_DOMAIN = 'enelmapa.co';
const DEFAULT_PORT = 3000;

// Credenciales del superadmin. Los defaults son inseguros a propósito y solo
// aceptables en local (regla no-negociable #2 del skill); viven acá y no en
// services/superadminAuth.js para que ese módulo no lea `process.env`.
const DEFAULT_SUPER_EMAIL = 'admin@enelmapa.co';
const DEFAULT_SUPER_PASS = 'super2026';

// Límites de intentos de login por IP. El superadmin es más estricto: es una
// sola cuenta conocida, así que nadie legítimo necesita muchos reintentos, y
// es la que más daño hace si cae (hallazgo S5).
const DEFAULT_RATE_WINDOW_MIN = 15;
const DEFAULT_LOGIN_MAX = 10;
const DEFAULT_SUPER_LOGIN_MAX = 5;

// Devuelve un entero >= 0, o el default si no vino nada. Un 0 explícito
// desactiva el limitador — lo usan los tests, que hacen decenas de logins
// desde la misma IP.
function intOrDefault(valor, porDefecto) {
  if (valor === undefined || valor === '') return porDefecto;
  const n = Number(valor);
  return Number.isInteger(n) && n >= 0 ? n : porDefecto;
}

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  // Fail-fast (S2): sin esto, un despliegue que se olvide de definir
  // SESSION_SECRET arranca igual y firma todas las sesiones con el secreto
  // que está escrito en el código fuente público. Es preferible que no
  // levante a que levante inseguro y nadie se entere.
  if (isProduction && !env.SESSION_SECRET) {
    throw new Error(
      'SESSION_SECRET es obligatoria cuando NODE_ENV=production. ' +
      'Sin ella las sesiones se firmarían con el secreto por defecto del repo. ' +
      'Generá una con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }

  return {
    nodeEnv,
    isProduction,
    port: Number(env.PORT) || DEFAULT_PORT,
    domain: env.DOMAIN || DEFAULT_DOMAIN,
    db: {
      host: env.DB_HOST || 'localhost',
      user: env.DB_USER || 'root',
      password: env.DB_PASS || '',
      database: env.DB_NAME || 'enelmapa'
    },
    superadmin: {
      email: env.SUPER_EMAIL || DEFAULT_SUPER_EMAIL,
      passwordHash: env.SUPER_PASS_HASH || null,
      password: env.SUPER_PASS || DEFAULT_SUPER_PASS
    },
    rateLimit: {
      windowMs: intOrDefault(env.RATE_LIMIT_WINDOW_MIN, DEFAULT_RATE_WINDOW_MIN) * 60 * 1000,
      loginMax: intOrDefault(env.RATE_LIMIT_LOGIN_MAX, DEFAULT_LOGIN_MAX),
      superadminMax: intOrDefault(env.RATE_LIMIT_SUPER_MAX, DEFAULT_SUPER_LOGIN_MAX)
    },
    session: buildSessionOptions(env)
  };
}

module.exports = { loadConfig };

const { buildSessionOptions } = require('./session');

// Fuente única de configuración. Antes cada archivo hacía su propio
// `process.env.X || 'default'` — `DOMAIN` estaba escrito en tres lugares
// distintos, así que cambiar el default en uno y olvidarse de otro era
// cuestión de tiempo (hallazgo E4 de BEST_PRACTICES.md).

const DEFAULT_DOMAIN = 'enelmapa.co';
const DEFAULT_PORT = 3000;

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
    session: buildSessionOptions(env)
  };
}

module.exports = { loadConfig, config: loadConfig() };

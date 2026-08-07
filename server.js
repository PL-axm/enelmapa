const { loadConfig } = require('./config');
const { createContainer } = require('./container');
const { createApp } = require('./app');
const { initDb } = require('./db/schema');

// Bootstrap: config → container → schema → app → listen. El orden importa y
// ahora está escrito en un solo lugar, en vez de repartido entre efectos de
// importación de varios módulos.
//
// `loadConfig()` puede lanzar si falta SESSION_SECRET en producción — es a
// propósito, ver el fail-fast en config/index.js. Antes eso pasaba dentro de
// un `require`, así que había que envolver un import en try/catch; ahora es
// una llamada normal.
let config;
try {
  config = loadConfig();
} catch (err) {
  console.error('Configuración inválida: ' + err.message);
  process.exit(1);
}

const container = createContainer(config);

// Con `secure: true`, express-session NO manda la cookie si no ve la request
// como HTTPS — y detrás de Apache/Passenger eso depende de que el proxy
// reenvíe `X-Forwarded-Proto: https`. Si no lo hace, no se setea ninguna
// cookie y nadie puede entrar a /admin, sin ningún error visible. Se avisa al
// arrancar para que el síntoma no sea un misterio.
function warnAboutSecureCookie() {
  if (!config.session.cookie.secure) return;
  console.log('Cookie de sesión: secure=true (solo viaja por HTTPS).');
  console.log('  Si nadie puede iniciar sesión, confirmá que Apache reenvía X-Forwarded-Proto: https.');
  console.log('  Destrabe temporal: COOKIE_SECURE=false');
}

initDb(container.pool).then(() => {
  const app = createApp({ pool: container.pool, config: container.config });

  app.listen(config.port, () => {
    console.log('EnElMapa corriendo en puerto ' + config.port);
    console.log('Dominio: ' + config.domain);
    warnAboutSecureCookie();
  });
}).catch(err => {
  console.error('Error iniciando DB:', err);
  process.exit(1);
});

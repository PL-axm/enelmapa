const { initDb } = require('./db/schema');
const { resolveSecureCookie } = require('./config/session');
const app = require('./app');

const PORT = process.env.PORT || 3000;
const DOMAIN = process.env.DOMAIN || 'enelmapa.co';

// Con `secure: true`, express-session NO manda la cookie si no ve la request
// como HTTPS — y detrás de Apache/Passenger eso depende de que el proxy
// reenvíe `X-Forwarded-Proto: https`. Si no lo hace, no se setea ninguna
// cookie y nadie puede entrar a /admin, sin ningún error visible. Se avisa al
// arrancar para que el síntoma no sea un misterio.
function warnAboutSecureCookie() {
  if (!resolveSecureCookie(process.env)) return;
  console.log('Cookie de sesión: secure=true (solo viaja por HTTPS).');
  console.log('  Si nadie puede iniciar sesión, confirmá que Apache reenvía X-Forwarded-Proto: https.');
  console.log('  Destrabe temporal: COOKIE_SECURE=false');
}

initDb().then(() => {
  app.listen(PORT, () => {
    console.log('EnElMapa corriendo en puerto ' + PORT);
    console.log('Dominio: ' + DOMAIN);
    warnAboutSecureCookie();
  });
}).catch(err => {
  console.error('Error iniciando DB:', err);
  process.exit(1);
});

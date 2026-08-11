const crypto = require('crypto');
const { ForbiddenError } = require('../errors');

// Ninguna mutación tenía protección CSRF (hallazgo S4): con la cookie de sesión
// en el navegador, cualquier página de terceros podía disparar un POST a
// /superadmin/delete/3 y el servidor lo aceptaba como legítimo.
//
// Se usa el patrón de token sincronizador: un token por sesión, guardado del
// lado del servidor, que el cliente tiene que devolver en cada mutación. El
// atacante puede hacer que el navegador mande la cookie, pero no puede leer el
// token —eso lo impide el mismo origen— así que no puede completar la petición.
//
// Está escrito acá en vez de con una librería por dos razones concretas:
// `csurf` está deprecado, y el sucesor mantenido implementa doble cookie, que
// necesita otra cookie y otro secreto cuando ya hay una sesión del lado del
// servidor donde guardar el token. Son ~40 líneas y el patrón está bien
// definido; lo que no se improvisa es la comparación, que va en tiempo
// constante.

const HEADER = 'x-csrf-token';
const CAMPO = '_csrf';
const METODOS_QUE_MUTAN = ['POST', 'PUT', 'PATCH', 'DELETE'];

function generarToken() {
  return crypto.randomBytes(32).toString('hex');
}

function comparar(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');

  // timingSafeEqual exige el mismo largo. Comparar contra sí mismo mantiene el
  // costo parejo antes de devolver false, para no delatar el largo esperado.
  if (bufA.length !== bufB.length || bufA.length === 0) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// Una sesión "autenticada" es la que ya identificó a alguien. Sólo esas reciben
// token, y la razón es de costo: `saveUninitialized` está en false, así que
// tocar `req.session` obliga a persistirla. Si el token se generara en cada
// request, cada visitante del menú público —la ruta de más tráfico— dejaría una
// fila en la tabla `sessions`.
function estaAutenticada(session) {
  return Boolean(session && (session.userId || session.isSuper));
}

// Expone el token a las vistas por `res.locals.csrfToken`. Va antes de los
// routers.
function provide(req, res, next) {
  if (estaAutenticada(req.session)) {
    if (!req.session.csrfToken) {
      req.session.csrfToken = generarToken();
    }
    res.locals.csrfToken = req.session.csrfToken;
  }
  next();
}

// Verifica el token en los métodos que mutan.
//
// `exentas` son rutas donde el token no puede existir todavía: los dos logins.
// Un login es la única mutación que se hace SIN sesión previa, y exigir un
// token ahí obligaría a persistir una sesión por cada visita a la pantalla de
// login. El riesgo que queda es login-CSRF (que alguien te loguee en una cuenta
// ajena), bastante menor que el de las mutaciones autenticadas, y a cambio los
// dos logins ya tienen rate limiting.
function createProtect({ exentas = [] } = {}) {
  return function protect(req, res, next) {
    if (!METODOS_QUE_MUTAN.includes(req.method)) return next();
    if (exentas.includes(req.path)) return next();

    // Sin sesión autenticada no hay token que comparar, y tampoco hay nada que
    // proteger: todas las rutas que mutan exigen `authRequired` o
    // `superRequired`, así que la request se va a rechazar igual — con un 401,
    // que es el código correcto. Devolver 403 acá lo taparía.
    if (!estaAutenticada(req.session)) return next();

    const recibido = req.get(HEADER) || (req.body && req.body[CAMPO]);

    if (!comparar(recibido, req.session.csrfToken)) {
      return next(new ForbiddenError(
        'Token de seguridad inválido o vencido. Recargá la página e intentá de nuevo.'
      ));
    }

    next();
  };
}

module.exports = { provide, createProtect, HEADER, CAMPO };

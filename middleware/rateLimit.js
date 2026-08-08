const rateLimit = require('express-rate-limit');
const { TooManyRequestsError } = require('../errors');

// Los dos logins no tenían ningún freno: se podían probar contraseñas a la
// velocidad que aguantara el servidor. En `/superadmin` eso es especialmente
// grave, porque esa cuenta puede editar y borrar cualquier negocio y resetear
// cualquier contraseña (hallazgo S5).
//
// El límite se cuenta por IP. Detrás de Apache/Passenger la IP real llega en
// `X-Forwarded-Proto`/`X-Forwarded-For`, y por eso `app.set('trust proxy', 1)`
// importa acá: sin eso, todas las requests parecerían venir del proxy y un
// solo atacante gastaría el cupo de todos los usuarios.
//
// `max <= 0` desactiva el limitador. Se usa en los tests, que hacen decenas de
// logins desde la misma IP y no tienen por qué chocar con esto — el limitador
// tiene su propio test, con un límite chico, en tests/integration/rate-limit.
function createLoginLimiter({ windowMs, max, mensaje }) {
  if (!max || max <= 0) {
    return (req, res, next) => next();
  }

  return rateLimit({
    windowMs,
    limit: max,

    // Sólo cuentan los intentos fallidos: si alguien entra bien diez veces
    // seguidas no hay nada que frenar, y castigarlo sería castigar al usuario
    // legítimo que comparte IP (una oficina, por ejemplo).
    skipSuccessfulRequests: true,

    // OJO: sin esto el limitador no cuenta NADA en esta app. Por defecto
    // "exitosa" quiere decir status < 400, y acá un login fallido responde
    // 200 — vuelve a renderizar el formulario con "Credenciales incorrectas".
    // O sea que los intentos que hay que frenar quedaban todos salteados.
    // Un login exitoso es el 302 al dashboard, y nada más.
    requestWasSuccessful: (req, res) => res.statusCode === 302,

    standardHeaders: 'draft-7',
    legacyHeaders: false,

    // Se delega en el error handler central en vez de responder acá, para que
    // el formato (JSON o EJS) lo decida el mismo lugar que decide el de todos
    // los demás errores.
    handler: (req, res, next) => next(new TooManyRequestsError(mensaje))
  });
}

module.exports = { createLoginLimiter };

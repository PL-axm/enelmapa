// Express 4 no atrapa promesas rechazadas: si un handler `async` lanza, la
// promesa queda sin manejar, Express nunca se entera y la request se cuelga
// sin responder (hallazgo B6). Peor todavía, en Node 20 una unhandled
// rejection mata el proceso — así fue como reordenar categorías tumbaba el
// servidor de todos los negocios.
//
// Envolver cada handler async con esto redirige el throw a `next(err)`, que
// es lo único que el error handler central puede ver.
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;

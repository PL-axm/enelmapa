const { NotFoundError } = require('../errors');

// La app sirve dos contratos distintos por el mismo Express: /api responde
// JSON y el resto renderiza EJS. Un error handler único tiene que respetar
// esa diferencia, si no un fallo en /api devuelve una página HTML que el
// `fetch()` del panel no sabe leer.
function wantsJson(req) {
  if (req.originalUrl.startsWith('/api')) return true;
  if (req.xhr) return true;
  return (req.get('accept') || '').includes('application/json');
}

function notFoundHandler(req, res, next) {
  next(new NotFoundError('Página no encontrada'));
}

// Recibe la config en vez de importar el singleton (Fase 3). Antes hacía
// `require('../config')` a nivel de módulo, así que la rama de producción
// —enmascarar el mensaje de un 500— no se podía testear sin manipular el
// registro de módulos de Jest. Ahora es un parámetro.
function createErrorHandler({ config }) {
  return function errorHandler(err, req, res, next) {
    const statusCode = err.statusCode || 500;
    const isServerError = statusCode >= 500;

    // Los errores previstos (403 de categoría ajena, 404 de negocio) no
    // necesitan stack trace: son parte del funcionamiento normal. Los otros sí,
    // porque son lo único que delata un bug — hoy la terminal es la única red
    // de seguridad que hay (ver QA_CHECKLIST.md).
    if (isServerError || !err.expected) {
      console.error('[' + req.method + ' ' + req.originalUrl + ']', err);
    } else {
      console.warn('[' + req.method + ' ' + req.originalUrl + '] ' + err.name + ': ' + err.message);
    }

    // Si la respuesta ya empezó a mandarse no se puede cambiar el status;
    // delegar al handler por defecto de Express, que corta la conexión.
    if (res.headersSent) return next(err);

    // Un 500 puede traer detalles internos (SQL, rutas del filesystem) en el
    // mensaje. Se muestran solo fuera de producción.
    const message = isServerError && config.isProduction
      ? 'Error interno'
      : err.message;

    if (wantsJson(req)) {
      return res.status(statusCode).json({ ok: false, error: message });
    }

    res.status(statusCode).render('404', { message });
  };
}

module.exports = { createErrorHandler, notFoundHandler, wantsJson };

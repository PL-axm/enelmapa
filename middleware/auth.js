// Mismo middleware para dos contratos distintos: /admin son páginas EJS (un
// navegador, que debe ir al login) y /api es JSON (un `fetch()` que no sabe
// qué hacer con un redirect, y que hasta ahora recibía el HTML de la página
// de login como si fuera la respuesta a su petición).
function authRequired(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }

  if (req.originalUrl.startsWith('/api')) {
    return res.status(401).json({ ok: false, error: 'No autenticado' });
  }

  res.redirect('/admin/login');
}

module.exports = authRequired;

const express = require('express');
const session = require('express-session');
const path = require('path');

const asyncHandler = require('./middleware/asyncHandler');
const { createErrorHandler, notFoundHandler } = require('./middleware/errorHandler');
const createTenantMiddleware = require('./middleware/tenant');
const csrf = require('./middleware/csrf');
const createPublicRouter = require('./routes/public');
const createAdminRouter = require('./routes/admin');
const createSuperadminRouter = require('./routes/superadmin');
const createApiRouter = require('./routes/api/index');
const { getSubdomain } = require('./services/subdomain');

// Antes este archivo creaba la app al importarse y cada router se traía el
// pool y la config por su cuenta con un `require` a nivel de módulo. Ahora
// recibe las dependencias y las reparte: cada pieza declara en su firma lo
// que necesita, y nadie recibe el container entero (ver container.js).
//
// Ningún router recibe ya el pool: al cerrar la Fase 4 no queda SQL fuera de
// repositories/, así que la app se arma sólo con repos y config. Que `pool` no
// aparezca en ninguna firma de router es la señal de que la migración está
// completa.
function createApp({ repos, services, config, sessionStore, logger }) {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('trust proxy', 1);

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));
  // `nosniff` es la tercera capa de S6: aunque algo se colara en uploads/, el
  // navegador no lo va a interpretar como HTML o JS por adivinar el tipo.
  // Importa porque uploads/ se sirve desde el mismo origen que el panel.
  app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff')
  }));

  // El store entra acá, no en config.session: config no conoce el pool.
  app.use(session({ ...config.session, store: sessionStore }));

  // CSRF: `provide` expone el token a las vistas, `protect` lo verifica en las
  // mutaciones. Van después de la sesión (de donde sale el token) y del parser
  // del cuerpo (de donde sale el `_csrf` de los formularios), y antes de los
  // routers.
  //
  // Los dos logins están exentos: son las únicas mutaciones sin sesión previa,
  // así que no puede haber token todavía. Ver el comentario de middleware/csrf.
  app.use(csrf.provide);
  app.use(csrf.createProtect({ exentas: ['/admin/login', '/superadmin/login'] }));

  const tenantMiddleware = createTenantMiddleware({ repos });
  const publicRoutes = createPublicRouter({ services, config });

  app.use((req, res, next) => {
    const subdomain = getSubdomain(req.hostname);
    if (subdomain && req.path === '/') {
      req.params = { slug: subdomain };
      // El callback tiene que mirar `err`: si no, un negocio inexistente por
      // subdominio seguiría de largo hacia publicRoutes sin req.business.
      return tenantMiddleware(req, res, (err) => {
        if (err) return next(err);
        publicRoutes(req, res, next);
      });
    }
    next();
  });

  app.use('/admin', createAdminRouter({ repos, services, config }));
  app.use('/superadmin', createSuperadminRouter({ repos, services, config }));
  app.use('/api', createApiRouter({ repos, services }));

  app.get('/s/:slug', tenantMiddleware, publicRoutes);

  app.get('/', asyncHandler(async (req, res) => {
    const businesses = await repos.businesses.platform.listForHome();
    res.render('home', { businesses });
  }));

  // Estos dos van últimos y en este orden: lo que no matcheó ninguna ruta es un
  // 404, y el error handler tiene que ser el último `app.use` de todos para ver
  // lo que le llegue por `next(err)` desde cualquier punto de la cadena.
  app.use(notFoundHandler);
  app.use(createErrorHandler({ config, logger }));

  return app;
}

module.exports = { createApp };

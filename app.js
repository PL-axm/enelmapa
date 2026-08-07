const express = require('express');
const session = require('express-session');
const path = require('path');

const asyncHandler = require('./middleware/asyncHandler');
const { createErrorHandler, notFoundHandler } = require('./middleware/errorHandler');
const createTenantMiddleware = require('./middleware/tenant');
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
// `pool` y `repos` conviven mientras dure la Fase 4: `repos` para los recursos
// ya migrados, `pool` para el SQL inline que queda. Al cerrar la fase, `pool`
// tiene que desaparecer de las firmas de los routers.
function createApp({ pool, repos, config }) {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('trust proxy', 1);

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

  app.use(session(config.session));

  const tenantMiddleware = createTenantMiddleware({ pool, repos });
  const publicRoutes = createPublicRouter();

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

  app.use('/admin', createAdminRouter({ pool, repos, config }));
  app.use('/superadmin', createSuperadminRouter({ pool, config }));
  app.use('/api', createApiRouter({ pool, repos, config }));

  app.get('/s/:slug', tenantMiddleware, publicRoutes);

  app.get('/', asyncHandler(async (req, res) => {
    const [businesses] = await pool.query('SELECT slug, name, logo_img FROM businesses ORDER BY name');
    res.render('home', { businesses });
  }));

  // Estos dos van últimos y en este orden: lo que no matcheó ninguna ruta es un
  // 404, y el error handler tiene que ser el último `app.use` de todos para ver
  // lo que le llegue por `next(err)` desde cualquier punto de la cadena.
  app.use(notFoundHandler);
  app.use(createErrorHandler({ config }));

  return app;
}

module.exports = { createApp };

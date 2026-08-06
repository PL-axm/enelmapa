const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const { config } = require('./config');
const asyncHandler = require('./middleware/asyncHandler');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

app.use(session(config.session));

const tenantMiddleware = require('./middleware/tenant');
const publicRoutes = require('./routes/public');
const { getSubdomain } = require('./services/subdomain');

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

const adminRoutes = require('./routes/admin');
app.use('/admin', adminRoutes);

const superadminRoutes = require('./routes/superadmin');
app.use('/superadmin', superadminRoutes);

const apiRoutes = require('./routes/api/index');
app.use('/api', apiRoutes);

app.get('/s/:slug', tenantMiddleware, publicRoutes);

app.get('/', asyncHandler(async (req, res) => {
  const { getPool } = require('./db/schema');
  const db = getPool();
  const [businesses] = await db.query('SELECT slug, name, logo_img FROM businesses ORDER BY name');
  res.render('home', { businesses });
}));

// Estos dos van últimos y en este orden: lo que no matcheó ninguna ruta es un
// 404, y el error handler tiene que ser el último `app.use` de todos para ver
// lo que le llegue por `next(err)` desde cualquier punto de la cadena.
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

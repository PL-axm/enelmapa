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

app.use(session({
  secret: process.env.SESSION_SECRET || 'enelmapa-dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    secure: false,
    sameSite: 'lax'
  }
}));

const tenantMiddleware = require('./middleware/tenant');
const publicRoutes = require('./routes/public');
const { getSubdomain } = require('./services/subdomain');

app.use((req, res, next) => {
  const subdomain = getSubdomain(req.hostname);
  if (subdomain && req.path === '/') {
    req.params = { slug: subdomain };
    return tenantMiddleware(req, res, () => publicRoutes(req, res, next));
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

app.get('/', async (req, res) => {
  const { getPool } = require('./db/schema');
  const db = getPool();
  const [businesses] = await db.query('SELECT slug, name, logo_img FROM businesses ORDER BY name');
  res.render('home', { businesses });
});

app.use((req, res) => {
  res.status(404).render('404', { message: 'Página no encontrada' });
});

module.exports = app;

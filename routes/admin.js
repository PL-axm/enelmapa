const express = require('express');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const authRequired = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

// Recibe sólo lo que usa. `pool` y `repos` conviven mientras dure la Fase 4:
// categorías ya sale del repo, el resto todavía es SQL inline. En la Fase 5 el
// QR se va a `qrService`, que hoy está duplicado con routes/api/index.js
// (hallazgo E3).
function createAdminRouter({ pool, repos, config }) {
  const router = express.Router();

  router.get('/login', (req, res) => {
    res.render('admin/login', { error: null });
  });

  router.post('/login', asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const [users] = await pool.query('SELECT u.*, b.name as business_name, b.slug FROM users u JOIN businesses b ON u.business_id = b.id WHERE u.email = ?', [email]);

    if (users.length === 0 || !bcrypt.compareSync(password, users[0].password_hash)) {
      return res.render('admin/login', { error: 'Credenciales incorrectas' });
    }

    const user = users[0];
    req.session.userId = user.id;
    req.session.businessId = user.business_id;
    req.session.userName = user.name;
    req.session.businessName = user.business_name;
    req.session.businessSlug = user.slug;

    res.redirect('/admin/dashboard');
  }));

  router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
  });

  router.get('/dashboard', authRequired, asyncHandler(async (req, res) => {
    const [businesses] = await pool.query('SELECT * FROM businesses WHERE id = ?', [req.session.businessId]);
    const categories = await repos.categories.forBusiness(req.session.businessId).count();
    const products = await repos.products.forBusiness(req.session.businessId).count();

    res.render('admin/dashboard', {
      session: req.session,
      business: businesses[0],
      stats: { categories, products }
    });
  }));

  router.get('/settings', authRequired, asyncHandler(async (req, res) => {
    const [businesses] = await pool.query('SELECT * FROM businesses WHERE id = ?', [req.session.businessId]);
    const [hours] = await pool.query('SELECT * FROM business_hours WHERE business_id = ? ORDER BY day_index', [req.session.businessId]);

    res.render('admin/settings', { session: req.session, business: businesses[0], hours });
  }));

  router.get('/categories', authRequired, asyncHandler(async (req, res) => {
    const categories = await repos.categories
      .forBusiness(req.session.businessId)
      .listWithProductCount();

    res.render('admin/categories', { session: req.session, categories });
  }));

  router.get('/products', authRequired, asyncHandler(async (req, res) => {
    const scope = req.session.businessId;
    const categories = await repos.categories.forBusiness(scope).listOrdered();
    const products = await repos.products.forBusiness(scope).listWithCategory();

    res.render('admin/products', { session: req.session, categories, products });
  }));

  router.get('/qr', authRequired, asyncHandler(async (req, res) => {
    const [businesses] = await pool.query('SELECT * FROM businesses WHERE id = ?', [req.session.businessId]);
    const business = businesses[0];
    const menuUrl = 'https://' + config.domain + '/s/' + business.slug;
    const qrDataUrl = await QRCode.toDataURL(menuUrl, { width: 300, margin: 2, color: { dark: '#1A1A18', light: '#FFFFFF' } });
    res.render('admin/qr', { session: req.session, business, menuUrl, qrDataUrl });
  }));

  return router;
}

module.exports = createAdminRouter;

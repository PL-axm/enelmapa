const express = require('express');
const authRequired = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { createLoginLimiter } = require('../middleware/rateLimit');
const { regenerarSesion, destruirSesion } = require('../middleware/sesion');

// Cada handler es leer la sesión, llamar a un repo o servicio, y renderizar.
// Ni SQL ni bcrypt ni generación de QR: eso vive en repositories/ y services/.
function createAdminRouter({ repos, services, config }) {
  const router = express.Router();

  const loginLimiter = createLoginLimiter({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.loginMax,
    mensaje: 'Demasiados intentos de inicio de sesión. Esperá unos minutos.'
  });

  router.get('/login', (req, res) => {
    res.render('admin/login', { error: null });
  });

  router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await services.auth.verifyAdmin({ email, password });

    if (!user) {
      return res.render('admin/login', { error: 'Credenciales incorrectas' });
    }

    // Sesión nueva ANTES de escribir los datos del usuario: si el visitante
    // llegó con una cookie plantada, ese id se descarta acá y el que queda
    // autenticado es uno que el atacante no conoce.
    await regenerarSesion(req);

    req.session.userId = user.id;
    req.session.businessId = user.business_id;
    req.session.userName = user.name;
    req.session.businessName = user.business_name;
    req.session.businessSlug = user.slug;

    res.redirect('/admin/dashboard');
  }));

  // POST y no GET: con GET, un tercero podía desloguear a cualquiera con un
  // `<img src="/admin/logout">` en cualquier página. Es molestia y no brecha,
  // pero el arreglo es una línea y el formulario ya lleva el token CSRF.
  router.post('/logout', asyncHandler(async (req, res) => {
    await destruirSesion(req);
    res.redirect('/admin/login');
  }));

  router.get('/dashboard', authRequired, asyncHandler(async (req, res) => {
    const scope = req.session.businessId;
    const business = await repos.businesses.forBusiness(scope).get();
    const categories = await repos.categories.forBusiness(scope).count();
    const products = await repos.products.forBusiness(scope).count();

    res.render('admin/dashboard', { session: req.session, business, stats: { categories, products } });
  }));

  router.get('/settings', authRequired, asyncHandler(async (req, res) => {
    const scope = repos.businesses.forBusiness(req.session.businessId);
    const business = await scope.get();
    const hours = await scope.hours();

    res.render('admin/settings', { session: req.session, business, hours });
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
    const business = await repos.businesses.forBusiness(req.session.businessId).get();
    const { url, dataUrl } = await services.qr.forSlug(business.slug);
    res.render('admin/qr', { session: req.session, business, menuUrl: url, qrDataUrl: dataUrl });
  }));

  return router;
}

module.exports = createAdminRouter;

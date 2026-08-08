const express = require('express');
const bcrypt = require('bcryptjs');
const superRequired = require('../middleware/superauth');
const asyncHandler = require('../middleware/asyncHandler');
const { createLoginLimiter } = require('../middleware/rateLimit');
const { verifySuperadmin } = require('../services/superadminAuth');
const { NotFoundError } = require('../errors');

// Este router es el único que usa `repos.businesses.platform`, la superficie
// que cruza negocios a propósito: el superadmin puede crear, editar y borrar
// cualquiera. Que esas llamadas se lean distinto de las scopeadas es
// deliberado — ver el comentario de businessRepository.
//
// En la Fase 5, el alta de negocio+admin+horarios pasa a
// `businessService.createWithDefaults()` envuelto en `withTransaction`, que es
// lo que hoy deja negocios huérfanos si el email del admin ya existe.
function createSuperadminRouter({ repos, config }) {
  const router = express.Router();

  // Más estricto que el de /admin: es una sola cuenta conocida, nadie legítimo
  // necesita muchos reintentos, y es la que más daño hace si cae.
  const loginLimiter = createLoginLimiter({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.superadminMax,
    mensaje: 'Demasiados intentos. Esperá unos minutos.'
  });

  router.get('/login', (req, res) => {
    res.render('superadmin/login', { error: null });
  });

  router.post('/login', loginLimiter, (req, res) => {
    const { email, password } = req.body;
    if (verifySuperadmin({ email, password }, config.superadmin)) {
      req.session.isSuper = true;
      return res.redirect('/superadmin');
    }
    res.render('superadmin/login', { error: 'Credenciales incorrectas' });
  });

  router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/superadmin/login');
  });

  router.get('/', superRequired, asyncHandler(async (req, res) => {
    const businesses = await repos.businesses.platform.listWithCounts();
    res.render('superadmin/dashboard', { businesses });
  }));

  router.get('/create', superRequired, (req, res) => {
    res.render('superadmin/create', { error: null });
  });

  router.post('/create', superRequired, asyncHandler(async (req, res) => {
    const { slug, name, address, phone, whatsapp, instagram, facebook, tiktok, admin_email, admin_password, admin_name } = req.body;

    if (await repos.businesses.platform.slugExists(slug)) {
      return res.render('superadmin/create', { error: 'El slug "' + slug + '" ya existe' });
    }

    // OJO: estas tres escrituras todavía NO son atómicas. Si el email del
    // admin ya existe, el negocio queda creado sin admin ni horarios y con el
    // slug ocupado. La costura para arreglarlo (`withTransaction`) ya está en
    // container.js; se usa en la Fase 5, cuando exista businessService.
    const bizId = await repos.businesses.platform.create({
      slug, name, address, phone, whatsapp, instagram, facebook, tiktok
    });

    await repos.users.forBusiness(bizId).create({
      email: admin_email,
      passwordHash: bcrypt.hashSync(admin_password, 10),
      name: admin_name
    });

    await repos.businesses.platform.createDefaultHours(bizId);

    res.redirect('/superadmin');
  }));

  router.get('/edit/:id', superRequired, asyncHandler(async (req, res) => {
    const business = await repos.businesses.platform.findById(req.params.id);
    if (!business) return res.redirect('/superadmin');
    const users = await repos.users.forBusiness(business.id).list();
    res.render('superadmin/edit', { business, users });
  }));

  router.post('/edit/:id', superRequired, asyncHandler(async (req, res) => {
    const { slug, name, address, phone, whatsapp, instagram, facebook, tiktok, is_open } = req.body;
    await repos.businesses.platform.update(req.params.id, {
      slug, name,
      address: address || '', phone: phone || '', whatsapp: whatsapp || '',
      instagram: instagram || '', facebook: facebook || '', tiktok: tiktok || '',
      is_open: is_open ? 1 : 0
    });
    res.redirect('/superadmin');
  }));

  router.post('/reset-password/:userId', superRequired, asyncHandler(async (req, res) => {
    const { new_password } = req.body;

    // Se busca ANTES de escribir: con un userId inexistente esto respondía 500
    // por un TypeError al leer `business_id` de undefined (mismo síntoma que
    // B4 — no distinguía "no encontrado" de "listo").
    const user = await repos.users.platform.findById(req.params.userId);
    if (!user) throw new NotFoundError('Usuario no encontrado');

    await repos.users.platform.setPassword(user.id, bcrypt.hashSync(new_password, 10));
    res.redirect('/superadmin/edit/' + user.business_id);
  }));

  router.post('/delete/:id', superRequired, asyncHandler(async (req, res) => {
    await repos.businesses.platform.remove(req.params.id);
    res.redirect('/superadmin');
  }));

  return router;
}

module.exports = createSuperadminRouter;

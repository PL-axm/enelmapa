const express = require('express');
const bcrypt = require('bcryptjs');
const superRequired = require('../middleware/superauth');
const asyncHandler = require('../middleware/asyncHandler');
const { verifySuperadmin } = require('../services/superadminAuth');

// Este router es el único que usa `repos.businesses.platform`, la superficie
// que cruza negocios a propósito: el superadmin puede crear, editar y borrar
// cualquiera. Que esas llamadas se lean distinto de las scopeadas es
// deliberado — ver el comentario de businessRepository.
//
// `pool` queda sólo para las queries de `users`, que se van con ese recurso.
// En la Fase 5, el alta de negocio+admin+horarios pasa a
// `businessService.createWithDefaults()` envuelto en `withTransaction`, que es
// lo que hoy deja negocios huérfanos si el email del admin ya existe.
function createSuperadminRouter({ pool, repos, config }) {
  const router = express.Router();

  router.get('/login', (req, res) => {
    res.render('superadmin/login', { error: null });
  });

  router.post('/login', (req, res) => {
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

    const hash = bcrypt.hashSync(admin_password, 10);
    await pool.query('INSERT INTO users (business_id, email, password_hash, name) VALUES (?, ?, ?, ?)',
      [bizId, admin_email, hash, admin_name || 'Administrador']);

    await repos.businesses.platform.createDefaultHours(bizId);

    res.redirect('/superadmin');
  }));

  router.get('/edit/:id', superRequired, asyncHandler(async (req, res) => {
    const business = await repos.businesses.platform.findById(req.params.id);
    if (!business) return res.redirect('/superadmin');
    const [users] = await pool.query('SELECT id, email, name FROM users WHERE business_id = ?', [req.params.id]);
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
    const hash = bcrypt.hashSync(new_password, 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.params.userId]);
    const [users] = await pool.query('SELECT business_id FROM users WHERE id = ?', [req.params.userId]);
    res.redirect('/superadmin/edit/' + users[0].business_id);
  }));

  router.post('/delete/:id', superRequired, asyncHandler(async (req, res) => {
    await repos.businesses.platform.remove(req.params.id);
    res.redirect('/superadmin');
  }));

  return router;
}

module.exports = createSuperadminRouter;

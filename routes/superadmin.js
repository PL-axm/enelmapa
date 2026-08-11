const express = require('express');
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
// El alta de negocio+admin+horarios pasa por `businessService`, que la envuelve
// en una transacción: antes, si el email del admin ya existía, quedaba un
// negocio sin admin ni horarios y con el slug ocupado.
function createSuperadminRouter({ repos, services, config }) {
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

    try {
      await services.businesses.createWithDefaults({
        business: { slug, name, address, phone, whatsapp, instagram, facebook, tiktok },
        admin: { email: admin_email, password: admin_password, name: admin_name }
      });
    } catch (err) {
      // Los errores de formulario se muestran SOBRE el formulario, no en la
      // página de error genérica: si no, el operador pierde todo lo que
      // escribió. Cualquier otra cosa sí va al handler central.
      if (err.statusCode === 400) {
        return res.render('superadmin/create', { error: err.message });
      }
      throw err;
    }

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

    await repos.users.platform.setPassword(user.id, services.auth.hashPassword(new_password));
    res.redirect('/superadmin/edit/' + user.business_id);
  }));

  router.post('/delete/:id', superRequired, asyncHandler(async (req, res) => {
    await repos.businesses.platform.remove(req.params.id);
    res.redirect('/superadmin');
  }));

  return router;
}

module.exports = createSuperadminRouter;

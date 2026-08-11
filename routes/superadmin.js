const express = require('express');
const superRequired = require('../middleware/superauth');
const asyncHandler = require('../middleware/asyncHandler');
const { createLoginLimiter } = require('../middleware/rateLimit');
const { verifySuperadmin } = require('../services/superadminAuth');
const { NotFoundError } = require('../errors');
const validate = require('../middleware/validate');
const { schemas } = require('../validators');

// Este router es el único que usa `repos.businesses.platform`, la superficie
// que cruza negocios a propósito: el superadmin puede crear, editar y borrar
// cualquiera. Que esas llamadas se lean distinto de las scopeadas es
// deliberado — ver el comentario de businessRepository.
//
// El alta de negocio+admin+horarios pasa por `businessService`, que la envuelve
// en una transacción: antes, si el email del admin ya existía, quedaba un
// negocio sin admin ni horarios y con el slug ocupado.
// Los errores de validación del alta se muestran SOBRE el formulario, igual que
// los del servicio: si fueran a la página de error genérica, el operador
// perdería todo lo que escribió. Por eso este wrapper en vez de `validate`
// pelado, que delega en el handler central.
function validarFormulario(schema, vista) {
  const validar = validate(schema);
  return (req, res, next) => validar(req, res, (err) => {
    if (err && err.statusCode === 400) {
      return res.render(vista, { error: err.message });
    }
    next(err);
  });
}

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

  // La validación corre antes del servicio, así que el slug llega con formato
  // garantizado. Un slug inválido ya no depende de que MySQL se queje: se
  // rechaza en el borde con un mensaje que dice qué está mal (hallazgo S7).
  router.post('/create', superRequired, validarFormulario(schemas.businessCreate, 'superadmin/create'), asyncHandler(async (req, res) => {
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

  router.post('/edit/:id', superRequired, validate(schemas.businessEdit), asyncHandler(async (req, res) => {
    const { slug, name, address, phone, whatsapp, instagram, facebook, tiktok, is_open } = req.body;
    await repos.businesses.platform.update(req.params.id, {
      slug, name,
      address: address || '', phone: phone || '', whatsapp: whatsapp || '',
      instagram: instagram || '', facebook: facebook || '', tiktok: tiktok || '',
      is_open: is_open ? 1 : 0
    });
    res.redirect('/superadmin');
  }));

  router.post('/reset-password/:userId', superRequired, validate(schemas.resetPassword), asyncHandler(async (req, res) => {
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

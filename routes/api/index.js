const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const authRequired = require('../../middleware/auth');
const asyncHandler = require('../../middleware/asyncHandler');
const { ValidationError, NotFoundError } = require('../../errors');

// Un :id no numérico llega tal cual al SQL (`WHERE id = 'abc'`) y MySQL
// responde ER_TRUNCATED_WRONG_VALUE. Se corta acá, en el borde, para que ni
// siquiera llegue a la consulta.
function requireIntParam(name) {
  return (req, res, next) => {
    const value = Number(req.params[name]);
    if (!Number.isInteger(value) || value <= 0) {
      return next(new ValidationError('Parámetro ' + name + ' inválido'));
    }
    req.params[name] = value;
    next();
  };
}

// Los repos devuelven si la escritura afectó alguna fila. Hasta acá eso se
// ignoraba y todo respondía {ok:true}, así que "no existe", "no es tuyo" y
// "listo" se veían igual desde el panel (hallazgo B4).
//
// Se responde 404 en los dos casos de fallo, y es a propósito: distinguir "no
// existe" de "no es tuyo" con un 403 confirmaría que ese id existe en OTRO
// negocio. Un enumerador podría mapear qué ids están ocupados recorriendo la
// ruta. Como el repo ya scopea por business_id, "no lo encontré dentro de tu
// negocio" es además la descripción honesta de lo que pasó.
function requireAffected(afectó, mensaje) {
  if (!afectó) throw new NotFoundError(mensaje);
}

function requireOrderArray(order) {
  if (!Array.isArray(order)) {
    throw new ValidationError('Se esperaba un array "order"');
  }
  return order;
}

// Sin `pool`: no queda una sola query inline acá. Los handlers son cableado
// puro — leer la request, llamar al repo, responder. El scope de tenant entra
// una vez por handler, en `forBusiness(req.session.businessId)`.
function createApiRouter({ repos, config }) {
  const router = express.Router();

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../../uploads', String(req.session.businessId));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, Date.now() + '-' + Math.random().toString(36).substring(2, 8) + ext);
    }
  });
  const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

  // === BUSINESS SETTINGS ===
  router.post('/settings', authRequired, upload.fields([
    { name: 'banner', maxCount: 1 },
    { name: 'logo', maxCount: 1 }
  ]), asyncHandler(async (req, res) => {
    const { name, address, phone, whatsapp, instagram, facebook, tiktok, is_open } = req.body;

    let banner_img, logo_img;
    if (req.files?.banner) banner_img = '/uploads/' + req.session.businessId + '/' + req.files.banner[0].filename;
    if (req.files?.logo) logo_img = '/uploads/' + req.session.businessId + '/' + req.files.logo[0].filename;

    const scope = repos.businesses.forBusiness(req.session.businessId);

    // El repo filtra por lista blanca: aunque el cliente mande `slug` o `id`
    // en el formulario, desde acá no se pueden tocar.
    await scope.update({
      name, address, phone, whatsapp, instagram, facebook, tiktok,
      is_open: is_open ? 1 : 0,
      menu_theme: req.body.menu_theme || 'light',
      banner_img,
      logo_img
    });

    if (req.body.hours) {
      let hours;
      try {
        hours = JSON.parse(req.body.hours);
      } catch (err) {
        throw new ValidationError('El campo "hours" no es JSON válido');
      }
      await scope.updateHours(hours);
    }

    req.session.businessName = name;
    res.json({ ok: true });
  }));

  // === CATEGORIES ===
  // Ya migrado al repo: no queda ni un `business_id` escrito a mano en estos
  // cuatro handlers. El scope entra una vez, en `forBusiness`.
  router.post('/categories', authRequired, asyncHandler(async (req, res) => {
    const { name } = req.body;
    const id = await repos.categories.forBusiness(req.session.businessId).create({ name });
    res.json({ ok: true, id });
  }));

  // OJO: /categories/reorder va ANTES de /categories/:id. Express matchea en
  // orden de registro, así que con el orden invertido (como estaba hasta el
  // 2026-08-06) toda petición a /reorder caía en el handler de /:id con
  // id='reorder' y tumbaba el proceso. Mismo criterio en /products.
  router.put('/categories/reorder', authRequired, asyncHandler(async (req, res) => {
    const order = requireOrderArray(req.body.order);
    await repos.categories.forBusiness(req.session.businessId).reorder(order);
    res.json({ ok: true });
  }));

  router.put('/categories/:id', authRequired, requireIntParam('id'), asyncHandler(async (req, res) => {
    const { name } = req.body;
    const afectó = await repos.categories.forBusiness(req.session.businessId).rename(req.params.id, name);
    requireAffected(afectó, 'Categoría no encontrada');
    res.json({ ok: true });
  }));

  router.delete('/categories/:id', authRequired, requireIntParam('id'), asyncHandler(async (req, res) => {
    const afectó = await repos.categories.forBusiness(req.session.businessId).remove(req.params.id);
    requireAffected(afectó, 'Categoría no encontrada');
    res.json({ ok: true });
  }));

  // === PRODUCTS ===
  // La pertenencia del category_id ya no se valida acá: la fuerza el repo
  // adentro de create/update, que es donde no se puede olvidar (B2/B3).
  const uploadedPath = (req) => req.file
    ? '/uploads/' + req.session.businessId + '/' + req.file.filename
    : '';

  router.post('/products', authRequired, upload.single('image'), asyncHandler(async (req, res) => {
    const { name, description, price, category_id } = req.body;

    const id = await repos.products.forBusiness(req.session.businessId).create({
      name,
      description,
      price: parseFloat(price),
      categoryId: category_id,
      image: uploadedPath(req)
    });

    res.json({ ok: true, id });
  }));

  router.put('/products/reorder', authRequired, asyncHandler(async (req, res) => {
    const order = requireOrderArray(req.body.order);
    await repos.products.forBusiness(req.session.businessId).reorder(order);
    res.json({ ok: true });
  }));

  router.put('/products/:id', authRequired, requireIntParam('id'), upload.single('image'), asyncHandler(async (req, res) => {
    const { name, description, price, category_id, is_active } = req.body;

    const afectó = await repos.products.forBusiness(req.session.businessId).update(req.params.id, {
      name,
      description,
      price: parseFloat(price),
      categoryId: category_id,
      isActive: is_active !== '0',
      image: uploadedPath(req)
    });

    requireAffected(afectó, 'Producto no encontrado');
    res.json({ ok: true });
  }));

  router.delete('/products/:id', authRequired, requireIntParam('id'), asyncHandler(async (req, res) => {
    const afectó = await repos.products.forBusiness(req.session.businessId).remove(req.params.id);
    requireAffected(afectó, 'Producto no encontrado');
    res.json({ ok: true });
  }));

  // === QR CODE ===
  router.get('/qr', authRequired, asyncHandler(async (req, res) => {
    const business = await repos.businesses.forBusiness(req.session.businessId).get();
    const size = parseInt(req.query.size) || 300;
    const menuUrl = 'https://' + config.domain + '/s/' + business.slug;
    const qr = await QRCode.toDataURL(menuUrl, { width: size, margin: 2, color: { dark: '#1A1A18', light: '#FFFFFF' } });
    res.json({ qr });
  }));

  return router;
}

module.exports = createApiRouter;

const express = require('express');
const { createUploader, verificarImagenes, traducirErroresDeSubida } = require('../../services/imageUpload');
const authRequired = require('../../middleware/auth');
const asyncHandler = require('../../middleware/asyncHandler');
const validate = require('../../middleware/validate');
const { schemas } = require('../../validators');
const { ValidationError, NotFoundError } = require('../../errors');

// Un :id no numérico llega tal cual al SQL (`WHERE id = 'abc'`) y MySQL
// responde ER_TRUNCATED_WRONG_VALUE. Se corta acá, en el borde, para que ni
// siquiera llegue a la consulta. Vive aparte de los esquemas de zod porque
// valida `req.params`, no el cuerpo.
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

// Los cinco campos de promoción viajan juntos y se guardan juntos, así que se
// agrupan una vez en vez de repetir cinco líneas en crear y otras cinco en
// editar — que es justo donde una queda afuera y el guardado responde 200 sin
// guardar ese campo. Ya vienen validados y normalizados por el esquema: el
// precio es número o null, las fechas son 'YYYY-MM-DD' o null, y los días son
// siete caracteres.
function camposPromo(body) {
  return {
    promo_price: body.promo_price,
    promo_label: body.promo_label,
    promo_from: body.promo_from,
    promo_to: body.promo_to,
    promo_days: body.promo_days
  };
}

// Sin `pool`: no queda una sola query inline acá. Los handlers son cableado
// puro — leer la request, llamar al repo, responder. El scope de tenant entra
// una vez por handler, en `forBusiness(req.session.businessId)`.
function createApiRouter({ repos, services }) {
  const router = express.Router();

  const upload = createUploader();

  // === BUSINESS SETTINGS ===
  router.post('/settings', authRequired, upload.fields([
    { name: 'banner', maxCount: 1 },
    { name: 'logo', maxCount: 1 }
  ]), verificarImagenes, validate(schemas.settings), asyncHandler(async (req, res) => {
    const {
      name, address, phone, whatsapp, instagram, facebook, tiktok,
      is_open, menu_theme, menu_scale, promos_enabled, hours
    } = req.body;

    let banner_img, logo_img;
    if (req.files?.banner) banner_img = '/uploads/' + req.session.businessId + '/' + req.files.banner[0].filename;
    if (req.files?.logo) logo_img = '/uploads/' + req.session.businessId + '/' + req.files.logo[0].filename;

    const scope = repos.businesses.forBusiness(req.session.businessId);

    // El repo filtra por lista blanca: aunque el cliente mande `slug` o `id`
    // en el formulario, desde acá no se pueden tocar.
    // Ojo al agregar un campo nuevo de `businesses`: hay que tocarlo en TRES
    // lugares —el esquema de validators/, la lista blanca del repo, y este
    // destructurado— y si falta el tercero el guardado responde 200 sin guardar
    // nada. Pasó con `menu_scale` y lo agarró su test de integración.
    await scope.update({
      name, address, phone, whatsapp, instagram, facebook, tiktok,
      is_open, menu_theme, menu_scale, promos_enabled, banner_img, logo_img
    });

    // Ya viene parseado y validado por el esquema: el try/catch del JSON y el
    // chequeo de formato de horas salieron del handler.
    if (hours) await scope.updateHours(hours);

    req.session.businessName = name;
    res.json({ ok: true });
  }));

  // === CATEGORIES ===
  // Ya migrado al repo: no queda ni un `business_id` escrito a mano en estos
  // cuatro handlers. El scope entra una vez, en `forBusiness`.
  router.post('/categories', authRequired, validate(schemas.categoryName), asyncHandler(async (req, res) => {
    const { name } = req.body;
    const id = await repos.categories.forBusiness(req.session.businessId).create({ name });
    res.json({ ok: true, id });
  }));

  // OJO: /categories/reorder va ANTES de /categories/:id. Express matchea en
  // orden de registro, así que con el orden invertido (como estaba hasta el
  // 2026-08-06) toda petición a /reorder caía en el handler de /:id con
  // id='reorder' y tumbaba el proceso. Mismo criterio en /products.
  router.put('/categories/reorder', authRequired, validate(schemas.reorder), asyncHandler(async (req, res) => {
    await repos.categories.forBusiness(req.session.businessId).reorder(req.body.order);
    res.json({ ok: true });
  }));

  router.put('/categories/:id', authRequired, requireIntParam('id'), validate(schemas.categoryName), asyncHandler(async (req, res) => {
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

  router.post('/products', authRequired, upload.single('image'), verificarImagenes, validate(schemas.productCreate), asyncHandler(async (req, res) => {
    const { name, description, price, category_id } = req.body;

    // `price` ya es número y `category_id` entero: los convirtió el esquema.
    // Antes acá había un `parseFloat` sin chequear NaN (hallazgo B5).
    const id = await repos.products.forBusiness(req.session.businessId).create({
      name,
      description,
      price,
      categoryId: category_id,
      image: uploadedPath(req),
      promo: camposPromo(req.body)
    });

    res.json({ ok: true, id });
  }));

  router.put('/products/reorder', authRequired, validate(schemas.reorder), asyncHandler(async (req, res) => {
    await repos.products.forBusiness(req.session.businessId).reorder(req.body.order);
    res.json({ ok: true });
  }));

  router.put('/products/:id', authRequired, requireIntParam('id'), upload.single('image'), verificarImagenes, validate(schemas.productUpdate), asyncHandler(async (req, res) => {
    const { name, description, price, category_id, is_active } = req.body;

    const afectó = await repos.products.forBusiness(req.session.businessId).update(req.params.id, {
      name,
      description,
      price,
      categoryId: category_id,
      isActive: is_active,
      image: uploadedPath(req),
      promo: camposPromo(req.body)
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
    const { dataUrl } = await services.qr.forSlug(business.slug, {
      size: parseInt(req.query.size) || undefined
    });
    res.json({ qr: dataUrl });
  }));

  // Va al final: traduce los errores de multer (que llegan sin statusCode y en
  // inglés) a errores de dominio, antes de que el handler central los tome por
  // bugs y responda 500.
  router.use(traducirErroresDeSubida);

  return router;
}

module.exports = createApiRouter;

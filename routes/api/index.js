const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const authRequired = require('../../middleware/auth');
const asyncHandler = require('../../middleware/asyncHandler');
const { ValidationError, ForbiddenError } = require('../../errors');

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

// El scoping por business_id en el WHERE protege las filas que ya existen,
// pero no sirve para un category_id que viene del cliente y se va a ESCRIBIR:
// ahí hay que confirmar la pertenencia antes. Devuelve el id ya normalizado a
// entero, o null si no es válido o no es de este negocio.
//
// La consulta ya vive en el repo; lo que queda acá es la normalización a
// entero. Cuando se migre `products` esto desaparece del todo: la validación
// pasa adentro de `productRepository.forBusiness().create()`, que es donde
// olvidarla deja de ser posible.
async function resolveOwnCategoryId(categoryRepo, rawCategoryId, businessId) {
  const categoryId = Number(rawCategoryId);
  if (!Number.isInteger(categoryId) || categoryId <= 0) return null;

  const owns = await categoryRepo.forBusiness(businessId).exists(categoryId);
  return owns ? categoryId : null;
}

function requireOrderArray(order) {
  if (!Array.isArray(order)) {
    throw new ValidationError('Se esperaba un array "order"');
  }
  return order;
}

// `pool` y `repos` conviven mientras dure la Fase 4: categorías ya salió, y
// productos/negocio/horarios siguen con SQL inline hasta que les toque. Al
// cerrar la fase `pool` desaparece de esta firma y los handlers quedan como
// cableado puro: validar → llamar al repo → responder.
function createApiRouter({ pool, repos, config }) {
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

    const menu_theme = req.body.menu_theme || 'light';
    const fields = { name, address, phone, whatsapp, instagram, facebook, tiktok, is_open: is_open ? 1 : 0, menu_theme };
    if (banner_img) fields.banner_img = banner_img;
    if (logo_img) fields.logo_img = logo_img;

    const keys = Object.keys(fields);
    const sets = keys.map(k => k + ' = ?').join(', ');
    const values = keys.map(k => fields[k]);
    values.push(req.session.businessId);

    await pool.query('UPDATE businesses SET ' + sets + ' WHERE id = ?', values);

    if (req.body.hours) {
      let hours;
      try {
        hours = JSON.parse(req.body.hours);
      } catch (err) {
        throw new ValidationError('El campo "hours" no es JSON válido');
      }
      for (const h of hours) {
        await pool.query('UPDATE business_hours SET open_time = ?, close_time = ?, is_closed = ? WHERE business_id = ? AND day_index = ?',
          [h.open_time, h.close_time, h.is_closed ? 1 : 0, req.session.businessId, h.day_index]);
      }
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

  // `rename`/`remove` devuelven si afectaron alguna fila, pero acá todavía se
  // ignora: distinguir "no existe" de "no es tuyo" de "listo" es B4, que
  // cambia el contrato de /api y va en su propia rama.
  router.put('/categories/:id', authRequired, requireIntParam('id'), asyncHandler(async (req, res) => {
    const { name } = req.body;
    await repos.categories.forBusiness(req.session.businessId).rename(req.params.id, name);
    res.json({ ok: true });
  }));

  router.delete('/categories/:id', authRequired, requireIntParam('id'), asyncHandler(async (req, res) => {
    await repos.categories.forBusiness(req.session.businessId).remove(req.params.id);
    res.json({ ok: true });
  }));

  // === PRODUCTS ===
  router.post('/products', authRequired, upload.single('image'), asyncHandler(async (req, res) => {
    const { name, description, price, category_id } = req.body;

    const categoryId = await resolveOwnCategoryId(repos.categories, category_id, req.session.businessId);
    if (categoryId === null) {
      throw new ForbiddenError('La categoría no pertenece a este negocio');
    }

    const image = req.file ? '/uploads/' + req.session.businessId + '/' + req.file.filename : '';
    const [maxRows] = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM products WHERE category_id = ? AND business_id = ?', [categoryId, req.session.businessId]);

    const [result] = await pool.query(
      'INSERT INTO products (business_id, category_id, name, description, price, image, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.session.businessId, categoryId, name, description || '', parseFloat(price), image, maxRows[0].next]
    );

    res.json({ ok: true, id: result.insertId });
  }));

  router.put('/products/reorder', authRequired, asyncHandler(async (req, res) => {
    const order = requireOrderArray(req.body.order);
    for (let i = 0; i < order.length; i++) {
      await pool.query('UPDATE products SET sort_order = ? WHERE id = ? AND business_id = ?', [i, Number(order[i]) || 0, req.session.businessId]);
    }
    res.json({ ok: true });
  }));

  router.put('/products/:id', authRequired, requireIntParam('id'), upload.single('image'), asyncHandler(async (req, res) => {
    const { name, description, price, category_id, is_active } = req.body;

    // El WHERE de abajo garantiza que el producto sea de este negocio, pero sin
    // esto se podría mover un producto propio a una categoría ajena.
    const categoryId = await resolveOwnCategoryId(repos.categories, category_id, req.session.businessId);
    if (categoryId === null) {
      throw new ForbiddenError('La categoría no pertenece a este negocio');
    }

    const fields = { name, description: description || '', price: parseFloat(price), category_id: categoryId, is_active: is_active !== '0' ? 1 : 0 };
    if (req.file) fields.image = '/uploads/' + req.session.businessId + '/' + req.file.filename;

    const keys = Object.keys(fields);
    const sets = keys.map(k => k + ' = ?').join(', ');
    const values = keys.map(k => fields[k]);
    values.push(req.params.id, req.session.businessId);

    await pool.query('UPDATE products SET ' + sets + ' WHERE id = ? AND business_id = ?', values);
    res.json({ ok: true });
  }));

  router.delete('/products/:id', authRequired, requireIntParam('id'), asyncHandler(async (req, res) => {
    await pool.query('DELETE FROM products WHERE id = ? AND business_id = ?', [req.params.id, req.session.businessId]);
    res.json({ ok: true });
  }));

  // === QR CODE ===
  router.get('/qr', authRequired, asyncHandler(async (req, res) => {
    const [businesses] = await pool.query('SELECT slug FROM businesses WHERE id = ?', [req.session.businessId]);
    const size = parseInt(req.query.size) || 300;
    const menuUrl = 'https://' + config.domain + '/s/' + businesses[0].slug;
    const qr = await QRCode.toDataURL(menuUrl, { width: size, margin: 2, color: { dark: '#1A1A18', light: '#FFFFFF' } });
    res.json({ qr });
  }));

  return router;
}

module.exports = createApiRouter;

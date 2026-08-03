const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getPool } = require('../../db/schema');
const authRequired = require('../../middleware/auth');

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
]), async (req, res) => {
  try {
    const db = getPool();
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

    await db.query('UPDATE businesses SET ' + sets + ' WHERE id = ?', values);

    if (req.body.hours) {
      const hours = JSON.parse(req.body.hours);
      for (const h of hours) {
        await db.query('UPDATE business_hours SET open_time = ?, close_time = ?, is_closed = ? WHERE business_id = ? AND day_index = ?',
          [h.open_time, h.close_time, h.is_closed ? 1 : 0, req.session.businessId, h.day_index]);
      }
    }

    req.session.businessName = name;
    res.json({ ok: true });
  } catch (err) {
    console.error('Settings save error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// === CATEGORIES ===
router.post('/categories', authRequired, async (req, res) => {
  const db = getPool();
  const { name } = req.body;
  const [maxRows] = await db.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM categories WHERE business_id = ?', [req.session.businessId]);
  const [result] = await db.query('INSERT INTO categories (business_id, name, sort_order) VALUES (?, ?, ?)', [req.session.businessId, name, maxRows[0].next]);
  res.json({ ok: true, id: result.insertId });
});

router.put('/categories/:id', authRequired, async (req, res) => {
  const db = getPool();
  const { name } = req.body;
  await db.query('UPDATE categories SET name = ? WHERE id = ? AND business_id = ?', [name, req.params.id, req.session.businessId]);
  res.json({ ok: true });
});

router.delete('/categories/:id', authRequired, async (req, res) => {
  const db = getPool();
  await db.query('DELETE FROM categories WHERE id = ? AND business_id = ?', [req.params.id, req.session.businessId]);
  res.json({ ok: true });
});

router.put('/categories/reorder', authRequired, async (req, res) => {
  const db = getPool();
  const { order } = req.body;
  for (let i = 0; i < order.length; i++) {
    await db.query('UPDATE categories SET sort_order = ? WHERE id = ? AND business_id = ?', [i, order[i], req.session.businessId]);
  }
  res.json({ ok: true });
});

// === PRODUCTS ===
router.post('/products', authRequired, upload.single('image'), async (req, res) => {
  const db = getPool();
  const { name, description, price, category_id } = req.body;
  const image = req.file ? '/uploads/' + req.session.businessId + '/' + req.file.filename : '';
  const [maxRows] = await db.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM products WHERE category_id = ?', [category_id]);

  const [result] = await db.query(
    'INSERT INTO products (business_id, category_id, name, description, price, image, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.session.businessId, category_id, name, description || '', parseFloat(price), image, maxRows[0].next]
  );

  res.json({ ok: true, id: result.insertId });
});

router.put('/products/reorder', authRequired, async (req, res) => {
  const db = getPool();
  const { order } = req.body;
  for (let i = 0; i < order.length; i++) {
    await db.query('UPDATE products SET sort_order = ? WHERE id = ? AND business_id = ?', [i, order[i], req.session.businessId]);
  }
  res.json({ ok: true });
});

router.put('/products/:id', authRequired, upload.single('image'), async (req, res) => {
  const db = getPool();
  const { name, description, price, category_id, is_active } = req.body;

  const fields = { name, description: description || '', price: parseFloat(price), category_id: parseInt(category_id), is_active: is_active !== '0' ? 1 : 0 };
  if (req.file) fields.image = '/uploads/' + req.session.businessId + '/' + req.file.filename;

  const keys = Object.keys(fields);
  const sets = keys.map(k => k + ' = ?').join(', ');
  const values = keys.map(k => fields[k]);
  values.push(req.params.id, req.session.businessId);

  await db.query('UPDATE products SET ' + sets + ' WHERE id = ? AND business_id = ?', values);
  res.json({ ok: true });
});

router.delete('/products/:id', authRequired, async (req, res) => {
  const db = getPool();
  await db.query('DELETE FROM products WHERE id = ? AND business_id = ?', [req.params.id, req.session.businessId]);
  res.json({ ok: true });
});

// === QR CODE ===
router.get('/qr', authRequired, async (req, res) => {
  const QRCode = require('qrcode');
  const db = getPool();
  const [businesses] = await db.query('SELECT slug FROM businesses WHERE id = ?', [req.session.businessId]);
  const size = parseInt(req.query.size) || 300;
  const domain = process.env.DOMAIN || 'enelmapa.co';
  const menuUrl = 'https://' + domain + '/s/' + businesses[0].slug;
  const qr = await QRCode.toDataURL(menuUrl, { width: size, margin: 2, color: { dark: '#1A1A18', light: '#FFFFFF' } });
  res.json({ qr });
});

module.exports = router;

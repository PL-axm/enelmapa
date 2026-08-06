const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getPool } = require('../db/schema');
const superRequired = require('../middleware/superauth');
const { verifySuperadmin } = require('../services/superadminAuth');

router.get('/login', (req, res) => {
  res.render('superadmin/login', { error: null });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (verifySuperadmin({ email, password })) {
    req.session.isSuper = true;
    return res.redirect('/superadmin');
  }
  res.render('superadmin/login', { error: 'Credenciales incorrectas' });
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/superadmin/login');
});

router.get('/', superRequired, async (req, res) => {
  const db = getPool();
  const [businesses] = await db.query(`
    SELECT b.*,
      (SELECT COUNT(*) FROM categories WHERE business_id = b.id) as cat_count,
      (SELECT COUNT(*) FROM products WHERE business_id = b.id) as prod_count,
      (SELECT email FROM users WHERE business_id = b.id LIMIT 1) as admin_email
    FROM businesses b ORDER BY b.created_at DESC
  `);
  res.render('superadmin/dashboard', { businesses });
});

router.get('/create', superRequired, (req, res) => {
  res.render('superadmin/create', { error: null });
});

router.post('/create', superRequired, async (req, res) => {
  const { slug, name, address, phone, whatsapp, instagram, facebook, tiktok, admin_email, admin_password, admin_name } = req.body;
  const db = getPool();

  const [existing] = await db.query('SELECT id FROM businesses WHERE slug = ?', [slug]);
  if (existing.length > 0) {
    return res.render('superadmin/create', { error: 'El slug "' + slug + '" ya existe' });
  }

  const [bizResult] = await db.query(
    'INSERT INTO businesses (slug, name, address, phone, whatsapp, instagram, facebook, tiktok, is_open) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
    [slug, name, address || '', phone || '', whatsapp || '', instagram || '', facebook || '', tiktok || '']
  );
  const bizId = bizResult.insertId;

  const hash = bcrypt.hashSync(admin_password, 10);
  await db.query('INSERT INTO users (business_id, email, password_hash, name) VALUES (?, ?, ?, ?)',
    [bizId, admin_email, hash, admin_name || 'Administrador']);

  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  for (let i = 0; i < days.length; i++) {
    await db.query('INSERT INTO business_hours (business_id, day_index, day_name, open_time, close_time) VALUES (?, ?, ?, ?, ?)',
      [bizId, i, days[i], '08:00', '20:00']);
  }

  res.redirect('/superadmin');
});

router.get('/edit/:id', superRequired, async (req, res) => {
  const db = getPool();
  const [businesses] = await db.query('SELECT * FROM businesses WHERE id = ?', [req.params.id]);
  if (businesses.length === 0) return res.redirect('/superadmin');
  const [users] = await db.query('SELECT id, email, name FROM users WHERE business_id = ?', [req.params.id]);
  res.render('superadmin/edit', { business: businesses[0], users });
});

router.post('/edit/:id', superRequired, async (req, res) => {
  const { slug, name, address, phone, whatsapp, instagram, facebook, tiktok, is_open } = req.body;
  const db = getPool();
  await db.query(
    'UPDATE businesses SET slug=?, name=?, address=?, phone=?, whatsapp=?, instagram=?, facebook=?, tiktok=?, is_open=? WHERE id=?',
    [slug, name, address || '', phone || '', whatsapp || '', instagram || '', facebook || '', tiktok || '', is_open ? 1 : 0, req.params.id]
  );
  res.redirect('/superadmin');
});

router.post('/reset-password/:userId', superRequired, async (req, res) => {
  const { new_password } = req.body;
  const db = getPool();
  const hash = bcrypt.hashSync(new_password, 10);
  await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.params.userId]);
  const [users] = await db.query('SELECT business_id FROM users WHERE id = ?', [req.params.userId]);
  res.redirect('/superadmin/edit/' + users[0].business_id);
});

router.post('/delete/:id', superRequired, async (req, res) => {
  const db = getPool();
  await db.query('DELETE FROM businesses WHERE id = ?', [req.params.id]);
  res.redirect('/superadmin');
});

module.exports = router;

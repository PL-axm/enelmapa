const { getPool } = require('../db/schema');

async function tenantMiddleware(req, res, next) {
  let slug = null;

  if (req.params.slug) {
    slug = req.params.slug;
  } else {
    const host = req.hostname;
    const parts = host.split('.');
    if (parts.length >= 3 && parts[0] !== 'www' && parts[0] !== 'admin') {
      slug = parts[0];
    }
  }

  if (!slug) {
    return res.status(404).render('404', { message: 'Negocio no encontrado' });
  }

  try {
    const db = getPool();
    const [businesses] = await db.query('SELECT * FROM businesses WHERE slug = ?', [slug]);

    if (businesses.length === 0) {
      return res.status(404).render('404', { message: 'Negocio no encontrado' });
    }

    const business = businesses[0];
    const [hours] = await db.query('SELECT * FROM business_hours WHERE business_id = ? ORDER BY day_index', [business.id]);
    const [categories] = await db.query('SELECT * FROM categories WHERE business_id = ? ORDER BY sort_order', [business.id]);
    const [products] = await db.query('SELECT * FROM products WHERE business_id = ? AND is_active = 1 ORDER BY sort_order', [business.id]);

    req.business = business;
    req.businessHours = hours;
    req.categories = categories;
    req.products = products;

    next();
  } catch (err) {
    console.error('Tenant error:', err);
    res.status(500).render('404', { message: 'Error interno' });
  }
}

module.exports = tenantMiddleware;

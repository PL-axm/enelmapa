const { getSubdomain } = require('../services/subdomain');
const asyncHandler = require('./asyncHandler');
const { NotFoundError } = require('../errors');

// Resuelve el negocio (tenant) de la request, por :slug de la ruta o por
// subdominio, y cuelga sus datos en req para que routes/public.js solo tenga
// que darles forma.
//
// Antes atrapaba sus propios errores y renderizaba el 404 a mano; ahora
// delega en el error handler central, que es el único que decide qué status
// y qué formato corresponde.
//
// Recibe el pool (Fase 3). En la Fase 4 esto pasa a recibir repositories y
// las cuatro queries de acá se van con ellos.
function createTenantMiddleware({ pool }) {
  return asyncHandler(async (req, res, next) => {
    const slug = req.params.slug || getSubdomain(req.hostname);

    if (!slug) {
      throw new NotFoundError('Negocio no encontrado');
    }

    const [businesses] = await pool.query('SELECT * FROM businesses WHERE slug = ?', [slug]);

    if (businesses.length === 0) {
      throw new NotFoundError('Negocio no encontrado');
    }

    const business = businesses[0];
    const [hours] = await pool.query('SELECT * FROM business_hours WHERE business_id = ? ORDER BY day_index', [business.id]);
    const [categories] = await pool.query('SELECT * FROM categories WHERE business_id = ? ORDER BY sort_order', [business.id]);
    const [products] = await pool.query('SELECT * FROM products WHERE business_id = ? AND is_active = 1 ORDER BY sort_order', [business.id]);

    req.business = business;
    req.businessHours = hours;
    req.categories = categories;
    req.products = products;

    next();
  });
}

module.exports = createTenantMiddleware;

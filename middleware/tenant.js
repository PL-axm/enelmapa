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
// Sin `pool`: resolver el tenant es ahora tres llamadas a repositories. Nótese
// que `findBySlug` vive en la superficie de plataforma a propósito — este
// middleware corre ANTES de saber qué negocio es, así que no hay scope todavía;
// a partir de ahí, todo lo demás ya va scopeado por `business.id`.
function createTenantMiddleware({ repos }) {
  return asyncHandler(async (req, res, next) => {
    const slug = req.params.slug || getSubdomain(req.hostname);

    if (!slug) {
      throw new NotFoundError('Negocio no encontrado');
    }

    const business = await repos.businesses.platform.findBySlug(slug);

    if (!business) {
      throw new NotFoundError('Negocio no encontrado');
    }

    const hours = await repos.businesses.forBusiness(business.id).hours();
    const categories = await repos.categories.forBusiness(business.id).listOrdered();
    const products = await repos.products.forBusiness(business.id).listActive();

    req.business = business;
    req.businessHours = hours;
    req.categories = categories;
    req.products = products;

    next();
  });
}

module.exports = createTenantMiddleware;

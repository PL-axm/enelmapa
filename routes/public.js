const express = require('express');

// Sin dependencias a propósito: este router no sabe qué tenant está
// renderizando, sólo le da forma a lo que `middleware/tenant.js` dejó en req.
// Recibe un objeto vacío y no lo usa — la firma es la del resto de los
// routers para que cablearlos sea uniforme.
//
// (En la Fase 5 el armado de `menuData` se muda a `menuService`.)
function createPublicRouter() {
  const router = express.Router();

  router.get('*', (req, res) => {
    const { business, businessHours, categories, products } = req;

    const menuData = categories.map(cat => ({
      id: cat.id,
      name: cat.name,
      products: products
        .filter(p => p.category_id === cat.id)
        .map(p => ({
          id: p.id,
          name: p.name,
          desc: p.description,
          price: p.price,
          img: p.image || ''
        }))
    })).filter(cat => cat.products.length > 0);

    res.render('menu', {
      business,
      hours: businessHours,
      menuData
    });
  });

  return router;
}

module.exports = createPublicRouter;

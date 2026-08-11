const express = require('express');

// Este router no sabe qué tenant está renderizando: sólo pasa lo que
// `middleware/tenant.js` dejó en req por `menuService` y renderiza. El armado
// de `menuData` —y la regla de esconder las categorías vacías— vive en el
// servicio, donde se puede probar sin levantar Express.
function createPublicRouter({ services }) {
  const router = express.Router();

  router.get('*', (req, res) => {
    const { business, businessHours, categories, products } = req;

    const menuData = services.menu.buildMenu({ categories, products });

    res.render('menu', {
      business,
      hours: businessHours,
      menuData
    });
  });

  return router;
}

module.exports = createPublicRouter;

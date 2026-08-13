const express = require('express');
const jsonInline = require('../services/jsonInline');
const { cssDePaleta, cssDeEscala, plantillaOPorDefecto } = require('../theme');
const promos = require('../services/promos');

// Este router no sabe qué tenant está renderizando: sólo pasa lo que
// `middleware/tenant.js` dejó en req por `menuService` y renderiza. El armado
// de `menuData` —y la regla de esconder las categorías vacías— vive en el
// servicio, donde se puede probar sin levantar Express.
function createPublicRouter({ services, config }) {
  const router = express.Router();

  router.get('*', (req, res) => {
    const { business, businessHours, categories, products } = req;

    // La fecha se calcula acá y se inyecta: el servicio es puro y no lee el
    // reloj. `config.zonaHoraria` es la del negocio, no la del servidor — si el
    // proceso corre en UTC, "hoy" cambiaría a las 7 de la tarde hora Colombia.
    const hoy = promos.hoyEn(config.zonaHoraria);

    const menuData = services.menu.buildMenu({
      categories,
      products,
      promosEnabled: Boolean(business.promos_enabled),
      hoy
    });

    res.render('menu', {
      business,
      hours: businessHours,
      menuData,
      // El skin se resuelve ACÁ, contra el registro de theme/templates.js, y no
      // en la vista con `business.menu_template` directo: eso último haría que
      // un valor guardado a mano en la columna se convirtiera en el path de un
      // `include`. Lo que llega a la vista siempre es una plantilla conocida.
      plantilla: plantillaOPorDefecto(business.menu_template),
      // Helpers de vista, no dependencias del router: se pasan explícitos en vez
      // de por `app.locals` para que se vea de dónde salen. Sólo esta vista los
      // usa, así que no hay nada que compartir globalmente.
      jsonInline,
      cssDePaleta,
      cssDeEscala
    });
  });

  return router;
}

module.exports = createPublicRouter;

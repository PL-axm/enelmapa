const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { createEventLimiter } = require('../middleware/rateLimit');
const { schemas } = require('../validators');
const estadisticas = require('../services/estadisticas');

// El beacon de estadísticas del menú público: `POST /s/<slug>/evento`.
//
// Cuelga de `/s/:slug` y no de `/api` porque `/api` exige sesión de admin, y
// porque una ruta relativa así funciona igual en `slug.enelmapa.co` que en
// `enelmapa.co/s/slug` — el middleware de subdominio sólo intercepta `/`.
//
// No pasa por `tenantMiddleware` a propósito: ese carga el menú entero
// (productos, fotos, ubicaciones) y para sumar una fila alcanza con el id.
//
// Siempre responde 204, también cuando descarta el evento (un bot, un slug que
// no existe). Responder distinto según el slug convertiría esto en un detector
// de qué negocios existen.
function createEventosRouter({ repos, config }) {
  const router = express.Router();

  const limiter = createEventLimiter({ max: config.rateLimit.eventosMax });

  router.post('/s/:slug/evento', limiter, validate(schemas.evento), asyncHandler(async (req, res) => {
    const userAgent = req.get('user-agent') || '';

    if (estadisticas.esBot(userAgent)) {
      return res.status(204).end();
    }

    const business = await repos.businesses.platform.findBySlug(req.params.slug);
    if (!business) {
      return res.status(204).end();
    }

    const { tipo, product_id: productId, o, ref } = req.body;
    const { dia, hora } = estadisticas.momentoEn(config.zonaHoraria);

    await repos.events.forBusiness(business.id).registrar({
      tipo,
      productId: tipo === 'producto' ? productId : null,
      origen: tipo === 'visita'
        ? estadisticas.clasificarOrigen({ o, ref, userAgent, dominio: config.domain })
        : null,
      visitante: estadisticas.huellaVisitante({
        ip: req.ip, userAgent, dia, secreto: config.session.secret
      }),
      dia,
      hora
    });

    res.status(204).end();
  }));

  return router;
}

module.exports = createEventosRouter;

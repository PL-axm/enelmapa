-- Estadísticas de uso del menú público: un evento por fila, sin resumir.
--
-- Los eventos los manda el NAVEGADOR (un beacon desde views/menu.ejs), no el
-- servidor al renderizar: los scanners que golpean el sitio a +100 req/min y
-- las vistas previas de links de WhatsApp/Instagram no ejecutan JS, así que no
-- inflan los números. Ver plans/estadisticas-visitas.md.
--
-- `dia` y `hora` se guardan YA en la zona del negocio (config.zonaHoraria),
-- calculadas en Node. Agrupar por `created_at` en UTC correría al día siguiente
-- todo lo de las 7 de la noche en adelante — el mismo problema que tenían las
-- promos — y convertir en SQL con CONVERT_TZ exige las tablas de zonas horarias
-- cargadas en MySQL, que en cPanel no están garantizadas.
--
-- `visitante` es un hash de IP + user-agent + día + secreto (ver
-- services/estadisticas.js). No se guarda la IP ni nada que identifique a una
-- persona, y como el día entra en el hash, el visitante de hoy no se puede
-- vincular con el de ayer.
--
-- `product_id` NO tiene FK a propósito: si el dueño borra un producto, sus
-- vistas se quedan en el historial. Las lecturas hacen JOIN con `products`
-- scopeado por negocio, así que un producto borrado —o un id de otro negocio
-- que alguien mande a mano— simplemente no aparece.

CREATE TABLE IF NOT EXISTS menu_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  tipo ENUM('visita','producto','whatsapp','instagram','facebook') NOT NULL,
  product_id INT NULL,
  origen VARCHAR(20) NULL,
  visitante CHAR(16) NOT NULL,
  dia DATE NOT NULL,
  hora TINYINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  KEY idx_negocio_dia (business_id, dia, tipo),
  KEY idx_negocio_producto (business_id, tipo, product_id)
);

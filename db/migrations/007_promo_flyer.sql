-- El flyer de promoción: una imagen sola, sin texto, que el negocio arma por su
-- cuenta ("2x1 en tal producto") y se muestra arriba del menú.
--
-- Una sola columna y ninguna tabla nueva porque es UNO por negocio. Mismo tipo
-- que `banner_img` y `logo_img`, que guardan la misma clase de dato: un path
-- bajo /uploads.
--
-- Lo gobierna `promos_enabled`, el interruptor que ya existe: apagar promociones
-- apaga también el flyer, porque es una promoción. No tiene vigencia propia
-- (fechas ni días) a propósito — una imagen se sube y se baja a mano, mientras
-- que el precio promocional cambia solo y por eso sí la necesita. Si más
-- adelante hace falta un "flyer de los martes", son tres columnas y cero lógica
-- nueva: `services/promos.js` ya sabe evaluar exactamente eso.
--
-- Mismo guard que las anteriores: MySQL no tiene `ADD COLUMN IF NOT EXISTS` y el
-- DDL es auto-commit, así que un ALTER a medias no se revierte con una
-- transacción.

SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'businesses'
    AND COLUMN_NAME = 'promo_flyer'
);

SET @sql := IF(@existe = 0,
  'ALTER TABLE businesses ADD COLUMN promo_flyer VARCHAR(500) DEFAULT ''''',
  'DO 0'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

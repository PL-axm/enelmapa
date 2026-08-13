-- Promociones: un precio promocional sobre un producto que ya existe, con
-- vigencia. No hay entidad "promo" independiente a propósito — nada de 2x1
-- sueltos sin producto detrás.
--
-- La vigencia tiene dos dimensiones y se necesitan las dos:
--   * ventana de fechas (promo_from / promo_to) para "todo septiembre",
--     "esta semana", "este mes";
--   * días de la semana (promo_days) para "todos los martes".
-- Combinadas dan "todo septiembre pero sólo martes y jueves".
--
-- Decisiones que conviene tener escritas acá y no deducir del código:
--
-- * `promo_price NULL` es el interruptor de la promo. No hay `promo_active`
--   aparte: dos fuentes para el mismo hecho terminan contradiciéndose. Y NULL en
--   vez de 0 porque 0 es un precio válido (una cortesía, un acompañamiento).
--
-- * `promo_days` es CHAR(7) de '0'/'1', no un bitmask. Un TINYINT con bits es
--   más compacto y ahí termina la ventaja: '0010100' se lee de un SELECT sin
--   hacer cuentas. La POSICIÓN 0 ES DOMINGO, igual que business_hours.day_index
--   (ver DAYS en repositories/businessRepository.js) e igual que Date.getDay().
--   Una segunda convención de días en la misma base sería un bug de corrimiento
--   esperando a pasar.
--
-- * `promos_enabled` vive en el negocio: apaga la sección del menú sin borrar
--   los precios promocionales ya cargados.
--
-- Todas nulables o con default, así que para los negocios que ya existen esto es
-- un no-op: quedan sin promo y con la sección apagada.
--
-- Mismo guard que 002/004/005 para cada columna: MySQL no tiene
-- `ADD COLUMN IF NOT EXISTS` y el DDL es auto-commit, así que un ALTER a medias
-- no se revierte con una transacción.

SET @existe := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'businesses' AND COLUMN_NAME = 'promos_enabled');
SET @sql := IF(@existe = 0,
  'ALTER TABLE businesses ADD COLUMN promos_enabled TINYINT DEFAULT 0', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @existe := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'promo_price');
SET @sql := IF(@existe = 0,
  'ALTER TABLE products ADD COLUMN promo_price DECIMAL(12,2) NULL DEFAULT NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @existe := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'promo_label');
SET @sql := IF(@existe = 0,
  'ALTER TABLE products ADD COLUMN promo_label VARCHAR(40) DEFAULT ''''', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @existe := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'promo_from');
SET @sql := IF(@existe = 0,
  'ALTER TABLE products ADD COLUMN promo_from DATE NULL DEFAULT NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @existe := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'promo_to');
SET @sql := IF(@existe = 0,
  'ALTER TABLE products ADD COLUMN promo_to DATE NULL DEFAULT NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @existe := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'promo_days');
SET @sql := IF(@existe = 0,
  'ALTER TABLE products ADD COLUMN promo_days CHAR(7) DEFAULT ''1111111''', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

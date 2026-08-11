-- Reemplaza el `ALTER TABLE businesses ADD COLUMN menu_theme` que vivía dentro
-- de un try/catch vacío y corría en CADA arranque del servidor (hallazgo E6).
-- Ese patrón funcionaba, pero escondía cualquier otro error del ALTER y no
-- dejaba registro de qué se había aplicado.
--
-- MySQL no tiene `ADD COLUMN IF NOT EXISTS` (MariaDB sí), así que la condición
-- se consulta a information_schema y el ALTER se ejecuta preparado. Es lo que
-- hace que esta migración sea segura tanto en una base nueva —donde 001 ya creó
-- la columna, y acá no hace nada— como en una vieja que se la haya perdido.

SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'businesses'
    AND COLUMN_NAME = 'menu_theme'
);

SET @sql := IF(@existe = 0,
  'ALTER TABLE businesses ADD COLUMN menu_theme VARCHAR(20) DEFAULT ''light''',
  'DO 0'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

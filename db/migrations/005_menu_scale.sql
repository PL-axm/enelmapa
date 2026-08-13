-- `menu_scale` es el tercer eje de personalización del menú, después de la
-- paleta (`menu_theme`, que a pesar del nombre son sólo colores) y el skin
-- (`menu_template`, el layout). Este es el TAMAÑO: un multiplicador que se
-- aplica a los tamaños de fuente del contenido.
--
-- Los tres son independientes a propósito: cualquier combinación de paleta,
-- layout y escala tiene que ser válida, y por eso son tres columnas y no un
-- único "estilo" con combinaciones predefinidas.
--
-- Default 'normal', cuyo factor es exactamente 1, así que los negocios que ya
-- existen no ven ningún cambio de tamaño.
--
-- Mismo guard que 002 y 004: MySQL no tiene `ADD COLUMN IF NOT EXISTS` y el DDL
-- es auto-commit, así que un ALTER a medias no se revierte con una transacción.

SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'businesses'
    AND COLUMN_NAME = 'menu_scale'
);

SET @sql := IF(@existe = 0,
  'ALTER TABLE businesses ADD COLUMN menu_scale VARCHAR(20) DEFAULT ''normal''',
  'DO 0'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

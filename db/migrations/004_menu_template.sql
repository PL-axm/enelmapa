-- `menu_template` es el SKIN del menú: el layout. No confundir con `menu_theme`,
-- que a pesar del nombre son sólo colores (una paleta). Son dos ejes distintos y
-- por eso son dos columnas: un negocio puede querer la grilla en oscuro o la
-- lista en crema, y las cuatro combinaciones tienen que ser posibles.
--
-- `menu_theme` no se renombra a `menu_palette` aunque sería más claro: está en
-- producción, en el repositorio, en el validador, en dos vistas y en tests, y el
-- rename cuesta una migración sobre datos vivos sin comprar nada funcional.
--
-- Nulable con default: los negocios que ya existen quedan en 'clasico', que es
-- exactamente el layout que tienen hoy. Nadie ve un cambio.
--
-- Mismo guard que 002: MySQL no tiene `ADD COLUMN IF NOT EXISTS` y el DDL es
-- auto-commit, así que un ALTER a medias no se puede revertir con una
-- transacción. La condición se consulta a information_schema y el ALTER se
-- ejecuta preparado.

SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'businesses'
    AND COLUMN_NAME = 'menu_template'
);

SET @sql := IF(@existe = 0,
  'ALTER TABLE businesses ADD COLUMN menu_template VARCHAR(20) DEFAULT ''clasico''',
  'DO 0'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

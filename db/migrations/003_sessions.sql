-- La tabla de sesiones la venía creando `express-mysql-session` con
-- `createDatabaseTable: true`. Funcionaba, pero dejaba una parte del schema
-- fuera del control de las migraciones: la librería decidía la forma y el
-- momento, y un cambio de versión podía cambiarla sin que quedara registro.
--
-- Ahora la crea esta migración y el store arranca con `createDatabaseTable` en
-- false. La definición es la misma que generaba la librería —incluido el
-- collate binario del session_id, que importa para que la comparación del id
-- sea sensible a mayúsculas.

CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  expires INT UNSIGNED NOT NULL,
  data MEDIUMTEXT COLLATE utf8mb4_bin,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

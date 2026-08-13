-- El schema que la app tenía al momento de introducir migraciones, congelado.
--
-- Todas las tablas van con IF NOT EXISTS a propósito: esta migración tiene que
-- poder correr contra una base VACÍA (un clon nuevo, la de test) y contra la de
-- PRODUCCIÓN, que ya tiene todo creado por el viejo initDb(). En producción es
-- un no-op y lo único que hace es quedar registrada como aplicada.
--
-- `menu_theme` ya viene incluida en businesses. El código anterior la agregaba
-- con un `ALTER TABLE` dentro de un try/catch vacío que corría en cada arranque,
-- así que a esta altura existe en todas las bases. La migración 002 la agrega
-- igual, en forma condicional, por si alguna quedó atrás.

CREATE TABLE IF NOT EXISTS businesses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  address VARCHAR(500) DEFAULT '',
  phone VARCHAR(50) DEFAULT '',
  whatsapp VARCHAR(50) DEFAULT '',
  instagram VARCHAR(100) DEFAULT '',
  facebook VARCHAR(100) DEFAULT '',
  tiktok VARCHAR(100) DEFAULT '',
  banner_img VARCHAR(500) DEFAULT '',
  logo_img VARCHAR(500) DEFAULT '',
  is_open TINYINT DEFAULT 1,
  menu_theme VARCHAR(20) DEFAULT 'light',
  -- `menu_template` NO va acá: 001 es el schema congelado al momento de
  -- introducir migraciones y no se reescribe. La agrega 004.
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS business_hours (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  day_index INT NOT NULL,
  day_name VARCHAR(20) NOT NULL,
  open_time VARCHAR(10) DEFAULT '07:30',
  close_time VARCHAR(10) DEFAULT '20:00',
  is_closed TINYINT DEFAULT 0,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  sort_order INT DEFAULT 0,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_id INT NOT NULL,
  business_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT DEFAULT (''),
  price DECIMAL(12,2) NOT NULL DEFAULT 0,
  image VARCHAR(500) DEFAULT '',
  sort_order INT DEFAULT 0,
  is_active TINYINT DEFAULT 1,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) DEFAULT '',
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

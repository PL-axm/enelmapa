const mysql = require('mysql2/promise');

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'enelmapa',
      waitForConnections: true,
      connectionLimit: 10,
      charset: 'utf8mb4'
    });
  }
  return pool;
}

async function initDb() {
  const db = getPool();

  await db.query(`
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  try { await db.query('ALTER TABLE businesses ADD COLUMN menu_theme VARCHAR(20) DEFAULT "light"'); } catch(e) {}

  await db.query(`
    CREATE TABLE IF NOT EXISTS business_hours (
      id INT AUTO_INCREMENT PRIMARY KEY,
      business_id INT NOT NULL,
      day_index INT NOT NULL,
      day_name VARCHAR(20) NOT NULL,
      open_time VARCHAR(10) DEFAULT '07:30',
      close_time VARCHAR(10) DEFAULT '20:00',
      is_closed TINYINT DEFAULT 0,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      business_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      sort_order INT DEFAULT 0,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await db.query(`
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      business_id INT NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255) DEFAULT '',
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

module.exports = { getPool, initDb };

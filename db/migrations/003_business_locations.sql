-- Crear tabla para múltiples ubicaciones por negocio
CREATE TABLE IF NOT EXISTS business_locations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  address VARCHAR(500) NOT NULL,
  is_primary TINYINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  UNIQUE KEY unique_business_address (business_id, address),
  KEY idx_business_id (business_id),
  KEY idx_is_primary (is_primary)
);

-- Migrar datos existentes desde la columna address de businesses
INSERT INTO business_locations (business_id, address, is_primary, created_at)
SELECT id, address, 1, NOW()
FROM businesses
WHERE address IS NOT NULL AND address != '';

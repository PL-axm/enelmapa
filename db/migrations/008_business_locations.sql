-- Múltiples ubicaciones por negocio.
--
-- `businesses.address` se conserva: sigue siendo el respaldo del que sale la
-- primera ubicación, y no hay rollback para recuperarla si se borra.
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

-- Migrar la dirección que ya tenía cada negocio, como ubicación principal.
--
-- El LEFT JOIN es lo que hace esto REPETIBLE, y no es una precaución teórica:
-- esta tabla se creó a mano en producción durante una caída, así que las filas
-- ya existen pero `schema_migrations` no tiene registro de esta migración —
-- el runner la va a ver pendiente y la va a ejecutar igual. Sin el JOIN, el
-- INSERT choca contra UNIQUE(business_id, address), runMigrations lanza, y
-- server.js muere en el arranque: exactamente la caída que ya costó un día.
--
-- MySQL no tiene rollback de DDL, así que una migración que falla a la mitad
-- no se deshace. Repetible es la única red que hay.
INSERT INTO business_locations (business_id, address, is_primary, created_at)
SELECT b.id, b.address, 1, NOW()
FROM businesses b
LEFT JOIN business_locations bl
       ON bl.business_id = b.id
      AND bl.address     = b.address
WHERE b.address IS NOT NULL
  AND b.address != ''
  AND bl.id IS NULL;

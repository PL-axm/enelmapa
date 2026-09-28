-- Varias fotos por producto.
--
-- Hasta acá `products.image` guardaba UNA sola, y esa columna SE QUEDA: sigue
-- siendo la foto principal, la que muestran las tarjetas del menú y la que ven
-- los skins. Así esta tabla agrega la galería sin obligar a tocar el menú ni
-- los dos skins, y si algún día esta tabla estorba, el menú sigue funcionando
-- con lo de siempre. Es el mismo criterio que con `businesses.address` cuando
-- llegaron las sedes: no hay rollback de DDL, y la columna vieja es la única
-- forma de volver.
--
-- `business_id` está duplicado a propósito (el producto ya lo tiene). Todas las
-- consultas de este proyecto van scopeadas por negocio, y tenerlo acá evita que
-- cada lectura de fotos dependa de un JOIN correcto para no filtrar las de otro
-- negocio. Un JOIN olvidado sería una fuga silenciosa.

CREATE TABLE IF NOT EXISTS product_images (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  business_id INT NOT NULL,
  image VARCHAR(500) NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  UNIQUE KEY unique_producto_imagen (product_id, image),
  KEY idx_producto (product_id, sort_order)
);

-- Migrar la foto que cada producto ya tenía, como primera de su galería.
--
-- El LEFT JOIN hace que esto sea REPETIBLE, y no es precaución teórica: la
-- migración 008 se creó a mano en producción durante una caída y, sin guarda,
-- el INSERT habría chocado contra la clave única y matado el arranque del
-- servidor. Acá no se repite ese error.
INSERT INTO product_images (product_id, business_id, image, sort_order)
SELECT p.id, p.business_id, p.image, 0
FROM products p
LEFT JOIN product_images pi
       ON pi.product_id = p.id
      AND pi.image = p.image
WHERE p.image IS NOT NULL
  AND p.image != ''
  AND pi.id IS NULL;

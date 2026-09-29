// Las fotos de un producto. Igual que el resto de los repos con tenant, la
// única puerta de entrada es `forBusiness(businessId)`: no existe una variante
// sin scope que se pueda llamar por error.
//
// Acá sólo hay SQL. Las reglas —cuántas fotos se permiten, cuál es la
// principal— viven en services/productImageService.js.
const MAXIMO_POR_PRODUCTO = 5;

function buildProductImageRepository(db) {
  return {
    MAXIMO_POR_PRODUCTO,

    forBusiness(businessId) {
      if (!Number.isInteger(businessId) || businessId <= 0) {
        throw new Error('businessId must be a positive integer');
      }

      return {
        // Todas las consultas filtran también por business_id, aunque el
        // product_id ya sería suficiente: si un id de producto ajeno se colara
        // por la URL, el negocio equivocado no vería nada igual.
        async list(productId) {
          const [rows] = await db.query(
            `SELECT id, product_id, image, sort_order
               FROM product_images
              WHERE product_id = ? AND business_id = ?
              ORDER BY sort_order ASC, id ASC`,
            [productId, businessId]
          );
          return rows;
        },

        // Las fotos de varios productos de una vez. La usa el menú público:
        // pedir la galería producto por producto serían decenas de consultas
        // por visita.
        async listForProducts(productIds) {
          if (!productIds || productIds.length === 0) return [];
          const [rows] = await db.query(
            `SELECT id, product_id, image, sort_order
               FROM product_images
              WHERE business_id = ? AND product_id IN (?)
              ORDER BY product_id ASC, sort_order ASC, id ASC`,
            [businessId, productIds]
          );
          return rows;
        },

        async count(productId) {
          const [rows] = await db.query(
            'SELECT COUNT(*) AS total FROM product_images WHERE product_id = ? AND business_id = ?',
            [productId, businessId]
          );
          return rows[0].total;
        },

        async get(imageId) {
          const [rows] = await db.query(
            'SELECT id, product_id, image, sort_order FROM product_images WHERE id = ? AND business_id = ?',
            [imageId, businessId]
          );
          return rows[0] || null;
        },

        // El orden por defecto manda la foto nueva al final de la galería.
        async create(productId, image) {
          const [[fila]] = await db.query(
            'SELECT COALESCE(MAX(sort_order), -1) + 1 AS siguiente FROM product_images WHERE product_id = ? AND business_id = ?',
            [productId, businessId]
          );
          const [result] = await db.query(
            'INSERT INTO product_images (product_id, business_id, image, sort_order) VALUES (?, ?, ?, ?)',
            [productId, businessId, image, fila.siguiente]
          );
          return result.insertId;
        },

        // Cuántas referencias quedan a un archivo, mirando la galería Y la foto
        // principal de los productos. Se usa antes de borrarlo del disco: una
        // ruta puede estar referenciada dos veces, y borrar el archivo dejaría
        // una foto rota en el menú sin que nadie se entere.
        async usosDe(image) {
          const [[fila]] = await db.query(
            `SELECT (SELECT COUNT(*) FROM product_images WHERE business_id = ? AND image = ?)
                  + (SELECT COUNT(*) FROM products WHERE business_id = ? AND image = ?) AS total`,
            [businessId, image, businessId, image]
          );
          return fila.total;
        },

        async delete(imageId) {
          const [result] = await db.query(
            'DELETE FROM product_images WHERE id = ? AND business_id = ?',
            [imageId, businessId]
          );
          return result.affectedRows > 0;
        },

        // Pone una foto al principio. Se usa al elegir la principal: la galería
        // y la tarjeta del menú tienen que coincidir.
        async ponerPrimera(imageId, productId) {
          await db.query(
            'UPDATE product_images SET sort_order = sort_order + 1 WHERE product_id = ? AND business_id = ?',
            [productId, businessId]
          );
          const [result] = await db.query(
            'UPDATE product_images SET sort_order = 0 WHERE id = ? AND business_id = ?',
            [imageId, businessId]
          );
          return result.affectedRows > 0;
        }
      };
    }
  };
}

module.exports = buildProductImageRepository;

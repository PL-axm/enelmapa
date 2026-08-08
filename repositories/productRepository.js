const { ForbiddenError } = require('../errors');

// Misma forma que categoryRepository: sólo se entra por `forBusiness`.
//
// La diferencia importante está en `create` y `update`. El `AND business_id = ?`
// del WHERE protege la fila que ya existe, pero no dice nada sobre un
// `category_id` que viene del cliente y se va a ESCRIBIR: sin validarlo, un
// negocio podía colgar un producto de la categoría de otro (B2) o mover uno
// propio al árbol ajeno (B3). Hasta ahora eso lo cubría un helper suelto en
// routes/api/index.js, o sea que dependía de que cada handler se acordara de
// llamarlo. Acá adentro, olvidarlo deja de ser posible: no hay camino a la
// escritura que no pase por el chequeo.
//
// `categoryRepo` se INYECTA, no se construye acá dentro. Si este módulo hiciera
// `categoryRepository(db)` por su cuenta volveríamos a tener una dependencia
// oculta que ningún test puede reemplazar — y sería, además, el mismo error que
// la fase viene a corregir.
function productRepository(db, categoryRepo) {
  return {
    forBusiness(businessId) {
      if (!Number.isInteger(businessId) || businessId <= 0) {
        throw new Error('productRepository.forBusiness: businessId inválido (' + businessId + ')');
      }

      const categories = categoryRepo.forBusiness(businessId);

      // Todo lo que escriba un category_id pasa por acá. Devuelve el id
      // normalizado a entero o lanza: no hay opción de seguir de largo.
      async function requireOwnCategory(rawCategoryId) {
        const categoryId = Number(rawCategoryId);
        const owns = Number.isInteger(categoryId) && categoryId > 0
          && await categories.exists(categoryId);

        if (!owns) {
          throw new ForbiddenError('La categoría no pertenece a este negocio');
        }
        return categoryId;
      }

      return {
        // Para el menú público: sólo los activos.
        async listActive() {
          const [rows] = await db.query(
            'SELECT * FROM products WHERE business_id = ? AND is_active = 1 ORDER BY sort_order',
            [businessId]
          );
          return rows;
        },

        // Para /admin/products, que muestra a qué categoría pertenece cada uno.
        async listWithCategory() {
          const [rows] = await db.query(`
            SELECT p.*, c.name as category_name
            FROM products p
            JOIN categories c ON p.category_id = c.id
            WHERE p.business_id = ?
            ORDER BY c.sort_order, p.sort_order
          `, [businessId]);
          return rows;
        },

        async count() {
          const [rows] = await db.query(
            'SELECT COUNT(*) as count FROM products WHERE business_id = ?',
            [businessId]
          );
          return Number(rows[0].count);
        },

        async create({ name, description, price, categoryId, image }) {
          const ownCategoryId = await requireOwnCategory(categoryId);

          const [maxRows] = await db.query(
            'SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM products WHERE category_id = ? AND business_id = ?',
            [ownCategoryId, businessId]
          );
          const [result] = await db.query(
            'INSERT INTO products (business_id, category_id, name, description, price, image, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [businessId, ownCategoryId, name, description || '', price, image || '', maxRows[0].next]
          );
          return result.insertId;
        },

        // `image` opcional: si no viene, la columna no se toca (así guardar sin
        // subir archivo no borra la foto que ya tenía).
        async update(id, { name, description, price, categoryId, isActive, image }) {
          const ownCategoryId = await requireOwnCategory(categoryId);

          const fields = {
            name,
            description: description || '',
            price,
            category_id: ownCategoryId,
            is_active: isActive ? 1 : 0
          };
          if (image) fields.image = image;

          const keys = Object.keys(fields);
          const sets = keys.map(k => k + ' = ?').join(', ');
          const values = keys.map(k => fields[k]);
          values.push(id, businessId);

          const [result] = await db.query(
            'UPDATE products SET ' + sets + ' WHERE id = ? AND business_id = ?',
            values
          );
          return result.affectedRows > 0;
        },

        async remove(id) {
          const [result] = await db.query(
            'DELETE FROM products WHERE id = ? AND business_id = ?',
            [id, businessId]
          );
          return result.affectedRows > 0;
        },

        // Cada UPDATE lleva su `AND business_id = ?`, así que colar un id ajeno
        // en la lista no lo reordena: simplemente no matchea ninguna fila.
        async reorder(orderedIds) {
          for (let i = 0; i < orderedIds.length; i++) {
            await db.query(
              'UPDATE products SET sort_order = ? WHERE id = ? AND business_id = ?',
              [i, Number(orderedIds[i]) || 0, businessId]
            );
          }
        }
      };
    }
  };
}

module.exports = productRepository;

// El punto de todo el refactor está en esta forma: el repo no expone ninguna
// operación sobre `categories`. Lo único que se puede pedir es
// `forBusiness(id)`, y recién eso devuelve los métodos, ya atados a ese
// negocio. No existe una versión "sin scope" que alguien pueda llamar por
// error a las tres de la mañana (hallazgo E1 / regla no-negociable #3 del
// skill).
//
// `db` es un ejecutor, no el pool: el pool de mysql2 y una PoolConnection
// exponen la misma `.query()`, así que el mismo repo sirve adentro y afuera de
// una transacción sin duplicar firmas (ver la nota de transacciones en
// plans/refactor-arquitectura-repository-di.md).

function categoryRepository(db) {
  return {
    forBusiness(businessId) {
      // Falla ruidoso y temprano. Un `businessId` undefined que se colara
      // hasta el SQL haría `WHERE business_id = NULL`, que en MySQL no
      // matchea nada: una lectura devolvería vacío y una escritura no haría
      // nada, las dos en silencio y las dos pareciendo que funcionaron.
      if (!Number.isInteger(businessId) || businessId <= 0) {
        throw new Error('categoryRepository.forBusiness: businessId inválido (' + businessId + ')');
      }

      return {
        async listOrdered() {
          const [rows] = await db.query(
            'SELECT * FROM categories WHERE business_id = ? ORDER BY sort_order',
            [businessId]
          );
          return rows;
        },

        // Para la página /admin/categories, que muestra cuántos productos
        // cuelgan de cada una.
        async listWithProductCount() {
          const [rows] = await db.query(`
            SELECT c.*, COUNT(p.id) as product_count
            FROM categories c
            LEFT JOIN products p ON p.category_id = c.id
            WHERE c.business_id = ?
            GROUP BY c.id
            ORDER BY c.sort_order
          `, [businessId]);
          return rows;
        },

        // Para el contador del dashboard.
        async count() {
          const [rows] = await db.query(
            'SELECT COUNT(*) as count FROM categories WHERE business_id = ?',
            [businessId]
          );
          return Number(rows[0].count);
        },

        // Confirma pertenencia antes de ESCRIBIR un category_id que vino del
        // cliente. El `AND business_id = ?` de un UPDATE protege la fila que
        // ya existe, pero no dice nada sobre un id que se va a insertar
        // apuntando a otro lado (bugs B2/B3). Hasta la Fase 3 esto era un
        // helper suelto en routes/api/index.js, o sea que dependía de que
        // cada handler se acordara de llamarlo.
        async exists(id) {
          const categoryId = Number(id);
          if (!Number.isInteger(categoryId) || categoryId <= 0) return false;

          const [rows] = await db.query(
            'SELECT id FROM categories WHERE id = ? AND business_id = ?',
            [categoryId, businessId]
          );
          return rows.length > 0;
        },

        async create({ name }) {
          const [maxRows] = await db.query(
            'SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM categories WHERE business_id = ?',
            [businessId]
          );
          const [result] = await db.query(
            'INSERT INTO categories (business_id, name, sort_order) VALUES (?, ?, ?)',
            [businessId, name, maxRows[0].next]
          );
          return result.insertId;
        },

        // Devuelve si tocó alguna fila, y el handler responde 404 cuando no.
        // Antes devolvía `{ok:true}` sin mirar `affectedRows`, así que renombrar
        // una categoría inexistente o ajena se reportaba como éxito.
        async rename(id, name) {
          const [result] = await db.query(
            'UPDATE categories SET name = ? WHERE id = ? AND business_id = ?',
            [name, id, businessId]
          );
          return result.affectedRows > 0;
        },

        async remove(id) {
          const [result] = await db.query(
            'DELETE FROM categories WHERE id = ? AND business_id = ?',
            [id, businessId]
          );
          return result.affectedRows > 0;
        },

        // El orden llega como un array de ids; la posición en el array es el
        // nuevo sort_order. Cada UPDATE lleva su `AND business_id = ?`, así
        // que colar un id ajeno en la lista no lo reordena: simplemente no
        // matchea.
        async reorder(orderedIds) {
          for (let i = 0; i < orderedIds.length; i++) {
            await db.query(
              'UPDATE categories SET sort_order = ? WHERE id = ? AND business_id = ?',
              [i, Number(orderedIds[i]) || 0, businessId]
            );
          }
        }
      };
    }
  };
}

module.exports = categoryRepository;

// `businesses` es el único caso donde `forBusiness` no alcanza, y conviene
// decir por qué en vez de disimularlo.
//
// En categories/products la regla es absoluta: nadie tiene motivo para
// consultarlas sin un negocio. Acá no. Hay tres consumidores legítimamente
// no scopeados:
//   - el superadmin, cuyo trabajo ES operar sobre todos los negocios,
//   - la home pública, que lista los negocios existentes,
//   - la resolución de tenant por slug, que corre ANTES de saber qué negocio es.
//
// Por eso hay dos superficies. `forBusiness(id)` para el realm de /admin, donde
// el dueño toca sólo lo suyo; y `platform`, para lo que cruza negocios a
// propósito. Están separadas para que en el call site se lea la diferencia:
// `repos.businesses.platform.remove(id)` deja claro que eso borra el negocio
// de cualquiera, y es greppable el día que haya que auditar quién sale del
// scope.

const TENANT_FIELDS = [
  'name', 'address', 'phone', 'whatsapp', 'instagram', 'facebook', 'tiktok',
  'is_open', 'menu_theme', 'menu_scale', 'promos_enabled',
  'banner_img', 'logo_img', 'promo_flyer'
];

// Sólo se escriben las columnas presentes en `data`, y sólo si están en la
// lista blanca. Sin esto, un `UPDATE businesses SET ?` con lo que venga del
// cliente dejaría cambiar `id` o `slug` desde /api/settings.
function buildUpdate(data, allowed) {
  const keys = Object.keys(data).filter(k => allowed.includes(k) && data[k] !== undefined);
  return {
    sets: keys.map(k => k + ' = ?').join(', '),
    values: keys.map(k => data[k]),
    isEmpty: keys.length === 0
  };
}

function businessRepository(db) {
  return {
    forBusiness(businessId) {
      if (!Number.isInteger(businessId) || businessId <= 0) {
        throw new Error('businessRepository.forBusiness: businessId inválido (' + businessId + ')');
      }

      return {
        async get() {
          const [rows] = await db.query('SELECT * FROM businesses WHERE id = ?', [businessId]);
          return rows[0] || null;
        },

        // El dueño no puede cambiar su propio slug desde /admin — eso es
        // atribución de plataforma y vive en `platform.update`.
        async update(data) {
          const { sets, values, isEmpty } = buildUpdate(data, TENANT_FIELDS);
          if (isEmpty) return false;

          const [result] = await db.query(
            'UPDATE businesses SET ' + sets + ' WHERE id = ?',
            [...values, businessId]
          );
          return result.affectedRows > 0;
        },

        async hours() {
          const [rows] = await db.query(
            'SELECT * FROM business_hours WHERE business_id = ? ORDER BY day_index',
            [businessId]
          );
          return rows;
        },

        async updateHours(hours) {
          for (const h of hours) {
            await db.query(
              'UPDATE business_hours SET open_time = ?, close_time = ?, is_closed = ? WHERE business_id = ? AND day_index = ?',
              [h.open_time, h.close_time, h.is_closed ? 1 : 0, businessId, h.day_index]
            );
          }
        }
      };
    },

    // === Superficie de plataforma — cruza negocios a propósito ===
    platform: {
      async findBySlug(slug) {
        const [rows] = await db.query('SELECT * FROM businesses WHERE slug = ?', [slug]);
        return rows[0] || null;
      },

      async findById(id) {
        const [rows] = await db.query('SELECT * FROM businesses WHERE id = ?', [id]);
        return rows[0] || null;
      },

      // Para la home: sólo lo que la portada necesita, no la fila entera.
      async listForHome() {
        const [rows] = await db.query(
          'SELECT slug, name, logo_img FROM businesses ORDER BY name'
        );
        return rows;
      },

      async listWithCounts() {
        const [rows] = await db.query(`
          SELECT b.*,
            (SELECT COUNT(*) FROM categories WHERE business_id = b.id) as cat_count,
            (SELECT COUNT(*) FROM products WHERE business_id = b.id) as prod_count,
            (SELECT email FROM users WHERE business_id = b.id LIMIT 1) as admin_email
          FROM businesses b ORDER BY b.created_at DESC
        `);
        return rows;
      },

      async slugExists(slug) {
        const [rows] = await db.query('SELECT id FROM businesses WHERE slug = ?', [slug]);
        return rows.length > 0;
      },

      async create({ slug, name, address, phone, whatsapp, instagram, facebook, tiktok }) {
        const [result] = await db.query(
          'INSERT INTO businesses (slug, name, address, phone, whatsapp, instagram, facebook, tiktok, is_open) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
          [slug, name, address || '', phone || '', whatsapp || '', instagram || '', facebook || '', tiktok || '']
        );
        return result.insertId;
      },

      // El superadmin sí puede tocar el slug, a diferencia del dueño.
      async update(id, data) {
        const { sets, values, isEmpty } = buildUpdate(data, ['slug', ...TENANT_FIELDS]);
        if (isEmpty) return false;

        const [result] = await db.query(
          'UPDATE businesses SET ' + sets + ' WHERE id = ?',
          [...values, id]
        );
        return result.affectedRows > 0;
      },

      // Las categorías, productos, horarios y usuarios se van en cascada
      // (ver los ON DELETE CASCADE de db/migrations/001_initial.sql).
      async remove(id) {
        const [result] = await db.query('DELETE FROM businesses WHERE id = ?', [id]);
        return result.affectedRows > 0;
      },

      async createDefaultHours(businessId, { open = '08:00', close = '20:00' } = {}) {
        for (let i = 0; i < DAYS.length; i++) {
          await db.query(
            'INSERT INTO business_hours (business_id, day_index, day_name, open_time, close_time) VALUES (?, ?, ?, ?, ?)',
            [businessId, i, DAYS[i], open, close]
          );
        }
      }
    }
  };
}

// Estaba duplicado entre db/seed.js y routes/superadmin.js (hallazgo E3).
const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

module.exports = businessRepository;
module.exports.DAYS = DAYS;

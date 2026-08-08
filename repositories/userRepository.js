// Mismas dos superficies que businessRepository, y por la misma razón: un
// usuario pertenece a un negocio, pero hay dos accesos que no pueden estar
// scopeados porque el negocio todavía no se conoce o no es el del scope.
//
//   - el login busca por email y recién ahí descubre de qué negocio es;
//   - el superadmin resetea contraseñas de cualquier negocio.
//
// Todo lo demás va por `forBusiness`.
//
// Acá no se hashea nada: el repo persiste lo que le dan. bcrypt vive en el
// borde (hoy en las rutas, en la Fase 5 en `authService`), porque elegir el
// algoritmo y el costo es una decisión de seguridad, no de almacenamiento.

function userRepository(db) {
  return {
    forBusiness(businessId) {
      if (!Number.isInteger(businessId) || businessId <= 0) {
        throw new Error('userRepository.forBusiness: businessId inválido (' + businessId + ')');
      }

      return {
        // Sin password_hash: nadie que liste usuarios necesita el hash, y no
        // sacarlo de la DB es más barato que acordarse de no renderizarlo.
        async list() {
          const [rows] = await db.query(
            'SELECT id, email, name FROM users WHERE business_id = ? ORDER BY id',
            [businessId]
          );
          return rows;
        },

        async create({ email, passwordHash, name }) {
          const [result] = await db.query(
            'INSERT INTO users (business_id, email, password_hash, name) VALUES (?, ?, ?, ?)',
            [businessId, email, passwordHash, name || 'Administrador']
          );
          return result.insertId;
        }
      };
    },

    // === Superficie de plataforma ===
    platform: {
      // Para el login de /admin. Trae el negocio en el mismo viaje porque la
      // sesión necesita su nombre y su slug apenas se autentica.
      //
      // Devuelve el hash a propósito: es el único lugar que lo necesita, para
      // comparar. Ver el comentario de `list()` sobre por qué no aparece en
      // ningún otro método.
      async findByEmailWithBusiness(email) {
        const [rows] = await db.query(
          `SELECT u.*, b.name as business_name, b.slug
           FROM users u JOIN businesses b ON u.business_id = b.id
           WHERE u.email = ?`,
          [email]
        );
        return rows[0] || null;
      },

      async findById(id) {
        const [rows] = await db.query(
          'SELECT id, business_id, email, name FROM users WHERE id = ?',
          [id]
        );
        return rows[0] || null;
      },

      // El superadmin resetea la contraseña de cualquier admin.
      async setPassword(userId, passwordHash) {
        const [result] = await db.query(
          'UPDATE users SET password_hash = ? WHERE id = ?',
          [passwordHash, userId]
        );
        return result.affectedRows > 0;
      }
    }
  };
}

module.exports = userRepository;

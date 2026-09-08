function buildLocationRepository(db) {
  return {
    forBusiness(businessId) {
      if (!Number.isInteger(businessId) || businessId <= 0) {
        throw new Error('businessId must be a positive integer');
      }

      return {
        async getAll() {
          const [rows] = await db.query(
            'SELECT id, address, is_primary FROM business_locations WHERE business_id = ? ORDER BY is_primary DESC, created_at ASC',
            [businessId]
          );
          return rows;
        },

        async get(locationId) {
          const [rows] = await db.query(
            'SELECT id, address, is_primary FROM business_locations WHERE id = ? AND business_id = ?',
            [locationId, businessId]
          );
          return rows[0] || null;
        },

        async create(address, isPrimary = 0) {
          // Si es primaria, desmarcar otras
          if (isPrimary) {
            await db.query(
              'UPDATE business_locations SET is_primary = 0 WHERE business_id = ?',
              [businessId]
            );
          }

          const [result] = await db.query(
            'INSERT INTO business_locations (business_id, address, is_primary) VALUES (?, ?, ?)',
            [businessId, address, isPrimary ? 1 : 0]
          );
          return result.insertId;
        },

        async update(locationId, { address, isPrimary }) {
          // Si es primaria, desmarcar otras
          if (isPrimary) {
            await db.query(
              'UPDATE business_locations SET is_primary = 0 WHERE business_id = ? AND id != ?',
              [businessId, locationId]
            );
          }

          const [result] = await db.query(
            'UPDATE business_locations SET address = ?, is_primary = ? WHERE id = ? AND business_id = ?',
            [address, isPrimary ? 1 : 0, locationId, businessId]
          );
          return result.affectedRows > 0;
        },

        async delete(locationId) {
          // No permitir borrar si es la única ubicación
          const [rows] = await db.query(
            'SELECT COUNT(*) as count FROM business_locations WHERE business_id = ?',
            [businessId]
          );

          if (rows[0].count <= 1) {
            throw new Error('Cannot delete the last location. Every business must have at least one location.');
          }

          const [result] = await db.query(
            'DELETE FROM business_locations WHERE id = ? AND business_id = ?',
            [locationId, businessId]
          );
          return result.affectedRows > 0;
        },

        async count() {
          const [rows] = await db.query(
            'SELECT COUNT(*) as count FROM business_locations WHERE business_id = ?',
            [businessId]
          );
          return rows[0].count;
        },

        async getOrCreateDefault() {
          const locations = await this.getAll();
          if (locations.length === 0) {
            // Crear ubicación por defecto desde businesses.address si existe
            const [bizRows] = await db.query(
              'SELECT address FROM businesses WHERE id = ?',
              [businessId]
            );

            if (bizRows[0]?.address) {
              const id = await this.create(bizRows[0].address, 1);
              return { id, address: bizRows[0].address, is_primary: 1 };
            }
          }
          return locations[0] || null;
        }
      };
    },

    platform: {
      async getByBusinessId(businessId) {
        const [rows] = await db.query(
          'SELECT id, address, is_primary FROM business_locations WHERE business_id = ? ORDER BY is_primary DESC, created_at ASC',
          [businessId]
        );
        return rows;
      }
    }
  };
}

module.exports = buildLocationRepository;

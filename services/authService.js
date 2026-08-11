const bcrypt = require('bcryptjs');

// bcrypt sale de las rutas. Elegir el algoritmo y el costo es una decisión de
// seguridad, no de ruteo ni de almacenamiento: si mañana hay que subir el
// costo o migrar a argon2, se cambia acá y en ningún otro lado.
//
// Ojo con no confundirlo con services/superadminAuth.js: ese autentica al
// operador de plataforma, que no es una fila de la base sino variables de
// entorno. Este es para los dueños de negocio, que sí viven en `users`.

const BCRYPT_COST = 10;

function authService({ repos }) {
  return {
    hashPassword(plano) {
      return bcrypt.hashSync(plano, BCRYPT_COST);
    },

    // Devuelve el usuario con los datos de su negocio, o null. La respuesta es
    // deliberadamente la misma para "el email no existe" y "la contraseña está
    // mal": distinguirlas le diría a un atacante qué emails son válidos.
    async verifyAdmin({ email, password }) {
      const user = await repos.users.platform.findByEmailWithBusiness(email);

      // Sin `user` no hay hash contra el que comparar. Se devuelve null sin
      // llamar a bcrypt, así que un email inexistente responde más rápido que
      // uno existente — es un canal de timing conocido de este diseño, y
      // cerrarlo bien pide un hash señuelo. Queda anotado, no resuelto.
      if (!user) return null;
      if (!bcrypt.compareSync(password, user.password_hash)) return null;

      return user;
    }
  };
}

module.exports = authService;
module.exports.BCRYPT_COST = BCRYPT_COST;

const bcrypt = require('bcryptjs');

// bcrypt sale de las rutas. Elegir el algoritmo y el costo es una decisión de
// seguridad, no de ruteo ni de almacenamiento: si mañana hay que subir el
// costo o migrar a argon2, se cambia acá y en ningún otro lado.
//
// Ojo con no confundirlo con services/superadminAuth.js: ese autentica al
// operador de plataforma, que no es una fila de la base sino variables de
// entorno. Este es para los dueños de negocio, que sí viven en `users`.

const BCRYPT_COST = 10;

// Hash señuelo: se compara contra él cuando el email no existe, para que la
// respuesta tarde lo mismo que con un email real.
//
// Sin esto, un email inexistente volvía sin llamar a bcrypt y por lo tanto en
// microsegundos, mientras uno existente pagaba los ~80ms del hash. Esa
// diferencia es medible desde afuera, y convierte el login en un oráculo de qué
// emails están registrados — justo lo que el mensaje de error único trataba de
// esconder.
//
// Se calcula una sola vez al cargar el módulo. Cuesta un hash al arrancar, no
// uno por request.
const HASH_SEÑUELO = bcrypt.hashSync('señuelo-que-nunca-es-una-contraseña-real', BCRYPT_COST);

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

      // El `|| ''` importa: bcrypt.compareSync lanza si la contraseña es
      // undefined, y un login sin campos no debería explotar.
      const hashAComparar = user ? user.password_hash : HASH_SEÑUELO;
      const coincide = bcrypt.compareSync(password || '', hashAComparar);

      // El orden de esta condición no se puede invertir por un `&&` que
      // corte antes: la comparación tiene que correr SIEMPRE, exista el
      // usuario o no. Es todo el punto del señuelo.
      if (!user || !coincide) return null;

      return user;
    }
  };
}

module.exports = authService;
module.exports.BCRYPT_COST = BCRYPT_COST;

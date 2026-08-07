const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// El superadmin es la cuenta con más privilegios de la plataforma (puede
// editar/borrar cualquier negocio y resetear cualquier contraseña), y sin
// embargo era la única que se autenticaba con `password === SUPER_PASS`:
// comparación en texto plano y con short-circuit, o sea filtrando por timing
// cuántos caracteres iniciales acertaste.
//
// Dos cambios:
//  1. Comparación en tiempo constante (`timingSafeEqual`), sin short-circuit
//     entre email y password.
//  2. Soporte de `SUPER_PASS_HASH` (bcrypt) como forma preferida, igual que
//     los admins de negocio. `SUPER_PASS` en texto plano sigue funcionando
//     como fallback para no romper el despliegue actual, pero es el camino a
//     abandonar — generar el hash con:
//       node -e "console.log(require('bcryptjs').hashSync('LA_PASS', 10))"
//
// Fase 3: recibe `config.superadmin` en vez de leer `process.env`. La lectura
// del entorno y sus defaults viven en un solo lugar (config/index.js).

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');

  // timingSafeEqual exige buffers del mismo largo. Comparar contra sí mismo
  // mantiene el costo parejo antes de devolver false, para no delatar el
  // largo esperado.
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifySuperadmin({ email, password }, superadminConfig) {
  const { email: expectedEmail, passwordHash, password: expectedPassword } = superadminConfig;

  // Sin `&&`: los dos chequeos corren siempre, así el tiempo de respuesta no
  // revela si lo que falló fue el email o la contraseña.
  const emailOk = safeEqual(email || '', expectedEmail);
  const passwordOk = passwordHash
    ? bcrypt.compareSync(password || '', passwordHash)
    : safeEqual(password || '', expectedPassword);

  return emailOk && passwordOk;
}

module.exports = { verifySuperadmin, safeEqual };

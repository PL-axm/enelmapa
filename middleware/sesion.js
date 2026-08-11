// Fijación de sesión: el login seteaba `req.session.userId` sobre la sesión que
// el visitante ya traía, sin cambiar el id. Si alguien logra plantar una cookie
// de sesión en el navegador de la víctima ANTES de que se loguee —un subdominio
// comprometido, un XSS en otra parte del dominio, una máquina compartida— esa
// misma sesión queda autenticada después, y el atacante ya conoce su id.
//
// `regenerate()` descarta la sesión anterior (la borra del store) y arranca una
// nueva con otro id. Después de eso se escriben los datos del usuario, así que
// el id que queda autenticado es uno que el atacante no puede conocer.
//
// Se envuelve en promesa porque el resto de los handlers son async: mezclar
// callbacks con async/await en el medio de un login es justo donde un error
// silencioso deja a alguien a medio autenticar.
function regenerarSesion(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

// El logout ya destruye la sesión, pero conviene esperar a que termine antes de
// redirigir: si no, la respuesta puede salir antes de que el store haya borrado
// la fila, y una request inmediata con la cookie vieja todavía la encontraría.
function destruirSesion(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
}

module.exports = { regenerarSesion, destruirSesion };

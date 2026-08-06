// Extrae el slug de negocio de un hostname, si corresponde.
// Antes duplicado en app.js y middleware/tenant.js (ver BEST_PRACTICES.md
// sección 1). 'www' y 'admin' están excluidos a propósito: son subdominios
// reservados de la plataforma, no de un negocio.
function getSubdomain(hostname) {
  const parts = hostname.split('.');
  if (parts.length >= 3 && parts[0] !== 'www' && parts[0] !== 'admin') {
    return parts[0];
  }
  return null;
}

module.exports = { getSubdomain };

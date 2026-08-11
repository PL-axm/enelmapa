const request = require('supertest');

// Desde que hay CSRF, toda mutación necesita el token de la sesión. Estos
// helpers lo consiguen y lo adjuntan, para que la suite siga ejercitando el
// stack REAL — con CSRF puesto — en vez de desactivarlo para los tests. Si se
// desactivara, la suite dejaría de reflejar cómo se comporta producción en su
// camino principal, que es justo lo que tiene que cubrir.

// El panel lo publica en un <meta>; las vistas del superadmin, en el campo
// oculto de sus formularios.
function extraerToken(html) {
  const meta = html.match(/name="csrf-token" content="([^"]*)"/);
  if (meta) return meta[1];

  const campo = html.match(/name="_csrf" value="([^"]*)"/);
  return campo ? campo[1] : null;
}

// Devuelve un objeto con la misma forma que un agente de supertest, pero con el
// header ya puesto en los métodos que mutan. Así los tests no cambian de forma:
// siguen escribiendo `agent.post(url).send(...)`.
function conCsrf(agent, token) {
  const conHeader = (metodo) => (url) => agent[metodo](url).set('X-CSRF-Token', token);

  return {
    get: (url) => agent.get(url),
    post: conHeader('post'),
    put: conHeader('put'),
    patch: conHeader('patch'),
    delete: conHeader('delete'),
    // Para los casos que necesitan el token crudo o el agente sin envolver
    // (por ejemplo, probar qué pasa SIN token).
    token,
    sinCsrf: agent
  };
}

async function loginAdmin(app, { email, password }) {
  const agent = request.agent(app);
  await agent.post('/admin/login').type('form').send({ email, password });

  const res = await agent.get('/admin/dashboard');
  const token = extraerToken(res.text);
  if (!token) throw new Error('No se pudo obtener el token CSRF tras el login de /admin');

  return conCsrf(agent, token);
}

async function loginSuperadmin(app, { email = 'admin@enelmapa.co', password = 'super2026' } = {}) {
  const agent = request.agent(app);
  await agent.post('/superadmin/login').type('form').send({ email, password });

  const res = await agent.get('/superadmin/create');
  const token = extraerToken(res.text);
  if (!token) throw new Error('No se pudo obtener el token CSRF tras el login de /superadmin');

  return conCsrf(agent, token);
}

module.exports = { loginAdmin, loginSuperadmin, conCsrf, extraerToken };

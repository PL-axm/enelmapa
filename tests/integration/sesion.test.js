const request = require('supertest');
const { createTestApp, getTestPool, getTestContainer } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createBusiness } = require('../helpers/fixtures');
const { loginAdmin } = require('../helpers/sesion');

const app = createTestApp();

afterAll(async () => {
  await closeDb();
});

function idDeSesion(res) {
  const cookies = res.headers['set-cookie'] || [];
  const sid = cookies.find(c => c.startsWith('connect.sid='));
  return sid ? sid.split(';')[0].split('=')[1] : null;
}

describe('fijación de sesión', () => {
  let business;

  beforeEach(async () => {
    await resetDb();
    business = await createBusiness({
      slug: 'test-fijacion', name: 'Test Fijación',
      adminEmail: 'fijacion@test.local', adminPassword: 'password-fija-123'
    });
  });

  // Reproduce la forma REAL del ataque, y no una aproximación.
  //
  // Un visitante anónimo no recibe sesión (saveUninitialized está en false y
  // nada la toca sin autenticar), así que el atacante no puede pedirle una al
  // servidor sin más: tiene que conseguir una cookie VÁLIDAMENTE FIRMADA, y la
  // forma de conseguirla es loguearse él. Después la planta en el navegador de
  // la víctima —un subdominio comprometido, una máquina compartida— y espera
  // que la víctima entre.
  //
  // Sin regenerate(), esa cookie que el atacante ya conoce queda autenticada
  // como la víctima. Un test que sólo comparara contra "no había sesión antes"
  // pasaría sin probar nada: la comparación sería contra null.
  async function cookieDeUnAtacanteConSesionValida() {
    const atacante = await createBusiness({
      slug: 'atacante', name: 'Atacante',
      adminEmail: 'atacante@test.local', adminPassword: 'password-atac-123'
    });

    const res = await request(app).post('/admin/login').type('form')
      .send({ email: atacante.adminEmail, password: atacante.adminPassword });

    const cookie = (res.headers['set-cookie'] || []).find(c => c.startsWith('connect.sid='));
    expect(cookie).toBeDefined();   // si no, el resto del test no prueba nada
    return cookie.split(';')[0];
  }

  test('una cookie plantada NO queda autenticada como la víctima', async () => {
    const plantada = await cookieDeUnAtacanteConSesionValida();
    const idPlantado = plantada.split('=')[1];

    // La víctima entra trayendo la cookie del atacante.
    const res = await request(app).post('/admin/login')
      .set('Cookie', plantada)
      .type('form')
      .send({ email: business.adminEmail, password: business.adminPassword });

    expect(res.status).toBe(302);

    const idFinal = idDeSesion(res);
    expect(idFinal).not.toBeNull();
    expect(idFinal).not.toBe(idPlantado);
  });

  test('y la cookie plantada deja de servir para nada', async () => {
    const plantada = await cookieDeUnAtacanteConSesionValida();

    await request(app).post('/admin/login')
      .set('Cookie', plantada).type('form')
      .send({ email: business.adminEmail, password: business.adminPassword });

    // El atacante vuelve con su cookie: la sesión que él conocía se destruyó al
    // regenerar, así que no entra a ningún panel.
    const res = await request(app).get('/admin/dashboard').set('Cookie', plantada);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/login');
  });

  test('la sesión plantada se borra del store', async () => {
    const plantada = await cookieDeUnAtacanteConSesionValida();

    const [antes] = await getTestPool().query('SELECT session_id FROM sessions');
    const idsViejos = antes.map(f => f.session_id);
    expect(idsViejos.length).toBeGreaterThan(0);

    await request(app).post('/admin/login')
      .set('Cookie', plantada).type('form')
      .send({ email: business.adminEmail, password: business.adminPassword });

    const [despues] = await getTestPool().query('SELECT session_id FROM sessions');
    const idsNuevos = despues.map(f => f.session_id);

    for (const viejo of idsViejos) {
      expect(idsNuevos).not.toContain(viejo);
    }
  });

  test('después de regenerar, la sesión funciona normalmente', async () => {
    const agent = await loginAdmin(app, {
      email: business.adminEmail, password: business.adminPassword
    });

    const res = await agent.get('/admin/dashboard');
    expect(res.status).toBe(200);
    expect(res.text).toContain(business.name);
  });

  test('el superadmin también regenera al entrar', async () => {
    const plantada = await cookieDeUnAtacanteConSesionValida();
    const idPlantado = plantada.split('=')[1];

    const res = await request(app).post('/superadmin/login')
      .set('Cookie', plantada).type('form')
      .send({ email: 'admin@enelmapa.co', password: 'super2026' });

    expect(res.status).toBe(302);
    expect(idDeSesion(res)).not.toBe(idPlantado);

    // Y la cookie del atacante no da acceso al panel de plataforma.
    expect((await request(app).get('/superadmin').set('Cookie', plantada)).status).toBe(302);
  });

  test('el logout borra la fila del store, no sólo la cookie', async () => {
    const agent = await loginAdmin(app, {
      email: business.adminEmail, password: business.adminPassword
    });

    const [antes] = await getTestPool().query('SELECT COUNT(*) as n FROM sessions');
    expect(Number(antes[0].n)).toBeGreaterThan(0);

    await agent.post('/admin/logout');

    const [despues] = await getTestPool().query('SELECT COUNT(*) as n FROM sessions');
    expect(Number(despues[0].n)).toBe(0);
  });
});

// Sin el hash señuelo, un email inexistente volvía sin llamar a bcrypt —o sea en
// microsegundos— mientras uno existente pagaba los ~80ms del hash. Esa diferencia
// es medible desde afuera y convierte el login en un oráculo de qué emails están
// registrados, justo lo que el mensaje de error único trata de esconder.
describe('canal de tiempo en el login', () => {
  let business;

  beforeEach(async () => {
    await resetDb();
    business = await createBusiness({
      slug: 'test-timing', name: 'Test Timing',
      adminEmail: 'timing@test.local', adminPassword: 'password-timing-123'
    });
  });

  async function medir(email) {
    const auth = getTestContainer().services.auth;
    const inicio = process.hrtime.bigint();
    await auth.verifyAdmin({ email, password: 'una-contraseña-incorrecta' });
    return Number(process.hrtime.bigint() - inicio) / 1e6;
  }

  test('un email inexistente tarda un tiempo comparable a uno existente', async () => {
    // Se toma la mediana de varias corridas: una sola medición en un runner
    // compartido es demasiado ruidosa para afirmar nada.
    const mediana = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];

    const existentes = [];
    const inexistentes = [];
    for (let i = 0; i < 5; i++) {
      existentes.push(await medir(business.adminEmail));
      inexistentes.push(await medir('no-existe-' + i + '@test.local'));
    }

    const conUsuario = mediana(existentes);
    const sinUsuario = mediana(inexistentes);

    // El señuelo tiene el mismo costo que un hash real, así que los tiempos
    // deberían quedar en el mismo orden de magnitud. Sin él, el inexistente
    // era 100x más rápido.
    expect(sinUsuario).toBeGreaterThan(conUsuario / 3);
  });

  test('sigue devolviendo null y sin distinguir el motivo', async () => {
    const auth = getTestContainer().services.auth;

    expect(await auth.verifyAdmin({ email: 'no-existe@test.local', password: 'x' })).toBeNull();
    expect(await auth.verifyAdmin({ email: business.adminEmail, password: 'x' })).toBeNull();
  });

  test('no explota sin contraseña', async () => {
    const auth = getTestContainer().services.auth;

    expect(await auth.verifyAdmin({ email: business.adminEmail })).toBeNull();
    expect(await auth.verifyAdmin({})).toBeNull();
  });
});

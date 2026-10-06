const request = require('supertest');
const { createTestApp, getTestRepos, getTestContainer } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createTwoBusinesses } = require('../helpers/fixtures');
const { loginAdmin, loginSuperadmin } = require('../helpers/sesion');
const estadisticas = require('../../services/estadisticas');

const app = createTestApp();

// Las lecturas de las estadísticas y el tablero del dueño. Lo que más importa
// acá es el scope: el tablero de A no puede mostrar nada de B, ni siquiera un
// producto de B que alguien haya mandado a mano al beacon de A.

afterAll(async () => {
  await closeDb();
});

const hoy = () => estadisticas.momentoEn(getTestContainer().config.zonaHoraria).dia;

async function sembrar(businessId, eventos) {
  const repo = getTestRepos().events.forBusiness(businessId);
  for (const e of eventos) {
    await repo.registrar({
      tipo: e.tipo,
      productId: e.productId || null,
      origen: e.origen || (e.tipo === 'visita' ? 'directo' : null),
      visitante: e.visitante || 'aaaaaaaaaaaaaaaa',
      dia: e.dia || hoy(),
      hora: e.hora === undefined ? 12 : e.hora
    });
  }
}

const visitas = (cantidad, extra = {}) =>
  Array.from({ length: cantidad }, (_, i) => ({ tipo: 'visita', visitante: String(i).padStart(16, '0'), ...extra }));

describe('estadísticas: lecturas del repositorio', () => {
  let businessA;
  let businessB;

  beforeEach(async () => {
    await resetDb();
    ({ businessA, businessB } = await createTwoBusinesses());
  });

  const rango = () => estadisticas.periodos(hoy(), 30).actual;

  test('resumen cuenta cada tipo y sólo del negocio pedido', async () => {
    await sembrar(businessA.businessId, [
      ...visitas(3),
      { tipo: 'producto', productId: businessA.productId },
      { tipo: 'whatsapp' }, { tipo: 'whatsapp' }, { tipo: 'instagram' }
    ]);
    await sembrar(businessB.businessId, visitas(7));

    const r = await getTestRepos().events.forBusiness(businessA.businessId).resumen(rango());
    expect(r).toEqual({ visitas: 3, visitantes: 3, productos: 1, whatsapp: 2, instagram: 1, facebook: 0 });
  });

  // Los visitantes son únicos POR DÍA: la misma huella dos veces el mismo día
  // es una; en días distintos (en la vida real la huella cambiaría) son dos.
  test('visitantes son únicos por día', async () => {
    const ayer = estadisticas.sumarDias(hoy(), -1);
    await sembrar(businessA.businessId, [
      { tipo: 'visita', visitante: 'x'.repeat(16) },
      { tipo: 'visita', visitante: 'x'.repeat(16) },
      { tipo: 'visita', visitante: 'x'.repeat(16), dia: ayer }
    ]);

    const r = await getTestRepos().events.forBusiness(businessA.businessId).resumen(rango());
    expect(r.visitas).toBe(3);
    expect(r.visitantes).toBe(2);
  });

  test('un negocio sin eventos da ceros, no nulos', async () => {
    const r = await getTestRepos().events.forBusiness(businessA.businessId).resumen(rango());
    expect(r).toEqual({ visitas: 0, visitantes: 0, productos: 0, whatsapp: 0, instagram: 0, facebook: 0 });
  });

  test('fuera del rango no cuenta', async () => {
    await sembrar(businessA.businessId, [{ tipo: 'visita', dia: estadisticas.sumarDias(hoy(), -40) }]);
    const r = await getTestRepos().events.forBusiness(businessA.businessId).resumen(rango());
    expect(r.visitas).toBe(0);
  });

  // DATE_FORMAT y no la columna cruda: mysql2 la devolvería como `Date` a
  // medianoche local, la trampa que ya corrió las promos un día.
  test('porDia devuelve la fecha como texto, la misma que se guardó', async () => {
    await sembrar(businessA.businessId, visitas(2));
    const filas = await getTestRepos().events.forBusiness(businessA.businessId).porDia(rango());
    expect(filas).toEqual([{ dia: hoy(), visitas: 2, visitantes: 2 }]);
  });

  test('porHora agrupa por la hora guardada', async () => {
    await sembrar(businessA.businessId, [...visitas(2, { hora: 20 }), ...visitas(1, { hora: 8 })]);
    const filas = await getTestRepos().events.forBusiness(businessA.businessId).porHora(rango());
    expect(filas.sort((a, b) => a.hora - b.hora)).toEqual([{ hora: 8, visitas: 1 }, { hora: 20, visitas: 2 }]);
  });

  test('topProductos ignora un producto de otro negocio mandado al beacon', async () => {
    await sembrar(businessA.businessId, [
      { tipo: 'producto', productId: businessA.productId },
      { tipo: 'producto', productId: businessB.productId },
      { tipo: 'producto', productId: businessB.productId }
    ]);

    const top = await getTestRepos().events.forBusiness(businessA.businessId).topProductos(rango());
    expect(top).toEqual([{ id: businessA.productId, name: businessA.name + ' producto', vistas: 1 }]);
  });

  test('origenes agrupa las visitas por origen', async () => {
    await sembrar(businessA.businessId, [...visitas(2, { origen: 'qr' }), ...visitas(1, { origen: 'instagram' })]);
    const filas = await getTestRepos().events.forBusiness(businessA.businessId).origenes(rango());
    expect(filas.sort((a, b) => b.visitas - a.visitas)).toEqual([
      { origen: 'qr', visitas: 2 }, { origen: 'instagram', visitas: 1 }
    ]);
  });

  test('las lecturas no se pueden usar sin negocio', () => {
    const repo = getTestRepos().events;
    expect(repo.resumen).toBeUndefined();
    expect(() => repo.forBusiness(0)).toThrow();
  });

  // La vista del superadmin: todos los negocios, también los que no tienen
  // ninguna visita.
  test('platform.resumenPorNegocio incluye a los negocios sin visitas', async () => {
    await sembrar(businessA.businessId, visitas(4));
    const filas = await getTestRepos().events.platform.resumenPorNegocio(rango());

    const a = filas.find(f => f.id === businessA.businessId);
    const b = filas.find(f => f.id === businessB.businessId);
    expect(a.visitas).toBe(4);
    expect(b).toMatchObject({ slug: businessB.slug, visitas: 0, visitantes: 0, whatsapp: 0 });
  });
});

describe('tablero del dueño: /admin/estadisticas', () => {
  let businessA;
  let businessB;

  beforeEach(async () => {
    await resetDb();
    ({ businessA, businessB } = await createTwoBusinesses());
  });

  test('sin sesión no se ve', async () => {
    const res = await request(app).get('/admin/estadisticas');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/admin\/login/);
  });

  test('sin visitas muestra el estado vacío', async () => {
    const admin = await loginAdmin(app, { email: businessA.adminEmail, password: businessA.adminPassword });
    const res = await admin.get('/admin/estadisticas');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Todavía no hay visitas en este período');
  });

  test('muestra lo del propio negocio y nada del otro', async () => {
    await sembrar(businessA.businessId, [...visitas(3), { tipo: 'producto', productId: businessA.productId }]);
    await sembrar(businessB.businessId, [...visitas(5), { tipo: 'producto', productId: businessB.productId }]);
    // Un producto de B mandado al beacon de A.
    await sembrar(businessA.businessId, [{ tipo: 'producto', productId: businessB.productId }]);

    const admin = await loginAdmin(app, { email: businessA.adminEmail, password: businessA.adminPassword });
    const res = await admin.get('/admin/estadisticas');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Visitas al menú');
    expect(res.text).toContain(businessA.name + ' producto');
    expect(res.text).not.toContain(businessB.name + ' producto');
    expect(res.text).not.toContain('Todavía no hay visitas');
  });

  // No hay id en la URL que cambiar, pero un parámetro de más tampoco tiene
  // que abrir nada.
  test('un parámetro con el id de otro negocio no cambia nada', async () => {
    await sembrar(businessB.businessId, [{ tipo: 'producto', productId: businessB.productId }, ...visitas(1)]);
    const admin = await loginAdmin(app, { email: businessA.adminEmail, password: businessA.adminPassword });
    const res = await admin.get('/admin/estadisticas?businessId=' + businessB.businessId + '&id=' + businessB.businessId);
    expect(res.text).not.toContain(businessB.name + ' producto');
    expect(res.text).toContain('Todavía no hay visitas');
  });

  test('el rango elegido queda marcado, y uno inválido cae a 30 días', async () => {
    const admin = await loginAdmin(app, { email: businessA.adminEmail, password: businessA.adminPassword });

    const siete = await admin.get('/admin/estadisticas?dias=7');
    expect(siete.text).toMatch(/href="\/admin\/estadisticas\?dias=7" class="activo"/);

    const raro = await admin.get('/admin/estadisticas?dias=99999');
    expect(raro.status).toBe(200);
    expect(raro.text).toMatch(/href="\/admin\/estadisticas\?dias=30" class="activo"/);
  });

  // El nombre de un producto lo escribe el dueño: en el tablero tiene que
  // salir escapado, igual que en el menú.
  test('el nombre del producto sale escapado', async () => {
    const pool = getTestContainer().pool;
    await pool.query('UPDATE products SET name = ? WHERE id = ?', ['<img src=x onerror=alert(1)>', businessA.productId]);
    await sembrar(businessA.businessId, [...visitas(1), { tipo: 'producto', productId: businessA.productId }]);

    const admin = await loginAdmin(app, { email: businessA.adminEmail, password: businessA.adminPassword });
    const res = await admin.get('/admin/estadisticas');
    expect(res.text).not.toContain('<img src=x');
    expect(res.text).toContain('&lt;img src=x');
  });

  test('el dashboard muestra las visitas de los últimos 7 días y enlaza al tablero', async () => {
    await sembrar(businessA.businessId, [
      ...visitas(4),
      { tipo: 'visita', dia: estadisticas.sumarDias(hoy(), -10) }
    ]);
    const admin = await loginAdmin(app, { email: businessA.adminEmail, password: businessA.adminPassword });
    const res = await admin.get('/admin/dashboard');
    expect(res.text).toMatch(/<div class="stat-num">4<\/div>\s*<div class="stat-label">Visitas al menú, últimos 7 días/);
    expect(res.text).toContain('href="/admin/estadisticas"');
  });
});

describe('tablero del superadmin: /superadmin/estadisticas', () => {
  let businessA;
  let businessB;

  beforeEach(async () => {
    await resetDb();
    ({ businessA, businessB } = await createTwoBusinesses());
  });

  test('sin sesión de superadmin no se ve, ni el listado ni el de un negocio', async () => {
    for (const url of ['/superadmin/estadisticas', '/superadmin/estadisticas/' + businessA.businessId]) {
      const res = await request(app).get(url);
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/\/superadmin\/login/);
    }
  });

  // Una sesión de dueño NO es una de superadmin: son reinos separados.
  test('un dueño logueado no entra', async () => {
    const admin = await loginAdmin(app, { email: businessA.adminEmail, password: businessA.adminPassword });
    const res = await admin.get('/superadmin/estadisticas/' + businessB.businessId);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/superadmin\/login/);
  });

  test('el listado trae todos los negocios, ordenados por visitas, también los que no tienen', async () => {
    await sembrar(businessB.businessId, [...visitas(5), { tipo: 'whatsapp' }]);
    await sembrar(businessA.businessId, visitas(2));

    const superadmin = await loginSuperadmin(app);
    const res = await superadmin.get('/superadmin/estadisticas');
    expect(res.status).toBe(200);

    const posA = res.text.indexOf(businessA.name);
    const posB = res.text.indexOf(businessB.name);
    expect(posA).toBeGreaterThan(-1);
    expect(posB).toBeGreaterThan(-1);
    expect(posB).toBeLessThan(posA);
    expect(res.text).toContain('2 / 2');
  });

  test('el servicio de plataforma calcula totales y variación', async () => {
    const ayer40 = estadisticas.sumarDias(hoy(), -40);
    await sembrar(businessA.businessId, [...visitas(6), ...visitas(3, { dia: ayer40 }), { tipo: 'whatsapp' }]);

    const r = await getTestContainer().services.tablero.plataforma({ hoy: hoy() });
    const a = r.negocios.find(n => n.id === businessA.businessId);
    const b = r.negocios.find(n => n.id === businessB.businessId);

    expect(a).toMatchObject({ visitas7: 6, visitas30: 6, whatsapp30: 1, variacion: 100 });
    expect(a.tasaClic).toBeCloseTo(16.7);
    expect(b).toMatchObject({ visitas30: 0, variacion: null });
    expect(r.totales).toEqual({ visitas7: 6, visitas30: 6, whatsapp30: 1 });
    expect(r.activos).toBe(1);
    expect(r.negocios[0].id).toBe(businessA.businessId);
  });

  test('el tablero de un negocio es el mismo que ve su dueño', async () => {
    await sembrar(businessB.businessId, [...visitas(3), { tipo: 'producto', productId: businessB.productId }]);

    const superadmin = await loginSuperadmin(app);
    const res = await superadmin.get('/superadmin/estadisticas/' + businessB.businessId + '?dias=7');
    expect(res.status).toBe(200);
    expect(res.text).toContain(businessB.name + ' producto');
    expect(res.text).not.toContain(businessA.name + ' producto');
    expect(res.text).toMatch(new RegExp('href="/superadmin/estadisticas/' + businessB.businessId + '\\?dias=7" class="activo"'));
  });

  test('un id inexistente es 404', async () => {
    const superadmin = await loginSuperadmin(app);
    const res = await superadmin.get('/superadmin/estadisticas/999999');
    expect(res.status).toBe(404);
  });

  // MySQL compara `id = '5abc'` convirtiendo el texto a 5: sin la guarda, un
  // id mal escrito abriría el tablero de otro negocio.
  test('un id con basura no se convierte en otro negocio', async () => {
    const superadmin = await loginSuperadmin(app);
    const res = await superadmin.get('/superadmin/estadisticas/' + businessA.businessId + 'abc');
    expect(res.status).toBe(404);
  });

  test('el listado de negocios enlaza a las estadísticas', async () => {
    const superadmin = await loginSuperadmin(app);
    const res = await superadmin.get('/superadmin');
    expect(res.text).toContain('href="/superadmin/estadisticas"');
    expect(res.text).toContain('href="/superadmin/estadisticas/' + businessA.businessId + '"');
  });
});

const request = require('supertest');
const { createTestApp, getTestPool } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createBusiness } = require('../helpers/fixtures');
const { loginAdmin } = require('../helpers/sesion');

const app = createTestApp();

afterAll(async () => {
  await closeDb();
});

describe('promociones', () => {
  let business;
  let agent;

  beforeEach(async () => {
    await resetDb();
    business = await createBusiness({
      slug: 'test-promos',
      name: 'Test Promos',
      adminEmail: 'promos@test.local',
      adminPassword: 'password-promos-123'
    });
    agent = await loginAdmin(app, {
      email: business.adminEmail,
      password: business.adminPassword
    });
  });

  const productoBase = () => ({
    name: 'Con promo',
    description: 'x',
    price: '20000',
    category_id: String(business.categoryId)
  });

  async function leerProducto(id) {
    const [filas] = await getTestPool().query('SELECT * FROM products WHERE id = ?', [id]);
    return filas[0];
  }

  describe('validación', () => {
    test('rechaza un precio promocional mayor o igual al normal', async () => {
      for (const promo of ['25000', '20000']) {
        const res = await agent.post('/api/products').type('form')
          .send({ ...productoBase(), promo_price: promo });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/menor que el precio normal/i);
      }
    });

    test('acepta un precio promocional menor', async () => {
      const res = await agent.post('/api/products').type('form')
        .send({ ...productoBase(), promo_price: '15000' });

      expect(res.status).toBe(200);
      expect(Number((await leerProducto(res.body.id)).promo_price)).toBe(15000);
    });

    test('rechaza un precio promocional negativo', async () => {
      const res = await agent.post('/api/products').type('form')
        .send({ ...productoBase(), promo_price: '-1' });

      expect(res.status).toBe(400);
    });

    test('rechaza una fecha de fin anterior a la de inicio', async () => {
      const res = await agent.post('/api/products').type('form').send({
        ...productoBase(),
        promo_price: '15000',
        promo_from: '2026-09-20',
        promo_to: '2026-09-10'
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/anterior a la de inicio/i);
    });

    test('acepta desde y hasta el mismo día', async () => {
      const res = await agent.post('/api/products').type('form').send({
        ...productoBase(),
        promo_price: '15000',
        promo_from: '2026-09-15',
        promo_to: '2026-09-15'
      });

      expect(res.status).toBe(200);
    });

    test('rechaza una promo sin ningún día activo', async () => {
      // Sería una promo que nunca se muestra: el dueño la carga, no la ve, y
      // nada se lo explica.
      const res = await agent.post('/api/products').type('form')
        .send({ ...productoBase(), promo_price: '15000', promo_days: '0000000' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/al menos un día/i);
    });

    test('rechaza días con formato inválido', async () => {
      for (const dias of ['111', '11111112', 'abcdefg']) {
        const res = await agent.post('/api/products').type('form')
          .send({ ...productoBase(), promo_price: '15000', promo_days: dias });

        expect(res.status).toBe(400);
      }
    });

    test('rechaza una fecha con formato inválido', async () => {
      const res = await agent.post('/api/products').type('form')
        .send({ ...productoBase(), promo_price: '15000', promo_from: '15/09/2026' });

      expect(res.status).toBe(400);
    });
  });

  describe('guardado', () => {
    test('un producto sin promo guarda NULL, no 0', async () => {
      // `''` en una columna DECIMAL vale 0, o sea "gratis". Si esto se rompe,
      // TODOS los productos pasan a tener una promoción de cero pesos.
      const res = await agent.post('/api/products').type('form')
        .send({ ...productoBase(), promo_price: '' });

      expect(res.status).toBe(200);
      expect((await leerProducto(res.body.id)).promo_price).toBeNull();
    });

    test('sin promo también se limpian etiqueta, fechas y días', async () => {
      const res = await agent.post('/api/products').type('form').send({
        ...productoBase(),
        promo_price: '',
        promo_label: 'que no quede',
        promo_from: '2026-09-01',
        promo_to: '2026-09-30',
        promo_days: '0010000'
      });

      const p = await leerProducto(res.body.id);
      expect(p.promo_price).toBeNull();
      expect(p.promo_label).toBe('');
      expect(p.promo_from).toBeNull();
      expect(p.promo_to).toBeNull();
    });

    test('guarda los cinco campos juntos', async () => {
      const res = await agent.post('/api/products').type('form').send({
        ...productoBase(),
        promo_price: '12000',
        promo_label: '-40%',
        promo_from: '2026-09-01',
        promo_to: '2026-09-30',
        promo_days: '0010100'
      });

      const p = await leerProducto(res.body.id);
      expect(Number(p.promo_price)).toBe(12000);
      expect(p.promo_label).toBe('-40%');
      expect(p.promo_days).toBe('0010100');
      // La columna DATE vuelve como Date; se compara por componentes locales,
      // que es como la escribió mysql2.
      expect(p.promo_from.getDate()).toBe(1);
      expect(p.promo_from.getMonth() + 1).toBe(9);
      expect(p.promo_to.getDate()).toBe(30);
    });

    // El caso que hace falta que funcione y es fácil de romper: si al editar se
    // ignorara un `promo_price` vacío en vez de escribir NULL, no habría forma
    // de quitar una promoción desde el panel.
    test('se puede QUITAR una promo editando el producto', async () => {
      const creado = await agent.post('/api/products').type('form')
        .send({ ...productoBase(), promo_price: '15000', promo_label: '2x1' });

      expect(Number((await leerProducto(creado.body.id)).promo_price)).toBe(15000);

      const editado = await agent.put('/api/products/' + creado.body.id).type('form')
        .send({ ...productoBase(), promo_price: '' });

      expect(editado.status).toBe(200);
      const p = await leerProducto(creado.body.id);
      expect(p.promo_price).toBeNull();
      expect(p.promo_label).toBe('');
    });

    test('editar sin tocar la promo la conserva', async () => {
      const creado = await agent.post('/api/products').type('form')
        .send({ ...productoBase(), promo_price: '15000', promo_days: '0010000' });

      await agent.put('/api/products/' + creado.body.id).type('form')
        .send({ ...productoBase(), name: 'Nombre nuevo', promo_price: '15000', promo_days: '0010000' });

      const p = await leerProducto(creado.body.id);
      expect(p.name).toBe('Nombre nuevo');
      expect(Number(p.promo_price)).toBe(15000);
      expect(p.promo_days).toBe('0010000');
    });

    test('sin días se guardan todos', async () => {
      const res = await agent.post('/api/products').type('form')
        .send({ ...productoBase(), promo_price: '15000' });

      expect((await leerProducto(res.body.id)).promo_days).toBe('1111111');
    });
  });

  describe('el interruptor de la sección', () => {
    test('un negocio nuevo la tiene apagada', async () => {
      const [filas] = await getTestPool().query(
        'SELECT promos_enabled FROM businesses WHERE id = ?', [business.businessId]
      );
      expect(filas[0].promos_enabled).toBe(0);
    });

    test('se enciende y se apaga desde Configuración', async () => {
      await agent.post('/api/settings').type('form')
        .send({ name: business.name, promos_enabled: 'on' });

      let [filas] = await getTestPool().query(
        'SELECT promos_enabled FROM businesses WHERE id = ?', [business.businessId]
      );
      expect(filas[0].promos_enabled).toBe(1);

      // Un checkbox desmarcado no viaja: su ausencia ES el apagado.
      await agent.post('/api/settings').type('form').send({ name: business.name });

      [filas] = await getTestPool().query(
        'SELECT promos_enabled FROM businesses WHERE id = ?', [business.businessId]
      );
      expect(filas[0].promos_enabled).toBe(0);
    });
  });

  // Este test no es sobre promociones: es sobre el error que cometí al
  // agregarlas. Cada campo nuevo de `businesses` hay que tocarlo en TRES
  // lugares —el esquema de validators/, la lista blanca TENANT_FIELDS del repo,
  // y el destructurado del handler— y si falta uno el guardado responde 200 sin
  // guardar ese campo. Ya pasó con `menu_scale` y volvió a pasar con
  // `promos_enabled` una fase después, con el comentario de advertencia escrito
  // al lado.
  //
  // La forma de que no dependa de acordarse: mandar TODOS los campos de una y
  // verificar que cada uno llegó. Un campo nuevo que se olvide en cualquiera de
  // los tres lugares hace fallar esto en cuanto se agregue acá.
  test('cada campo de Configuración se guarda de verdad', async () => {
    const enviado = {
      name: 'Nombre Nuevo',
      address: 'Calle 1 # 2-3',
      phone: '6041234567',
      whatsapp: '3001234567',
      instagram: 'micuenta',
      facebook: 'mipagina',
      tiktok: 'mitiktok',
      is_open: 'on',
      menu_theme: 'navy',
      menu_scale: 'grande',
      promos_enabled: 'on'
    };

    const res = await agent.post('/api/settings').type('form').send(enviado);
    expect(res.status).toBe(200);

    const [filas] = await getTestPool().query(
      'SELECT * FROM businesses WHERE id = ?', [business.businessId]
    );
    const guardado = filas[0];

    const esperado = {
      ...enviado,
      is_open: 1,
      promos_enabled: 1
    };

    for (const [campo, valor] of Object.entries(esperado)) {
      expect({ campo, valor: guardado[campo] }).toEqual({ campo, valor });
    }
  });

  describe('el panel muestra el estado', () => {
    // Sin esto el dueño carga una promo, no la ve en el menú y no tiene forma de
    // saber por qué. Las fechas se eligen relativas a hoy para que el estado sea
    // el mismo el día que se corra el test.
    const diasDesdeHoy = (n) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };

    test('una promo vigente se ve como activa', async () => {
      await agent.post('/api/products').type('form').send({
        ...productoBase(), name: 'Vigente', promo_price: '15000',
        promo_from: diasDesdeHoy(-1), promo_to: diasDesdeHoy(1)
      });

      const res = await agent.get('/admin/products');
      expect(res.text).toContain('Promo activa');
    });

    test('una promo futura se ve como programada', async () => {
      await agent.post('/api/products').type('form').send({
        ...productoBase(), name: 'Futura', promo_price: '15000',
        promo_from: diasDesdeHoy(10)
      });

      const res = await agent.get('/admin/products');
      expect(res.text).toContain('Promo programada');
    });

    test('una promo pasada se ve como vencida', async () => {
      await agent.post('/api/products').type('form').send({
        ...productoBase(), name: 'Pasada', promo_price: '15000',
        promo_to: diasDesdeHoy(-10)
      });

      const res = await agent.get('/admin/products');
      expect(res.text).toContain('Promo vencida');
    });

    test('el precio normal se muestra tachado junto al promocional', async () => {
      await agent.post('/api/products').type('form')
        .send({ ...productoBase(), promo_price: '15000' });

      const res = await agent.get('/admin/products');
      expect(res.text).toMatch(/line-through[^>]*>\$ 20\.000/);
      expect(res.text).toContain('$ 15.000');
    });

    test('un producto sin promo no muestra ninguna etiqueta', async () => {
      await agent.post('/api/products').type('form').send(productoBase());

      const res = await agent.get('/admin/products');
      expect(res.text).not.toContain('Promo activa');
      expect(res.text).not.toContain('Promo vencida');
    });
  });

  test('el menú público NO cambia todavía', async () => {
    // Esta fase es sólo backend y panel: la sección del menú es la siguiente. Si
    // algo de acá se filtrara al menú, se rompería el corte entre las dos fases.
    await agent.post('/api/products').type('form')
      .send({ ...productoBase(), promo_price: '15000', promo_label: 'ROMPER' });

    await getTestPool().query(
      'UPDATE businesses SET promos_enabled = 1 WHERE id = ?', [business.businessId]
    );

    const res = await request(app).get('/s/test-promos');

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('ROMPER');
    expect(res.text).not.toContain('Promociones');
  });
});

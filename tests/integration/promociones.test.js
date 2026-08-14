const request = require('supertest');
const { createTestApp, getTestPool } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createBusiness } = require('../helpers/fixtures');
const { loginAdmin } = require('../helpers/sesion');
const { NOMBRE_SECCION_PROMOS } = require('../../services/menuService');

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

    test('sin precio Y sin etiqueta se limpian fechas y días', async () => {
      // Sin ninguna de las dos no hay promoción, y una ventana de fechas suelta es
      // basura que después nadie interpreta.
      const res = await agent.post('/api/products').type('form').send({
        ...productoBase(),
        promo_price: '',
        promo_label: '',
        promo_from: '2026-09-01',
        promo_to: '2026-09-30',
        promo_days: '0010000'
      });

      const p = await leerProducto(res.body.id);
      expect(p.promo_price).toBeNull();
      expect(p.promo_label).toBe('');
      expect(p.promo_from).toBeNull();
      expect(p.promo_to).toBeNull();
      expect(p.promo_days).toBe('1111111');
    });

    // Un 2x1 no baja el precio unitario: cambia lo que te dan. Exigir precio
    // promocional hacía imposible cargar la promoción más común de un restaurante.
    test('una promo de SÓLO etiqueta se guarda y conserva su vigencia', async () => {
      const res = await agent.post('/api/products').type('form').send({
        ...productoBase(),
        promo_price: '',
        promo_label: '2x1',
        promo_from: '2026-09-01',
        promo_to: '2026-09-30',
        promo_days: '0010000'
      });

      expect(res.status).toBe(200);
      const p = await leerProducto(res.body.id);
      expect(p.promo_price).toBeNull();
      expect(p.promo_label).toBe('2x1');
      expect(p.promo_days).toBe('0010000');
      expect(p.promo_from.getDate()).toBe(1);
    });

    test('la etiqueta sola también se puede quitar', async () => {
      const creado = await agent.post('/api/products').type('form')
        .send({ ...productoBase(), promo_price: '', promo_label: '2x1' });

      await agent.put('/api/products/' + creado.body.id).type('form')
        .send({ ...productoBase(), promo_price: '', promo_label: '' });

      const p = await leerProducto(creado.body.id);
      expect(p.promo_label).toBe('');
      expect(p.promo_price).toBeNull();
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

});

// === Fase 5: la sección en el menú público ===
describe('la sección de promociones en el menú', () => {
  let business;
  let agent;

  const hoyTexto = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  beforeEach(async () => {
    await resetDb();
    business = await createBusiness({
      slug: 'test-seccion',
      name: 'Test Sección',
      adminEmail: 'seccion@test.local',
      adminPassword: 'password-seccion-123'
    });
    agent = await loginAdmin(app, {
      email: business.adminEmail,
      password: business.adminPassword
    });
  });

  async function crearConPromo(extra = {}) {
    const res = await agent.post('/api/products').type('form').send({
      name: 'Producto en promo',
      description: 'x',
      price: '20000',
      category_id: String(business.categoryId),
      promo_price: '15000',
      ...extra
    });
    expect(res.status).toBe(200);
    return res.body.id;
  }

  const encender = () => getTestPool().query(
    'UPDATE businesses SET promos_enabled = 1 WHERE id = ?', [business.businessId]
  );

  function datosDelMenu(texto) {
    return JSON.parse(texto.match(/const menuData = (.+);/)[1]);
  }

  test('encendida y con promo vigente, la sección va primera', async () => {
    await crearConPromo();
    await encender();

    const res = await request(app).get('/s/test-seccion');
    const data = datosDelMenu(res.text);

    expect(data.promos).not.toBeNull();
    expect(data.promos.name).toBe(NOMBRE_SECCION_PROMOS);
    expect(data.promos.products).toHaveLength(1);
  });

  test('el producto en promo también sigue en su categoría', async () => {
    await crearConPromo();
    await encender();

    const data = datosDelMenu((await request(app).get('/s/test-seccion')).text);
    const idsEnCategorias = data.categorias.flatMap(c => c.products.map(p => p.id));

    expect(idsEnCategorias).toContain(data.promos.products[0].id);
  });

  test('apagada, el menú queda exactamente como sin promociones', async () => {
    await crearConPromo({ promo_label: 'NO SALE' });
    // sin encender

    const res = await request(app).get('/s/test-seccion');
    const data = datosDelMenu(res.text);

    expect(data.promos).toBeNull();
    expect(res.text).not.toContain('NO SALE');
    // Y la tarjeta tampoco anuncia la promo: el interruptor apaga la promoción
    // entera, no sólo la sección.
    expect(data.categorias[0].products.every(p => p.promo === null)).toBe(true);
  });

  test('encendida y sin promos vigentes no aparece una sección vacía', async () => {
    await agent.post('/api/products').type('form').send({
      name: 'Sin promo', description: '', price: '20000',
      category_id: String(business.categoryId)
    });
    await encender();

    const data = datosDelMenu((await request(app).get('/s/test-seccion')).text);
    expect(data.promos).toBeNull();
  });

  test('una promo vencida no llega al menú', async () => {
    await crearConPromo({ promo_to: '2020-01-01' });
    await encender();

    const data = datosDelMenu((await request(app).get('/s/test-seccion')).text);
    expect(data.promos).toBeNull();
  });

  test('una promo que empieza hoy sí llega', async () => {
    // El borde inclusivo, contra la base de verdad y no sólo en el unit test.
    await crearConPromo({ promo_from: hoyTexto(), promo_to: hoyTexto() });
    await encender();

    const data = datosDelMenu((await request(app).get('/s/test-seccion')).text);
    expect(data.promos).not.toBeNull();
  });

  test('el precio normal viaja junto al promocional, para tacharlo', async () => {
    await crearConPromo({ promo_label: '-25%' });
    await encender();

    const data = datosDelMenu((await request(app).get('/s/test-seccion')).text);
    const p = data.promos.products[0];

    expect(Number(p.price)).toBe(20000);
    expect(Number(p.promo.price)).toBe(15000);
    expect(p.promo.label).toBe('-25%');
  });

  test('una promo de sólo etiqueta llega al menú sin tachado', async () => {
    // El 2x1 en el menú: entra en la sección, muestra el badge, y el precio queda
    // como está — no hay nada que tachar.
    await agent.post('/api/products').type('form').send({
      name: 'Alitas', description: '', price: '30000',
      category_id: String(business.categoryId),
      promo_price: '', promo_label: '2x1'
    });
    await encender();

    const data = datosDelMenu((await request(app).get('/s/test-seccion')).text);
    const p = data.promos.products.find(x => x.name === 'Alitas');

    expect(p).toBeDefined();
    expect(p.promo).toEqual({ price: null, label: '2x1' });
    expect(Number(p.price)).toBe(30000);
  });

  test('los skins no tachan nada cuando la promo no tiene precio', async () => {
    const res = await request(app).get('/s/test-seccion');

    // La guarda está en los dos skins y en el modal del armazón.
    expect(res.text).toContain('p.promo.price !== null');
  });

  test('una etiqueta con HTML no puede inyectar', async () => {
    // La etiqueta la escribe el dueño del negocio y se muestra a cualquiera que
    // abra el menú, igual que el nombre.
    await crearConPromo({ promo_label: '</script><img src=x>' });
    await encender();

    const res = await request(app).get('/s/test-seccion');

    expect(res.text).not.toContain('</script><img');
    expect(res.text).toContain('\\u003c/script\\u003e');
  });
});

// === Fase 6: el flyer y el nombre de la sección ===
describe('flyer de promociones', () => {
  let business;
  let agent;

  // Un PNG de 1x1 real: tiene que pasar el fileFilter por mimetype Y la
  // verificación de magic bytes del archivo ya escrito, que es la capa que un
  // buffer inventado no pasaría.
  const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64'
  );

  beforeEach(async () => {
    await resetDb();
    business = await createBusiness({
      slug: 'test-flyer',
      name: 'Test Flyer',
      adminEmail: 'flyer@test.local',
      adminPassword: 'password-flyer-123'
    });
    agent = await loginAdmin(app, {
      email: business.adminEmail,
      password: business.adminPassword
    });
  });

  const leerNegocio = async () => {
    const [filas] = await getTestPool().query(
      'SELECT * FROM businesses WHERE id = ?', [business.businessId]
    );
    return filas[0];
  };

  const subirFlyer = () => agent.post('/api/settings')
    .field('name', business.name)
    .field('promos_enabled', 'on')
    .attach('flyer', PNG_1x1, 'flyer.png');

  test('un negocio nuevo no tiene flyer', async () => {
    expect((await leerNegocio()).promo_flyer).toBe('');
  });

  test('se sube y queda guardado bajo uploads del negocio', async () => {
    const res = await subirFlyer();

    expect(res.status).toBe(200);
    expect((await leerNegocio()).promo_flyer)
      .toMatch(new RegExp('^/uploads/' + business.businessId + '/'));
  });

  test('aparece en el menú cuando las promociones están encendidas', async () => {
    await subirFlyer();

    const res = await request(app).get('/s/test-flyer');
    const flyer = (await leerNegocio()).promo_flyer;

    expect(res.text).toContain('id="flyerPopup"');
    expect(res.text).toContain('class="promo-flyer"');
    expect(res.text).toContain(flyer);
  });

  // El aviso tiene que ser lo PRIMERO que se abre, así que su script va antes del
  // que arma el menú. Desde el script grande aparecería recién después de dibujar
  // hasta 114 tarjetas.
  test('su script va antes del que arma el menú', async () => {
    await subirFlyer();

    const res = await request(app).get('/s/test-flyer');

    expect(res.text.indexOf('flyerPopup')).toBeLessThan(res.text.indexOf('const menuData ='));
  });

  test('nace oculto: lo abre el script, no el CSS', async () => {
    // Si apareciera con la página y el script decidiera después, quien ya lo cerró
    // en esta visita vería un parpadeo del aviso en cada carga.
    await subirFlyer();

    const res = await request(app).get('/s/test-flyer');

    expect(res.text).toMatch(/\.flyer-popup \{[^}]*display: none/);
    expect(res.text).toMatch(/\.flyer-popup\.open \{[^}]*display: flex/);
    expect(res.text).not.toMatch(/id="flyerPopup"[^>]*class="[^"]*open/);
  });

  test('se puede cerrar por la X, por el fondo y por Escape', async () => {
    await subirFlyer();

    const res = await request(app).get('/s/test-flyer');

    // Dos elementos marcados para cerrar —la X y el fondo— más el manejo de la
    // tecla. Un aviso del que no se sale fácil es peor que no tenerlo.
    expect((res.text.match(/data-cerrar-flyer/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(res.text).toContain("e.key === 'Escape'");
  });

  // Se probó primero con `sessionStorage` para no repetirlo al recargar, y se
  // sacó: quien cerraba el aviso y refrescaba creía que algo se había roto, y el
  // negocio que armó la lámina quiere que se vea. Un menú se abre y se cierra, no
  // se navega, así que "cada carga" es casi siempre "una vez" igual.
  test('se muestra en cada carga, sin recordar que ya se vio', async () => {
    await subirFlyer();

    const res = await request(app).get('/s/test-flyer');

    expect(res.text).toContain("popup.classList.add('open')");
    // Ni rastro del recuerdo: si vuelve, este test avisa.
    expect(res.text).not.toMatch(/sessionStorage\.(get|set)Item/);
  });

  test('ya NO se muestra como banner suelto arriba del menú', async () => {
    // Si quedaran los dos, el negocio tendría la misma imagen dos veces en la
    // misma pantalla.
    await subirFlyer();

    const res = await request(app).get('/s/test-flyer');
    const antesDeLaNav = res.text.slice(0, res.text.indexOf('<nav class="cat-nav"'));

    expect(antesDeLaNav).not.toContain('promo-flyer"');
  });

  // Es una promoción, así que la apaga el mismo interruptor que la sección.
  test('con las promociones apagadas no aparece, aunque esté cargado', async () => {
    await subirFlyer();
    await getTestPool().query(
      'UPDATE businesses SET promos_enabled = 0 WHERE id = ?', [business.businessId]
    );

    const res = await request(app).get('/s/test-flyer');

    expect(res.text).not.toContain('id="flyerPopup"');
    expect(res.text).not.toContain('class="promo-flyer"');
    // Y no se borró: vuelve al encenderlo.
    expect((await leerNegocio()).promo_flyer).not.toBe('');
  });

  test('sin flyer el menú no trae la etiqueta', async () => {
    await agent.post('/api/settings').type('form')
      .send({ name: business.name, promos_enabled: 'on' });

    const res = await request(app).get('/s/test-flyer');
    expect(res.text).not.toContain('id="flyerPopup"');
  });

  // Lo que banner y logo NO pueden hacer, y para un flyer es indispensable: la
  // promoción termina y la lámina tiene que bajar.
  test('se puede quitar', async () => {
    await subirFlyer();
    expect((await leerNegocio()).promo_flyer).not.toBe('');

    const res = await agent.post('/api/settings').type('form')
      .send({ name: business.name, promos_enabled: 'on', quitar_flyer: 'on' });

    expect(res.status).toBe(200);
    expect((await leerNegocio()).promo_flyer).toBe('');
  });

  test('guardar sin tocar el flyer no lo borra', async () => {
    await subirFlyer();
    const antes = (await leerNegocio()).promo_flyer;

    await agent.post('/api/settings').type('form')
      .send({ name: business.name, promos_enabled: 'on' });

    expect((await leerNegocio()).promo_flyer).toBe(antes);
  });

  test('subir uno nuevo gana sobre la casilla de quitar', async () => {
    // Si alguien marca "quitar" y además elige un archivo, lo que quiere es el
    // archivo.
    await subirFlyer();
    const primero = (await leerNegocio()).promo_flyer;

    await agent.post('/api/settings')
      .field('name', business.name)
      .field('promos_enabled', 'on')
      .field('quitar_flyer', 'on')
      .attach('flyer', PNG_1x1, 'otro.png');

    const despues = (await leerNegocio()).promo_flyer;
    expect(despues).not.toBe('');
    expect(despues).not.toBe(primero);
  });

  test('un archivo que no es imagen se rechaza', async () => {
    // Hereda las tres capas de services/imageUpload.js. Un .png con contenido de
    // texto pasa el mimetype declarado pero no los magic bytes.
    const res = await agent.post('/api/settings')
      .field('name', business.name)
      .attach('flyer', Buffer.from('no soy una imagen'), 'trampa.png');

    expect(res.status).toBe(400);
    expect((await leerNegocio()).promo_flyer).toBe('');
  });
});

describe('el nombre de la sección de promociones', () => {
  let business;
  let agent;

  beforeEach(async () => {
    await resetDb();
    business = await createBusiness({
      slug: 'test-nombre',
      name: 'Test Nombre',
      adminEmail: 'nombre@test.local',
      adminPassword: 'password-nombre-123'
    });
    agent = await loginAdmin(app, {
      email: business.adminEmail,
      password: business.adminPassword
    });
  });

  // Las categorías de los negocios suelen estar en mayúsculas porque el dueño las
  // escribió así; al lado, "Promociones" se veía en minúsculas.
  test('es PROMOCIONES, en mayúsculas', async () => {
    await agent.post('/api/products').type('form').send({
      name: 'Con promo', description: '', price: '20000',
      category_id: String(business.categoryId), promo_price: '15000'
    });
    await getTestPool().query(
      'UPDATE businesses SET promos_enabled = 1 WHERE id = ?', [business.businessId]
    );

    const res = await request(app).get('/s/test-nombre');
    const data = JSON.parse(res.text.match(/const menuData = (.+);/)[1]);

    expect(data.promos.name).toBe('PROMOCIONES');
  });

  // No se resolvió con `text-transform: uppercase` a propósito: las categorías
  // están en mayúsculas por el dato, no por CSS, y transformarlas cambiaría cómo
  // se ven las de los negocios que las escribieron en mixto.
  test('el CSS no transforma los títulos de categoría', async () => {
    const res = await request(app).get('/s/test-nombre');
    const css = res.text.match(/\.category-title \{[^}]*\}/)[0];

    expect(css).not.toContain('text-transform');
  });
});

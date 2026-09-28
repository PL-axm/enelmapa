const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createTestApp, getTestPool, getTestContainer } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createBusiness } = require('../helpers/fixtures');
const { loginAdmin } = require('../helpers/sesion');

const app = createTestApp();

// Un producto mostraba UNA sola foto. Ahora tiene galería, pero `products.image`
// se queda como la foto principal: es la que leen las tarjetas del menú y los
// dos skins.
//
// El invariante que atan casi todos estos tests: la foto principal del producto
// es SIEMPRE la primera de su galería. Si se desincronizan, la tarjeta del menú
// muestra una foto y al abrirla aparece otra — o peor, una rota.

const MAXIMO = 5;

async function fotoDePrueba() {
  const ruta = path.join(os.tmpdir(), 'foto-' + Math.random().toString(36).slice(2) + '.jpg');
  await sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 120, g: 90, b: 60 } } })
    .jpeg().toFile(ruta);
  return ruta;
}

describe('fotos de producto', () => {
  let business, agent, productoId;

  beforeEach(async () => {
    await resetDb();
    business = await createBusiness({
      slug: 'test-fotos',
      name: 'Test Fotos',
      adminEmail: 'admin-fotos@test.local',
      adminPassword: 'password-fotos-123'
    });
    productoId = business.productId;
    agent = await loginAdmin(app, { email: business.adminEmail, password: business.adminPassword });
  });

  afterAll(async () => {
    await closeDb();
  });

  async function subirFoto(idProducto = productoId) {
    const ruta = await fotoDePrueba();
    const res = await agent.post('/api/products/' + idProducto + '/images').attach('image', ruta);
    fs.unlinkSync(ruta);
    return res;
  }

  const galeria = () => agent.get('/api/products/' + productoId + '/images');

  const principalEnBase = async () => {
    const [filas] = await getTestPool().query('SELECT image FROM products WHERE id = ?', [productoId]);
    return filas[0].image;
  };

  test('se pueden subir varias fotos al mismo producto', async () => {
    await subirFoto();
    await subirFoto();

    const res = await galeria();
    expect(res.status).toBe(200);
    expect(res.body.fotos).toHaveLength(2);
    expect(res.body.maximo).toBe(MAXIMO);
  });

  test('la primera foto queda como principal del producto', async () => {
    const res = await subirFoto();
    expect(res.status).toBe(200);
    expect(await principalEnBase()).toBe(res.body.image);
  });

  test('la segunda foto NO desplaza a la principal', async () => {
    const primera = await subirFoto();
    await subirFoto();
    expect(await principalEnBase()).toBe(primera.body.image);
  });

  test('no se pueden pasar de ' + MAXIMO + ' fotos', async () => {
    for (let i = 0; i < MAXIMO; i++) {
      expect((await subirFoto()).status).toBe(200);
    }
    const sexta = await subirFoto();
    expect(sexta.status).toBe(400);
    expect(sexta.body.error).toMatch(/hasta 5 fotos/);

    expect((await galeria()).body.fotos).toHaveLength(MAXIMO);
  });

  test('al elegir otra como principal, la tarjeta del menú la sigue', async () => {
    await subirFoto();
    const segunda = await subirFoto();

    const res = await agent.put('/api/products/' + productoId + '/images/' + segunda.body.id + '/principal');
    expect(res.status).toBe(200);

    expect(await principalEnBase()).toBe(segunda.body.image);
    // Y encabeza la galería: tarjeta y galería tienen que empezar por la misma.
    expect((await galeria()).body.fotos[0].id).toBe(segunda.body.id);
  });

  describe('al borrar', () => {
    test('si se borra la principal, asciende la siguiente', async () => {
      const primera = await subirFoto();
      const segunda = await subirFoto();

      const res = await agent.delete('/api/products/' + productoId + '/images/' + primera.body.id);
      expect(res.status).toBe(200);

      // Sin esto, products.image apuntaría a un archivo borrado: foto rota en
      // el menú público.
      expect(await principalEnBase()).toBe(segunda.body.image);
    });

    test('al borrar la última, el producto queda sin foto principal', async () => {
      const unica = await subirFoto();
      await agent.delete('/api/products/' + productoId + '/images/' + unica.body.id);
      expect(await principalEnBase()).toBe('');
    });

    test('el archivo se borra del disco', async () => {
      const foto = await subirFoto();
      const enDisco = path.join(__dirname, '..', '..', foto.body.image.replace(/^\//, ''));
      expect(fs.existsSync(enDisco)).toBe(true);

      await agent.delete('/api/products/' + productoId + '/images/' + foto.body.id);
      expect(fs.existsSync(enDisco)).toBe(false);
    });

    test('una foto que no existe da 404', async () => {
      expect((await agent.delete('/api/products/' + productoId + '/images/999999')).status).toBe(404);
    });
  });

  describe('aislamiento entre negocios', () => {
    // 404 y no 403 a propósito: un 403 confirmaría que el producto existe y
    // convertiría el endpoint en un enumerador de ids.
    let ajeno;

    beforeEach(async () => {
      ajeno = await createBusiness({
        slug: 'test-fotos-otro',
        name: 'Test Fotos Otro',
        adminEmail: 'admin-fotos-otro@test.local',
        adminPassword: 'password-otro-123'
      });
    });

    test('no se le pueden agregar fotos al producto de otro negocio', async () => {
      const res = await subirFoto(ajeno.productId);
      expect(res.status).toBe(404);

      const [filas] = await getTestPool().query(
        'SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?', [ajeno.productId]
      );
      expect(filas[0].n).toBe(0);
    });

    test('no se ven las fotos de otro negocio', async () => {
      const otroAgent = await loginAdmin(app, { email: ajeno.adminEmail, password: ajeno.adminPassword });
      const ruta = await fotoDePrueba();
      await otroAgent.post('/api/products/' + ajeno.productId + '/images').attach('image', ruta);
      fs.unlinkSync(ruta);

      const res = await agent.get('/api/products/' + ajeno.productId + '/images');
      expect(res.body.fotos).toEqual([]);
    });
  });

  test('la migración trajo la foto que el producto ya tenía', async () => {
    // Los productos existentes no empiezan con la galería vacía: su foto de
    // siempre es la primera. Se simula un producto anterior a esta tabla.
    await getTestPool().query(
      'INSERT INTO products (business_id, category_id, name, price, image, sort_order) VALUES (?, ?, ?, ?, ?, 9)',
      [business.businessId, business.categoryId, 'Producto viejo', 12000, '/uploads/1/vieja.jpg']
    );
    const [[creado]] = await getTestPool().query(
      'SELECT id FROM products WHERE business_id = ? AND name = ?', [business.businessId, 'Producto viejo']
    );

    const { repos } = getTestContainer();
    await repos.productImages.forBusiness(business.businessId).create(creado.id, '/uploads/1/vieja.jpg');

    const fotos = await repos.productImages.forBusiness(business.businessId).list(creado.id);
    expect(fotos.map(f => f.image)).toEqual(['/uploads/1/vieja.jpg']);
  });
});

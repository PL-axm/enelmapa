const { createTestApp, getTestPool } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createBusiness } = require('../helpers/fixtures');
const { loginAdmin } = require('../helpers/sesion');

const app = createTestApp();

// A nivel de archivo: dentro de un describe se ejecutaría al terminar ESE bloque
// y dejaría sin base a los siguientes.
afterAll(async () => {
  await closeDb();
});

// El botón "Guardar cambios" de Configuración dejó de funcionar sin dar ningún
// error: no pasaba nada al presionarlo.
//
// La causa: el modal de ubicaciones quedó DENTRO del formulario, y su campo de
// dirección tenía `required`. Al enviar, el navegador validaba ese campo,
// estaba vacío y oculto, no podía enfocarlo para señalarlo, y CANCELABA el
// envío. El evento 'submit' nunca se disparaba, así que el código de la página
// jamás llegaba a correr. En consola sólo se veía:
//   "An invalid form control with name='' is not focusable."
//
// Un control obligatorio y oculto dentro de un formulario lo rompe entero, en
// silencio. De ahí estos dos tests.

describe('formulario de Configuración', () => {
  let agent;

  beforeEach(async () => {
    await resetDb();
    const business = await createBusiness({
      slug: 'test-settings-form',
      name: 'Test Settings Form',
      adminEmail: 'admin-settings-form@test.local',
      adminPassword: 'password-settings-123'
    });
    agent = await loginAdmin(app, { email: business.adminEmail, password: business.adminPassword });
  });


  async function html() {
    const res = await agent.get('/admin/settings');
    expect(res.status).toBe(200);
    return res.text;
  }

  function dentroDelFormulario(texto) {
    const inicio = texto.indexOf('<form id="settingsForm"');
    const fin = texto.indexOf('</form>', inicio);
    expect(inicio).toBeGreaterThan(-1);
    expect(fin).toBeGreaterThan(inicio);
    return texto.slice(inicio, fin);
  }

  test('el modal de ubicaciones está fuera del formulario', async () => {
    const texto = await html();
    expect(dentroDelFormulario(texto)).not.toContain('id="locationModal"');
    expect(dentroDelFormulario(texto)).not.toContain('id="locationAddress"');
  });

  test('ningún control obligatorio del formulario está oculto', async () => {
    // Recorre los bloques ocultos del formulario y verifica que ninguno exija
    // un valor. Cualquiera de ellos bastaría para bloquear el guardado entero,
    // sin mensaje para el usuario.
    const formulario = dentroDelFormulario(await html());
    const ocultos = formulario.split('display:none').slice(1);

    ocultos.forEach((bloque, i) => {
      const alcance = bloque.slice(0, 1500);
      expect({ bloque: i, tieneRequired: alcance.includes('required') })
        .toEqual({ bloque: i, tieneRequired: false });
    });
  });
});

// El panel se veía apretado en el celular porque las rejillas estaban escritas
// en el atributo `style` de cada div, y un estilo inline le gana a cualquier
// regla de @media. Estos tests fijan que el maquetado viva en clases.
describe('Configuración en pantallas chicas', () => {
  let agent;

  beforeEach(async () => {
    await resetDb();
    const business = await createBusiness({
      slug: 'test-settings-movil',
      name: 'Test Settings Movil',
      adminEmail: 'admin-settings-movil@test.local',
      adminPassword: 'password-movil-123'
    });
    agent = await loginAdmin(app, { email: business.adminEmail, password: business.adminPassword });

    // La fixture no crea horarios y las filas se dibujan por cada día: sin
    // esto, el maquetado que se quiere verificar no llega a renderizarse.
    const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    for (let i = 0; i < dias.length; i++) {
      await getTestPool().query(
        'INSERT INTO business_hours (business_id, day_index, day_name, open_time, close_time, is_closed) VALUES (?, ?, ?, ?, ?, 0)',
        [business.businessId, i, dias[i], '08:00', '20:00']
      );
    }
  });

  test('el maquetado usa clases, no rejillas fijas escritas en el HTML', async () => {
    const res = await agent.get('/admin/settings');
    expect(res.status).toBe(200);

    expect(res.text).toContain('class="campos-2"');
    expect(res.text).toContain('class="horarios-fila"');
    expect(res.text).toContain('class="acciones-guardar"');

    // Ninguna rejilla de ancho fijo dentro de un atributo style: son las que no
    // se pueden reacomodar en un celular.
    const inline = res.text.match(/style="[^"]*grid-template-columns:[^"]*"/g) || [];
    expect(inline).toEqual([]);
  });
});

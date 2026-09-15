const { createTestApp } = require('../helpers/container');
const { resetDb, closeDb } = require('../helpers/db');
const { createBusiness } = require('../helpers/fixtures');
const { loginAdmin } = require('../helpers/sesion');

const app = createTestApp();

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

  afterAll(async () => {
    await closeDb();
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

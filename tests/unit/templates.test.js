const tema = require('../../theme');
const { TEMPLATES } = require('../../theme/templates');

describe('registro de skins', () => {
  test('el skin por defecto existe', () => {
    expect(tema.esTemplateValido(tema.TEMPLATE_POR_DEFECTO)).toBe(true);
  });

  test('cada skin declara nombre y partial', () => {
    for (const [id, t] of Object.entries(TEMPLATES)) {
      expect(typeof t.nombre).toBe('string');
      expect(t.nombre.length).toBeGreaterThan(0);
      expect(typeof t.partial).toBe('string');
    }
  });

  test('el archivo de cada skin existe en views/menu/', () => {
    // Un `partial` mal escrito rompería el menú público —la página entera— y no
    // hay forma de que un test de otra cosa lo note.
    const fs = require('fs');
    const path = require('path');

    for (const [id, t] of Object.entries(TEMPLATES)) {
      const archivo = path.join(__dirname, '../../views/menu', t.partial + '.ejs');
      expect(fs.existsSync(archivo)).toBe(true);
    }
  });

  // El armazón hace `include('menu/' + plantilla)`, así que lo que se le pasa
  // define qué archivo se lee. Si eso saliera de `business.menu_template`
  // directo, un valor escrito a mano en la columna sería un include arbitrario.
  // `plantillaOPorDefecto` es la única puerta y por eso se prueba así.
  describe('plantillaOPorDefecto normaliza todo lo que no conoce', () => {
    const basura = [
      '../../etc/passwd',
      '../admin/settings',
      '/etc/passwd',
      'clasico/../../../algo',
      'noExiste',
      '',
      null,
      undefined,
      42,
      {}
    ];

    test.each(basura.map(v => [JSON.stringify(v) || String(v), v]))(
      'con %s devuelve el partial por defecto',
      (_etiqueta, valor) => {
        expect(tema.plantillaOPorDefecto(valor)).toBe(TEMPLATES[tema.TEMPLATE_POR_DEFECTO].partial);
      }
    );

    test('con un id válido devuelve su partial', () => {
      for (const id of tema.idsDeTemplates()) {
        expect(tema.plantillaOPorDefecto(id)).toBe(TEMPLATES[id].partial);
      }
    });
  });
});

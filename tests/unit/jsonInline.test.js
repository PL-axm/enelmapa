const jsonInline = require('../../services/jsonInline');

// El payload real que rompía el menú: `JSON.stringify` no escapa `<`, así que
// este nombre cerraba el `<script>` de views/menu.ejs y lo que venía después
// se ejecutaba como HTML.
const PAYLOAD_SCRIPT = '</script><img src=x onerror=alert(1)>';

// Y el que rompe el panel: la descripción real de "Cazuela Chidas". La comilla
// simple cerraba el atributo `onclick='…'` y el botón Editar dejaba de andar.
const PAYLOAD_APOSTROFO = "Papas francesas, ropa vieja, pico e' gallo";

describe('jsonInline', () => {
  test('el payload que cerraba el <script> sale escapado', () => {
    const salida = jsonInline({ name: PAYLOAD_SCRIPT });

    expect(salida).not.toContain('</script>');
    expect(salida).not.toContain('<');
    expect(salida).toContain('\\u003c/script\\u003e');
  });

  test('la comilla simple sale escapada, así no cierra el atributo', () => {
    const salida = jsonInline({ description: PAYLOAD_APOSTROFO });

    expect(salida).not.toContain("'");
    expect(salida).toContain("pico e\\u0027 gallo");
  });

  test('el resultado sigue siendo JSON válido y vuelve al valor original', () => {
    // Es la propiedad que hace que esto sirva: se escapa con `\uXXXX`, que es
    // válido en JSON y en JavaScript, así que del otro lado no hay que
    // des-escapar nada.
    const original = {
      name: PAYLOAD_SCRIPT,
      description: PAYLOAD_APOSTROFO,
      mezcla: 'a<b>c&d"e\'f',
      precio: 20000,
      activo: true,
      vacio: null,
      lista: [1, '<', "'"]
    };

    expect(JSON.parse(jsonInline(original))).toEqual(original);
  });

  test('NO escapa las comillas dobles, que son estructurales', () => {
    // Escaparlas rompería el JSON: `{"a":1}` dejaría de ser parseable. Por eso
    // el contrato del helper pide atributos con comillas simples.
    const salida = jsonInline({ a: 1 });

    expect(salida).toBe('{"a":1}');
    expect(() => JSON.parse(salida)).not.toThrow();
  });

  test('escapa los separadores de línea Unicode', () => {
    const sep = String.fromCharCode(0x2028);
    const par = String.fromCharCode(0x2029);
    const salida = jsonInline({ a: 'x' + sep + 'y' + par + 'z' });

    expect(salida).toContain('\\u2028');
    expect(salida).toContain('\\u2029');
    expect(salida).not.toContain(sep);
    expect(salida).not.toContain(par);
  });

  test('escapa el ampersand', () => {
    expect(jsonInline({ a: 'x&y' })).toContain('\\u0026');
  });

  test('no rompe valores normales', () => {
    const salida = jsonInline({ name: 'Mofongos x 5', price: '20000.00' });

    expect(salida).toBe('{"name":"Mofongos x 5","price":"20000.00"}');
  });
});

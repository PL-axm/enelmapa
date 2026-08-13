const tema = require('../../theme');
const { schemas } = require('../../validators');
const { PALETAS, VARIABLES } = require('../../theme/paletas');

// Estos tests existen por un bug concreto: la lista de paletas estaba escrita
// tres veces —el `z.enum` del validador, los radios de settings.ejs y los
// bloques `if` del CSS del menú— y se desincronizó. El panel ofrecía `navy` y el
// validador aceptaba `blue`, así que elegir la quinta paleta devolvía 400 y
// `blue` se guardaba sin tener CSS, cayendo a claro en silencio.
//
// La forma de que no vuelva a pasar no es acordarse de tocar los tres lados: es
// que haya un solo lado y que la suite falle si alguien agrega uno nuevo.

describe('coherencia del tema', () => {
  test('el validador acepta exactamente las paletas declaradas', () => {
    // Este es EL test del bug. Si alguien agrega una paleta a theme/ y el
    // validador no la conoce, o al revés, esto falla antes del merge.
    const aceptadas = tema.idsDePaletas().filter(
      (id) => schemas.settings.safeParse({ name: 'N', menu_theme: id }).success
    );

    expect(aceptadas).toEqual(tema.idsDePaletas());
  });

  test('el validador rechaza una paleta que no existe', () => {
    expect(tema.idsDePaletas()).not.toContain('fucsia');
    expect(schemas.settings.safeParse({ name: 'N', menu_theme: 'fucsia' }).success).toBe(false);
  });

  test('`blue` ya no existe y `navy` sí', () => {
    // El nombre se resolvió a favor de navy: tenía el CSS y estaba en el panel.
    expect(tema.esPaletaValida('navy')).toBe(true);
    expect(tema.esPaletaValida('blue')).toBe(false);
  });

  test('cada paleta declara TODAS las variables, no un delta', () => {
    // Un delta parcial hereda en silencio de la anterior, que es exactamente
    // cómo `blue` pasaba por una paleta sin serlo.
    for (const [id, paleta] of Object.entries(PALETAS)) {
      expect(Object.keys(paleta.vars).sort()).toEqual([...VARIABLES].sort());
    }
  });

  test('cada paleta tiene nombre para mostrar', () => {
    for (const [id, paleta] of Object.entries(PALETAS)) {
      expect(typeof paleta.nombre).toBe('string');
      expect(paleta.nombre.length).toBeGreaterThan(0);
    }
  });

  test('la paleta por defecto existe', () => {
    expect(tema.esPaletaValida(tema.PALETA_POR_DEFECTO)).toBe(true);
  });
});

describe('cssDePaleta', () => {
  test('emite las 11 variables de la paleta pedida', () => {
    const css = tema.cssDePaleta('dark');

    expect(css).toContain('--bg: #1A1917;');
    expect(css).toContain('--accent: #D4A67D;');
    for (const v of VARIABLES) {
      expect(css).toContain(v + ':');
    }
  });

  test('una paleta desconocida cae en la de por defecto en vez de quedar sin colores', () => {
    // Cubre a los negocios que quedaron con `blue` guardado en la base mientras
    // el validador lo aceptaba: el menú tiene que verse, no quedar sin variables.
    expect(tema.cssDePaleta('blue')).toBe(tema.cssDePaleta(tema.PALETA_POR_DEFECTO));
    expect(tema.cssDePaleta(undefined)).toBe(tema.cssDePaleta(tema.PALETA_POR_DEFECTO));
    expect(tema.cssDePaleta(null)).toBe(tema.cssDePaleta(tema.PALETA_POR_DEFECTO));
  });

  test('ningún valor puede romper el <style> ni inyectar', () => {
    // El día que exista "color de acento personalizable", este es el único lugar
    // por donde va a pasar. Un `}` o un `<` en un valor cierra la regla o la
    // etiqueta. Mejor que el filtro ya esté y esté probado.
    for (const id of tema.idsDePaletas()) {
      const css = tema.cssDePaleta(id);
      expect(css).not.toMatch(/[<>]/);
      // Una sola llave de apertura y una de cierre: las del `:root`.
      expect(css.match(/\{/g)).toHaveLength(1);
      expect(css.match(/\}/g)).toHaveLength(1);
    }
  });
});

describe('paletasParaUI', () => {
  test('devuelve una entrada por paleta, con los colores de la muestra', () => {
    const ui = tema.paletasParaUI();

    expect(ui.map(p => p.id)).toEqual(tema.idsDePaletas());
    for (const p of ui) {
      expect(p.fondo).toBe(PALETAS[p.id].vars['--bg']);
      expect(p.texto).toBe(PALETAS[p.id].vars['--text-primary']);
      expect(p.borde).toBe(PALETAS[p.id].vars['--border']);
    }
  });
});

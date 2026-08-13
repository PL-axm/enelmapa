const tema = require('../../theme');
const { schemas } = require('../../validators');
const { ESCALAS } = require('../../theme/escalas');

describe('escalas tipográficas', () => {
  // Mismo test que cierra el bug de las paletas, aplicado al eje nuevo: la lista
  // no puede quedar escrita en dos lados.
  test('el validador acepta exactamente las escalas declaradas', () => {
    const aceptadas = tema.idsDeEscalas().filter(
      (id) => schemas.settings.safeParse({ name: 'N', menu_scale: id }).success
    );

    expect(aceptadas).toEqual(tema.idsDeEscalas());
  });

  test('rechaza una escala inventada', () => {
    expect(schemas.settings.safeParse({ name: 'N', menu_scale: 'gigante' }).success).toBe(false);
  });

  test('sin escala cae a la de por defecto', () => {
    expect(schemas.settings.safeParse({ name: 'N' }).data.menu_scale)
      .toBe(tema.ESCALA_POR_DEFECTO);
  });

  // ESTE es el test de la fase: con la escala por defecto el factor es 1, así que
  // `calc(14.5px * 1)` es 14.5px y ningún negocio existente ve un cambio de
  // tamaño. Si alguien "afina" este número, la fase deja de ser invisible.
  test('la escala por defecto tiene factor exactamente 1', () => {
    expect(ESCALAS[tema.ESCALA_POR_DEFECTO].factor).toBe(1);
  });

  test('los factores son números finitos y en un rango razonable', () => {
    for (const [id, e] of Object.entries(ESCALAS)) {
      expect(typeof e.factor).toBe('number');
      expect(Number.isFinite(e.factor)).toBe(true);
      expect(e.factor).toBeGreaterThan(0.5);
      expect(e.factor).toBeLessThanOrEqual(1.5);
    }
  });

  // El piso de legibilidad, verificado y no afirmado. Los tamaños base salen del
  // propio skin, así que este test también protege el caso "alguien baja la
  // descripción a 11px base" — que con cualquier factor menor a 1 la hundiría.
  //
  // Nació de un error: el comentario de escalas.js decía que 0.9 mantenía la
  // descripción sobre 11px, pero la base más chica es 12px y 12 × 0.9 = 10.8px.
  // La afirmación era falsa y nada la comprobaba.
  test('ningún tamaño de contenido baja de 11px, ni en la escala más chica', () => {
    const fs = require('fs');
    const path = require('path');

    const PISO_PX = 11;
    const skin = fs.readFileSync(
      path.join(__dirname, '../../views/menu/clasico.ejs'), 'utf8'
    );

    const bases = [...skin.matchAll(/calc\(([\d.]+)px \* var\(--escala\)\)/g)]
      .map(m => Number(m[1]));

    expect(bases.length).toBeGreaterThan(0);   // si el regex deja de matchear, se sabe

    const factorMasChico = Math.min(...Object.values(ESCALAS).map(e => e.factor));
    const masChico = Math.min(...bases) * factorMasChico;

    expect(masChico).toBeGreaterThanOrEqual(PISO_PX);
  });

  test('cada escala tiene nombre y descripción para el panel', () => {
    for (const [id, e] of Object.entries(ESCALAS)) {
      expect(e.nombre.length).toBeGreaterThan(0);
      expect(e.descripcion.length).toBeGreaterThan(0);
    }
  });

  test('los factores son distintos entre sí y crecientes en el orden declarado', () => {
    // Dos escalas con el mismo factor serían dos opciones que hacen lo mismo, y
    // el panel las muestra en el orden de declaración: si no crecen, el usuario
    // ve "Compacto, Normal, Grande" desordenado respecto de lo que hacen.
    const factores = tema.idsDeEscalas().map(id => ESCALAS[id].factor);

    expect(new Set(factores).size).toBe(factores.length);
    expect(factores).toEqual([...factores].sort((a, b) => a - b));
  });
});

describe('cssDeEscala', () => {
  test('emite el factor de la escala pedida', () => {
    expect(tema.cssDeEscala('grande')).toContain('--escala: ' + ESCALAS.grande.factor);
  });

  test('una escala desconocida cae en la de por defecto', () => {
    expect(tema.cssDeEscala('gigante')).toBe(tema.cssDeEscala(tema.ESCALA_POR_DEFECTO));
    expect(tema.cssDeEscala(undefined)).toBe(tema.cssDeEscala(tema.ESCALA_POR_DEFECTO));
    expect(tema.cssDeEscala(null)).toBe(tema.cssDeEscala(tema.ESCALA_POR_DEFECTO));
  });

  test('sólo emite un número, nunca texto de la base', () => {
    // El valor entra a un `calc()`. Si acá se pudiera colar una cadena, sería una
    // inyección en el `<style>`; que siempre salga un número es lo que lo impide.
    for (const id of tema.idsDeEscalas()) {
      const css = tema.cssDeEscala(id);
      const valor = css.match(/--escala:\s*([^;]+);/)[1];
      expect(Number.isFinite(Number(valor))).toBe(true);
    }
  });
});

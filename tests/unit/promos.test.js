const promos = require('../../services/promos');

const { ESTADOS } = promos;

// La fecha se INYECTA en todos estos tests. Es el punto de que el servicio sea
// puro: un test de "promo de martes" que dependiera del día en que se corre
// pasaría hoy y fallaría el jueves, y eso es peor que no tenerlo.
const hoy = (fecha, dia) => ({ fecha, dia });

// 2026-09-15 es martes. Se elige una fecha fija y se anota qué día cae, en vez
// de calcularlo, para que el test diga lo que prueba.
const MARTES = hoy('2026-09-15', 2);

function producto(extra) {
  return { promo_price: 15000, promo_days: '1111111', promo_from: null, promo_to: null, ...extra };
}

describe('estado de una promoción', () => {
  test('sin precio promocional no hay promo', () => {
    expect(promos.estado({ promo_price: null }, MARTES)).toBe(ESTADOS.SIN_PROMO);
    expect(promos.estado({}, MARTES)).toBe(ESTADOS.SIN_PROMO);
  });

  test('con precio y sin restricciones, está activa', () => {
    expect(promos.estado(producto(), MARTES)).toBe(ESTADOS.ACTIVA);
  });

  test('un precio de 0 SÍ es una promoción', () => {
    // 0 es un precio válido —una cortesía— y por eso el interruptor es NULL y no
    // el cero. Si esto se rompe, regalar algo dejaría de poder anunciarse.
    expect(promos.estado(producto({ promo_price: 0 }), MARTES)).toBe(ESTADOS.ACTIVA);
  });

  describe('ventana de fechas', () => {
    test('antes del inicio está programada', () => {
      expect(promos.estado(producto({ promo_from: '2026-09-16' }), MARTES)).toBe(ESTADOS.PROGRAMADA);
    });

    test('después del fin está vencida', () => {
      expect(promos.estado(producto({ promo_to: '2026-09-14' }), MARTES)).toBe(ESTADOS.VENCIDA);
    });

    // Los bordes son la mitad de los bugs de fechas.
    test('el primer día de la ventana está activa', () => {
      expect(promos.estado(producto({ promo_from: '2026-09-15' }), MARTES)).toBe(ESTADOS.ACTIVA);
    });

    test('el último día de la ventana está activa', () => {
      expect(promos.estado(producto({ promo_to: '2026-09-15' }), MARTES)).toBe(ESTADOS.ACTIVA);
    });

    test('una ventana de un solo día funciona', () => {
      expect(promos.estado(
        producto({ promo_from: '2026-09-15', promo_to: '2026-09-15' }), MARTES
      )).toBe(ESTADOS.ACTIVA);
    });

    test('sólo inicio: vale para siempre desde ahí', () => {
      expect(promos.estado(producto({ promo_from: '2026-01-01' }), MARTES)).toBe(ESTADOS.ACTIVA);
    });

    test('sólo fin: vale desde siempre hasta ahí', () => {
      expect(promos.estado(producto({ promo_to: '2026-12-31' }), MARTES)).toBe(ESTADOS.ACTIVA);
    });

    test('cruza el fin de mes sin problemas', () => {
      const p = producto({ promo_from: '2026-08-28', promo_to: '2026-09-03' });
      expect(promos.estado(p, hoy('2026-09-01', 2))).toBe(ESTADOS.ACTIVA);
      expect(promos.estado(p, hoy('2026-08-31', 1))).toBe(ESTADOS.ACTIVA);
      expect(promos.estado(p, hoy('2026-09-04', 5))).toBe(ESTADOS.VENCIDA);
    });

    test('compara como fechas y no como texto suelto', () => {
      // '2026-09-9' contra '2026-09-15' ordenaría mal si alguien guardara sin
      // padding. Con dos dígitos, el orden alfabético ES el cronológico.
      expect(promos.estado(producto({ promo_to: '2026-09-09' }), MARTES)).toBe(ESTADOS.VENCIDA);
      expect(promos.estado(producto({ promo_from: '2026-10-01' }), MARTES)).toBe(ESTADOS.PROGRAMADA);
    });
  });

  describe('días de la semana', () => {
    test('el martes de "sólo martes" está activa', () => {
      expect(promos.estado(producto({ promo_days: '0010000' }), MARTES)).toBe(ESTADOS.ACTIVA);
    });

    test('el martes de "sólo lunes" está fuera de día', () => {
      expect(promos.estado(producto({ promo_days: '0100000' }), MARTES)).toBe(ESTADOS.FUERA_DE_DIA);
    });

    // La posición 0 es Domingo. Si alguien la cambiara a Lunes, toda promo con
    // días se correría un día y nada más lo notaría.
    test('la posición 0 es DOMINGO', () => {
      const soloDomingo = producto({ promo_days: '1000000' });
      expect(promos.estado(soloDomingo, hoy('2026-09-13', 0))).toBe(ESTADOS.ACTIVA);
      expect(promos.estado(soloDomingo, hoy('2026-09-14', 1))).toBe(ESTADOS.FUERA_DE_DIA);
    });

    test('la posición 6 es SÁBADO', () => {
      const soloSabado = producto({ promo_days: '0000001' });
      expect(promos.estado(soloSabado, hoy('2026-09-19', 6))).toBe(ESTADOS.ACTIVA);
    });

    test('días vacíos o rotos se tratan como todos los días', () => {
      for (const v of [undefined, null, '', '11', 'xxxxxxx'.slice(0, 3)]) {
        expect(promos.estado(producto({ promo_days: v }), MARTES)).toBe(ESTADOS.ACTIVA);
      }
    });
  });

  test('la fecha manda sobre el día: vencida gana a fuera-de-día', () => {
    // Importa para el mensaje del panel: si la promo venció, decir "fuera de
    // día" mandaría al dueño a revisar los días cuando el problema es la fecha.
    const p = producto({ promo_to: '2026-09-01', promo_days: '0100000' });
    expect(promos.estado(p, MARTES)).toBe(ESTADOS.VENCIDA);
  });

  test('estaActiva es el estado activa y nada más', () => {
    expect(promos.estaActiva(producto(), MARTES)).toBe(true);
    expect(promos.estaActiva(producto({ promo_to: '2020-01-01' }), MARTES)).toBe(false);
    expect(promos.estaActiva({ promo_price: null }, MARTES)).toBe(false);
  });
});

describe('aFechaTexto', () => {
  test('acepta el texto tal cual', () => {
    expect(promos.aFechaTexto('2026-09-15')).toBe('2026-09-15');
  });

  test('nulo y vacío devuelven null', () => {
    expect(promos.aFechaTexto(null)).toBeNull();
    expect(promos.aFechaTexto(undefined)).toBeNull();
    expect(promos.aFechaTexto('')).toBeNull();
  });

  // El motivo de que esta función exista. mysql2 devuelve una columna DATE como
  // un Date a MEDIANOCHE LOCAL del proceso. Usar `toISOString()` sobre eso corre
  // la fecha un día en cualquier servidor al este de Greenwich: la medianoche
  // local del 15 es el 14 a las 22:00 UTC. Se leen los componentes locales, que
  // son los que mysql2 puso.
  test('un Date de mysql2 se convierte por componentes locales, no por UTC', () => {
    const comoLoDevuelveMysql = new Date(2026, 8, 15, 0, 0, 0);   // 15 de septiembre, local

    expect(promos.aFechaTexto(comoLoDevuelveMysql)).toBe('2026-09-15');
  });

  test('rellena mes y día con cero', () => {
    expect(promos.aFechaTexto(new Date(2026, 0, 5, 0, 0, 0))).toBe('2026-01-05');
  });
});

describe('hoyEn', () => {
  // Se pasa un instante fijo, así el test no depende de cuándo se corre.
  const instante = new Date('2026-09-15T03:30:00Z');   // 15/09 03:30 UTC

  test('en Bogotá todavía es el día anterior', () => {
    // UTC-5: las 03:30 UTC del 15 son las 22:30 del 14 en Colombia. Este es
    // exactamente el caso que rompería una promo que vence "el 14" si se
    // evaluara en UTC: se apagaría cinco horas antes.
    expect(promos.hoyEn('America/Bogota', instante)).toEqual({ fecha: '2026-09-14', dia: 1 });
  });

  test('en UTC ya es el día siguiente', () => {
    expect(promos.hoyEn('UTC', instante)).toEqual({ fecha: '2026-09-15', dia: 2 });
  });

  test('el índice de día coincide con la convención de la app', () => {
    // Domingo = 0. Se comprueba contra un domingo conocido.
    expect(promos.hoyEn('UTC', new Date('2026-09-13T12:00:00Z')).dia).toBe(0);
    expect(promos.hoyEn('UTC', new Date('2026-09-19T12:00:00Z')).dia).toBe(6);
  });
});

// Un 2x1 no baja el precio unitario: lo que cambia es lo que te dan. La primera
// versión exigía precio promocional, así que la promoción más común de un
// restaurante no se podía cargar.
describe('promos de sólo etiqueta', () => {
  const MARTES = { fecha: '2026-09-15', dia: 2 };

  test('con etiqueta y sin precio hay promoción', () => {
    const p = { promo_price: null, promo_label: '2x1', promo_days: '1111111' };

    expect(promos.tienePromo(p)).toBe(true);
    expect(promos.estado(p, MARTES)).toBe(ESTADOS.ACTIVA);
  });

  test('sin etiqueta y sin precio no hay promoción', () => {
    expect(promos.tienePromo({ promo_price: null, promo_label: '' })).toBe(false);
    expect(promos.estado({ promo_price: null, promo_label: '' }, MARTES)).toBe(ESTADOS.SIN_PROMO);
  });

  test('la vigencia se aplica igual a una promo de sólo etiqueta', () => {
    const soloMartes = { promo_price: null, promo_label: '2x1', promo_days: '0010000' };
    expect(promos.estado(soloMartes, MARTES)).toBe(ESTADOS.ACTIVA);
    expect(promos.estado(soloMartes, { fecha: '2026-09-16', dia: 3 })).toBe(ESTADOS.FUERA_DE_DIA);

    const vencida = { promo_price: null, promo_label: '2x1', promo_to: '2026-09-01' };
    expect(promos.estado(vencida, MARTES)).toBe(ESTADOS.VENCIDA);
  });

  test('con precio y con etiqueta también, que es el caso de "-30%"', () => {
    const p = { promo_price: '14000.00', promo_label: '-30%', promo_days: '1111111' };

    expect(promos.tienePromo(p)).toBe(true);
    expect(promos.estado(p, MARTES)).toBe(ESTADOS.ACTIVA);
  });
});

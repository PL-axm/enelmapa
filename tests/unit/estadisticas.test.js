const estadisticas = require('../../services/estadisticas');

const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const INSTAGRAM_IAB = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 345.0.0.0';
const FACEBOOK_IAB = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]';

describe('estadisticas.momentoEn', () => {
  // El caso que justifica guardar `dia` en la zona del negocio: a las 23:30 en
  // Bogotá ya es el día siguiente en UTC. Agrupar por UTC pasaría la visita de
  // la noche del sábado al domingo.
  test('a las 23:30 en Bogotá el día es el de Bogotá, no el de UTC', () => {
    const ahora = new Date('2026-10-04T04:30:00Z'); // 3 oct, 23:30 en Bogotá
    expect(estadisticas.momentoEn('America/Bogota', ahora)).toEqual({ dia: '2026-10-03', hora: 23 });
  });

  test('la medianoche es la hora 0, no 24', () => {
    const ahora = new Date('2026-10-04T05:00:00Z'); // 4 oct, 00:00 en Bogotá
    expect(estadisticas.momentoEn('America/Bogota', ahora)).toEqual({ dia: '2026-10-04', hora: 0 });
  });
});

describe('estadisticas.esBot', () => {
  test.each([
    'Googlebot/2.1 (+http://www.google.com/bot.html)',
    'facebookexternalhit/1.1',
    'WhatsApp/2.23.20.0',
    'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0',
    'curl/8.4.0',
    'python-requests/2.31'
  ])('%s es bot', (ua) => {
    expect(estadisticas.esBot(ua)).toBe(true);
  });

  test('sin user-agent se trata como bot', () => {
    expect(estadisticas.esBot('')).toBe(true);
    expect(estadisticas.esBot(undefined)).toBe(true);
  });

  // Los navegadores internos de Instagram y Facebook son personas, no bots:
  // son justamente el tráfico que viene de las redes del negocio.
  test.each([CHROME_ANDROID, INSTAGRAM_IAB, FACEBOOK_IAB])('un navegador real no es bot', (ua) => {
    expect(estadisticas.esBot(ua)).toBe(false);
  });
});

describe('estadisticas.clasificarOrigen', () => {
  const base = { o: '', ref: '', userAgent: CHROME_ANDROID, dominio: 'enelmapa.co' };

  test('la marca del QR gana sobre todo lo demás', () => {
    expect(estadisticas.clasificarOrigen({ ...base, o: 'qr', ref: 'l.instagram.com' })).toBe('qr');
  });

  test.each([
    ['l.instagram.com', 'instagram'],
    ['www.instagram.com', 'instagram'],
    ['m.facebook.com', 'facebook'],
    ['l.facebook.com', 'facebook'],
    ['web.whatsapp.com', 'whatsapp'],
    ['www.tiktok.com', 'tiktok'],
    ['www.google.com', 'google'],
    ['www.google.com.co', 'google'],
    ['enelmapa.co', 'enelmapa'],
    ['www.enelmapa.co', 'enelmapa'],
    ['blog.ejemplo.com', 'otro']
  ])('referrer %s → %s', (ref, esperado) => {
    expect(estadisticas.clasificarOrigen({ ...base, ref })).toBe(esperado);
  });

  // Un dominio que sólo TERMINA parecido no es la red: `noinstagram.com` no es
  // Instagram.
  test('un dominio que se parece no se confunde con la red', () => {
    expect(estadisticas.clasificarOrigen({ ...base, ref: 'noinstagram.com' })).toBe('otro');
  });

  test('sin referrer, el navegador interno de Instagram delata el origen', () => {
    expect(estadisticas.clasificarOrigen({ ...base, userAgent: INSTAGRAM_IAB })).toBe('instagram');
  });

  test('sin referrer, el navegador interno de Facebook delata el origen', () => {
    expect(estadisticas.clasificarOrigen({ ...base, userAgent: FACEBOOK_IAB })).toBe('facebook');
  });

  test('sin referrer ni pistas es directo', () => {
    expect(estadisticas.clasificarOrigen(base)).toBe('directo');
  });

  test('un valor de `o` desconocido se ignora', () => {
    expect(estadisticas.clasificarOrigen({ ...base, o: 'lo-que-sea' })).toBe('directo');
  });
});

describe('estadisticas.huellaVisitante', () => {
  const visitante = { ip: '190.1.2.3', userAgent: CHROME_ANDROID, secreto: 's3cr3t' };

  test('es estable dentro del mismo día', () => {
    const a = estadisticas.huellaVisitante({ ...visitante, dia: '2026-10-06' });
    const b = estadisticas.huellaVisitante({ ...visitante, dia: '2026-10-06' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  // Que cambie de un día al otro es lo que impide seguir a una persona en el
  // tiempo, incluso para quien tenga acceso a la base.
  test('cambia al día siguiente', () => {
    const hoy = estadisticas.huellaVisitante({ ...visitante, dia: '2026-10-06' });
    const manana = estadisticas.huellaVisitante({ ...visitante, dia: '2026-10-07' });
    expect(hoy).not.toBe(manana);
  });

  test('dos personas distintas el mismo día dan huellas distintas', () => {
    const a = estadisticas.huellaVisitante({ ...visitante, dia: '2026-10-06' });
    const b = estadisticas.huellaVisitante({ ...visitante, ip: '190.9.9.9', dia: '2026-10-06' });
    expect(a).not.toBe(b);
  });

  test('no contiene la IP', () => {
    const h = estadisticas.huellaVisitante({ ...visitante, dia: '2026-10-06' });
    expect(h).not.toContain('190');
  });

  // Sin el secreto, cualquiera podría recalcular el hash de una IP conocida y
  // saber si esa persona visitó el menú.
  test('depende del secreto', () => {
    const a = estadisticas.huellaVisitante({ ...visitante, dia: '2026-10-06' });
    const b = estadisticas.huellaVisitante({ ...visitante, secreto: 'otro', dia: '2026-10-06' });
    expect(a).not.toBe(b);
  });
});

describe('estadisticas: armado del tablero', () => {
  test('rangoValido acepta 7, 30 y 90, y cualquier otra cosa cae a 30', () => {
    expect(estadisticas.rangoValido('7')).toBe(7);
    expect(estadisticas.rangoValido(90)).toBe(90);
    expect(estadisticas.rangoValido('100000')).toBe(30);
    expect(estadisticas.rangoValido(undefined)).toBe(30);
    expect(estadisticas.rangoValido('abc')).toBe(30);
  });

  test('sumarDias cruza meses y años', () => {
    expect(estadisticas.sumarDias('2026-10-01', -1)).toBe('2026-09-30');
    expect(estadisticas.sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(estadisticas.sumarDias('2028-02-28', 1)).toBe('2028-02-29');
  });

  // "Últimos 7 días" incluye hoy, y el período anterior es el bloque de 7
  // inmediatamente antes, sin solaparse ni dejar un hueco.
  test('periodos: el actual incluye hoy y el anterior es contiguo', () => {
    expect(estadisticas.periodos('2026-10-06', 7)).toEqual({
      actual: { desde: '2026-09-30', hasta: '2026-10-06' },
      anterior: { desde: '2026-09-23', hasta: '2026-09-29' }
    });
  });

  test('completarDias rellena con ceros los días sin visitas', () => {
    const dias = estadisticas.completarDias(
      [{ dia: '2026-10-02', visitas: 5, visitantes: 3 }],
      '2026-10-01', '2026-10-03'
    );
    expect(dias).toEqual([
      { dia: '2026-10-01', visitas: 0, visitantes: 0 },
      { dia: '2026-10-02', visitas: 5, visitantes: 3 },
      { dia: '2026-10-03', visitas: 0, visitantes: 0 }
    ]);
  });

  test('completarHoras da siempre 24 horas', () => {
    const horas = estadisticas.completarHoras([{ hora: 13, visitas: 4 }]);
    expect(horas).toHaveLength(24);
    expect(horas[13]).toEqual({ hora: 13, visitas: 4 });
    expect(horas[0]).toEqual({ hora: 0, visitas: 0 });
  });

  test('variacion: null sin base, y el porcentaje redondeado con ella', () => {
    expect(estadisticas.variacion(10, 0)).toBeNull();
    expect(estadisticas.variacion(15, 10)).toBe(50);
    expect(estadisticas.variacion(5, 10)).toBe(-50);
    expect(estadisticas.variacion(10, 10)).toBe(0);
  });

  test('armarTablero normaliza alturas y porcentajes para la vista', () => {
    const resumen = { visitas: 10, visitantes: 6, productos: 4, whatsapp: 2, instagram: 1, facebook: 1 };
    const t = estadisticas.armarTablero({
      dias: 7,
      periodo: { desde: '2026-09-30', hasta: '2026-10-06' },
      resumen,
      resumenAnterior: { visitas: 5, visitantes: 0, productos: 4, whatsapp: 1, instagram: 0, facebook: 0 },
      porDia: [{ dia: '2026-10-06', visitas: 10, visitantes: 6 }],
      porHora: [{ hora: 20, visitas: 10 }],
      topProductos: [{ id: 1, name: 'Tinto', vistas: 4 }, { id: 2, name: 'Pan', vistas: 2 }],
      origenes: [{ origen: 'directo', visitas: 3 }, { origen: 'qr', visitas: 7 }]
    });

    expect(t.vacio).toBe(false);
    expect(t.kpis.visitas).toEqual({ valor: 10, variacion: 100 });
    expect(t.kpis.visitantes.variacion).toBeNull();
    expect(t.kpis.tasaClic).toBe(20);
    expect(t.serie).toHaveLength(7);
    expect(t.serie[6].alto).toBe(1);
    expect(t.horas[20].alto).toBe(1);
    expect(t.topProductos.map(p => p.ancho)).toEqual([1, 0.5]);
    // Ordenados de mayor a menor, con etiqueta legible.
    expect(t.origenes[0]).toEqual({ origen: 'qr', etiqueta: 'Código QR', visitas: 7, porcentaje: 70 });
    expect(t.clics.find(c => c.red === 'WhatsApp').porcentaje).toBe(50);
  });

  test('armarTablero sin visitas queda vacío y sin dividir por cero', () => {
    const cero = { visitas: 0, visitantes: 0, productos: 0, whatsapp: 0, instagram: 0, facebook: 0 };
    const t = estadisticas.armarTablero({
      dias: 30,
      periodo: { desde: '2026-09-07', hasta: '2026-10-06' },
      resumen: cero, resumenAnterior: cero,
      porDia: [], porHora: [], topProductos: [], origenes: []
    });
    expect(t.vacio).toBe(true);
    expect(t.kpis.tasaClic).toBe(0);
    expect(t.serie).toHaveLength(30);
    expect(t.serie.every(d => d.alto === 0)).toBe(true);
  });
});

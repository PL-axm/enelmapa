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

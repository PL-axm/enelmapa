const crypto = require('crypto');

// Las decisiones de las estadísticas del menú: qué es un bot, de dónde vino una
// visita, qué día y hora es en la zona del negocio, y cómo se identifica a un
// visitante sin guardar quién es. Todo puro: el reloj, la IP y el secreto
// entran como argumentos, así que se prueba sin base, sin Express y sin
// depender del día en que corre la suite.

const TIPOS = ['visita', 'producto', 'whatsapp', 'instagram', 'facebook'];

// Lo que llega al beacon ya filtró a casi todos los bots, porque no ejecutan
// JS. Esto es para los pocos que sí — los navegadores sin cabeza de los
// buscadores y de las vistas previas.
const PATRON_BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|whatsapp\/|curl|wget|python|axios|node-fetch|go-http/i;

function esBot(userAgent) {
  if (!userAgent) return true;
  return PATRON_BOT.test(userAgent);
}

// Día y hora en la zona del negocio. Con `hourCycle: 'h23'` y no `hour12:
// false`: este último devuelve "24" a la medianoche en algunas versiones de
// Node, y la columna `hora` es 0-23.
function momentoEn(zona, ahora = new Date()) {
  const partes = {};
  const formato = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23'
  });
  for (const p of formato.formatToParts(ahora)) partes[p.type] = p.value;

  return {
    dia: partes.year + '-' + partes.month + '-' + partes.day,
    hora: Number(partes.hour)
  };
}

// De dónde vino la visita. El orden importa:
//
//   1. `?o=qr` lo agrega el QR que genera el panel (services/qrService.js).
//      Gana sobre todo lo demás porque es lo único que sabemos con certeza.
//   2. El host del referrer, que manda el navegador.
//   3. El user-agent: Instagram y Facebook abren los links en su propio
//      navegador, que muchas veces NO manda referrer pero sí se identifica.
//
// WhatsApp abre los links en el navegador del sistema y casi nunca deja
// rastro, así que buena parte de lo que venga de ahí va a caer en "directo".
const ORIGENES_POR_HOST = [
  ['instagram', /(^|\.)instagram\.com$/],
  ['facebook', /(^|\.)(facebook\.com|fb\.com|fb\.me)$/],
  ['whatsapp', /(^|\.)(whatsapp\.com|wa\.me)$/],
  ['tiktok', /(^|\.)tiktok\.com$/],
  ['google', /(^|\.)google\.[a-z.]+$/]
];

function clasificarOrigen({ o, ref, userAgent, dominio }) {
  if (o === 'qr') return 'qr';

  const host = String(ref || '').toLowerCase().trim();
  if (host) {
    for (const [origen, patron] of ORIGENES_POR_HOST) {
      if (patron.test(host)) return origen;
    }
    // La landing de la plataforma enlaza a los menús de sus clientes: vale la
    // pena saber cuántas visitas les manda.
    if (dominio && (host === dominio || host.endsWith('.' + dominio))) return 'enelmapa';
    return 'otro';
  }

  if (/Instagram/.test(userAgent || '')) return 'instagram';
  if (/FBAN|FBAV|FB_IAB/.test(userAgent || '')) return 'facebook';

  return 'directo';
}

// Identificador de visitante para contar únicos por día, sin cookies y sin
// guardar la IP. El día entra en el hash, así que mañana la misma persona da
// otro valor: no hay forma de seguirla en el tiempo, ni siquiera desde la
// base. El secreto impide recalcular el hash a partir de una IP conocida.
function huellaVisitante({ ip, userAgent, dia, secreto }) {
  return crypto
    .createHash('sha256')
    .update([ip || '', userAgent || '', dia, secreto].join('|'))
    .digest('hex')
    .slice(0, 16);
}

// ===== Lectura: lo que necesitan los tableros =====

// Los rangos que ofrece el tablero. Cualquier otro valor de `?dias=` cae al
// default: no hay por qué aceptar `?dias=100000` y recorrer toda la tabla.
const RANGOS = [7, 30, 90];
const RANGO_POR_DEFECTO = 30;

function rangoValido(valor) {
  const n = Number(valor);
  return RANGOS.includes(n) ? n : RANGO_POR_DEFECTO;
}

// Aritmética de fechas sobre texto 'YYYY-MM-DD', en UTC a propósito: son
// fechas de calendario, no instantes, y en UTC no hay cambios de horario que
// hagan que "sumar un día" sume 23 o 25 horas.
function sumarDias(fecha, n) {
  const [y, m, d] = fecha.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

// El período pedido (los últimos `dias` días, HOY incluido) y el anterior del
// mismo largo, para la comparación. `hoy` se inyecta: ver `momentoEn`.
function periodos(hoy, dias) {
  const desde = sumarDias(hoy, -(dias - 1));
  return {
    actual: { desde, hasta: hoy },
    anterior: { desde: sumarDias(desde, -dias), hasta: sumarDias(desde, -1) }
  };
}

// Un día sin visitas no viene en el GROUP BY. Sin completarlo, el gráfico
// pegaría el lunes al jueves y la caída no se vería.
function completarDias(filas, desde, hasta) {
  const porDia = new Map(filas.map(f => [f.dia, f]));
  const dias = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) {
    const fila = porDia.get(d);
    dias.push({ dia: d, visitas: fila ? fila.visitas : 0, visitantes: fila ? fila.visitantes : 0 });
  }
  return dias;
}

function completarHoras(filas) {
  const porHora = new Map(filas.map(f => [f.hora, f.visitas]));
  return Array.from({ length: 24 }, (_, hora) => ({ hora, visitas: porHora.get(hora) || 0 }));
}

// Variación porcentual contra el período anterior. `null` cuando no hay base
// para comparar: "+∞ %" no le dice nada a nadie, y es lo que pasa el primer mes.
function variacion(actual, anterior) {
  if (!anterior) return null;
  return Math.round(((actual - anterior) / anterior) * 100);
}

function porcentaje(parte, total) {
  return total ? Math.round((parte / total) * 1000) / 10 : 0;
}

const ETIQUETAS_ORIGEN = {
  qr: 'Código QR',
  instagram: 'Instagram',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
  tiktok: 'TikTok',
  google: 'Google',
  enelmapa: 'EnElMapa',
  otro: 'Otro sitio',
  directo: 'Directo / sin dato'
};

// Junta lo que devolvieron las consultas en lo que la vista dibuja. La vista
// no calcula nada: recibe alturas y porcentajes ya hechos.
function armarTablero({ dias, periodo, resumen, resumenAnterior, porDia, porHora, topProductos, origenes }) {
  const serie = completarDias(porDia, periodo.desde, periodo.hasta);
  const horas = completarHoras(porHora);
  const maxDia = Math.max(1, ...serie.map(d => d.visitas));
  const maxHora = Math.max(1, ...horas.map(h => h.visitas));
  const maxProducto = Math.max(1, ...topProductos.map(p => p.vistas));
  const totalOrigen = origenes.reduce((s, o) => s + o.visitas, 0);
  const clics = resumen.whatsapp + resumen.instagram + resumen.facebook;

  return {
    dias,
    rangos: RANGOS,
    periodo,
    vacio: resumen.visitas === 0,
    kpis: {
      visitas: { valor: resumen.visitas, variacion: variacion(resumen.visitas, resumenAnterior.visitas) },
      visitantes: { valor: resumen.visitantes, variacion: variacion(resumen.visitantes, resumenAnterior.visitantes) },
      productos: { valor: resumen.productos, variacion: variacion(resumen.productos, resumenAnterior.productos) },
      whatsapp: { valor: resumen.whatsapp, variacion: variacion(resumen.whatsapp, resumenAnterior.whatsapp) },
      tasaClic: porcentaje(resumen.whatsapp, resumen.visitas)
    },
    serie: serie.map(d => ({ ...d, alto: d.visitas / maxDia })),
    horas: horas.map(h => ({ ...h, alto: h.visitas / maxHora })),
    topProductos: topProductos.map(p => ({ ...p, ancho: p.vistas / maxProducto })),
    origenes: origenes
      .map(o => ({
        origen: o.origen,
        etiqueta: ETIQUETAS_ORIGEN[o.origen] || o.origen,
        visitas: o.visitas,
        porcentaje: porcentaje(o.visitas, totalOrigen)
      }))
      .sort((a, b) => b.visitas - a.visitas),
    clics: [
      { red: 'WhatsApp', clics: resumen.whatsapp },
      { red: 'Instagram', clics: resumen.instagram },
      { red: 'Facebook', clics: resumen.facebook }
    ].map(c => ({ ...c, porcentaje: porcentaje(c.clics, clics) }))
  };
}

module.exports = {
  TIPOS, esBot, momentoEn, clasificarOrigen, huellaVisitante,
  RANGOS, RANGO_POR_DEFECTO, rangoValido, sumarDias, periodos,
  completarDias, completarHoras, variacion, porcentaje, armarTablero, ETIQUETAS_ORIGEN
};

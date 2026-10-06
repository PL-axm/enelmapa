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

module.exports = { TIPOS, esBot, momentoEn, clasificarOrigen, huellaVisitante };

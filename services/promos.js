// Decide si una promoción está vigente. Es la primera lógica de esta app que
// depende de qué día es, así que conviene tener las tres decisiones escritas:
//
// 1. Se evalúa EN EL SERVIDOR. El reloj del visitante está fuera de nuestro
//    control y suele estar mal; una promo que aparece según la hora del teléfono
//    es imposible de soportar.
//
// 2. En la zona horaria del NEGOCIO, no en UTC. Si el proceso corre en UTC —lo
//    normal en un servidor— "hoy" cambia a las 7 de la tarde hora Colombia, así
//    que una promo que vence "el 31" se apagaría el 30 a las 19:00 para todo el
//    mundo. La zona sale de config (`config.zonaHoraria`) y se resuelve con
//    `Intl`, nunca restando horas a mano.
//
// 3. La fecha ENTRA como parámetro, no se lee acá adentro. Todo lo de este
//    módulo es puro. Un `new Date()` en el medio haría que un test de "promo de
//    martes" pase hoy y falle el jueves, y un test así es peor que ninguno.
//
// Consecuencia a tener presente: el menú público pasa a depender del día. Hoy no
// hay cache ni CDN, así que no cambia nada; el día que se ponga uno, la fecha
// tiene que entrar en la clave de cache.

// Posición 0 = Domingo, igual que `business_hours.day_index` y que
// `Date.getDay()`. Una segunda convención sería un bug de corrimiento.
const DIAS_TODOS = '1111111';
const LARGO_DIAS = 7;

// El orden que devuelve `Intl` con `weekday: 'short'` en inglés, para pasar de
// nombre a índice sin depender del locale del sistema.
const ORDEN_INTL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Fecha y día de la semana "ahora" en la zona del negocio, como datos simples:
// `{ fecha: 'YYYY-MM-DD', dia: 0..6 }`. Se comparan como texto, que para
// YYYY-MM-DD ordena igual que cronológicamente.
function hoyEn(zona, ahora = new Date()) {
  const fecha = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(ahora);

  const nombreDia = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, weekday: 'short'
  }).format(ahora);

  return { fecha, dia: ORDEN_INTL.indexOf(nombreDia) };
}

// mysql2 devuelve una columna DATE como un objeto `Date` a medianoche LOCAL del
// proceso. `toISOString()` sobre eso es una trampa: en un servidor al este de
// Greenwich la medianoche local cae el día anterior en UTC, y la fecha saldría
// corrida un día. Por eso se leen los componentes locales, que son los que
// mysql2 puso.
function aFechaTexto(valor) {
  if (!valor) return null;
  if (typeof valor === 'string') return valor.slice(0, 10);

  const y = valor.getFullYear();
  const m = String(valor.getMonth() + 1).padStart(2, '0');
  const d = String(valor.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

// Normaliza `promo_days`. Vacío, nulo o con largo raro se trata como "todos los
// días": es lo que espera alguien que cargó un precio promocional y no tocó los
// días. `'0000000'` sí se rechaza en el validador, porque ahí es una promo que
// nunca se muestra, o sea una trampa para quien la cargó.
function diasNormalizados(valor) {
  return typeof valor === 'string' && valor.length === LARGO_DIAS ? valor : DIAS_TODOS;
}

const SIN_PROMO = 'sin-promo';
const ACTIVA = 'activa';
const PROGRAMADA = 'programada';
const VENCIDA = 'vencida';
const FUERA_DE_DIA = 'fuera-de-dia';

// Devuelve UNO de los cinco estados. Que sean estados y no un booleano es lo que
// permite mostrarle al dueño por qué su promo no se ve: cargarla y que no
// aparezca sin explicación es el reclamo garantizado.
function estado(producto, hoy) {
  if (producto.promo_price === null || producto.promo_price === undefined) return SIN_PROMO;

  const desde = aFechaTexto(producto.promo_from);
  const hasta = aFechaTexto(producto.promo_to);

  // Los bordes son inclusivos: una promo "del 1 al 30" está activa el 1 y el 30.
  if (desde && hoy.fecha < desde) return PROGRAMADA;
  if (hasta && hoy.fecha > hasta) return VENCIDA;

  if (diasNormalizados(producto.promo_days)[hoy.dia] !== '1') return FUERA_DE_DIA;

  return ACTIVA;
}

function estaActiva(producto, hoy) {
  return estado(producto, hoy) === ACTIVA;
}

// Para el panel: texto y color de la etiqueta de estado.
const ETIQUETAS = {
  [ACTIVA]: { texto: 'Promo activa', color: '#2ECC71' },
  [PROGRAMADA]: { texto: 'Promo programada', color: '#C8956C' },
  [VENCIDA]: { texto: 'Promo vencida', color: '#9C9889' },
  [FUERA_DE_DIA]: { texto: 'Promo fuera de día', color: '#9C9889' }
};

function etiqueta(estadoId) {
  return ETIQUETAS[estadoId] || null;
}

module.exports = {
  hoyEn,
  aFechaTexto,
  diasNormalizados,
  estado,
  estaActiva,
  etiqueta,
  DIAS_TODOS,
  LARGO_DIAS,
  ESTADOS: { SIN_PROMO, ACTIVA, PROGRAMADA, VENCIDA, FUERA_DE_DIA }
};

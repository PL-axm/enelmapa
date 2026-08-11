// Todo el logging era `console.error` suelto, sin nivel ni hora (hallazgo E8).
// En una app sin monitoreo, donde la terminal del servidor es la única red de
// seguridad, eso significa que no se puede distinguir un 403 esperado de un bug,
// ni saber cuándo pasó algo, ni bajar el ruido en producción.
//
// Es deliberadamente chico: niveles, marca de tiempo y contexto. No hay
// transporte a archivo ni a un servicio externo, porque bajo Passenger la
// salida estándar ya va al log del servidor y agregar rotación de archivos sería
// resolver un problema que no tenemos.
//
// Escribe por `console.error` / `console.warn` / `console.log` según el nivel a
// propósito: así respeta la separación entre stdout y stderr que espera
// Passenger, y los tests que espían la consola siguen funcionando.

const NIVELES = { error: 0, warn: 1, info: 2, debug: 3 };
const SALIDA = { error: 'error', warn: 'warn', info: 'log', debug: 'log' };

function createLogger({ level = 'info', silent = false } = {}) {
  const umbral = NIVELES[level] ?? NIVELES.info;

  function escribir(nivel, mensaje, contexto) {
    if (silent || NIVELES[nivel] > umbral) return;

    const partes = [new Date().toISOString(), nivel.toUpperCase(), mensaje];

    // El contexto va al final y sólo si hay algo: un objeto vacío en cada línea
    // haría el log más difícil de leer, que es lo contrario de lo que se busca.
    if (contexto && Object.keys(contexto).length > 0) {
      partes.push(JSON.stringify(contexto));
    }

    console[SALIDA[nivel]](partes.join(' '));
  }

  return {
    error: (mensaje, contexto) => escribir('error', mensaje, contexto),
    warn: (mensaje, contexto) => escribir('warn', mensaje, contexto),
    info: (mensaje, contexto) => escribir('info', mensaje, contexto),
    debug: (mensaje, contexto) => escribir('debug', mensaje, contexto),

    // Para errores inesperados: el stack es lo único que delata dónde está el
    // bug, así que va aparte del mensaje y siempre por stderr.
    excepcion: (mensaje, err, contexto) => {
      if (silent) return;
      escribir('error', mensaje, contexto);
      console.error(err);
    }
  };
}

module.exports = { createLogger, NIVELES };

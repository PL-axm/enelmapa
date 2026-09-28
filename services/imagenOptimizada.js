const fs = require('fs');
const path = require('path');

// Reduce las fotos que suben los negocios.
//
// El problema medido el 2026-09-15 en producción: el menú de un negocio pesaba
// 28 MB en imágenes, con un promedio de 729 KB por foto y varias de 4 MB. Nadie
// las redimensionaba: entraban tal como salían del celular. El cliente que
// escanea el QR en la mesa las descarga con datos móviles.
//
// Dos reglas de diseño, las dos por lo mismo — que subir una foto nunca falle
// por culpa de esto:
//
//   1. NUNCA lanza. Si sharp no está, si la imagen es rara, si el disco falla:
//      se deja el archivo original y se sigue. Una foto pesada es un problema
//      menor; una subida que revienta es un negocio que no puede trabajar.
//   2. Sólo reemplaza si el resultado pesa MENOS. Recomprimir puede agrandar
//      un archivo ya optimizado, y sería absurdo empeorarlo.

// 1400px cubre una pantalla de celular a doble densidad y la ventana de
// producto en escritorio. Más que eso es peso que nadie ve.
const ANCHO_MAXIMO = 1400;
const CALIDAD = 80;

// Se carga una sola vez y sin romper si falta: el servidor corre en un hosting
// compartido donde una dependencia nativa puede no instalarse, y eso no debe
// impedir que la plataforma levante ni que se suban fotos.
let sharp = null;
let motivoNoDisponible = null;
try {
  sharp = require('sharp');
} catch (err) {
  motivoNoDisponible = err.message;
}

function disponible() {
  return sharp !== null;
}

// Los GIF se dejan intactos: suelen ser animados y al redimensionarlos con la
// configuración por defecto se pierde la animación. Es un formato marginal acá
// y no vale la pena arriesgar a cambiarle el contenido a alguien.
function esOptimizable(ruta) {
  return path.extname(ruta).toLowerCase() !== '.gif';
}

async function optimizar(ruta) {
  if (!disponible()) {
    return { optimizada: false, motivo: 'sharp no disponible: ' + motivoNoDisponible };
  }
  if (!esOptimizable(ruta)) {
    return { optimizada: false, motivo: 'formato que no se toca (gif)' };
  }

  let antes;
  try {
    antes = fs.statSync(ruta).size;
  } catch (err) {
    return { optimizada: false, motivo: 'no se pudo leer el archivo' };
  }

  // Se escribe a un temporal y recién al final se renombra. Sharp no puede leer
  // y escribir el mismo archivo a la vez, y además así una caída a mitad de
  // camino nunca deja media imagen donde antes había una entera.
  const temporal = ruta + '.tmp';

  try {
    // Se lee a memoria ANTES de procesar, en vez de pasarle la ruta a sharp.
    // Con la ruta, sharp deja el archivo de origen abierto mientras trabaja y
    // el renombrado de abajo falla con EPERM — siempre en Windows, y en Linux
    // según el momento, que es peor: un fallo intermitente que los tests
    // pasarían por casualidad. El límite de subida son 5 MB, así que cabe.
    const original = fs.readFileSync(ruta);
    const imagen = sharp(original, { failOn: 'none' }).rotate();
    const meta = await imagen.metadata();

    await imagen
      // `withoutEnlargement`: una foto chica se deja como está, no se estira.
      .resize({ width: ANCHO_MAXIMO, withoutEnlargement: true })
      .toFormat(meta.format === 'png' ? 'png' : 'jpeg', { quality: CALIDAD, mozjpeg: true })
      .toFile(temporal);

    const despues = fs.statSync(temporal).size;

    if (despues >= antes) {
      fs.unlinkSync(temporal);
      return { optimizada: false, motivo: 'ya estaba optimizada', antes, despues };
    }

    fs.renameSync(temporal, ruta);
    return { optimizada: true, antes, despues, ancho: Math.min(meta.width || 0, ANCHO_MAXIMO) };
  } catch (err) {
    try { fs.unlinkSync(temporal); } catch (e) { /* no llegó a crearse */ }
    return { optimizada: false, motivo: err.message, antes };
  }
}

// El middleware. Va DESPUÉS de verificarImagenes: si el archivo no era una
// imagen real, ya fue rechazado y no hay nada que optimizar.
//
// El resultado se registra pero nunca corta la request, por la regla 1.
function crearMiddleware({ logger, archivosDe }) {
  return async function optimizarImagenes(req, res, next) {
    for (const archivo of archivosDe(req)) {
      const r = await optimizar(archivo.path);
      if (r.optimizada) {
        logger?.debug?.('Imagen optimizada', {
          archivo: path.basename(archivo.path),
          antesKB: Math.round(r.antes / 1024),
          despuesKB: Math.round(r.despues / 1024)
        });
      } else if (r.motivo && !r.motivo.startsWith('ya estaba') && !r.motivo.startsWith('formato')) {
        logger?.warn?.('No se pudo optimizar una imagen, queda la original', {
          archivo: path.basename(archivo.path), motivo: r.motivo
        });
      }
    }
    next();
  };
}

module.exports = { optimizar, disponible, crearMiddleware, ANCHO_MAXIMO, CALIDAD };

const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const imagenOptimizada = require('../../services/imagenOptimizada');

// Las fotos entraban tal como salían del celular: 729 KB de promedio medidos en
// producción, algunas de 4 MB, y el cliente las descarga con datos móviles
// mientras espera en la mesa.
//
// La regla que gobierna este módulo, y la que más se prueba acá: optimizar es
// una mejora, NUNCA un requisito. Si algo falla, la foto original queda y la
// subida sigue.

function dirTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'img-'));
}

async function crearFoto(ruta, { ancho = 3000, alto = 2000 } = {}) {
  await sharp({
    create: { width: ancho, height: alto, channels: 3, background: { r: 180, g: 120, b: 60 } }
  }).jpeg({ quality: 100 }).toFile(ruta);
  return fs.statSync(ruta).size;
}

describe('optimización de imágenes', () => {
  let dir;

  beforeEach(() => { dir = dirTemporal(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('sharp está disponible en este entorno', () => {
    // Si esto falla, el resto de los tests no prueban lo que creen probar.
    expect(imagenOptimizada.disponible()).toBe(true);
  });

  test('una foto grande se achica y pesa menos', async () => {
    const ruta = path.join(dir, 'grande.jpg');
    const antes = await crearFoto(ruta, { ancho: 3000, alto: 2000 });

    const r = await imagenOptimizada.optimizar(ruta);

    expect(r.optimizada).toBe(true);
    expect(r.despues).toBeLessThan(antes);
    const meta = await sharp(ruta).metadata();
    expect(meta.width).toBe(imagenOptimizada.ANCHO_MAXIMO);
  });

  test('una foto chica NO se estira', async () => {
    // Agrandar una foto de 400px no le agrega información: sólo peso y borrosidad.
    const ruta = path.join(dir, 'chica.jpg');
    await crearFoto(ruta, { ancho: 400, alto: 300 });

    await imagenOptimizada.optimizar(ruta);

    const meta = await sharp(ruta).metadata();
    expect(meta.width).toBe(400);
  });

  test('optimizar dos veces no vuelve a tocar el archivo', async () => {
    // Recomprimir algo ya optimizado puede AGRANDARLO, y empeorar la foto del
    // negocio sería peor que no hacer nada. Además esto importa para el script
    // que convierte las fotos que ya están en el servidor: correrlo dos veces
    // tiene que ser inofensivo.
    const ruta = path.join(dir, 'dos-veces.jpg');
    await crearFoto(ruta, { ancho: 2000, alto: 1200 });

    const primera = await imagenOptimizada.optimizar(ruta);
    expect(primera.optimizada).toBe(true);
    const yaOptimizada = fs.readFileSync(ruta);

    const segunda = await imagenOptimizada.optimizar(ruta);

    expect(segunda.optimizada).toBe(false);
    expect(fs.readFileSync(ruta).equals(yaOptimizada)).toBe(true);
  });

  test('un GIF no se toca: podría ser animado', async () => {
    const ruta = path.join(dir, 'animado.gif');
    fs.writeFileSync(ruta, Buffer.from('GIF89a-contenido-falso'));
    const antes = fs.readFileSync(ruta);

    const r = await imagenOptimizada.optimizar(ruta);

    expect(r.optimizada).toBe(false);
    expect(fs.readFileSync(ruta).equals(antes)).toBe(true);
  });

  test('un archivo ilegible no lanza: devuelve que no se optimizó', async () => {
    const r = await imagenOptimizada.optimizar(path.join(dir, 'no-existe.jpg'));
    expect(r.optimizada).toBe(false);
  });

  test('un archivo que no es imagen no lanza ni lo destruye', async () => {
    // No debería llegar acá (verificarImagenes lo rechaza antes), pero si
    // llegara, lo peor sería romper la subida o dejar el archivo a medias.
    const ruta = path.join(dir, 'roto.jpg');
    fs.writeFileSync(ruta, Buffer.from('esto no es una imagen'));

    const r = await imagenOptimizada.optimizar(ruta);

    expect(r.optimizada).toBe(false);
    expect(fs.readFileSync(ruta).toString()).toBe('esto no es una imagen');
    expect(fs.existsSync(ruta + '.tmp')).toBe(false);
  });

  describe('el middleware', () => {
    const sinLog = { debug: () => {}, warn: () => {} };

    test('optimiza lo que subió multer y sigue', async () => {
      const ruta = path.join(dir, 'subida.jpg');
      const antes = await crearFoto(ruta);

      const mw = imagenOptimizada.crearMiddleware({
        logger: sinLog,
        archivosDe: () => [{ path: ruta }]
      });

      const next = jest.fn();
      await mw({}, {}, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0]).toEqual([]);
      expect(fs.statSync(ruta).size).toBeLessThan(antes);
    });

    test('si optimizar falla, la subida sigue igual', async () => {
      // La regla de oro: una foto pesada es un problema menor; una subida que
      // revienta es un negocio que no puede trabajar.
      const ruta = path.join(dir, 'inexistente.jpg');
      const mw = imagenOptimizada.crearMiddleware({
        logger: sinLog,
        archivosDe: () => [{ path: ruta }]
      });

      const next = jest.fn();
      await mw({}, {}, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0]).toEqual([]);
    });

    test('sin archivos no hace nada', async () => {
      const mw = imagenOptimizada.crearMiddleware({ logger: sinLog, archivosDe: () => [] });
      const next = jest.fn();
      await mw({}, {}, next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});

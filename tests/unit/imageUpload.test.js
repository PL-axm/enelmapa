const { detectarFormato, extensionPermitida, traducirErroresDeSubida } = require('../../services/imageUpload');
const { ValidationError } = require('../../errors');

// Cubre S6. La detección por magic bytes es la capa que de verdad decide qué
// es un archivo: extensión y mimetype los elige quien sube.
describe('detectarFormato', () => {
  const cabecera = (bytes) => Buffer.from(bytes.concat(new Array(20).fill(0)));

  test('reconoce JPEG, PNG y GIF por su firma', () => {
    expect(detectarFormato(cabecera([0xFF, 0xD8, 0xFF, 0xE0]))).toBe('jpeg');
    expect(detectarFormato(cabecera([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))).toBe('png');
    expect(detectarFormato(cabecera([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('gif');
  });

  // WebP no tiene la marca al principio: es RIFF, cuatro bytes de tamaño, y
  // recién en el byte 8 dice WEBP.
  test('reconoce WebP, que tiene la marca en el byte 8', () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP', 'ascii'),
      Buffer.alloc(8)
    ]);
    expect(detectarFormato(webp)).toBe('webp');
  });

  test('un RIFF que no es WebP no pasa', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE', 'ascii'),
      Buffer.alloc(8)
    ]);
    expect(detectarFormato(wav)).toBeNull();
  });

  // El caso que motiva todo: renombrar un HTML a .jpg y declararlo image/jpeg
  // pasa el fileFilter, pero acá se cae.
  test('un HTML disfrazado de imagen no pasa', () => {
    expect(detectarFormato(Buffer.from('<html><script>alert(1)</script>', 'ascii'))).toBeNull();
  });

  test('un SVG con script tampoco: no es un formato binario reconocido', () => {
    expect(detectarFormato(Buffer.from('<svg onload="alert(1)">', 'ascii'))).toBeNull();
  });

  test('un buffer más corto que la firma no rompe', () => {
    expect(detectarFormato(Buffer.from([0xFF]))).toBeNull();
    expect(detectarFormato(Buffer.alloc(0))).toBeNull();
  });
});

describe('extensionPermitida', () => {
  test('acepta las extensiones de imagen, sin importar mayúsculas', () => {
    for (const nombre of ['foto.jpg', 'foto.JPEG', 'foto.PNG', 'a.webp', 'a.gif']) {
      expect(extensionPermitida(nombre)).toBe(true);
    }
  });

  test('rechaza todo lo demás', () => {
    for (const nombre of ['shell.html', 'x.svg', 'x.php', 'sin-extension', '', undefined]) {
      expect(extensionPermitida(nombre)).toBe(false);
    }
  });

  // .jpg.html termina en .html, así que cae — el chequeo mira la última
  // extensión, que es la que decide cómo lo sirve el servidor web.
  test('la doble extensión se juzga por la última', () => {
    expect(extensionPermitida('foto.jpg.html')).toBe(false);
    expect(extensionPermitida('foto.html.jpg')).toBe(true);
  });
});

// Los errores de multer llegan sin statusCode, así que el handler central los
// tomaba por bugs: respondía 500 con el mensaje crudo en inglés ("File too
// large") a lo que en realidad es un error del cliente.
describe('traducirErroresDeSubida', () => {
  function traducir(err) {
    let capturado;
    traducirErroresDeSubida(err, {}, {}, (e) => { capturado = e; });
    return capturado;
  }

  test('un límite de tamaño pasa a ser un 400 con mensaje propio', () => {
    const multerErr = Object.assign(new Error('File too large'), {
      name: 'MulterError', code: 'LIMIT_FILE_SIZE'
    });
    const traducido = traducir(multerErr);

    expect(traducido).toBeInstanceOf(ValidationError);
    expect(traducido.statusCode).toBe(400);
    expect(traducido.message).toBe('La imagen supera el máximo de 5 MB');
  });

  test('un código de multer desconocido igual sale como 400', () => {
    const traducido = traducir(Object.assign(new Error('x'), {
      name: 'MulterError', code: 'CODIGO_NUEVO'
    }));

    expect(traducido.statusCode).toBe(400);
    expect(traducido.message).toBe('No se pudo procesar el archivo');
  });

  // Un error que no es de multer tiene que seguir de largo sin tocarse: si lo
  // convirtiéramos en 400, un bug real se vería como culpa del usuario.
  test('los demás errores pasan intactos', () => {
    const original = new Error('la DB explotó');
    expect(traducir(original)).toBe(original);
  });
});

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { ValidationError } = require('../errors');

// Multer aceptaba cualquier archivo, y `uploads/` se sirve estático desde el
// mismo origen que el panel. O sea que un admin podía subir un .html o un .svg
// con `<script>` y quedaba servido en enelmapa.co — XSS almacenado sobre su
// propio negocio y, por el origen compartido, sobre la sesión de cualquiera
// que abriera ese archivo (hallazgo S6).
//
// Se defiende en tres capas, porque ninguna alcanza sola:
//
//   1. `fileFilter` mira extensión y mimetype. Es lo más barato y corta el caso
//      ingenuo, pero los dos los elige el cliente: renombrar shell.html a
//      foto.jpg y declarar image/jpeg lo pasa entero.
//   2. Verificación de magic bytes DESPUÉS de escribir. Es la que de verdad
//      dice qué es el archivo. No se puede hacer en `fileFilter` porque ahí
//      todavía no se leyó el contenido — por eso el archivo se escribe y, si
//      no es una imagen real, se borra.
//   3. `nosniff` al servir `uploads/` (en app.js), para que aunque algo se
//      cuele el navegador no lo interprete como HTML.

const EXTENSIONES = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const MIMETYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Firmas reales de cada formato, leídas del principio del archivo.
const FIRMAS = [
  { tipo: 'jpeg', bytes: [0xFF, 0xD8, 0xFF] },
  { tipo: 'png', bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  { tipo: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] }
];

// Devuelve el formato detectado, o null si no es una imagen conocida.
// Función pura sobre el buffer: se puede testear sin tocar el disco.
function detectarFormato(buffer) {
  for (const { tipo, bytes } of FIRMAS) {
    if (buffer.length >= bytes.length && bytes.every((b, i) => buffer[i] === b)) {
      return tipo;
    }
  }
  // WebP es RIFF....WEBP: la marca está en el byte 8, no al principio.
  if (buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

function extensionPermitida(nombre) {
  return EXTENSIONES.includes(path.extname(nombre || '').toLowerCase());
}

function fileFilter(req, file, cb) {
  if (!extensionPermitida(file.originalname)) {
    return cb(new ValidationError('Sólo se aceptan imágenes (jpg, png, webp, gif)'));
  }
  if (!MIMETYPES.includes(file.mimetype)) {
    return cb(new ValidationError('El archivo no parece una imagen'));
  }
  cb(null, true);
}

function createUploader() {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '..', 'uploads', String(req.session.businessId));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, Date.now() + '-' + Math.random().toString(36).substring(2, 8) + ext);
    }
  });

  return multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });
}

// Capa 2. Corre después de multer: lee los primeros bytes de cada archivo
// escrito y, si no es una imagen de verdad, lo borra y corta la request.
function verificarImagenes(req, res, next) {
  const archivos = [
    ...(req.file ? [req.file] : []),
    ...Object.values(req.files || {}).flat()
  ];

  for (const archivo of archivos) {
    let cabecera;
    try {
      const fd = fs.openSync(archivo.path, 'r');
      cabecera = Buffer.alloc(12);
      fs.readSync(fd, cabecera, 0, 12, 0);
      fs.closeSync(fd);
    } catch (err) {
      return next(new ValidationError('No se pudo leer el archivo subido'));
    }

    if (!detectarFormato(cabecera)) {
      // Se borran TODOS los archivos de esta request, no sólo el ofensor: si
      // uno era falso, no hay razón para dejar a medias el resto.
      for (const a of archivos) {
        try { fs.unlinkSync(a.path); } catch (e) { /* ya no está */ }
      }
      return next(new ValidationError('El archivo no es una imagen válida'));
    }
  }

  next();
}

// Multer lanza sus propios errores (`MulterError`) sin statusCode, así que el
// error handler los tomaba por bugs: respondía 500 con el mensaje en inglés
// crudo — "File too large" — cuando en realidad son errores del cliente.
const MENSAJES_MULTER = {
  LIMIT_FILE_SIZE: 'La imagen supera el máximo de 5 MB',
  LIMIT_FILE_COUNT: 'Se subieron demasiados archivos',
  LIMIT_UNEXPECTED_FILE: 'Campo de archivo inesperado',
  LIMIT_PART_COUNT: 'El formulario tiene demasiadas partes'
};

function traducirErroresDeSubida(err, req, res, next) {
  if (err && err.name === 'MulterError') {
    return next(new ValidationError(MENSAJES_MULTER[err.code] || 'No se pudo procesar el archivo'));
  }
  next(err);
}

module.exports = {
  createUploader,
  verificarImagenes,
  traducirErroresDeSubida,
  detectarFormato,
  extensionPermitida
};

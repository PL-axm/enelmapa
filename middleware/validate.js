const { ValidationError } = require('../errors');
const { limpiarArchivosSubidos } = require('../services/imageUpload');

// Valida en el borde y reemplaza `req.body` por los datos ya coercionados, así
// los handlers reciben `price` como número y `category_id` como entero en vez
// de las cadenas que llegan del formulario. Eso es lo que les permite dejar de
// hacer `parseFloat` a mano — que era el bug B5.
//
// Se queda con el PRIMER error nada más. Zod devuelve todos, pero el panel
// muestra un solo mensaje arriba: acumularlos daría un párrafo ilegible, y el
// usuario corrige de a uno igual.
function primerMensaje(error) {
  const issue = error.issues[0];
  if (!issue) return 'Datos inválidos';

  // El nombre del campo se agrega SÓLO cuando está anidado: en
  // `hours.2.open_time` saber cuál de los siete días falló es la mitad de la
  // información. En un campo simple sería ruido — el mensaje ya dice "El
  // precio debe ser un número", y agregarle "(price)" no aporta nada y suena
  // a error de programador.
  if (issue.path.length > 1) {
    return issue.message + ' (' + issue.path.join('.') + ')';
  }
  return issue.message;
}

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      // Si la validación corre después de multer —y para los formularios con
      // imagen corre después— el archivo ya está escrito en disco. Sin esto
      // quedaría huérfano: nadie lo referencia y nadie lo borra.
      limpiarArchivosSubidos(req);
      return next(new ValidationError(primerMensaje(result.error)));
    }

    req.body = result.data;
    next();
  };
}

module.exports = validate;

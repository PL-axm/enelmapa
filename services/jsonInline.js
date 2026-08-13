// Serializa un valor para pegarlo DENTRO de un documento HTML: en un `<script>`
// o en un atributo con comillas simples. `JSON.stringify` solo no alcanza para
// eso, y las dos formas de que no alcance estaban pasando en el código:
//
// 1. `views/menu.ejs` hacía `const menuData = <%- JSON.stringify(menuData) %>`.
//    `JSON.stringify` no escapa `<` ni `/`, así que un producto llamado
//    `</script><img src=x onerror=…>` cerraba la etiqueta y ejecutaba. El nombre
//    lo escribe el dueño del negocio y la víctima era cualquier visitante de ese
//    menú, en el mismo origen que el panel.
//
// 2. `views/admin/products.ejs` hacía `onclick='editProd(<%- JSON.stringify(…) %>)'`.
//    `JSON.stringify` tampoco escapa la comilla simple, así que el valor del
//    atributo termina en el primer apóstrofo del contenido. No es teórico: la
//    descripción de "Cazuela Chidas" dice `pico e' gallo`, y el botón Editar de
//    ese producto está roto —el atributo se corta ahí— además de dejar inyectar
//    atributos nuevos.
//
// Qué se escapa y por qué:
//   <  >           cierran o abren etiquetas: matan `</script>`, `<!--`, `-->`
//   &              por si el resultado cae donde se resuelven entidades HTML
//   comilla simple delimita el atributo en la forma que usa este proyecto
//   U+2028 U+2029  son válidos dentro de un string JSON pero rompen un literal
//                  de JavaScript en parsers viejos
//
// Lo que NO se escapa, y es importante: **las comillas dobles**. En la salida de
// `JSON.stringify` son estructurales —`{"a":1}`— y reemplazarlas daría algo que
// no es JSON ni JavaScript válido. Por eso el contrato de este helper incluye la
// forma del atributo: **comillas simples**. Dentro de `onclick='…'` las dobles
// no molestan. Con un atributo de comillas dobles esto no sirve, y ese es el
// único uso incorrecto posible.
//
// Los caracteres que sí se escapan nunca aparecen de forma estructural en la
// salida de `JSON.stringify`: sólo pueden venir del contenido. Por eso el
// resultado **sigue siendo JSON válido y JavaScript válido** — `\uXXXX` es un
// escape legítimo en las dos gramáticas y el navegador reconstruye el mismo
// string. No hay que des-escapar nada del otro lado.

// Los dos separadores se construyen con `fromCharCode` en vez de escribirse como
// carácter: pegados literalmente son invisibles en el editor, y una tabla de
// escapes cuyas claves no se ven no se puede revisar ni volver a escribir.
const SEPARADOR_LINEA = String.fromCharCode(0x2028);
const SEPARADOR_PARRAFO = String.fromCharCode(0x2029);

const ESCAPES = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  "'": '\\u0027',
  [SEPARADOR_LINEA]: '\\u2028',
  [SEPARADOR_PARRAFO]: '\\u2029'
};

const PELIGROSOS = new RegExp('[<>&\'' + SEPARADOR_LINEA + SEPARADOR_PARRAFO + ']', 'g');

function jsonInline(valor) {
  return JSON.stringify(valor).replace(PELIGROSOS, (c) => ESCAPES[c]);
}

module.exports = jsonInline;

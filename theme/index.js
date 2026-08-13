const { PALETAS, VARIABLES, POR_DEFECTO } = require('./paletas');

// La cara pública de `theme/`: lo que consumen el validador, la vista de
// configuración y el menú. Los tres leen de acá, así que no puede volver a
// pasar que uno conozca una paleta que otro no.
//
// Módulo de datos puro: no importa Express, ni el pool, ni config. Se puede
// probar sin levantar nada.

function idsDePaletas() {
  return Object.keys(PALETAS);
}

function esPaletaValida(id) {
  return Object.prototype.hasOwnProperty.call(PALETAS, id);
}

// Normaliza lo que venga de la base. Un negocio guardado antes de que existiera
// una paleta —o con el `blue` que el validador dejaba pasar— cae en la de por
// defecto en vez de renderizar sin colores.
function paletaOPorDefecto(id) {
  return esPaletaValida(id) ? id : POR_DEFECTO;
}

// Las variables CSS de una paleta, listas para inyectar en un `:root`.
//
// Los valores son datos nuestros, no entrada de usuario, pero igual se filtran:
// el día que alguien agregue "color de acento personalizable" este es el único
// lugar por donde pasaría, y una llave `}` o un `<` en un valor CSS rompe el
// `<style>` y abre una inyección. Mejor que el filtro ya exista.
const VALOR_CSS_SEGURO = /^[#0-9a-zA-Z(),.%\s-]+$/;

function cssDePaleta(id) {
  const paleta = PALETAS[paletaOPorDefecto(id)];

  const declaraciones = VARIABLES
    .map((nombre) => {
      const valor = paleta.vars[nombre];
      if (!VALOR_CSS_SEGURO.test(valor)) {
        throw new Error('theme: valor CSS inválido en ' + id + ' ' + nombre + ': ' + valor);
      }
      return '    ' + nombre + ': ' + valor + ';';
    })
    .join('\n');

  return ':root {\n' + declaraciones + '\n  }';
}

// Lo que la vista de configuración necesita para pintar cada opción. Los colores
// de la muestra se DERIVAN de la paleta en vez de escribirse aparte: antes el
// `<div class="theme-option">` de settings.ejs repetía a mano el fondo y el
// texto de cada tema, o sea una cuarta copia de la misma información.
function paletasParaUI() {
  return idsDePaletas().map((id) => ({
    id,
    nombre: PALETAS[id].nombre,
    fondo: PALETAS[id].vars['--bg'],
    texto: PALETAS[id].vars['--text-primary'],
    borde: PALETAS[id].vars['--border']
  }));
}

module.exports = {
  PALETAS,
  VARIABLES,
  PALETA_POR_DEFECTO: POR_DEFECTO,
  idsDePaletas,
  esPaletaValida,
  paletaOPorDefecto,
  cssDePaleta,
  paletasParaUI
};

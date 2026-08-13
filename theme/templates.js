// Los skins disponibles. Mismo criterio que las paletas: una lista, y quien la
// necesite la lee de acá.
//
// `partial` es el nombre del archivo dentro de views/menu/. El armazón hace
// `include('menu/' + plantilla)`, y esa plantilla SIEMPRE sale de este registro
// —nunca directo de la columna de la base—: un `menu_template` con `../../algo`
// guardado a mano se convertiría en un include arbitrario. `plantillaOPorDefecto`
// es la única puerta.
//
// Sobre el nombre del segundo skin, cuando llegue: el id va a ser `grilla`, no
// `rappi`. Es marca registrada de otra empresa; como etiqueta visible en un
// producto que se le vende a restaurantes es un riesgo que no hace falta correr,
// y como identificador en el código envejece mal.

const TEMPLATES = {
  clasico: {
    nombre: 'Clásico',
    descripcion: 'Lista con foto chica a la derecha',
    partial: 'clasico'
  }
};

const POR_DEFECTO = 'clasico';

function idsDeTemplates() {
  return Object.keys(TEMPLATES);
}

function esTemplateValido(id) {
  return Object.prototype.hasOwnProperty.call(TEMPLATES, id);
}

function plantillaOPorDefecto(id) {
  return TEMPLATES[esTemplateValido(id) ? id : POR_DEFECTO].partial;
}

module.exports = {
  TEMPLATES,
  TEMPLATE_POR_DEFECTO: POR_DEFECTO,
  idsDeTemplates,
  esTemplateValido,
  plantillaOPorDefecto
};

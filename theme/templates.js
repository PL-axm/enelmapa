// Los skins disponibles. Mismo criterio que las paletas: una lista, y quien la
// necesite la lee de acá.
//
// `partial` es el nombre del archivo dentro de views/menu/. El armazón hace
// `include('menu/' + plantilla)`, y esa plantilla SIEMPRE sale de este registro
// —nunca directo de la columna de la base—: un `menu_template` con `../../algo`
// guardado a mano se convertiría en un include arbitrario. `plantillaOPorDefecto`
// es la única puerta.
//
// El id del skin en cuadrícula es `grilla` y no el nombre de la app en la que se
// inspira: esa es marca registrada de otra empresa, así que como etiqueta visible
// en un producto que se le vende a restaurantes es un riesgo que no hace falta
// correr, y como identificador en el código envejece mal.

const TEMPLATES = {
  clasico: {
    nombre: 'Clásico',
    descripcion: 'Lista con foto chica a la derecha',
    partial: 'clasico'
  },
  grilla: {
    nombre: 'Cuadrícula',
    descripcion: 'Dos columnas con foto grande arriba',
    partial: 'grilla'
  }
};

const POR_DEFECTO = 'clasico';

function idsDeTemplates() {
  return Object.keys(TEMPLATES);
}

// Para el selector del panel.
function templatesParaUI() {
  return idsDeTemplates().map((id) => ({
    id,
    nombre: TEMPLATES[id].nombre,
    descripcion: TEMPLATES[id].descripcion
  }));
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
  templatesParaUI,
  esTemplateValido,
  plantillaOPorDefecto
};

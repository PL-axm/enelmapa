// Escala tipográfica del menú: un multiplicador, no una tabla de tamaños.
//
// Por qué un factor y no un tamaño por elemento y por breakpoint. Los tamaños
// actuales ya están afinados y cambian en tres breakpoints —el nombre del
// producto es 14.5px, 14px y 13.5px según el ancho—. Una tabla con "nombre en
// compacto a 380px" sería 4 escalas × 3 breakpoints × 4 elementos = 48 números
// que alguien tiene que mantener coherentes entre sí, y la primera vez que se
// agregue un elemento hay que inventar 4 valores más.
//
// Con un factor, los tamaños afinados se quedan donde están y la escala los
// multiplica: `font-size: calc(14.5px * var(--escala))`. Los breakpoints siguen
// funcionando igual y la proporción entre nombre, descripción y precio —que es
// lo que hace que el menú se vea armado— no se puede romper por accidente.
//
// `normal` es 1 a propósito: `calc(14.5px * 1)` es exactamente 14.5px, así que
// los negocios que ya existen no ven ningún cambio. Eso además hace verificable
// la fase: con la escala por defecto, los tamaños computados tienen que ser
// idénticos a los de antes.
//
// El factor de `compacto` es 0.92 y no 0.9 por una razón medible: el tamaño de
// contenido más chico del skin es la descripción, 12px en pantallas de hasta
// 600px. Con 0.9 quedaba en 10.8px, que en un celular ya es incómodo de leer;
// con 0.92 queda en 11.04px. Ese piso de 11px no es un comentario a creer: está
// verificado en tests/unit/escalas.test.js, que lee los tamaños base del propio
// skin y los multiplica por el factor más chico. Si alguien baja un tamaño base o
// el factor, el test avisa.

const ESCALAS = {
  compacto: {
    nombre: 'Compacto',
    descripcion: 'Entra más en pantalla',
    factor: 0.92
  },
  normal: {
    nombre: 'Normal',
    descripcion: 'El tamaño de siempre',
    factor: 1
  },
  grande: {
    nombre: 'Grande',
    descripcion: 'Más fácil de leer',
    factor: 1.12
  },
  extra: {
    nombre: 'Extra grande',
    descripcion: 'Para leer sin esfuerzo',
    factor: 1.25
  }
};

const POR_DEFECTO = 'normal';

function idsDeEscalas() {
  return Object.keys(ESCALAS);
}

function esEscalaValida(id) {
  return Object.prototype.hasOwnProperty.call(ESCALAS, id);
}

function escalaOPorDefecto(id) {
  return esEscalaValida(id) ? id : POR_DEFECTO;
}

// El factor listo para inyectar. Se emite como número puro para que el `calc()`
// de cada regla lo multiplique; nunca se interpola texto que venga de la base.
function cssDeEscala(id) {
  return ':root {\n    --escala: ' + ESCALAS[escalaOPorDefecto(id)].factor + ';\n  }';
}

function escalasParaUI() {
  return idsDeEscalas().map((id) => ({
    id,
    nombre: ESCALAS[id].nombre,
    descripcion: ESCALAS[id].descripcion,
    factor: ESCALAS[id].factor
  }));
}

module.exports = {
  ESCALAS,
  ESCALA_POR_DEFECTO: POR_DEFECTO,
  idsDeEscalas,
  esEscalaValida,
  escalaOPorDefecto,
  cssDeEscala,
  escalasParaUI
};

// Fuente única de las paletas del menú público.
//
// Antes esta lista estaba escrita tres veces —el `z.enum` del validador, los
// radios de views/admin/settings.ejs y los bloques `<% if (theme === ...) %>` de
// views/menu.ejs— y se desincronizó, como era cuestión de tiempo: la vista
// ofrecía `navy`, el validador aceptaba `blue`. Elegir la quinta paleta devolvía
// 400, y `blue` se guardaba bien pero no tenía CSS, así que el menú se dibujaba
// como `light` sin que nada avisara.
//
// Se resolvió a favor de `navy`: tenía el CSS y estaba en el panel; `blue` era
// el nombre equivocado, escrito sólo en el validador.
//
// Cada paleta declara TODAS las variables, no un delta sobre `light`. Un delta
// parcial hereda en silencio, que es exactamente cómo `blue` pasaba por una
// paleta existente sin serlo. El test de coherencia exige el juego completo.
//
// `--radius` no está acá a propósito: es forma, no color, y vale igual para las
// cinco. Vive en el CSS base del menú.

const VARIABLES = [
  '--bg',
  '--bg-card',
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--accent',
  '--accent-light',
  '--border',
  '--category-bg',
  '--shadow',
  '--shadow-lg'
];

const SOMBRA_CLARA = '0 1px 3px rgba(26,26,24,0.06), 0 1px 2px rgba(26,26,24,0.04)';
const SOMBRA_CLARA_LG = '0 4px 12px rgba(26,26,24,0.08)';
const SOMBRA_OSCURA = '0 1px 3px rgba(0,0,0,0.2)';
const SOMBRA_OSCURA_LG = '0 4px 12px rgba(0,0,0,0.3)';

const PALETAS = {
  light: {
    nombre: 'Claro',
    vars: {
      '--bg': '#FAFAF7',
      '--bg-card': '#FFFFFF',
      '--text-primary': '#1A1A18',
      '--text-secondary': '#6B6860',
      '--text-muted': '#9C9889',
      '--accent': '#C8956C',
      '--accent-light': '#E8D5C4',
      '--border': '#E8E5DE',
      '--category-bg': '#F2EFEA',
      '--shadow': SOMBRA_CLARA,
      '--shadow-lg': SOMBRA_CLARA_LG
    }
  },

  dark: {
    nombre: 'Oscuro',
    vars: {
      '--bg': '#1A1917',
      '--bg-card': '#252420',
      '--text-primary': '#F0EDE6',
      '--text-secondary': '#A8A295',
      '--text-muted': '#7A7568',
      '--accent': '#D4A67D',
      '--accent-light': '#3D3428',
      '--border': '#333127',
      '--category-bg': '#2A2823',
      '--shadow': SOMBRA_OSCURA,
      '--shadow-lg': SOMBRA_OSCURA_LG
    }
  },

  cream: {
    nombre: 'Crema',
    vars: {
      '--bg': '#F5F0E8',
      '--bg-card': '#FBF8F3',
      '--text-primary': '#3D3426',
      '--text-secondary': '#6B6050',
      '--text-muted': '#9C9080',
      '--accent': '#B8834E',
      '--accent-light': '#E8D5C0',
      '--border': '#E0D8CC',
      '--category-bg': '#EDE7DC',
      '--shadow': '0 1px 3px rgba(61,52,38,0.06)',
      '--shadow-lg': '0 4px 12px rgba(61,52,38,0.08)'
    }
  },

  green: {
    nombre: 'Verde',
    vars: {
      '--bg': '#1B2E1B',
      '--bg-card': '#243024',
      '--text-primary': '#D4E6D4',
      '--text-secondary': '#9AB89A',
      '--text-muted': '#6A8A6A',
      '--accent': '#8BC48B',
      '--accent-light': '#2D422D',
      '--border': '#2E452E',
      '--category-bg': '#223222',
      '--shadow': SOMBRA_OSCURA,
      '--shadow-lg': SOMBRA_OSCURA_LG
    }
  },

  navy: {
    nombre: 'Azul noche',
    vars: {
      '--bg': '#1a1a2e',
      '--bg-card': '#222240',
      '--text-primary': '#e0e0e0',
      '--text-secondary': '#a0a0b8',
      '--text-muted': '#6a6a88',
      '--accent': '#7B8CDE',
      '--accent-light': '#2a2a50',
      '--border': '#2e2e4e',
      '--category-bg': '#202038',
      '--shadow': SOMBRA_OSCURA,
      '--shadow-lg': SOMBRA_OSCURA_LG
    }
  }
};

const POR_DEFECTO = 'light';

module.exports = { PALETAS, VARIABLES, POR_DEFECTO };

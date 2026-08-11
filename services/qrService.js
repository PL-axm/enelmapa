const QRCode = require('qrcode');

// La generación del QR estaba escrita dos veces, en routes/admin.js y en
// routes/api/index.js, con los mismos colores y el mismo armado de URL copiados
// a mano (hallazgo E3). Cambiar el color de marca en uno y olvidarse del otro
// era cuestión de tiempo, y el síntoma habría sido un QR impreso distinto al de
// la pantalla.

const OPCIONES = {
  margin: 2,
  color: { dark: '#1A1A18', light: '#FFFFFF' }
};

const TAMAÑO_POR_DEFECTO = 300;

function qrService({ config }) {
  return {
    // La URL pública del menú del negocio. Sale de config.domain, que es la
    // única fuente del dominio desde la Fase 2 — antes estaba escrito en tres
    // archivos distintos.
    menuUrl(slug) {
      return 'https://' + config.domain + '/s/' + slug;
    },

    // Devuelve la URL y el data-URL del PNG juntos: los dos consumidores
    // necesitan ambos —el panel muestra la URL debajo del código, y el JSON la
    // devuelve para el botón de descarga— y así no hay forma de que uno arme
    // una y el otro otra.
    async forSlug(slug, { size = TAMAÑO_POR_DEFECTO } = {}) {
      const url = this.menuUrl(slug);
      const dataUrl = await QRCode.toDataURL(url, { ...OPCIONES, width: size });
      return { url, dataUrl };
    }
  };
}

module.exports = qrService;
module.exports.TAMAÑO_POR_DEFECTO = TAMAÑO_POR_DEFECTO;

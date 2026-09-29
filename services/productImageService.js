const fs = require('fs');
const path = require('path');
const { ValidationError, NotFoundError } = require('../errors');

// Las decisiones sobre la galería de un producto, fuera del repositorio y fuera
// de las rutas.
//
// Hay dos invariantes que sostener, y ninguno vive en una sola tabla:
//
//   1. `products.image` es SIEMPRE la primera foto de la galería. Las tarjetas
//      del menú y los dos skins leen esa columna; si se desincroniza, la
//      tarjeta muestra una foto y la galería empieza por otra.
//   2. Ningún producto pasa del máximo de fotos.
//
// Por eso las escrituras van dentro de `withTransaction`: o queda el invariante
// entero o no queda nada. Es el mismo motivo por el que existen
// businessService.createWithDefaults y locationService.

const MAXIMO = 5;

function productImageService({ withTransaction, logger }) {
  // Borra el archivo del disco, pero sólo si NINGUNA otra fila lo usa. Dos
  // productos podrían apuntar a la misma ruta —hoy no pasa, porque cada subida
  // genera un nombre nuevo, pero un día alguien agrega "duplicar producto" y
  // entonces sí—. Borrar la foto de otro sería un daño invisible: la fila queda
  // y la imagen desaparece del menú.
  //
  // Nunca lanza: si el archivo no se puede borrar, lo peor es que ocupe disco.
  // Perder la petición por eso sería mucho peor.
  async function borrarArchivoSiNadieLoUsa(tx, businessId, imagen) {
    try {
      const enUso = await tx.productImages.forBusiness(businessId).usosDe(imagen);
      if (enUso > 0) return;

      const relativa = imagen.replace(/^\/uploads\//, '');
      const completa = path.join(__dirname, '..', 'uploads', relativa);
      // Nunca salir de uploads/: la ruta viene de la base, pero si alguna vez
      // llegara con "..", esto la deja adentro.
      const raiz = path.join(__dirname, '..', 'uploads');
      if (!path.resolve(completa).startsWith(path.resolve(raiz))) return;

      fs.unlinkSync(completa);
    } catch (err) {
      logger?.warn?.('No se pudo borrar una foto del disco', { imagen, motivo: err.message });
    }
  }

  return {
    MAXIMO,

    async agregar(businessId, productId, rutaImagen) {
      return withTransaction(async (tx) => {
        const productos = tx.products.forBusiness(businessId);
        const fotos = tx.productImages.forBusiness(businessId);

        // Se confirma que el producto es de este negocio ANTES de escribir:
        // con un id ajeno en la URL, la foto quedaría colgada de un producto
        // que no le pertenece.
        const producto = await productos.get(productId);
        if (!producto) throw new NotFoundError('Producto no encontrado');

        if (await fotos.count(productId) >= MAXIMO) {
          throw new ValidationError('Un producto puede tener hasta ' + MAXIMO + ' fotos. Quita alguna para agregar otra.');
        }

        const id = await fotos.create(productId, rutaImagen);

        // Si es la primera, también es la principal: la tarjeta del menú lee
        // products.image y quedaría sin foto.
        const total = await fotos.count(productId);
        if (total === 1) await productos.setImagenPrincipal(productId, rutaImagen);

        return { id, total };
      });
    },

    // Para el camino viejo: el formulario de producto sigue teniendo su campo
    // de imagen, y esa foto tiene que quedar TAMBIÉN como primera de la
    // galería. Si no, la tarjeta del menú mostraría una foto que la galería
    // no tiene, y al abrir el producto aparecería otra.
    //
    // No aplica el máximo a propósito: esto no es "agregar una foto más",
    // es fijar cuál es la principal, y rechazar el guardado entero del
    // producto por eso sería desproporcionado.
    async asegurarPrincipal(businessId, productId, rutaImagen) {
      return withTransaction(async (tx) => {
        const productos = tx.products.forBusiness(businessId);
        const fotos = tx.productImages.forBusiness(businessId);

        const existentes = await fotos.list(productId);
        const yaEsta = existentes.find((f) => f.image === rutaImagen);
        const id = yaEsta ? yaEsta.id : await fotos.create(productId, rutaImagen);

        await fotos.ponerPrimera(id, productId);
        await productos.setImagenPrincipal(productId, rutaImagen);
        return id;
      });
    },

    async eliminar(businessId, productId, imageId) {
      return withTransaction(async (tx) => {
        const productos = tx.products.forBusiness(businessId);
        const fotos = tx.productImages.forBusiness(businessId);

        const foto = await fotos.get(imageId);
        if (!foto || foto.product_id !== productId) {
          throw new NotFoundError('Foto no encontrada');
        }

        await fotos.delete(imageId);

        // Si se borró la principal, asciende la siguiente. Sin esto la tarjeta
        // del menú seguiría apuntando a un archivo que ya no existe: una foto
        // rota en el menú público.
        const quedan = await fotos.list(productId);
        const producto = await productos.get(productId);
        if (producto && producto.image === foto.image) {
          await productos.setImagenPrincipal(productId, quedan.length > 0 ? quedan[0].image : '');
        }

        await borrarArchivoSiNadieLoUsa(tx, businessId, foto.image);
        return { quedan: quedan.length };
      });
    },

    async hacerPrincipal(businessId, productId, imageId) {
      return withTransaction(async (tx) => {
        const productos = tx.products.forBusiness(businessId);
        const fotos = tx.productImages.forBusiness(businessId);

        const foto = await fotos.get(imageId);
        if (!foto || foto.product_id !== productId) {
          throw new NotFoundError('Foto no encontrada');
        }

        await fotos.ponerPrimera(imageId, productId);
        await productos.setImagenPrincipal(productId, foto.image);
        return true;
      });
    }
  };
}

module.exports = productImageService;

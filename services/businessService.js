const { ValidationError } = require('../errors');

// El alta de un negocio son tres escrituras: el negocio, su admin y sus siete
// horarios. Hasta ahora iban sueltas, y eso dejaba un agujero concreto —
// reproducido contra enelmapa_dev: si el email del admin ya existía, el negocio
// quedaba creado sin admin ni horarios y con el slug ocupado. El operador ni
// podía reintentar con el mismo slug, y el negocio quedaba inaccesible.
//
// Acá las tres van dentro de `withTransaction`, así que o entran las tres o no
// entra ninguna. Es el motivo por el que la costura se construyó en la Fase 4:
// los repos reciben un ejecutor, así que `tx` es el mismo juego de repos atado
// a la conexión de la transacción.

function businessService({ repos, withTransaction, auth }) {
  return {
    // Devuelve el id del negocio creado. Lanza ValidationError si el slug o el
    // email ya están tomados — son errores del formulario, no bugs, y quien
    // llama los muestra sobre el formulario.
    async createWithDefaults({ business, admin }) {
      // Se chequea antes para poder dar un mensaje preciso sobre qué slug
      // choca. No reemplaza al UNIQUE de la base: entre este SELECT y el
      // INSERT hay una ventana, y si dos altas simultáneas la cruzan, el que
      // pierda cae en el catch de abajo. El chequeo es por el mensaje, la
      // garantía es de la base.
      if (await repos.businesses.platform.slugExists(business.slug)) {
        throw new ValidationError('El slug "' + business.slug + '" ya existe');
      }

      try {
        return await withTransaction(async (tx) => {
          const businessId = await tx.businesses.platform.create(business);

          await tx.users.forBusiness(businessId).create({
            email: admin.email,
            passwordHash: auth.hashPassword(admin.password),
            name: admin.name
          });

          await tx.businesses.platform.createDefaultHours(businessId);

          return businessId;
        });
      } catch (err) {
        // El UNIQUE que salta es `users.email` o `businesses.slug`. La
        // transacción ya revirtió todo, así que no queda nada a medias: lo
        // único que falta es traducir el error de MySQL a algo que el operador
        // pueda entender y corregir.
        if (err.code === 'ER_DUP_ENTRY') {
          throw new ValidationError(
            err.message.includes('email')
              ? 'Ya existe un usuario con el email "' + admin.email + '"'
              : 'El slug "' + business.slug + '" ya existe'
          );
        }
        throw err;
      }
    }
  };
}

module.exports = businessService;

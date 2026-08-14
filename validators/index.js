const { z } = require('zod');
const tema = require('../theme');

// Hasta acá no había ninguna validación de entrada (hallazgo E5): lo que
// mandaba el cliente llegaba tal cual al SQL. Los síntomas eran tres:
//
//   B5 — `parseFloat(price)` sin chequear NaN: un precio no numérico llegaba
//        como NaN a la columna DECIMAL y MySQL respondía con un error, o sea
//        un 500 por un dato mal escrito.
//   S7 — el `slug` se escribía sin validar formato ni longitud. Es la
//        dirección pública del negocio y su subdominio.
//   E5 — todo lo demás: nombres vacíos, campos larguísimos, JSON malformado.
//
// Los esquemas COERCIONAN a propósito. Los formularios llegan por multipart o
// urlencoded, así que todo entra como texto: sin coerción, `price` sería la
// cadena "20000" y `category_id` la cadena "3". El middleware reemplaza
// `req.body` por los datos ya convertidos, así que los handlers dejan de
// hacer `parseFloat` y `Number` a mano.

const texto = (max, campo) => z
  .string({ message: campo + ' es obligatorio' })
  .trim()
  .min(1, campo + ' no puede estar vacío')
  .max(max, campo + ' no puede tener más de ' + max + ' caracteres');

const textoOpcional = (max) => z.string().trim().max(max).optional().default('');

// Un precio es un número finito y no negativo. Se acepta 0 (hay productos de
// cortesía) pero no negativos ni NaN — que era el bug.
const precio = z.coerce
  .number({ message: 'El precio debe ser un número' })
  .finite('El precio debe ser un número')
  .nonnegative('El precio no puede ser negativo')
  .max(99999999.99, 'El precio es demasiado alto');

const idPositivo = (campo) => z.coerce
  .number({ message: campo + ' inválido' })
  .int(campo + ' inválido')
  .positive(campo + ' inválido');

// `www` y `admin` los excluye getSubdomain() para reservarlos a la plataforma,
// así que un negocio con esos slugs quedaría INALCANZABLE por subdominio: la
// URL existiría pero resolvería a la home. Los demás se reservan por las
// mismas razones antes de que alguien los pida.
// (No hace falta listar 's': el mínimo de 2 caracteres ya lo hace imposible, y
// listarlo sugeriría una protección que no está haciendo nada.)
const SLUGS_RESERVADOS = ['www', 'admin', 'api', 'app', 'mail', 'ftp', 'superadmin', 'uploads'];

const slug = z
  .string({ message: 'El slug es obligatorio' })
  .trim()
  .toLowerCase()
  .min(2, 'El slug necesita al menos 2 caracteres')
  .max(100, 'El slug no puede tener más de 100 caracteres')
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'El slug sólo admite minúsculas, números y guiones, sin empezar ni terminar con guión'
  )
  .superRefine((v, ctx) => {
    if (SLUGS_RESERVADOS.includes(v)) {
      ctx.addIssue({
        code: 'custom',
        message: 'El slug "' + v + '" está reservado por la plataforma'
      });
    }
  });

// Los checkbox de HTML no se envían cuando están desmarcados: la presencia del
// campo ES el valor. Por eso "ausente" significa false y no "sin especificar".
const checkbox = z.any().optional().transform((v) => (v ? 1 : 0));

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (formato HH:MM)');

// === promociones ===
//
// El precio promocional es opcional y su AUSENCIA es el interruptor: sin precio
// no hay promo. El formulario manda '' cuando el campo está vacío, y '' en una
// columna DECIMAL es 0, o sea "gratis" — por eso vacío se convierte en `null`
// explícito y no se deja pasar tal cual.
const precioPromo = z
  .union([z.literal(''), z.coerce.number()])
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : v))
  .superRefine((v, ctx) => {
    if (v === null) return;
    if (!Number.isFinite(v)) {
      ctx.addIssue({ code: 'custom', message: 'El precio promocional debe ser un número' });
      return;
    }
    if (v < 0) {
      ctx.addIssue({ code: 'custom', message: 'El precio promocional no puede ser negativo' });
    }
  });

// Fecha opcional en formato YYYY-MM-DD, que es lo que manda un <input type=date>.
// Vacío es `null`: "sin fecha de inicio" y "sin vencimiento" son estados
// válidos y significan "desde siempre" y "para siempre".
const fechaOpcional = z
  .union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (formato AAAA-MM-DD)')])
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : v));

// Los días activos, un carácter por día, posición 0 = Domingo.
//
// `'0000000'` se RECHAZA: es una promo que nunca se va a mostrar. Guardarla
// dejaría al dueño mirando un producto con precio promocional que no aparece en
// ningún lado, sin nada que se lo explique. Vacío o ausente se normaliza a todos
// los días, que es lo que espera quien cargó un precio y no tocó los días.
const diasPromo = z
  .union([z.literal(''), z.string().regex(/^[01]{7}$/, 'Los días de la promoción son inválidos')])
  .optional()
  .transform((v) => (v === '' || v === undefined ? '1111111' : v))
  .superRefine((v, ctx) => {
    if (v === '0000000') {
      ctx.addIssue({
        code: 'custom',
        message: 'La promoción tiene que estar activa al menos un día de la semana'
      });
    }
  });

// Las reglas que cruzan campos, aplicadas al objeto entero. Van en un helper
// porque valen igual para crear y para editar un producto.
function refinarPromo(datos, ctx) {
  if (datos.promo_price === null) return;

  // Una promo más cara que el precio normal es un error de carga, y si se guarda
  // el menú muestra un tachado absurdo: "$20.000" tachado y "$25.000" al lado.
  if (datos.promo_price >= datos.price) {
    ctx.addIssue({
      code: 'custom',
      path: ['promo_price'],
      message: 'El precio promocional tiene que ser menor que el precio normal'
    });
  }

  if (datos.promo_from && datos.promo_to && datos.promo_from > datos.promo_to) {
    ctx.addIssue({
      code: 'custom',
      path: ['promo_to'],
      message: 'La fecha de fin no puede ser anterior a la de inicio'
    });
  }
}

// Sin precio promocional, el resto de los campos de promo no significan nada.
// Se limpian en vez de guardarse: una ventana de fechas sin precio es basura que
// después nadie sabe interpretar, y peor, reaparece si alguien vuelve a poner un
// precio sin mirar las fechas viejas.
function limpiarPromoVacia(datos) {
  if (datos.promo_price === null) {
    return { ...datos, promo_label: '', promo_from: null, promo_to: null, promo_days: '1111111' };
  }
  return datos;
}

// `hours` llega como un string JSON dentro del formulario. Antes se parseaba
// con un try/catch en el handler y no se validaba el contenido.
const horarios = z
  .string()
  .transform((raw, ctx) => {
    try {
      return JSON.parse(raw);
    } catch (err) {
      ctx.addIssue({ code: 'custom', message: 'El campo "hours" no es JSON válido' });
      return z.NEVER;
    }
  })
  .pipe(z.array(z.object({
    day_index: z.coerce.number().int().min(0).max(6),
    open_time: hora,
    close_time: hora,
    is_closed: z.any().optional().transform((v) => (v ? 1 : 0))
  })).max(7, 'No puede haber más de 7 días'))
  .optional();

const schemas = {
  // === categorías ===
  categoryName: z.object({
    name: texto(255, 'El nombre')
  }),

  // El array de ids que manda el drag-and-drop.
  reorder: z.object({
    order: z.array(idPositivo('Id'), { message: 'Se esperaba un array "order"' })
      .max(500, 'Demasiados elementos para reordenar')
  }),

  // === productos ===
  productCreate: z.object({
    name: texto(255, 'El nombre'),
    description: textoOpcional(5000),
    price: precio,
    category_id: idPositivo('La categoría'),
    promo_price: precioPromo,
    promo_label: textoOpcional(40),
    promo_from: fechaOpcional,
    promo_to: fechaOpcional,
    promo_days: diasPromo
  }).superRefine(refinarPromo).transform(limpiarPromoVacia),

  productUpdate: z.object({
    name: texto(255, 'El nombre'),
    description: textoOpcional(5000),
    price: precio,
    category_id: idPositivo('La categoría'),
    // Ausente significa activo, y sólo el '0' explícito lo desactiva: es la
    // semántica que ya tenía el formulario.
    is_active: z.any().optional().transform((v) => v !== '0'),
    promo_price: precioPromo,
    promo_label: textoOpcional(40),
    promo_from: fechaOpcional,
    promo_to: fechaOpcional,
    promo_days: diasPromo
  }).superRefine(refinarPromo).transform(limpiarPromoVacia),

  // === ajustes del negocio (el dueño) ===
  settings: z.object({
    name: texto(255, 'El nombre'),
    address: textoOpcional(500),
    phone: textoOpcional(50),
    whatsapp: textoOpcional(50),
    instagram: textoOpcional(100),
    facebook: textoOpcional(100),
    tiktok: textoOpcional(100),
    is_open: checkbox,
    // La lista sale de `theme/`, no escrita a mano: cuando estaba acá y también
    // en la vista y también en el CSS del menú, se desincronizó — el panel
    // ofrecía `navy` y esto aceptaba `blue`, así que la quinta paleta devolvía
    // 400 y `blue` se guardaba sin tener CSS.
    menu_theme: z.enum(tema.idsDePaletas()).optional().default(tema.PALETA_POR_DEFECTO),
    menu_template: z.enum(tema.idsDeTemplates()).optional().default(tema.TEMPLATE_POR_DEFECTO),
    menu_scale: z.enum(tema.idsDeEscalas()).optional().default(tema.ESCALA_POR_DEFECTO),
    promos_enabled: checkbox,
    // El flyer se reemplaza subiendo otro, pero también tiene que poder QUITARSE:
    // la promoción termina y la lámina baja. Banner y logo hoy sólo se pueden
    // reemplazar, y para ellos alcanza; para un flyer no.
    quitar_flyer: checkbox,
    hours: horarios
  }),

  // === negocios (el superadmin) ===
  businessCreate: z.object({
    slug,
    name: texto(255, 'El nombre del negocio'),
    address: textoOpcional(500),
    phone: textoOpcional(50),
    whatsapp: textoOpcional(50),
    instagram: textoOpcional(100),
    facebook: textoOpcional(100),
    tiktok: textoOpcional(100),
    admin_email: z.string().trim().toLowerCase().email('El email del admin no es válido'),
    admin_password: z.string().min(8, 'La contraseña del admin necesita al menos 8 caracteres'),
    admin_name: textoOpcional(255)
  }),

  businessEdit: z.object({
    slug,
    name: texto(255, 'El nombre del negocio'),
    address: textoOpcional(500),
    phone: textoOpcional(50),
    whatsapp: textoOpcional(50),
    instagram: textoOpcional(100),
    facebook: textoOpcional(100),
    tiktok: textoOpcional(100),
    is_open: checkbox
  }),

  resetPassword: z.object({
    new_password: z.string().min(8, 'La contraseña necesita al menos 8 caracteres')
  })
};

module.exports = { schemas, SLUGS_RESERVADOS };

# Modelo de negocio — enelmapa

Este documento describe el modelo de negocio **tal como está implementado en el producto**, derivado de la funcionalidad existente en el código. No incluye precios, costos ni proyecciones financieras porque esa información no existe en este repositorio.

## Qué es

**enelmapa** es una plataforma SaaS multi-tenant de **menús digitales** para negocios de comida y bebida (cafés, restaurantes). Cada negocio obtiene una página de menú pública, accesible por QR o URL, que reemplaza al menú físico impreso.

## Los tres roles del negocio

| Rol | Quién es | Qué puede hacer | Dónde vive en el código |
|---|---|---|---|
| **Cliente final** | Comensal que escanea el QR en la mesa | Solo ver el menú (categorías, productos, precios, horarios, redes sociales) — sin login | Menú público (`/s/:slug` o subdominio) |
| **Admin del negocio** | Dueño/encargado de un café o restaurante | Gestiona **su propio** negocio: categorías, productos (con foto), precios, horarios, redes sociales, banner/logo, tema del menú, y genera su QR | `/admin` |
| **Superadmin** | Operador de la plataforma (enelmapa como empresa) | Da de alta negocios nuevos, edita cualquiera, resetea contraseñas de admins, borra negocios | `/superadmin` |

Esta separación de roles es la base del modelo: **enelmapa vende/opera la infraestructura**, cada **negocio administra su propio contenido**, y el **cliente final consume gratis**.

## Cómo se provee un negocio (onboarding)

No hay registro de autoservicio (self-signup). El alta de un nuevo negocio la hace el superadmin manualmente desde `/superadmin/create`, ingresando:
- `slug` (identificador único, define la URL/subdominio del negocio)
- Datos del negocio (nombre, dirección, teléfono, WhatsApp, redes sociales)
- Credenciales del primer usuario admin de ese negocio

Esto indica un modelo **operado/asistido** (onboarding manual, tipo "agencia" o "servicio gestionado"), no un producto self-service de "crea tu cuenta y empieza gratis". Encaja con negocios pequeños que probablemente no configurarían esto sin ayuda.

## Identidad y descubrimiento de cada negocio

Cada negocio es direccionable de dos formas:
- **Subdominio**: `<slug>.enelmapa.co` — la URL "de marca" pensada para imprimir en el QR de la mesa.
- **Ruta**: `enelmapa.co/s/<slug>` — alternativa sin necesidad de configurar DNS/subdominio, útil para arranque rápido o negocios sin dominio propio.

Esto sugiere que la entrega del "producto" a cada cliente (negocio) es tan simple como un slug + un QR impreso, sin necesidad de que el negocio tenga su propia web.

## Propuesta de valor por rol

- **Para el negocio**: evita reimprimir el menú cada vez que cambian precios o platos; permite abrir/cerrar el local (`is_open`) y mostrarlo en el menú; centraliza WhatsApp/Instagram/Facebook/TikTok en un solo lugar que el cliente ve al consultar el menú.
- **Para el cliente final**: acceso inmediato al menú actualizado desde su celular vía QR, sin descargar nada.
- **Para enelmapa (la plataforma)**: un panel único (`/superadmin`) para administrar de forma centralizada una cartera creciente de negocios/clientes.

## Qué construye hoy la plataforma (funcionalidades reales)

- CRUD de categorías y productos por negocio, con reordenamiento (drag-and-drop vía `sort_order`) y activación/desactivación de productos sin borrarlos.
- Subida de imágenes (producto, banner, logo) por negocio.
- Horarios de atención por día de la semana, editables por el propio negocio.
- Generación de código QR apuntando al menú del negocio, descargable/reimprimible.
- Selección de tema visual del menú (`menu_theme`).
- Indicador de negocio abierto/cerrado.

## Lo que el modelo de negocio *no* resuelve todavía (huecos visibles en el código)

Estos son puntos donde el producto actual no tiene soporte — relevante si se va a documentar o decidir el modelo de negocio real de la empresa:

- **Sin cobros ni planes**: no hay tablas ni rutas de facturación, suscripción, ni límites por plan (todo negocio tiene las mismas capacidades ilimitadas).
- **Sin autoservicio**: no existe un flujo de "regístrate y crea tu negocio" para el cliente final del negocio; todo pasa por el superadmin.
- **Sin analítica**: no se registran vistas del menú, clics en productos, ni conversión a WhatsApp — no hay forma de mostrarle al negocio "cuánta gente vio tu menú".
- **Un usuario admin no está limitado a uno por negocio** por el modelo de datos (`users.business_id`), pero no hay UI para invitar/gestionar múltiples usuarios de un mismo negocio desde `/admin` (solo el superadmin puede crear usuarios, vía alta de negocio o edición).
- **Sin soporte multi-sucursal**: cada negocio es una única entidad `businesses`; una marca con varias sedes necesitaría un slug (y URL) separado por sede.

## Flujo típico end-to-end

1. Superadmin da de alta el negocio y su primer usuario admin.
2. El negocio entra a `/admin`, carga categorías, productos con fotos y precios, horarios y redes.
3. El negocio genera su QR desde `/admin/qr` y lo imprime/coloca en mesas.
4. El cliente final escanea el QR → ve el menú público, actualizado en tiempo real por el negocio, sin intervención de enelmapa.

# Plan — skins/templates de menú y promociones con vigencia

Decidido el 2026-08-11, después de cerrar el refactor de arquitectura (`main` en
`fdc9b38`). Se apoya en `plans/refactor-arquitectura-repository-di.md`.

**Reglas que gobiernan cada fase** (de `WORKFLOW.md`, `QA_CHECKLIST.md` y el
skill `enelmapa-dev`): una rama por fase, mergeable y verificable sola; `npm test`
en verde contra `enelmapa_test`; `QA_CHECKLIST.md` completo; **verificación del
front en navegador**; ninguna fase puede romper nada, ni back ni front. Todo se
prueba en localhost contra `enelmapa_dev`, **nunca contra producción**, ni
siquiera para leer, y siempre se declara contra qué base se corrió.

Por tamaño y por área tocada (schema, multi-tenancy, todos los tenants a la vez),
esto es **team mode** según el paso 1 del flujo del skill: plan profundo con
alternativas y trade-offs, no fullstack mode.

## Qué se pidió

1. Que la vista actual del menú pase a ser **un skin/template**, no *la* vista.
2. Tener **varios** skins. El actual es uno; el segundo muestra los productos en
   grilla de dos columnas con foto grande, estilo app de delivery.
3. Que en cada skin se pueda personalizar **tamaño de títulos, descripciones y
   demás**, y algunos **colores**.
4. Una **sección de promociones** de productos, **al principio del menú**, que se
   pueda habilitar o no. Las promos pueden ser **fijas, por semana o por mes**.
5. **El dueño de cada menú cambia el skin** desde su panel.

Decisiones tomadas con el usuario antes de escribir esto:

- **Promoción** = precio promocional sobre un producto que ya existe, con
  vigencia. No hay entidad "promo" independiente: nada de 2x1 sueltos sin
  producto detrás.
- **Vigencia = ventana de fechas + días de la semana**, las dos cosas. Permite
  "todo septiembre", "esta semana", "todos los martes" y "todo septiembre pero
  sólo martes y jueves".
- **Personalización por presets**: escala de tamaños de 3-4 opciones que mueve
  todo proporcionalmente, más las paletas ya armadas. No hay sliders por
  elemento ni color libre.
- **Skin en grilla de 2 columnas**, no tarjetas de ancho completo.
- **El dueño elige el skin**, en Configuración, igual que hoy elige la paleta.

## Punto de partida real (verificado en el código, no de memoria)

`views/menu.ejs` son 398 líneas en un solo archivo: `<style>` con todo el CSS, el
HTML del chrome (banner, header, nav de categorías, buscador, modal de producto,
modal de info, FAB de WhatsApp) y un `<script>` que **renderiza el menú entero en
el cliente** desde un `menuData` inyectado inline.

Tres consecuencias que mandan sobre el diseño:

- **Lo que hoy llamamos "tema" son sólo colores.** `menu_theme` cambia un bloque
  de variables CSS (`--bg`, `--accent`, …). No toca layout ni tipografía. Un
  "skin" en el sentido que se pidió es **layout**: son dos ejes distintos y hay
  que modelarlos separados, no meter el layout en la misma columna.
- **El producto se dibuja en JavaScript, dos veces**: una en el render del menú
  (con `textContent`) y otra en los resultados de búsqueda (con `innerHTML`, ver
  bugs). Un segundo layout sin unificar eso serían cuatro copias de la tarjeta.
- **El CSS va inline por página**, sin hoja compartida — convención del proyecto
  (`SKILL.md`). Los skins la respetan: cada uno trae su `<style>`. Para una
  página de menú además conviene: una sola request, primer pintado inmediato.

### Cuatro bugs que aparecieron mirando esto

Entran al plan porque están en el camino, no como desvío.

1. **La quinta paleta no se puede guardar.** `views/admin/settings.ejs` ofrece
   `navy`; `validators/index.js` acepta `['light','dark','cream','green','blue']`.
   **Reproducido contra `enelmapa_dev`**: `light`/`dark`/`cream`/`green`/`blue`
   → 200, `navy` → 400. Y al revés, `blue` pasa la validación pero no tiene
   bloque CSS en `menu.ejs`, así que se guarda y el menú se dibuja como `light`,
   en silencio.

   La causa no es el typo: **la lista de paletas está escrita tres veces**
   (validador, vista de configuración, CSS del menú). Cualquier arreglo puntual
   se vuelve a desincronizar. Por eso la Fase 1 es una fuente única.

2. **XSS por ruptura del `<script>`.** `menu.ejs:278` hace
   `const menuData = <%- JSON.stringify(menuData) %>;`. `<%-` es salida cruda y
   `JSON.stringify` no escapa `<` ni `/`, así que un producto llamado
   `</script><img src=x onerror=…>` cierra la etiqueta y ejecuta. El nombre lo
   escribe el dueño del negocio y la víctima es **cualquier visitante de ese
   menú**, en el mismo origen que el panel. Certeza por inspección del código;
   la reproducción con payload va como test de regresión en la Fase 1.

3. **XSS en los resultados de búsqueda.** `menu.ejs:348` arma la tarjeta con
   `info.innerHTML = '<div class="product-name">' + p.name + …`. El render
   principal usa `textContent` y está bien; el de búsqueda no. Se cierra al
   unificar el constructor de tarjeta (Fase 2), que es la razón de fondo para
   unificarlo.

4. **`SKILL.md` describe la arquitectura anterior al refactor** y contradice al
   código en lo que más importa. Dice que el filtro `business_id` es manual en
   cada query y que "no hay repository que lo fuerce" (regla no-negociable #3),
   que la sesión usa `MemoryStore` (#4), que no hay capa de servicio, y que no
   hay CSRF ni rate-limiting ni validación de mimetype ni de precio. Nada de eso
   sigue siendo cierto. Seguir el skill tal como está hoy lleva a escribir SQL
   manual en las rutas — exactamente lo que los repositories vinieron a impedir.
   Es la Fase 0.

## Modelo de datos

Tres columnas nuevas en `businesses` y cinco en `products`. Todas nulables o con
default: la migración es un no-op para los negocios existentes.

```sql
-- businesses
menu_template  VARCHAR(20) DEFAULT 'clasico'   -- layout (skin)
menu_scale     VARCHAR(20) DEFAULT 'normal'    -- escala tipográfica
promos_enabled TINYINT     DEFAULT 0           -- la sección se muestra o no

-- products
promo_price DECIMAL(12,2) NULL DEFAULT NULL    -- NULL = sin promo configurada
promo_label VARCHAR(40)   DEFAULT ''           -- etiqueta opcional: "-30%", "2x1"
promo_from  DATE          NULL DEFAULT NULL    -- NULL = sin fecha de inicio
promo_to    DATE          NULL DEFAULT NULL    -- NULL = sin vencimiento
promo_days  CHAR(7)       DEFAULT '1111111'    -- días activos, posición 0 = Domingo
```

Decisiones y por qué:

- **`menu_theme` no se renombra.** Sería más claro `menu_palette`, pero está en
  producción, en el repositorio, en el validador, en dos vistas y en tests. El
  rename cuesta una migración sobre datos vivos y no compra nada funcional. Se
  queda, documentado como "paleta" en `CLAUDE.md`.
- **`promo_price NULL` es el interruptor de la promo**, no una columna
  `promo_active` aparte: dos fuentes para el mismo hecho terminan
  contradiciéndose. `NULL` y no `0` porque `0` es un precio válido (una
  cortesía, un acompañamiento).
- **`promo_days` es `CHAR(7)` de `'0'`/`'1'`, no un bitmask.** Un `TINYINT` con
  bits es más compacto y ahí termina la ventaja: `'0010100'` se lee de un
  `SELECT` sin hacer cuentas, y en un bug de producción a las once de la noche
  eso vale más que tres bytes. **La posición 0 es Domingo**, igual que
  `business_hours.day_index` (ver `DAYS` en `businessRepository.js:156`) e igual
  que `Date.getDay()`. Una segunda convención de días en la misma base sería
  garantía de un bug de corrimiento.
- **`'0000000'` no es un estado válido** — es una promo que nunca se muestra, o
  sea una trampa. El validador lo rechaza; vacío o ausente se normaliza a
  `'1111111'`.
- **`promos_enabled` está en el negocio**, y es el "habilitada o no" que se
  pidió: apaga la sección sin borrar los precios promocionales cargados.
- **Un producto en promo sigue apareciendo en su categoría**, además de en la
  sección. Quien navega "Entradas" tiene que seguir viéndolo: la sección es un
  atajo, no una mudanza.
- **Una promo vencida no se borra.** El dato queda; simplemente no se muestra.
  Así el dueño reactiva la promo del mes pasado cambiando una fecha en vez de
  volver a cargar todo.

### El reloj: la parte delicada de esto

Hoy **la app no evalúa tiempo en ningún lado**. `business_hours` guarda strings
(`'07:30'`) que sólo se muestran, y `is_open` es una bandera manual. Las promos
con vigencia son la primera lógica que depende de qué día es, y eso trae tres
decisiones que conviene tomar acá y no improvisar en el handler:

- **Se evalúa en el servidor, no en el cliente.** El reloj del visitante está
  fuera de nuestro control y suele estar mal; y una promo que aparece según la
  hora del teléfono es imposible de soportar.
- **En la zona horaria del negocio, no en UTC.** El servidor puede correr en UTC:
  ahí "hoy" cambia a las 7 de la tarde hora Colombia, así que una promo que
  vence "el 31" se apagaría el 30 a las 19:00 para todo el mundo. Se resuelve
  con `America/Bogota` explícito vía `Intl.DateTimeFormat` — nunca restando 5
  horas a mano. La zona va en `config/` como constante documentada: hoy todos
  los clientes son colombianos, y cuando eso deje de ser cierto el cambio es una
  columna en `businesses` y un solo lugar donde leerla.
- **La fecha entra como parámetro, no se lee adentro.** `menuService` es una
  función pura y tiene que seguir siéndolo: `buildMenu({ ..., hoy })`. Un
  `new Date()` adentro haría que los tests dependan del día en que se corren —
  un test de "promo de martes" que pasa hoy y falla el jueves es peor que no
  tenerlo. La fecha la calcula el router y la inyecta.

Consecuencia a anotar para el futuro: el menú público pasa a **depender del
día**. Hoy no hay cache ni CDN, así que no cambia nada; el día que se ponga uno,
la fecha tiene que entrar en la clave de cache.

### Validación (`validators/index.js`, zod)

Con `superRefine` donde el mensaje depende de otro campo, igual que ya se hace
para los horarios:

- `promo_price` opcional, `>= 0` y **estrictamente menor que `price`**. Una promo
  más cara que el precio normal es un error de carga, y si se guarda el menú
  muestra un tachado absurdo.
- `promo_from <= promo_to` cuando están las dos.
- `promo_days`: exactamente 7 caracteres `0`/`1`, y no todos `0`.
- **Sin `promo_price` se limpia todo lo demás.** Una ventana de fechas sin precio
  es basura que después nadie entiende.

## Arquitectura de los skins

### La fuente única (mata el bug 1 por construcción)

Un módulo de datos, sin Express y sin EJS, con tests propios:

```
theme/
  paletas.js    -> { light: {vars}, dark: {vars}, cream: {...}, ... }
  escalas.js    -> { compacto: {vars}, normal: {vars}, grande: {...} }
  templates.js  -> [{ id: 'clasico', nombre: 'Clásico', partial: 'clasico' }, ...]
  index.js      -> ids(), varsCss(paleta), esValido(id), ...
```

Tres consumidores, una lista:

- el **validador** construye su `z.enum` desde `Object.keys(paletas)`;
- la **vista de configuración** itera la lista para pintar las opciones;
- el **menú** emite las variables CSS desde el mismo objeto.

Test que cierra la puerta: *para cada paleta declarada existen sus variables, y
el enum del validador es exactamente esa lista*. Con eso, un `navy` sin CSS o un
`blue` sin opción en el panel rompe la suite en vez de romperse en producción.

### El contrato de un skin

`views/menu.ejs` pasa a ser el **armazón**: head, variables de paleta y escala,
chrome compartido (banner, header, nav, buscador, modales, footer, FAB) y el
script que maneja navegación, scroll-spy, búsqueda y modal. De ahí incluye el
skin:

```
views/menu/
  clasico.ejs   -> su <style> + su window.SKIN
  grilla.ejs    -> ídem
```

Cada skin expone **una sola cosa**:

```js
window.SKIN = {
  tarjetaProducto(p) { /* devuelve un elemento del DOM */ },
  contenedorCategoria() { /* opcional: lista vs grilla */ }
};
```

El armazón llama a eso desde el render del menú **y desde la búsqueda**. Un
único constructor de tarjeta, que arma nodos y usa `textContent`: ahí se cierra
el bug 3, y ahí es donde el badge de promo se implementa una vez.

`services/menuService.js` no se entera de skins. Sigue siendo una función pura;
sólo cambia su salida para incluir promos.

**Sobre el nombre**: el id interno es `grilla`, no `rappi`, y en la UI
"Cuadrícula" o "Estilo delivery". Rappi es marca registrada de otra empresa: como
etiqueta visible en un producto que se le vende a restaurantes es un riesgo
innecesario, y como identificador en el código envejece mal.

### Dónde encaja cada cosa en la arquitectura actual

Para que ninguna fase invente una capa nueva ni saltee una existente:

| Qué | Dónde va |
|---|---|
| Paletas, escalas, templates | `theme/` (datos puros, sin dependencias) |
| ¿Está activa esta promo hoy? | `services/menuService.js`, función pura |
| Armado de `menuData` + promos | `services/menuService.js` |
| Columnas nuevas de `businesses` | `TENANT_FIELDS` de `businessRepository` |
| Columnas nuevas de `products` | `productRepository.forBusiness(id).update` |
| Reglas de entrada | `validators/index.js` + `middleware/validate.js` |
| Fecha de hoy en Bogotá | la calcula el router, la inyecta al servicio |
| Zona horaria | constante en `config/`, leída en un solo lugar |
| Schema | `db/migrations/004_promociones.sql` (+ `005` si hace falta) |
| Mutaciones del panel | `routes/api/index.js`, nunca `routes/admin.js` |

Nada de SQL en rutas, nada de `process.env` fuera de `config/`, nada de
`try/catch` + `res.status(500)` en un handler (para eso están `asyncHandler` y
`errors/`), y toda mutación nueva pasa por CSRF porque el middleware es global.

## Fases

Una rama por fase, cada una mergeable y verificable sola.

### Fase 0 — Poner el skill y la doc al día ✅

Sólo documentación, sin código. Va primero porque es lo que hace que las fases
siguientes se escriban contra la arquitectura real.

- `SKILL.md`: reescribir las reglas no-negociables #3 y #4 (hoy dicen lo
  contrario de lo que hace el código), sacar de "qué NO es un bug" lo que ya se
  arregló (capa de servicio, CSRF, rate limiting, mimetype, validación), y
  actualizar el resumen de una línea.
- Revisar de paso las dos líneas obsoletas de `QA_CHECKLIST.md`: el arranque en
  frío justificado "por MemoryStore" y el "no hay error-handler centralizado".
  Los pasos siguen valiendo; el motivo escrito al lado envejeció.
- **Criterio de aceptación**: ninguna afirmación del skill contradice al código.
  Se verifica una por una, no en bloque.

### Fase 1 — Fuente única del tema + los dos XSS ✅

Sin cambio visual. Es la más chica y arregla lo que ya está roto.

- `theme/` con paletas, escalas y templates como datos + tests de coherencia.
- Validador y `views/admin/settings.ejs` leyendo de ahí. Se resuelve
  `navy`/`blue`: se define cuál es y queda una sola lista.
- `menuData` deja de poder romper el `<script>`: se escapa `<` como `<`, o
  se pasa por `<script type="application/json">` + `JSON.parse`. Test de
  regresión con un producto llamado `</script><img src=x onerror=…>`.
- **Criterio de aceptación**: las 5 paletas se guardan y se ven; el menú de El
  Silvestre queda idéntico al de antes.

### Fase 2 — Extraer el skin actual ✅

Refactor puro, riesgo concentrado en el front.

- `menu.ejs` → armazón + `views/menu/clasico.ejs`.
- Contrato `window.SKIN`, con la búsqueda usando el mismo constructor (cierra el
  bug 3).
- `menu_template` en la migración, con `clasico` por default. Todavía sin segundo
  skin.
- **Criterio de aceptación**: capturas antes/después **idénticas** en las 5
  paletas y en los tres breakpoints (380 / 600 / 901+). Si algo se corrió un
  píxel, no está terminada. Esta fase no agrega nada: si se nota, salió mal.

**Dos desviaciones del plan original, con su motivo:**

- `menu_template` **no** entra al validador ni a `TENANT_FIELDS` todavía. Con un
  solo skin no hay nada que elegir, y agregar un campo que ninguna pantalla
  escribe deja un camino de escritura inalcanzable —o peor, alcanzable sin UI que
  lo valide visualmente—. Entra en la Fase 6, junto con el selector.
- `theme/escalas.js` tampoco se crea acá. El plan lo listaba en la Fase 1, pero
  un módulo sin consumidor es código muerto: se agrega en la Fase 3, que es
  cuando existe quien lo use.

Cómo se verificó la identidad visual, que era el punto: se capturó el HTML
renderizado de dos negocios en las 5 paletas antes y después, se normalizaron
todas las reglas CSS a `@media|selector → declaraciones ordenadas` y se
compararon como conjuntos — **95 reglas, cero diferencias en las 5 paletas**. La
comparación incluye el contexto `@media` en la clave, así que una regla que se
hubiera ido al breakpoint equivocado al partir los archivos aparecería como
faltante. Y el DOM ya renderizado por el JS se comparó por hash: **idéntico**
(mismo hash, mismo largo, 46 tarjetas, 9 secciones, tarjetas como hijas directas
de la sección). La única diferencia en toda la página es que las tarjetas de la
**búsqueda** ahora traen `alt` en la imagen, porque usan el constructor
compartido y el viejo código de búsqueda no lo ponía.

### Fase 3 — Escala tipográfica + selector en Configuración ✅

- `menu_scale` con 3-4 presets (`compacto` / `normal` / `grande` / `extra`) como
  variables CSS: `--fs-titulo-categoria`, `--fs-nombre`, `--fs-desc`,
  `--fs-precio`, y los saltos de los `@media`.
- Selector en `/admin/settings`, al lado del de paleta, con la misma vista previa
  "Aa" que ya existe.
- Los `font-size` sueltos del skin pasan a variables. Es el momento: toca los
  mismos selectores que la Fase 2 acaba de ordenar.
- **Criterio de aceptación**: cambiar la escala mueve todo proporcionalmente y
  nada se desborda ni se solapa en 380px, que es donde aprieta.

### Fase 4 — Promociones: datos, reglas y panel ✅

Sin tocar el menú público todavía. Al terminar, el dueño puede cargar promos y no
se ven en ningún lado — nada se rompe y la fase de mayor riesgo queda partida en
dos.

- Migración `004_promociones.sql`: las 3 columnas de `businesses` y las 5 de
  `products`, cada una con el guard de `information_schema` + `PREPARE` de
  `002_menu_theme.sql`. MySQL no tiene `ADD COLUMN IF NOT EXISTS` y **no hay
  rollback**.
- Validadores con las cuatro reglas de arriba.
- `productRepository`: columnas nuevas en el update, con `promo_price = NULL`
  cuando llega vacío — quitar una promo tiene que ser posible, y `''` en una
  columna `DECIMAL` es `0`, o sea "gratis".
- `settings`: `promos_enabled`.
- Panel: en el formulario de producto, precio promo + etiqueta + desde/hasta +
  días, con **atajos que llenan las fechas** ("Fija", "Esta semana", "Este mes").
- **Estado visible en la lista de productos**: `Activa` / `Programada` / `Vencida`
  / `Fuera de día`. Sin esto el dueño carga una promo, no la ve en el menú y no
  tiene forma de saber por qué; ese es el reclamo garantizado.
- **Criterio de aceptación**: `promo_price` mayor al precio se rechaza con
  mensaje claro; `'0000000'` en días se rechaza; guardar sin promo limpia fechas
  y días; el menú público queda **exactamente** como antes.

### Fase 5 — La sección de promociones en el menú ✅

- `menuService.buildMenu` devuelve `{ promos, categorias }` en vez de un array.
  Es un cambio de contrato: alcanza a `routes/public.js`, al armazón y a
  `tests/unit/menuService.test.js`. `promos` sale vacío si la sección está
  apagada, así **la decisión de mostrarla vive en un solo lugar** y no repartida
  entre servicio y vista.
- `promoActiva(producto, hoy)` como función pura, con tests de borde: primer y
  último día de la ventana, sólo `from`, sólo `to`, día no incluido, cambio de
  mes, y el caso de zona horaria (23:30 en Bogotá sigue siendo "hoy" aunque en
  UTC ya sea mañana).
- Sección primera en el menú, y en la tarjeta el precio normal tachado + el
  promocional destacado + el badge si hay etiqueta.
- **Criterio de aceptación**: con la sección apagada el menú queda como antes;
  encendida y sin promos activas **no** aparece una sección vacía (misma regla
  que las categorías vacías, que ya se ocultan); un producto en promo se ve en la
  sección **y** en su categoría.

### Fase 6 — Flyer de promoción + "PROMOCIONES" en mayúsculas ✅

Pedido el 2026-08-13, después de ver la Fase 5 funcionando. Dos cosas de tamaño
muy distinto que van juntas porque las dos son presentación de promociones.

**1. El título en mayúsculas.** La sección se llama "Promociones" y al lado de
"ENTRADAS 🥞" y "BOWLS CLÁSICOS 🍜" se ve en minúsculas.

Un detalle que importa para no arreglarlo mal: **las categorías están en
mayúsculas porque el dueño las escribió así**, no porque haya un
`text-transform` en el CSS. CAFICULTOR las tiene en mixto ("Desayunos &
Brunch 🥞"). Así que:

- Poner `text-transform: uppercase` en `.category-title` cambiaría cómo se ven
  las categorías de **todos** los negocios, incluidos los que las escribieron en
  mixto a propósito. Descartado.
- La sección de promos es la única cuyo nombre lo elegimos nosotros, así que se
  escribe `PROMOCIONES` en la constante y listo. Calza con El Silvestre y va a
  destacar en CAFICULTOR, que es el costo aceptado de tener un nombre fijo.

**2. El flyer.** Una imagen sola, sin texto: el negocio arma su lámina de "2x1
en tal producto" y la sube. Decidido con el usuario:

- **Uno solo**, tipo banner, **arriba del menú** —entre el encabezado y la nav de
  categorías— y fuera de la sección. Es lo primero que se ve al abrir.
- **Tocarlo no hace nada.** Informa y se termina ahí: cero código que pueda
  quedar roto, y si el flyer dice "2x1 en Bowls", el cliente scrollea y los
  encuentra.

Modelo: **una columna**, `businesses.promo_flyer VARCHAR(500) DEFAULT ''`, el
mismo tipo que `banner_img` y `logo_img`. Sin tabla nueva.

Decisiones y por qué:

- **Lo gobierna `promos_enabled`**, el interruptor que ya existe. Apagar
  promociones apaga también el flyer: es una promoción. Un negocio con flyer y
  sin promos de producto lo enciende y ve el flyer sin sección, porque la sección
  sigue escondiéndose cuando no hay productos vigentes.
- **El flyer NO lleva vigencia propia** (fechas ni días). Es scope que no se
  pidió: la promo de producto la tiene porque el precio cambia solo, mientras que
  una imagen se sube y se baja a mano. Si más adelante hace falta un "flyer de
  los martes", son tres columnas y **cero lógica nueva** — `promos.estado()` ya
  hace exactamente eso.
- **Tiene que poder quitarse.** Banner y logo hoy sólo se pueden reemplazar, no
  borrar (está anotado como limitación en `PROCEDIMIENTO_CARGA_MENU.md`). Para un
  flyer eso no sirve: la promoción termina y la lámina tiene que bajar. Va con
  una casilla "Quitar el flyer" en Configuración.
- **Va en el armazón, no en el skin.** Está fuera de la lista de productos, así
  que es chrome y lo comparten todos los skins.
- La subida pasa por `services/imageUpload.js` como todo lo demás, y hereda sus
  tres capas: `fileFilter` por mimetype, magic bytes del archivo escrito, y
  `nosniff` al servir.

**Criterio de aceptación**: el flyer aparece sólo con promociones encendidas y
con imagen cargada; se puede quitar; sin flyer el menú queda igual que antes; la
sección se llama PROMOCIONES en el título, en el chip de la nav y en el
desplegable.

### Fase 8 — El flyer pasa a popup ✅

Pedido el 2026-08-14. El flyer se mostraba como banner entre el encabezado y la
nav; ahora es un aviso que aparece encima del menú al abrirlo.

- **Reemplaza al banner, no se suma.** "Que sea un popup" es eso: si quedaran los
  dos, el negocio tendría la misma imagen dos veces en la misma pantalla.
- **Se muestra en cada carga del menú.** Se probó primero con `sessionStorage`
  para no repetirlo al recargar, y se sacó al usarlo: quien cierra el aviso y
  refresca cree que algo se rompió, y el negocio que armó la lámina quiere que se
  vea. Un menú se abre y se cierra, no se navega, así que "cada carga" es casi
  siempre "una vez" igual. Si alguna vez hay que no repetirlo, la forma correcta
  es una clave que INCLUYA la URL de la imagen —así un flyer nuevo se vuelve a
  mostrar— y en try/catch, porque en modo privado el solo acceso a
  `sessionStorage` lanza en algunos navegadores.
- **Se cierra con la X, con el fondo y con Escape.** Un popup del que no se sale
  fácil es peor que no tenerlo.
- `z-index: 250`, arriba de todo lo demás (los modales están en 200, el FAB y el
  buscador en 150-160). Es lo primero que se ve y lo primero que se descarta, así
  que no compite con nada: cuando el visitante abre un producto, el aviso ya no
  está.
- El interruptor sigue siendo el mismo, `promos_enabled`.

**Costo aceptado, que conviene tener escrito**: un banner se podía volver a mirar
scrolleando; un popup cerrado desaparece hasta la próxima carga. Se gana atención,
se pierde permanencia. Si más adelante molesta, dejar el banner *además* del popup
es una línea.

**Criterio de aceptación**: aparece al abrir el menú con promociones encendidas y
flyer cargado; se cierra por los tres caminos; no vuelve a aparecer al recargar
en la misma pestaña; sí vuelve si el flyer cambia; sin flyer o con promociones
apagadas no hay ni rastro de él.

### Fase 7 — Skin `grilla` ✅

- `views/menu/grilla.ejs`: grilla de 2 columnas, foto arriba, nombre, descripción
  recortada, precio; categorías como chips; promos incluidas porque el contrato
  ya las tiene.
- Selector de template en Configuración, con vista previa.
- Qué hacer cuando **no hay foto**: placeholder con la inicial o el nombre
  centrado. Un layout que apuesta a la imagen se ve roto sin imagen, y hay
  negocios (CAFICULTOR tiene 114 productos) donde falta en muchos.
- **Criterio de aceptación**: los dos skins conviven, se cambia de uno a otro sin
  romper nada, y se ven bien con los datos reales de El Silvestre (46 productos,
  casi todos con foto) y de CAFICULTOR (114, muchos sin foto).

## Orden: por qué así

Fase 0 primero porque el skill es lo que se lee antes de escribir código, y hoy
manda a hacer lo contrario de lo que corresponde.

Fase 1 después porque arregla bugs vivos y porque **todo lo demás se apoya en el
registro**: si las paletas siguen escritas tres veces, agregar templates y
escalas hace tres listas más.

Fase 2 antes de cualquier skin nuevo: extraer con un solo skin es verificable
—tiene que quedar idéntico— y con dos ya no hay contra qué comparar.

Fase 3 antes de la 6 porque prueba el registro con un **segundo eje** (escala)
sin agregar layout todavía. Si el contrato está mal pensado, se descubre acá,
donde el retroceso es chico.

Fases 4 y 5 separadas porque promociones es lo más grande del plan: modelo,
reloj, validación, panel y menú. Partirlo deja dos fases que se verifican solas,
en vez de una rama enorme donde un problema al final obliga a revisar todo.

Fase 6 al final para que la promo se implemente **una vez** en un skin y el
segundo nazca sabiendo del badge. Al revés serían dos implementaciones y una
migración de contrato en el medio.

**Si preferís ver la grilla antes**, se puede mover la 7 delante de la 4-5: el
costo es implementar la tarjeta de promo en dos skins en vez de uno. Es una
decisión de prioridad, no técnica.

## Riesgos

- **La Fase 2 es la de mayor riesgo para el front.** Todo el menú público pasa
  por ahí y es lo que ve el cliente final del restaurante. Mitigación: capturas
  comparadas paleta por paleta y breakpoint por breakpoint, y no mergear con una
  diferencia sin explicar.
- **La migración de la Fase 4 corre sobre producción sin rollback.** Mitigación:
  sólo columnas nulables o con default, nada de `NOT NULL` sin default, nada de
  tocar columnas existentes.
- **El reloj es la fuente de bugs más probable de todo el plan**: zona horaria,
  bordes de la ventana, cambio de mes. Mitigación: la fecha se inyecta, la
  función es pura, y los casos de borde son tests y no pruebas a mano.
- **`buildMenu` cambia de forma.** Contenido: un servicio, un router, una vista y
  un archivo de tests. Es chico pero es de contrato, así que va con la fase que
  lo necesita y no arrastrado de a pedazos.
- **Peso de la página.** El menú se renderiza en el cliente desde un JSON inline;
  una grilla de 114 productos con foto es mucha imagen. `loading="lazy"` ya se
  usa y hay que mantenerlo en el skin nuevo. Si aparece lentitud real, el
  siguiente paso es paginar por categoría, no adelantarlo ahora.
- **Deuda que este plan NO toca**: `menu_theme` sigue llamándose así aunque sea
  una paleta; el menú sigue renderizándose en el cliente (server-side sería mejor
  para SEO, pero es otro proyecto); no hay vista previa en vivo en el panel — el
  dueño guarda y abre su menú; y las promos no tienen historial, así que no se
  puede responder "qué promo estaba activa el 12 de septiembre".

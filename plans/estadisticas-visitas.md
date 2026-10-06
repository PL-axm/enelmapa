# Plan: estadísticas de visitas por menú

Aprobado el 2026-10-06. Rama `feature/estadisticas-visitas` (desde `main` en
`8d1c8b4`).

**Estado:** las tres fases están terminadas en la rama y se mergean juntas,
a pedido del usuario.

Es **team mode**: agrega una tabla, un endpoint público sin sesión y código que
corre en el menú de **todos** los negocios a la vez.

## Qué se pidió

Un tablero con estadísticas de visitas **por menú**. Lo ve cada dueño en su
panel (solo el suyo) y lo ve el superadmin (todos los negocios).

Lo que se decidió con el usuario antes de escribir esto:

- **Métricas:** visitas y visitantes únicos, productos más vistos, clics a
  WhatsApp y redes, y el origen de la visita (QR o link).
- **Conteo con un beacon desde el navegador**, no al renderizar en el servidor.
- **Historial completo**, un evento por fila y sin borrar nada.

## Decisiones de diseño

### 1. Cómo se cuenta: beacon desde el navegador

Cuando el menú termina de cargar, manda `navigator.sendBeacon` a
`POST /s/:slug/evento`. Al abrir un producto o tocar un botón de WhatsApp o de
redes, manda otro evento al mismo endpoint.

| | Beacon (elegido) | Contar en el servidor |
|---|---|---|
| Bots (los logs muestran +100 req/min de scanners) | No ejecutan JS, así que no cuentan | Cuentan todos |
| Vista previa de un link en WhatsApp e Instagram | No cuenta | Cuenta como visita |
| Productos vistos y clics | Se pueden medir | No se pueden medir |
| Costo | Un `INSERT` por evento, en una request aparte | Un `INSERT` dentro del render del menú |

Además, al recibir el beacon se descartan los user-agents de bots conocidos
(`bot`, `crawler`, `spider`, `preview`, `facebookexternalhit`…), por si alguno
sí ejecuta JS.

**Por qué el endpoint cuelga de `/s/:slug` y no de `/api`:** `/api` exige
sesión de admin (`authRequired`) y el visitante del menú no la tiene. Además,
el menú se sirve tanto en `slug.enelmapa.co` como en `/s/slug`. Una ruta
relativa como `/s/<slug>/evento` funciona igual en los dos casos, porque el
middleware de subdominio solo intercepta `/`.

**CSRF:** el endpoint se agrega a las `exentas`, igual que los logins. Un
visitante anónimo no tiene sesión y no queremos que la tenga (eso crearía una
fila en `sessions` por visitante, que es justo lo que `csrf.provide` evita). No
hay nada que proteger: el endpoint solo agrega una fila de contador y no lee ni
cambia datos de nadie.

**Abuso:** cualquiera puede mandar eventos falsos para inflar los números. Se
mitiga con:

- un rate limit por IP (por ejemplo, 60 eventos por minuto) con el mismo
  `express-rate-limit` que ya usan los logins;
- validación con zod: `tipo` tiene que ser uno de un enum cerrado y
  `product_id` un entero.

No pretende ser a prueba de un atacante decidido. Es un contador de
marketing, no un dato contable.

### 2. Visitantes únicos sin cookies y sin guardar la IP

`visitante = sha256(ip + user-agent + fecha local + SESSION_SECRET)`, recortado
a 16 caracteres.

- Cuenta los **únicos por día**: la misma persona dos veces el mismo día cuenta
  una vez.
- **No se guarda la IP** ni nada que identifique a una persona. Como la fecha
  entra en el hash, al día siguiente ese visitante no se puede vincular con el
  de ayer. No hay banner de cookies que agregar ni datos personales que
  declarar.
- Hay un costo: los "únicos del mes" son una suma de únicos diarios, no
  personas distintas en el mes. Se rotula como "visitantes por día" para no
  prometer más de lo que mide.

Alternativa descartada: una cookie con un id. Mide mejor a la persona en el
tiempo, pero es un dato persistente en el teléfono del cliente del negocio, y
se pierde igual en modo incógnito.

### 3. Origen de la visita

- **QR:** `qrService.menuUrl` pasa a generar `…/s/slug?o=qr`. El beacon lee el
  parámetro.
  - **Ojo: los QR que ya están impresos no lo tienen**, así que esas visitas van
    a aparecer como "directo" hasta que el negocio reimprima. El tablero lo
    explica en una nota.
- **El resto sale de `document.referrer`:** `instagram`, `facebook`, `whatsapp`,
  `google`, `otro` o `directo` (sin referrer). La clasificación se hace en el
  servidor, en un servicio puro y testeable. El navegador manda el host del
  referrer y nada más.

### 4. Schema: una tabla de eventos

`db/migrations/010_menu_events.sql`:

```sql
CREATE TABLE IF NOT EXISTS menu_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  tipo ENUM('visita','producto','whatsapp','instagram','facebook') NOT NULL,
  product_id INT NULL,          -- solo en 'producto'
  origen VARCHAR(20) NULL,      -- solo en 'visita'
  visitante CHAR(16) NOT NULL,
  dia DATE NOT NULL,            -- fecha en America/Bogota, no UTC
  hora TINYINT NOT NULL,        -- 0-23, en America/Bogota
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  KEY idx_negocio_dia (business_id, dia, tipo),
  KEY idx_negocio_producto (business_id, tipo, product_id)
);
```

- **`dia` y `hora` se guardan ya en la hora de Bogotá**, calculadas en Node con
  `config.zonaHoraria`, por la misma razón que las promos: si se agrupara por
  `created_at` en UTC, las visitas de las 7 pm en adelante caerían en el día
  siguiente. También evita depender de `CONVERT_TZ`, que necesita las tablas de
  zonas horarias cargadas en MySQL, y en cPanel no está garantizado.
- **`product_id` sin FK, a propósito.** Si el dueño borra un producto, sus
  vistas se quedan en el historial. El "top productos" hace JOIN con
  `products` scopeado por negocio, así que un producto borrado o un id ajeno
  inventado por alguien simplemente no aparece. No se filtra nada de otro
  negocio.
- **Volumen:** un negocio con 300 visitas diarias y 3 eventos por visita son
  unos 330 mil filas al año, unos 30 MB con índices. Si en algún momento pesa,
  se agrega una tabla de resumen diario y se purga el detalle viejo; eso es un
  cambio aparte.

### 5. Capas, siguiendo `CLAUDE.md`

- **`repositories/eventRepository.js`**
  - `forBusiness(id)` expone `registrar(evento)`, `resumen(desde, hasta)` (con
    visitas, únicos y clics), `porDia`, `porHora`, `topProductos(limite)` y
    `origenes`.
  - `platform.resumenPorNegocio(desde, hasta)` es la vista cruzada del
    superadmin. Deliberadamente no tiene scope y es fácil de encontrar con grep.
- **`services/estadisticas.js`** (puro):
  - clasifica el referrer;
  - calcula `dia` y `hora` a partir de una fecha inyectada (no lee el reloj
    adentro);
  - detecta bots;
  - arma el hash del visitante;
  - completa con ceros los días sin visitas, para que el gráfico no salte días.
- **`routes/public.js`**, o un router chico `routes/eventos.js`: recibe el
  `POST /s/:slug/evento`, valida, resuelve el negocio con
  `businesses.platform.findBySlug`, responde `204` y nada más.
  - Si el slug no existe, también responde `204`, para no convertir el endpoint
    en un detector de slugs.
  - El endpoint **no** pasa por `tenantMiddleware`, que carga el menú completo
    (productos, fotos…) y sería un desperdicio para un contador.
- **`views/menu.ejs`**: unas 25 líneas de JS al final del shell.
  - Manda el beacon de visita al cargar.
  - Engancha `openProductModal`, el FAB de WhatsApp y los `.social-btn` con
    `data-evento`.
  - Va en el shell y no en los skins: así los dos skins (y los futuros) quedan
    cubiertos sin tocarlos.

### 6. Los tableros

**Un solo partial, `views/partials/estadisticas.ejs`**, que reciben las dos
vistas. Así el dueño y el superadmin ven exactamente lo mismo de un negocio y
no hay dos versiones que se desincronicen.

Qué tiene:

- un selector de rango: 7, 30 o 90 días (`?dias=`, validado contra esa lista);
- **tarjetas de resumen:** visitas, visitantes por día, clics a WhatsApp, tasa
  de clic (clics / visitas) y la variación contra el período anterior;
- **visitas por día:** un gráfico de barras;
- **por hora del día:** barras de 0 a 23, para ver a qué hora se mira el menú;
- **top 10 de productos vistos;**
- **origen:** QR, Instagram, WhatsApp, directo, etc.;
- **clics por red:** WhatsApp, Instagram, Facebook, TikTok.

Los gráficos son **SVG generado en el servidor con EJS**, sin librería. El
proyecto no tiene bundler y no usa CDNs. Unas barras y una línea no justifican
agregar Chart.js, y así el tablero funciona sin JS. Los colores salen de las
variables CSS del panel.

**Dueño:** `GET /admin/estadisticas`, con un link "📈 Estadísticas" nuevo en el
sidebar.

- Todo va scopeado por `req.session.businessId`.
- El dashboard actual suma una tarjeta con las "visitas de los últimos 7 días"
  que lleva al tablero.

**Superadmin:**

- `GET /superadmin/estadisticas`: una tabla con todos los negocios (visitas de
  7 y 30 días, únicos, clics a WhatsApp y variación). Se ordena por visitas,
  para ver de un vistazo qué menús se usan y cuáles están muertos.
- `GET /superadmin/estadisticas/:id`: el mismo partial que ve el dueño, para
  ese negocio. Si el id no existe, responde 404.

## Fases

Cada fase en su propia rama, mergeable sola, con `npm test` en verde y
`QA_CHECKLIST.md` completo.

1. **Recolección** (esta rama):
   - la migración `010`;
   - el repositorio con `registrar`;
   - el servicio puro;
   - el endpoint con su rate limit y la exención de CSRF;
   - el beacon en `menu.ejs`;
   - el `?o=qr` en el QR.

   **Conviene mergear esta fase sola y primero:** las estadísticas empiezan a
   juntarse recién desde que esto está en producción, así que cada día antes
   cuenta. Cuando estén listos los tableros, ya va a haber datos para mostrar.
2. **Tablero del dueño:** las lecturas del repositorio, el partial, la ruta y
   el sidebar en `/admin/estadisticas`, y la tarjeta en el dashboard.
3. **Tablero del superadmin:** `platform.resumenPorNegocio`, más las dos rutas
   y su vista.

## Tests

- **Unit (`services/estadisticas`):**
  - clasificación del referrer;
  - detección de bots;
  - fecha y hora en Bogotá a las 23:30 hora local, cuando en UTC ya es el día
    siguiente;
  - el hash es estable en el mismo día y cambia al día siguiente;
  - el completado de días vacíos.
- **Integración (endpoint):**
  - un evento válido devuelve `204` y queda una fila;
  - un `tipo` inválido devuelve `400`;
  - un slug inexistente devuelve `204` y no inserta nada;
  - un user-agent de bot no inserta nada;
  - pasa sin token CSRF;
  - el rate limit corta.
- **Integración (tenant scoping), el test que más importa:**
  - el dueño A no ve los eventos de B;
  - un `product_id` de B mandado al slug de A no aparece en el top de A;
  - `/superadmin/estadisticas/:id` exige `isSuper`.
- **Repositorio:** `forBusiness` lanza con un id inválido, y las agregaciones
  dan lo esperado sobre fixtures conocidos.

## Ajustes al implementar la fase 1

- **Sin `tiktok` en el enum de clics:** el menú no muestra un botón de TikTok.
  Si se agrega uno, se suma al enum con una migración y a `TIPOS` en
  `services/estadisticas.js`. TikTok sí existe como **origen** (por el
  referrer).
- **CSRF:** sin sesión, `createProtect` ya dejaba pasar la request. La exención
  igual hace falta para el dueño logueado que mira su menú en `/s/slug`.
  `exentas` ahora acepta una RegExp además de rutas exactas.
- **Rate limit:** 300 por minuto por IP, no 60. Los clientes de un local suelen
  estar todos en el mismo wifi, o sea detrás de una sola IP. Se configura con
  `RATE_LIMIT_EVENTOS_MAX`.
- **QR:** `forSlug` devuelve `url` (limpia, para mostrar y copiar) y `urlQr`
  (la que se codifica). Además, el menú borra `?o=qr` de la barra de
  direcciones al cargar, para que un link compartido no cuente como escaneo.
- **Origen:** si no hay referrer, se usa el user-agent del navegador interno de
  Instagram o Facebook. Se suma `enelmapa` como origen para las visitas que
  llegan desde la landing.

## Ajustes al implementar las fases 2 y 3

- **Las tres fases van en la misma rama**, con un commit por fase, y se
  mergean juntas al final a pedido del usuario. No hubo una rama por fase.
- **"Productos abiertos" tiene su propia tarjeta**, además de aparecer en el
  top.
- **Superadmin:** un id con algo que no sea dígitos devuelve 404. MySQL
  compara `id = '5abc'` como `5`, así que sin esa guarda se abriría el
  tablero de otro negocio.
- **La nota sobre los QR viejos** no lleva fecha: el tablero no sabe cuándo se
  desplegó.

## Fuera de alcance, y limitaciones que hay que saber

- **Las visitas del propio dueño a su menú también cuentan.** Excluirlas exige
  compartir la cookie de sesión entre `enelmapa.co` y los subdominios, y eso es
  un cambio de seguridad aparte.
- **No hay datos históricos.** Todo arranca en cero el día del deploy.
- **Los QR ya impresos aparecen como "directo"** (ver la sección 3).
- No hay exportación a CSV, ni comparación entre negocios para el dueño, ni
  alertas. Se puede agregar después si hace falta.

## Deploy

Según `CLAUDE.md`, **un merge a `main` llega a producción en menos de 5
minutos** (`deploy/deploy.sh` por cron). `WORKFLOW.md` todavía dice que es un
`git pull` manual, y está desactualizado en ese punto.

La migración `010` corre sola en el primer arranque. Es un `CREATE TABLE IF NOT
EXISTS`, así que si se repite no hace nada.

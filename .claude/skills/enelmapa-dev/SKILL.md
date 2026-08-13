---
name: enelmapa-dev
description: Trabajar en el código fuente de la app EnElMapa (Node.js + Express + EJS + MySQL, SaaS multi-tenant de menús digitales para restaurantes/cafés). Usar cuando el usuario pida agregar/modificar features, corregir bugs, revisar arquitectura, levantar el entorno local, o tocar la base de datos de enelmapa.co. No confundir con el skill cargar-menu-pdf (ese es para subir contenido de un negocio vía la API pública del admin, sin tocar código ni base de datos).
---

# Desarrollo sobre el código de EnElMapa

> Esta es la **única** copia — vive dentro del propio repo
> (`.claude/skills/enelmapa-dev/`) para que cualquier máquina que clone
> `enelmapa` tenga el mismo contexto automáticamente, sin setup aparte. No
> hay otra copia en un wrapper externo; si alguna vez aparece una duplicada
> fuera de este repo, es una desviación y esta es la fuente de verdad.

## Antes de arrancar cualquier tarea nueva en este proyecto

Preguntar primero: **¿es una tarea de desarrollo (código/DB/plataforma) o de
subida de contenido (menú de un negocio)?**

- Subida de contenido → skill `cargar-menu-pdf`, no este.
- Desarrollo → seguir el flujo de esta sección (ver también `WORKFLOW.md` en
  la raíz del repo, tiene el diagrama completo).

### Flujo para tareas de desarrollo

1. **Elegir modo** (preguntar si no es obvio por el tamaño del pedido):

   | | **Fullstack mode** | **Team mode** |
   |---|---|---|
   | Cuándo | Cambio acotado a 1-2 archivos: fix puntual, feature chica y bien definida, ajuste de vista/estilo, endpoint nuevo que sigue un patrón ya existente | Toca modelo de datos/schema, seguridad, multi-tenancy (scoping de `business_id`), nueva dependencia, o cualquier cosa que afecte a **todos** los tenants a la vez |
   | Plan | Corto: qué archivo(s), qué cambia, 3-5 líneas | Más profundo: alternativas consideradas, trade-offs, y qué dice `BEST_PRACTICES.md` si aplica al área tocada |
   | Ejecución | Directo tras aprobar, sin explorar alternativas | Solo en el modo elegido — no mezclar con ida y vuelta de "podríamos hacer también..." salvo que se pida explícitamente |

2. **Plan obligatorio antes de ejecutar** — usar el modo plan nativo
   (explorar → proponer → esperar aprobación) y **además** guardar el plan
   aprobado como archivo en `plans/<slug-de-la-tarea>.md` (crear la carpeta
   si no existe). No ejecutar cambios de código antes de la aprobación
   explícita.
3. Ejecutar **solo** en el modo elegido en el paso 1.
4. **Si el cambio toca backend** (`routes/`, `middleware/`, `db/`,
   `services/`, `app.js` o `server.js`): correr `npm test` (en verde) y
   completar `QA_CHECKLIST.md` antes de dar la tarea por terminada. Ver
   `TESTING.md` para cómo escribir un test nuevo. Cambios solo de vistas
   EJS/CSS quedan exceptuados de este paso.

La arquitectura completa está documentada en **`CLAUDE.md`** (léelo primero,
es la fuente autoritativa) — este skill no la repite, agrega lo que ese
archivo no cubre: reglas de seguridad no-negociables, prioridades de mejora
ya diagnosticadas, y el flujo de trabajo acordado con el equipo.

## Resumen de una línea

Node.js + Express + EJS (sin bundler) + MySQL (`mysql2/promise`), desplegado en
cPanel/Passenger (`.htaccess` proxea a un proceso Node local). Suite de tests
Jest+Supertest en `tests/` (ver `TESTING.md`). Tres realms de auth
independientes: público (sin auth), `/admin` (dueño de un negocio, scope por
`session.businessId`), `/superadmin` (operador de la plataforma, puede tocar
cualquier negocio).

Las capas, de afuera hacia adentro: `routes/` es cableado (leer entrada, llamar,
responder) → `services/` tiene las decisiones → `repositories/` tiene **todo** el
SQL → el pool. Nada se construye a nivel de módulo: `container.js` es el único
lugar que arma dependencias y `createApp(container)` las reparte. El schema se
cambia con migraciones versionadas en `db/migrations/`.

## Reglas no-negociables (antes de tocar nada)

1. **`npm run seed` borra TODA la base de datos multi-tenant**, no solo un
   negocio demo — [db/seed.js](db/seed.js) hace `DELETE FROM
   products/categories/business_hours/users/businesses` (todas las filas, de
   todos los negocios) y luego re-siembra un único negocio "caficultor" de
   prueba. **Nunca correrlo contra una base compartida o de producción.** Si
   hace falta reset de datos, hacerlo con `DELETE ... WHERE business_id = ?`
   scopeado, no con el script de seed.
2. **`/superadmin` puede editar/borrar cualquier negocio y resetear cualquier
   contraseña** (`routes/superadmin.js`) — `SUPER_EMAIL`/`SUPER_PASS` son env
   vars con default inseguro (`admin@enelmapa.co` / `super2026`) solo
   aceptable en local. No asumir que esas credenciales por defecto sirven en
   producción; no las uses sin que el usuario confirme cuáles son las reales.
3. **El SQL no se escribe fuera de `repositories/`, y el scope de tenant lo
   fuerza el repo.** Los repos scopeados (`categories`, `products`,
   `businesses`, `users`) **no exponen ningún método a nivel de tabla**: la
   única entrada es `forBusiness(businessId)`, que devuelve los métodos ya
   atados a ese negocio. No existe una versión sin scope que alguien pueda
   llamar por error, y `forBusiness` lanza si el id no es un entero positivo en
   vez de emitir `WHERE business_id = NULL` (que en MySQL no matchea nada: una
   lectura vuelve vacía y una escritura no hace nada, las dos en silencio y
   pareciendo éxito).

   Lo que sí es una decisión deliberada cada vez: la superficie `platform` de
   `businessRepository`/`userRepository`, para lo que legítimamente cruza
   negocios (login por email, vistas del superadmin, resolución de tenant por
   slug). Leer `repos.users.platform.x` en un call site es una declaración de
   que esa consulta sale del scope a propósito, y es greppable.

   **Escribir `db.query` en un handler es la desviación a evitar**, no olvidar
   el `AND business_id = ?`.
4. **La sesión vive en MySQL** (`db/sessionStore.js`, tabla `sessions`), no en
   el `MemoryStore` de `express-session`. Eso cerró la "sesión inestable" que
   se veía bajo Passenger: al reciclar procesos Node se perdían las sesiones en
   memoria y una request caía en `302` a `/admin/login` segundos después de un
   login exitoso. Dos consecuencias al tocar código: **`sessions` no cuelga de
   `businesses`**, así que ninguna cascada la alcanza y lo que limpie datos de
   tenant tiene que limpiarla aparte; y `SESSION_SECRET` es **obligatoria** con
   `NODE_ENV=production` — `loadConfig` lanza en vez de arrancar firmando con
   el secreto por defecto del repo.

## Qué NO es un bug — patrones intencionales del código actual

> Los 24 hallazgos de la auditoría de `BEST_PRACTICES.md` (B1–B7, S1–S9, E1–E8)
> se cerraron entre las fases del refactor, más cuatro de sesión que salieron
> después. **`BEST_PRACTICES.md` es un documento histórico**: describe el estado
> anterior y sirve para entender por qué el código quedó como quedó, no para
> saber qué falta. No usarlo como lista de pendientes.

- **Un 404, no un 403, cuando la fila es de otro negocio.** Es a propósito: un
  403 confirmaría que la fila existe y convertiría el endpoint en un enumerador
  de ids. "No existe" y "no es tuya" tienen que ser indistinguibles desde afuera.
- **Los dos logins están exentos de CSRF** (`app.js`, `middleware/csrf.js`): son
  las únicas mutaciones sin sesión previa, así que no puede haber token todavía.
  Está documentado en el middleware; no es un olvido.
- **El token CSRF sólo se genera para sesiones autenticadas.** Si se generara
  siempre, cada visitante anónimo de un menú público crearía una fila en
  `sessions`.
- **Las categorías vacías no se muestran** en el menú público
  (`services/menuService.js`). Decisión de producto, no un filtro de más.
- **CSS inline por página, sin hoja compartida.** Convención, no deuda — ver
  Convenciones más abajo.
- **El menú público se renderiza en el cliente** desde un JSON inyectado inline.
  Es lo que hay; cambiarlo a server-side es un proyecto aparte (SEO), no un
  arreglo al pasar.
- **`npm run seed` borra toda la base** y eso es intencional para una base local
  dedicada — ver regla no-negociable #1.

Lo que **sí** conviene revisar antes de "descubrir" algo: `git log` de la fase
correspondiente. Cada arreglo dejó el motivo escrito en el mensaje de commit,
incluido el caso concreto que lo reprodujo.

## Setup local

DB local dedicada (separada de producción, decidido explícitamente para no
arriesgar datos reales de negocios al probar cambios):

```bash
sudo mysql -e "
CREATE DATABASE IF NOT EXISTS enelmapa_dev CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS 'enelmapa_dev'@'localhost' IDENTIFIED BY 'enelmapa_dev_local';
GRANT ALL PRIVILEGES ON enelmapa_dev.* TO 'enelmapa_dev'@'localhost';
FLUSH PRIVILEGES;
"
```

```bash
npm install
DB_HOST=localhost DB_USER=enelmapa_dev DB_PASS=enelmapa_dev_local DB_NAME=enelmapa_dev npm run dev
```

**Las migraciones corren solas al arrancar** (`db/migrate.js` aplica lo pendiente
de `db/migrations/` y lo anota en `schema_migrations`), así que un clon nuevo
queda con el schema al día sin pasos extra. Ya no existe `initDb()`.

Para tener datos con que trabajar, `npm run seed` es seguro contra
`enelmapa_dev` porque es una base local dedicada — el riesgo es sólo si esas env
vars apuntaran por error a la base real (regla no-negociable #1).

No hay lint/build configurado. Sí hay tests (ver siguiente sección) — para
cambios de UI/EJS que no tienen cobertura, probar a mano contra las rutas
(`curl` o navegador).

### Setup de tests

```bash
sudo mysql -e "
CREATE DATABASE IF NOT EXISTS enelmapa_test CHARACTER SET utf8mb4;
GRANT ALL PRIVILEGES ON enelmapa_test.* TO 'enelmapa_dev'@'localhost';
FLUSH PRIVILEGES;
"
npm test
```

Detalle completo (estructura de `tests/`, cómo agregar un test, gotchas) en
`TESTING.md`.

## Flujo de trabajo (git + deploy)

- **Una rama por cambio** (feature o fix), `main` protegida — mergear cuando
  el cambio esté probado localmente contra `enelmapa_dev`. Nombrar la rama
  por lo que hace (`fix-...`, `feat-...`), no por fecha.
- **Deploy = `git pull` manual en el servidor** (cPanel/SSH, no hay CI/CD
  configurado). Eso significa que mergear a `main` **no** despliega solo —
  avisar explícitamente cuando un cambio está mergeado y listo para que
  alguien haga el pull en el servidor, no asumir que ya está en producción.
- Sin entorno de staging: el único "ambiente" además de local es producción.
  Probar bien en `enelmapa_dev` antes de mergear, ya que no hay red de
  seguridad intermedia.

## Convenciones al agregar código

- **`/admin` renderiza, `/api` muta.** Un endpoint nuevo que crea/edita/borra
  datos va en `routes/api/index.js`, no en `routes/admin.js` (ver
  `CLAUDE.md`).
- Vistas EJS con CSS inline por página (no hay hoja de estilos compartida,
  cada `views/admin/*.ejs` repite su propio `<style>` — igual que
  `partials/admin-head.ejs`, que es el que incluyen las cinco páginas del
  panel). Seguir el mismo patrón visual (paleta `#C8956C` acento, `#1A1917`
  sidebar) en vez de introducir un sistema nuevo.
- Subida de imágenes: `services/imageUpload.js` — `multer.diskStorage` a
  `uploads/<businessId>/`, nombre randomizado, servido estático en `/uploads`.
  Cualquier upload nuevo va por ahí, y hereda las tres capas: `fileFilter` por
  mimetype declarado, verificación de **magic bytes** del archivo ya escrito
  (el mimetype lo controla quien sube, los primeros bytes son el contenido
  real), y `X-Content-Type-Options: nosniff` al servir.
- Todas las respuestas de `/api` son JSON `{ok: true, ...}` /
  `{ok: false, error}`; las páginas `/admin` renderizan EJS. No mezclar los
  dos estilos en un mismo endpoint.
- **No escribir `try/catch` + `res.status(500)` en un handler.** Se lanza desde
  `errors/`, `asyncHandler` atrapa el rechazo y `middleware/errorHandler.js` (el
  último `app.use` de `app.js`) renderiza o serializa.
- **Nada lee `process.env` fuera de `config/index.js`.** Si hace falta un valor
  de entorno nuevo, se agrega ahí y se recibe por parámetro.
- **Validación en el borde con zod**: schema en `validators/`, aplicado por
  `middleware/validate.js`, que **reemplaza `req.body`** con los datos ya
  convertidos — un handler nunca ve un string donde espera un número.

## Relación con `cargar-menu-pdf`

Ese skill opera **solo por HTTP** contra el admin ya desplegado (sin acceso
al código ni a la DB) — sigue siendo el camino correcto para cargar contenido
de un negocio real vía su cuenta de admin. Con el código ya clonado, para
tareas de **plataforma** (crear negocios, tocar el modelo de datos, arreglar
bugs) el camino es este skill + acceso directo a MySQL/superadmin si hace
falta — no reemplaza al otro, son capas distintas (contenido de un tenant vs.
la plataforma en sí).

## Documentos de referencia en el repo

- `CLAUDE.md` — arquitectura (autoritativo).
- `BEST_PRACTICES.md` — **histórico**. La auditoría que originó el refactor; sus
  24 hallazgos están cerrados. Sirve para entender por qué el código quedó como
  quedó, no como lista de pendientes.
- `plans/` — un archivo por tarea grande, con las alternativas que se
  consideraron y por qué se eligió una. `refactor-arquitectura-repository-di.md`
  y `orden-fases-restantes.md` explican el estado actual mejor que cualquier
  resumen.
- `BUSINESS_MODEL.md` — modelo de negocio derivado del código (roles,
  onboarding, qué no resuelve todavía la plataforma).
- `WORKFLOW.md` — diagrama y reglas del flujo de trabajo completo (dev +
  subida de contenido).
- `TESTING.md` — cómo escribir/correr tests, estructura de `tests/`,
  gotchas (ej. `--runInBand`, el falso-positivo de subdominio con Hosts
  tipo IP).
- `QA_CHECKLIST.md` — checklist manual pre-merge para cambios de backend.
- `.claude/memory-snapshot/` — contexto/decisiones acumuladas en la máquina
  original (ver el README ahí para cómo usarlo en una máquina nueva).

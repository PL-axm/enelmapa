---
name: enelmapa-dev
description: Trabajar en el código fuente de la app EnElMapa (Node.js + Express + EJS + MySQL, SaaS multi-tenant de menús digitales para restaurantes/cafés). Usar cuando el usuario pida agregar/modificar features, corregir bugs, revisar arquitectura, levantar el entorno local, o tocar la base de datos de enelmapa.co. No confundir con el skill cargar-menu-pdf (ese es para subir contenido de un negocio vía la API pública del admin, sin tocar código ni base de datos).
---

# Desarrollo sobre el código de EnElMapa

> Esta copia vive dentro del propio repo (`.claude/skills/enelmapa-dev/`) para
> que cualquier máquina que clone `enelmapa` tenga el mismo contexto. La
> copia "canónica" original se armó en un proyecto wrapper local
> (`menumap/`) que además contiene `cargar-menu-pdf` y
> `PROCEDIMIENTO_CARGA_MENU.md` — si trabajas desde ese wrapper, esos archivos
> son la fuente de verdad; si sólo tienes este repo clonado, esta copia y la
> de `cargar-menu-pdf` (también en `.claude/skills/` acá) son autosuficientes.

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

La arquitectura completa está documentada en **`CLAUDE.md`** (léelo primero,
es la fuente autoritativa) — este skill no la repite, agrega lo que ese
archivo no cubre: reglas de seguridad no-negociables, prioridades de mejora
ya diagnosticadas, y el flujo de trabajo acordado con el equipo.

## Resumen de una línea

Node.js + Express + EJS (sin bundler) + MySQL (`mysql2/promise`), sin capa de
servicio (routes → DB directo), sin tests, desplegado en cPanel/Passenger
(`.htaccess` proxea a un proceso Node local). Tres realms de auth
independientes: público (sin auth), `/admin` (dueño de un negocio, scope por
`session.businessId`), `/superadmin` (operador de la plataforma, puede tocar
cualquier negocio).

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
3. **El filtro de tenant (`business_id`) es manual en cada query**, no hay
   repository/ORM que lo fuerce (ver hallazgo #2 de `BEST_PRACTICES.md`). Al
   escribir o tocar cualquier query nueva sobre `categories`/`products`/etc,
   **siempre** incluir `AND business_id = ?` con el valor de
   `req.session.businessId` — olvidarlo es una fuga de datos entre negocios,
   no un bug cosmético.
4. **La sesión usa el `MemoryStore` por defecto de `express-session`**
   ([server.js:19-28](server.js#L19-L28)) — sin store persistente
   configurado. Bajo Passenger (que recicla procesos Node), esto causa que
   una sesión válida se pierda sin aviso si la request cae en un proceso
   "frío". Esta es la causa raíz confirmada de la "sesión inestable" que se
   observa operando por fuera (por HTTP, ver skill `cargar-menu-pdf`) — si se
   toca este código, considerar un store real (`connect-mysql`,
   `connect-redis`) antes de asumir que el problema es solo cosmético.

## Qué NO es un bug — patrones intencionales del código actual

- Sin capa de servicio (controller → DB directo): documentado y con plan de
  adopción incremental en `BEST_PRACTICES.md`, no reescribir de golpe.
- Sin CSRF, sin rate-limiting en logins, sin validación de `mimetype` en
  uploads de imagen, sin validación de `slug`/`price` con librería: todos
  hallazgos ya diagnosticados en `BEST_PRACTICES.md` con prioridad — revisar
  esa lista antes de "descubrir" el mismo hallazgo de nuevo.
- Lógica duplicada conocida (generación de QR, extracción de subdominio,
  array de días de la semana, alta de negocio+horarios) entre
  `routes/admin.js` / `routes/api/index.js` / `db/seed.js` /
  `routes/superadmin.js` — normal por ahora, ver sección 1 de
  `BEST_PRACTICES.md` para el plan de extracción a `services/`.

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

`initDb()` crea las tablas solo si no existen — no hace falta correr
`npm run seed` para tener algo que ver (y **no correrlo nunca** contra la DB
de producción, ver regla no-negociable #1 arriba). Para tener datos de
prueba en `enelmapa_dev` sí es seguro correr `npm run seed` ahí, porque es
una base local vacía dedicada — el riesgo es solo si esas env vars
apuntaran por error a la base real.

No hay lint/build/test configurado. Para verificar un cambio, probar a mano
contra las rutas (`curl` o navegador) — no hay suite automática que corra.

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
  `partials/admin-layout.ejs`). Seguir el mismo patrón visual (paleta
  `#C8956C` acento, `#1A1917` sidebar) en vez de introducir un sistema nuevo.
- Subida de imágenes: `multer.diskStorage` a `uploads/<businessId>/`, nombre
  randomizado, servido estático en `/uploads`. Cualquier upload nuevo debe
  seguir ese mismo patrón (ver `routes/api/index.js:9-20`).
- Todas las respuestas de `/api` son JSON `{ok: true, ...}` /
  `{ok: false, error}`; las páginas `/admin` renderizan EJS. No mezclar los
  dos estilos en un mismo endpoint.

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
- `BEST_PRACTICES.md` — auditoría priorizada de seguridad/calidad, con plan
  de adopción incremental. Consultar antes de proponer un cambio estructural
  grande.
- `BUSINESS_MODEL.md` — modelo de negocio derivado del código (roles,
  onboarding, qué no resuelve todavía la plataforma).
- `WORKFLOW.md` — diagrama y reglas del flujo de trabajo completo (dev +
  subida de contenido).
- `.claude/memory-snapshot/` — contexto/decisiones acumuladas en la máquina
  original (ver el README ahí para cómo usarlo en una máquina nueva).

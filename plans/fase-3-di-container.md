# Fase 3 — DI: `container.js`, `createPool`, `createApp({ pool, config })`

Rama: `feat-di-container`. Fase 3 de `plans/refactor-arquitectura-repository-di.md`
(leer ese plan primero: acá va sólo el detalle de esta fase).

## Objetivo

Sacar los dos singletons que hoy se importan a nivel de módulo — el pool de MySQL y el
objeto `config` — y pasarlos como dependencias explícitas. Es la fase que abre las costuras
para la Fase 4 (repositories): sin esto, no hay dónde enchufar un repo.

Sin cambios de comportamiento. Los 78 tests actuales son el contrato: si alguno cambia de
resultado, el refactor está mal. Los que cambian de *forma* (por cómo construyen la app) se
ajustan, pero ninguna aserción de negocio se toca.

## Cuatro correcciones al plan original, acordadas antes de arrancar (2026-08-07)

Salieron de la revisión de POO/SOLID pedida por el usuario.

**C1 — Los repos no construyen a sus colaboradores.** El ejemplo del plan original
(`refactor-arquitectura-repository-di.md:124`) hace
`categoryRepository(pool).forBusiness(...)` *adentro* de `productRepository`: es un DIP
violado dentro de la fase que existe para arreglar DIP. La regla para la Fase 4 queda escrita
acá: `productRepository(pool, categoryRepo)` — todo colaborador se recibe, el único que
construye es el container.

**C2 — No se pasa el container hacia abajo.** `createApp` recibe `{ pool, config }`
destructurado, y cada router/middleware recibe *sólo lo suyo*
(`createPublicRouter()` no recibe nada, `createTenantMiddleware({ pool })` recibe el pool).
Pasar el container entero convertiría la DI en un service locator: dependencias ocultas y
tests que tienen que armar el mundo. El container se abre únicamente en el composition root.

**C3 — `config` deja de instanciarse al importarse.** Hoy `config/index.js` exporta
`config: loadConfig()`, así que un `require` puede lanzar — por eso `server.js` tiene un
`try/catch` alrededor de un import. Pasa a exportar sólo `loadConfig`; `server.js` lo llama
explícitamente. Además `server.js` deja de llamar `resolveSecureCookie(process.env)` por su
cuenta y lee `config.session.cookie.secure`, que ya tiene el valor resuelto.

**C4 — La inyección entra por el factory del router, no por el handler.** Cada `routes/*.js`
pasa a exportar `function createXRouter({ pool, config })`. Así la Fase 4 sólo cambia los
nombres destructurados (`{ productRepo, categoryRepo }`) sin volver a tocar los handlers.

## Cambios por archivo

**Nuevos**

- `db/pool.js` — `createPool(dbConfig)`, factory sin estado de módulo.
- `container.js` — `createContainer(config)` → `{ config, pool, close() }`. En la Fase 4 acá
  se agregan los repos.
- `tests/helpers/container.js` — container único por archivo de test + `createTestApp()`.

**Modificados**

- `config/index.js` — exporta sólo `loadConfig`; agrega `config.db` y `config.superadmin`
  (hoy leídos de `process.env` en `db/schema.js` y `services/superadminAuth.js`).
- `db/schema.js` — `initDb(pool)` recibe el pool; se le va `getPool`.
- `app.js` — `createApp({ pool, config })`.
- `server.js` — `loadConfig()` → `createContainer` → `initDb(pool)` → `createApp` → `listen`.
- `middleware/errorHandler.js` — `createErrorHandler({ config })`.
- `middleware/tenant.js` — `createTenantMiddleware({ pool })`.
- `routes/{admin,superadmin,public}.js`, `routes/api/index.js` — factories (C4).
- `services/superadminAuth.js` — `verifySuperadmin(creds, superadminConfig)` en vez de leer
  `process.env`.
- `db/seed.js` — construye su propio pool desde `loadConfig()`.
- `tests/helpers/{db,fixtures}.js` + los 5 tests de integración — usan `createTestApp()`.
- `tests/unit/{errorHandler,superadminAuth}.test.js` — pasan config inyectada.

**Sin tocar**: `config/session.js` (`loadConfig` ya lo usa), `middleware/{auth,superauth,
asyncHandler}.js` (no dependen de nada inyectable), `errors/`, `services/subdomain.js`,
todas las vistas EJS.

`tests/env.setup.js` **se queda como está** — forzar `DB_NAME=enelmapa_test` es la regla
no-negociable #1 del skill, y la DI no la reemplaza. Lo que cambia es que ahora la config de
DB *pasa* por `loadConfig`, no que deje de forzarse.

## Verificación

- `npm test` en verde con los mismos 78 tests (más 1 nuevo: el enmascarado de mensajes de 500
  en producción, que recién ahora es testeable sin tocar el registro de módulos).
- `QA_CHECKLIST.md` completo. Puntos con más riesgo en esta fase: arranque en frío
  (`initDb` cambió de firma) y el escenario de dos tenants contra `enelmapa_dev`.
- `grep` del diff: ningún `db.query` nuevo sobre tablas con `business_id` sin su filtro.
- Merge a `main` + avisar del `git pull` manual en el servidor.

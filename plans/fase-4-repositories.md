# Fase 4 — Repositories con scoping forzado

Rama: `feat-repositories-scoping`. Fase 4 de `plans/refactor-arquitectura-repository-di.md`
(incluida la nota de transacciones agregada el 2026-08-07).

## Objetivo

Que consultar `categories`/`products`/`business_hours`/`users` sin filtrar por `business_id`
deje de ser posible. Hoy el filtro es manual en cada query y lo único que lo sostiene es la
disciplina — la regla no-negociable #3 del skill existe precisamente porque nada la fuerza.

La forma: los repos no exponen ningún método de tabla. El único punto de entrada es
`forBusiness(businessId)`, que devuelve el objeto con las operaciones ya atadas a ese negocio.
No hay una versión "sin scope" que alguien pueda llamar por error.

## Orden

Recurso por recurso, con la suite corriendo entre cada uno:
**categorías → productos → negocio → usuarios → horarios**.

Cada recurso es un commit. Empezamos por categorías porque es el de menos dependencias y el
que fija la forma que copian los otros cuatro.

## Forma de un repo

```js
function categoryRepository(db) {          // db: pool o PoolConnection
  return {
    forBusiness(businessId) {
      // …validación…
      return { listOrdered, create, rename, remove, reorder, exists, … };
    }
  };
}
```

`db` es un *ejecutor*, no el pool: en `mysql2` el pool y una `PoolConnection` exponen la misma
`.query()`, así que el repo no sabe ni le importa cuál le tocó. Eso es lo que hace que
`withTransaction` funcione sin duplicar firmas — ver la nota de transacciones del plan padre.

`container.js` gana `buildRepos(db)` (los repos cableados entre sí, con los colaboradores
**inyectados**, nunca construidos adentro — corrección C1) y `withTransaction(fn)`.

## Transición de los routers

Durante la fase, `createAdminRouter` y `createApiRouter` reciben `{ pool, repos, config }`:
`repos` para lo ya migrado, `pool` para lo que todavía tiene SQL inline. **`pool` desaparece de
las firmas de los routers al cerrar la fase** — si al final quedó alguno, la migración está
incompleta.

## Qué NO hace esta fase

Cambiar comportamiento. En particular **no** se cierra B4 (las mutaciones responden `{ok:true}`
aunque no hayan afectado ninguna fila). Los repos sí devuelven si afectaron algo — la
información pasa a existir — pero los handlers la siguen ignorando por ahora.

Razón: B4 cambia el contrato de `/api` y obliga a tocar el JS inline de `views/admin/*.ejs`.
Meter un cambio de contrato adentro de la fase más riesgosa del refactor es justo lo que se
evitó en la Fase 1 al separar "arreglar bugs" de "mover código". B4 va en una rama corta
después, con los tests de `tenant-scoping` invertidos a propósito.

Tampoco se tocan servicios ni controllers (Fase 5), ni la validación zod (Fase 6).

## Verificación

- `npm test` en verde entre recurso y recurso, no sólo al final.
- Test de aislamiento por repo en `tests/repositories/`: cada operación de A sobre una fila de
  B no lee, no escribe y no borra.
- `forBusiness` sin `businessId` válido tiene que lanzar, no devolver un objeto que consulte
  sin filtro.
- `QA_CHECKLIST.md` completo, con el escenario de dos tenants a mano (lo exige el checklist
  para cualquier cambio que toque `business_id`, y esta fase los toca todos).
- `grep` del diff: cero `query(` sobre tablas con `business_id` fuera de `repositories/`.

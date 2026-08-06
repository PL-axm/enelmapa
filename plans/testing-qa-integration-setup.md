# Testing (unit + integración) + QA para el backend de enelmapa

## Contexto

`enelmapa` (Node/Express/EJS/MySQL, multi-tenant) no tiene ningún test hoy —
confirmado, cero `.test.js`/`.spec.js`/`jest.config` en todo el repo. El
usuario pidió que todo cambio de backend tenga pruebas unitarias, pruebas de
integración (si es posible) y un proceso de QA, integrado al flujo de
trabajo ya definido (Fullstack/Team mode en `enelmapa-dev/SKILL.md` +
`WORKFLOW.md`). Se buscó en el ecosistema de skills (`npx skills find` con
varias queries) y no apareció nada tailored a este stack/arquitectura —
se construye a medida.

El propio `BEST_PRACTICES.md` del repo ya diagnosticaba esto (sección 7):
recomienda arrancar por integración (Supertest contra `/api`) antes que
unit tests, porque casi no hay funciones puras todavía (todo es
routes → DB directo). Este plan sigue esa recomendación y además extrae la
primera función pura real para dar un ejemplo concreto de unit test.

Decisión ya tomada con el usuario: el hallazgo de seguridad nuevo (abajo,
paso 4) se **documenta con un test, no se arregla** en este plan.

## Enfoque

**Jest + Supertest.** El repo es CommonJS puro, sin build step — Jest corre
nativo, sin config extra. Sin alternativa mejor justificada (Vitest es para
proyectos ESM/Vite; Mocha+Chai+Sinon es más piezas para el mismo resultado).

### 1. Split `server.js` → `app.js` + `server.js` (requisito técnico para poder testear)

Hoy `server.js` configura Express, monta rutas, Y llama
`initDb().then(() => app.listen(...))` en el mismo archivo — imposible
importar `app` en un test sin abrir un puerto real y conectar a MySQL real.

- **`app.js`** (nuevo): todo lo que hoy es `server.js` líneas 1-71 (setup,
  middlewares, montaje de rutas, 404 handler). Termina en
  `module.exports = app;`. No llama `initDb()` ni `app.listen()`.
- **`server.js`** (reescrito, queda finito):
  ```js
  const { initDb } = require('./db/schema');
  const app = require('./app');
  const PORT = process.env.PORT || 3000;
  initDb().then(() => app.listen(PORT, () => { /* logs actuales */ }))
    .catch(err => { console.error(...); process.exit(1); });
  ```
- Confirmado por grep: nada más en el repo hace `require('./server')`, el
  split no rompe otros imports. `package.json` (`main`, `start`, `dev`) no
  cambia, sigue apuntando a `server.js`.
- Cambio puramente mecánico (copy+paste, cero lógica nueva). Mergeable y
  verificable solo, antes de escribir el primer test — QA: `npm run dev`
  se comporta idéntico a hoy.

### 2. Base de datos de test: `enelmapa_test` separada de `enelmapa_dev`

Igual criterio que ya se aplicó para separar `enelmapa_dev` de producción
(mismo `SKILL.md`): los tests hacen `DELETE FROM businesses` (cascada por FK
a `business_hours`/`categories`/`products`/`users`) antes de cada test para
aislamiento — correr eso contra `enelmapa_dev` borraría cualquier dato que
el desarrollador tenga ahí a mano en paralelo.

```bash
sudo mysql -e "
CREATE DATABASE IF NOT EXISTS enelmapa_test CHARACTER SET utf8mb4;
GRANT ALL PRIVILEGES ON enelmapa_test.* TO 'enelmapa_dev'@'localhost';
FLUSH PRIVILEGES;
"
```
(reusa el usuario `enelmapa_dev`/`enelmapa_dev_local` que ya existe.)

**Guardrail a nivel de código, no solo convención**: `tests/env.setup.js`
(cargado vía `jest.config.js` → `setupFiles`) hace
`process.env.DB_NAME = 'enelmapa_test'` **sin `||`**, sobreescribiendo
incondicionalmente cualquier valor heredado del shell, antes de que
cualquier test importe `app.js`/`db/schema.js`. Así `npm test` no puede
tocar otra base aunque el shell esté mal configurado.

`tests/helpers/db.js` → `resetDb()` = `initDb()` + `DELETE FROM businesses`.
Se llama en `beforeEach` de cada archivo de integración.

**Gotcha a documentar**: sin transacciones/sandboxing por test, dos archivos
de test corriendo en paralelo se pisarían — `package.json` script:
`"test": "jest --runInBand"` (serial).

`jest.config.js` (raíz):
```js
module.exports = { testEnvironment: 'node', setupFiles: ['<rootDir>/tests/env.setup.js'], testTimeout: 10000 };
```

### 3. Tests de integración (Supertest)

**`tests/integration/auth.test.js`**: login válido (302 + cookie) / password
incorrecta / email inexistente (mismo shape de respuesta que password
incorrecta, evita user enumeration) / `GET /admin/dashboard` sin sesión
(redirect a login) / con sesión válida vía `supertest.agent()` (200) /
logout invalida la sesión.

**`tests/integration/tenant-scoping.test.js`** (riesgo #1 de
`BEST_PRACTICES.md`): fixture de dos negocios (A/B) con su propia categoría
y producto (`tests/helpers/fixtures.js`), dos agents logueados por
separado:
- `GET /admin/categories` de A nunca trae datos de B.
- `POST /api/categories` de A inserta con `business_id` de A (verificado
  consultando la DB directo, no solo la respuesta JSON).
- `PUT`/`DELETE /api/categories/:id` de A sobre un id de B → responde
  `{ok:true}` (comportamiento actual) pero el registro de B queda intacto
  en DB — se verifica el estado real, no solo el código HTTP.
- Mismos 3 casos para `/api/products`.
- Request sin sesión a cualquier `/api/*` → 302 a login (comportamiento
  actual, aunque sea una API JSON).

**Hallazgo a documentar (no arreglar, ya acordado)**: `POST /api/products`
(`routes/api/index.js:95-107`) nunca valida que el `category_id` recibido
pertenezca al `business_id` de la sesión — a diferencia de `PUT`/`DELETE`
que sí filtran por `business_id`. Un admin de A podría crear un producto
con `business_id=A` pero `category_id` del árbol de B. Se agrega un test
que documenta este comportamiento actual (falla a propósito o `test.todo`,
con comentario apuntando a este hallazgo) — arreglo queda para un cambio
aparte, a decidir después.

### 4. Unit test — extraer `getSubdomain`

`services/subdomain.js` (nuevo): `getSubdomain(hostname)` pura, extraída de
la lógica duplicada en `server.js:33-40` (pasa a `app.js`) y
`middleware/tenant.js:9-14` — ambos pasan a `require` este módulo. Mata una
duplicación ya señalada en `BEST_PRACTICES.md` sección 1 de paso.

`tests/unit/subdomain.test.js`: `caficultor.enelmapa.co`→`caficultor`,
`www.enelmapa.co`→`null`, `admin.enelmapa.co`→`null`, `enelmapa.co`→`null`,
`localhost`→`null`, `a.b.enelmapa.co`→`a` (documenta comportamiento actual
tal cual).

**No** se extrae QR ni el array de días de la semana en este plan — son de
menor valor como ejemplo de testing (QR depende de librería externa, días
es solo dato) y `BEST_PRACTICES.md` ya los dejó para "cuando se toque ese
código de nuevo". Mantiene el plan enfocado.

### 5. QA: `QA_CHECKLIST.md` (nuevo, raíz del repo)

Checklist manual pre-merge para cambios de backend (routes/, middleware/,
db/, services/, app.js, server.js — vistas EJS/CSS solas quedan
exceptuadas):

```markdown
# QA Checklist — antes de mergear cualquier cambio de backend

- [ ] `npm test` en verde localmente contra `enelmapa_test`.
- [ ] Si toca `/api` o queries con `business_id`: reproducir a mano una vez
      el escenario de dos tenants contra `enelmapa_dev` (login negocio A y
      B, confirmar cero fuga cruzada específica de lo que se acaba de
      tocar).
- [ ] Reiniciar `npm run dev` en frío una vez (no hot-reload) y probar el
      flujo tocado (detecta fallos de boot que no aparecen con watch).
- [ ] Revisar la consola del server durante la prueba manual por errores no
      atrapados (no hay error-handler centralizado todavía).
- [ ] Si agrega/modifica columnas o tablas: correr `npm run dev` dos veces
      seguidas contra una `enelmapa_dev` con datos, confirmar que `initDb()`
      sigue siendo idempotente.
- [ ] Si toca sesión/auth: probar logout + re-login a mano una vez.
- [ ] `git diff` propio: grep por nuevos `db.query(` sobre
      `categories`/`products`/`business_hours`/`users`, confirmar que cada
      uno filtra por `business_id`.
- [ ] Confirmar `echo $DB_NAME` antes de correr tests/seed — nunca debe
      apuntar a producción.
```

### 6. Integración al flujo existente (ediciones, no archivos nuevos salvo lo ya listado)

- **`WORKFLOW.md`**: en el diagrama Mermaid, insertar `K1[npm test]` →
  `K2[QA_CHECKLIST.md]` entre `K[Probar contra enelmapa_dev]` y
  `L[Merge a main]`. En "Reglas fijas": agregar que todo cambio de
  routes/middleware/db/services/app.js/server.js requiere tests en verde +
  checklist completo antes de mergear. En "Dónde vive cada cosa": agregar
  `tests/` y `QA_CHECKLIST.md`.
- **`.claude/skills/enelmapa-dev/SKILL.md`**: "Resumen de una línea" — quitar
  "sin tests". Paso 3 del flujo de desarrollo — agregar que un cambio de
  backend requiere `npm test` + `QA_CHECKLIST.md` completo antes de darlo
  por terminado. "Setup local" — agregar bloque de setup de tests (el
  `sudo mysql` de arriba + `npm test`). Reemplazar la frase "No hay
  lint/build/test configurado" por pointer a `TESTING.md`. "Documentos de
  referencia" — agregar `TESTING.md` y `QA_CHECKLIST.md`.
- **`TESTING.md`** (nuevo): convenciones de fixtures, cómo agregar un test
  nuevo, el gotcha de `--runInBand`, por qué `enelmapa_test` se fuerza
  incondicionalmente.

**No se crea un skill nuevo** (`enelmapa-testing`) — se extiende
`enelmapa-dev`. Testing/QA no es un tipo de tarea distinto (a diferencia de
`cargar-menu-pdf`, que opera por HTTP sin tocar código): es un paso
obligatorio dentro del mismo flujo de "tarea de desarrollo" que el skill ya
define. El patrón ya establecido en el repo es skill operacional + docs
companion que linkea (`CLAUDE.md`, `BEST_PRACTICES.md`, `BUSINESS_MODEL.md`)
— `TESTING.md` encaja ahí, no necesita ser un skill aparte.

## Rollout (fases independientes, cada una mergeable sola)

1. Split `app.js`/`server.js` (Team mode — toca el bootstrap de todos los
   tenants). QA: `npm run dev` idéntico a hoy.
2. Fundación: `jest`+`supertest` en devDependencies, `jest.config.js`,
   `tests/env.setup.js`, `tests/helpers/{db,fixtures}.js`, crear
   `enelmapa_test`, un test de humo (`GET /` → 200) para validar el pipe
   completo.
3. `services/subdomain.js` + `tests/unit/subdomain.test.js`, cablear en
   `app.js` y `middleware/tenant.js`.
4. `tests/integration/auth.test.js`.
5. `tests/integration/tenant-scoping.test.js` (incluye el test que
   documenta el hallazgo del `category_id` cruzado).
6. `QA_CHECKLIST.md` + ediciones a `WORKFLOW.md`/`SKILL.md` + `TESTING.md`.

## Verificación end-to-end

- Después de fase 1: `npm run dev` contra `enelmapa_dev`, confirmar que la
  app arranca y responde igual que antes del split (`curl localhost:3000/`).
- Después de fase 2: `npm test` corre el test de humo en verde contra
  `enelmapa_test` (confirmar con un `SELECT` manual que `enelmapa_dev` no
  se tocó).
- Después de cada fase de tests (3-5): `npm test` en verde, revisar que los
  nombres de los tests reflejen los casos descritos arriba.
- Al final: recorrer `QA_CHECKLIST.md` una vez completo, contra un cambio
  de prueba chico, para confirmar que el checklist es accionable tal cual
  está escrito.

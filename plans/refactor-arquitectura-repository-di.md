# Refactor arquitectónico de enelmapa — Repository, DI y capa de servicios

## Contexto

`enelmapa` es un SaaS multi-tenant de menús digitales (~2.500 líneas, Node/Express/EJS/MySQL)
que hoy sigue el patrón **routes → DB directo**: cada handler llama `getPool()` y escribe SQL
inline. Funciona, pero no tiene ninguna capa entre la ruta y la base: sin repository, sin
servicios, sin inyección de dependencias, sin validación, sin manejo de errores centralizado.

El usuario pidió (a) auditar todos los huecos del código y (b) proponer una arquitectura mejor
con patrones de diseño, patrón repository e inyección de dependencias.

La auditoría encontró **7 bugs de comportamiento, 9 huecos de seguridad y 8 problemas
estructurales**. El más peligroso a largo plazo es estructural: el filtro `business_id` es manual
en cada query y nada impide olvidarlo — en un multi-tenant eso es fuga de datos entre negocios.

Pero el más urgente es operativo y está en producción hoy. Tres hallazgos que por separado
parecen menores se combinan en un fallo de plataforma: reordenar categorías cae en el handler
equivocado (B1), el error resultante no lo atrapa nadie (B6), y la sesión vive en memoria (S9).
Resultado: **cualquier dueño de negocio que arrastre una categoría en su panel mata el proceso
Node y desloguea a todos los admins de todos los negocios.** Reproducido en vivo durante el QA
de la Fase 0. Es la razón por la que la Fase 1 va antes que cualquier refactor.

Resultado buscado: una base donde el aislamiento entre tenants sea **imposible de olvidar** (lo
fuerza el tipo, no la disciplina), los errores no cuelguen requests, y cada pieza sea testeable
en aislamiento. Todo por fases mergeables, sin big-bang.

Decisiones tomadas con el usuario antes de escribir este plan (2026-08-06):

- Mergear la suite de tests (`feat-backend-testing-qa`) a `main` **primero** — es la red de
  seguridad que hace viable mover código de lugar.
- Alcance **completo** (repository + servicios + DI + errores + validación + seguridad +
  migraciones), no un subconjunto.
- DI con **composition root a mano**, sin Awilix ni dependencias nuevas.
- Los fixes de bugs van en una **rama corta previa**, para no mezclar "mover código" con
  "cambiar comportamiento".

---

## Auditoría — qué está mal hoy

### Bugs de comportamiento

| # | Hallazgo | Dónde |
|---|---|---|
| B1 | **`PUT /api/categories/reorder` tumba el proceso entero.** Lo captura `/categories/:id` (registrado antes), que ejecuta `UPDATE categories SET name = NULL WHERE id = 'reorder'` → `ER_TRUNCATED_WRONG_VALUE`. Sin error-handler (B6) queda como unhandled rejection y **Node mata el proceso**. Reproducido en vivo durante el QA de la Fase 0, no es teórico. `products/reorder` sí funciona (registrado antes que `:id`) | `routes/api/index.js:72` vs `:85` |
| B2 | `POST /api/products` no valida que `category_id` sea del negocio de la sesión → producto de A colgando de una categoría de B | `routes/api/index.js:95-107` |
| B3 | Igual en `PUT /api/products/:id`: el `WHERE` filtra por `business_id`, pero el `SET category_id` no se valida → mover un producto propio al árbol de otro tenant. **Hallazgo nuevo**, no cubierto por el test de B2 | `routes/api/index.js:118-132` |
| B4 | Todas las mutaciones responden `{ok:true}` sin mirar `affectedRows` → "no existe" y "no es tuyo" se ven igual que "listo" | `routes/api/index.js` (todas) |
| B5 | `parseFloat(price)` sin chequear `NaN` → error SQL | `routes/api/index.js:103`, `:122` |
| B6 | **Sin error-handler central.** Un throw async deja la request colgada sin respuesta (no 500). Solo `/settings` tiene `try/catch` | `app.js:58-60` (solo hay 404) |
| B7 | `GET /` es async sin protección: si MySQL no responde, la home cuelga | `app.js:51-56` |

### Seguridad

| # | Hallazgo | Dónde |
|---|---|---|
| S1 | `cookie.secure: false` hardcodeado → la cookie de sesión viaja en claro también en producción | `app.js:22` |
| S2 | `SESSION_SECRET` cae a un default hardcodeado en el fuente | `app.js:17` |
| S3 | Superadmin compara password con `===` contra una env var — sin bcrypt y sin `timingSafeEqual`, justo la cuenta con más privilegios | `routes/superadmin.js:16` |
| S4 | Sin CSRF en ninguna mutación (`/api`, `/admin`, `/superadmin`) | global |
| S5 | Sin rate limiting en los dos logins — fuerza bruta libre, crítico en `/superadmin` | `routes/admin.js:11`, `routes/superadmin.js:14` |
| S6 | Multer sin `fileFilter`: acepta cualquier tipo y `uploads/` se sirve estático | `routes/api/index.js:20` + `app.js:14` |
| S7 | Editar `slug` desde superadmin sin validar formato ni duplicados → viola el UNIQUE y, por B6, cuelga | `routes/superadmin.js:80` |
| S8 | `/api/*` sin sesión responde `302` HTML a login en vez de `401` JSON | `middleware/auth.js` |
| S9 | Sesión en `MemoryStore` — causa raíz confirmada de los 302 aleatorios bajo Passenger | `app.js:16-25` |

### Estructura

| # | Hallazgo | Dónde |
|---|---|---|
| E1 | **El scoping por `business_id` es manual en cada query.** Nada lo fuerza | `routes/api/index.js`, `routes/admin.js` |
| E2 | `getPool()` singleton importado a nivel de módulo en 6 archivos → sin costuras para testear ni inyectar | global |
| E3 | Lógica duplicada: QR (`admin.js:84-93` ↔ `api/index.js:141-150`), array de días (`seed.js:197` ↔ `superadmin.js:63`), alta de negocio+horarios (`seed.js:188-200` ↔ `superadmin.js:53-67`), fallback de `DOMAIN` en 3 archivos | varios |
| E4 | Config dispersa: `process.env.X \|\| default` repetido, sin módulo central ni fail-fast | varios |
| E5 | Cero validación de entrada (sin zod ni guards) | global |
| E6 | Sin migraciones: `initDb()` + `ALTER TABLE` en `try/catch` vacío | `db/schema.js:42` |
| E7 | Se sirve `public/` estático pero el directorio no existe | `app.js:13` |
| E8 | Logging sólo con `console.error`, sin estructura ni niveles | global |

---

## Arquitectura objetivo

```
config/index.js              Fuente única de env, con fail-fast en producción
container.js                 Composition root: instancia y cablea todo (DI)
app.js                       createApp(container) — sin requires de DB adentro
server.js                    Bootstrap: migraciones → createApp → listen

db/
  pool.js                    createPool(config) — factory, no singleton
  migrations/                001_initial.sql, 002_*.sql … + runner
repositories/
  tenantScoped.js            forBusiness(id) — el corazón del aislamiento
  businessRepository.js      categoryRepository.js  productRepository.js
  userRepository.js          businessHoursRepository.js
services/
  authService  businessService  categoryService  productService
  menuService  qrService  storageService  subdomain.js (ya existe)
controllers/
  adminController  apiController  superadminController  publicController
middleware/
  auth  superauth  tenant  errorHandler  asyncHandler  validate
errors/                      NotFoundError, ForbiddenError, ValidationError…
validators/                  Esquemas zod por recurso
routes/                      Sólo cableado: router + middleware + controller
```

### Los patrones y qué problema resuelve cada uno

**Repository con scoping forzado** (mata E1, B2, B3). La pieza central: no existe forma de
consultar `products`/`categories` sin pasar por `forBusiness(businessId)`.

```js
// repositories/productRepository.js
function productRepository(pool) {
  return {
    forBusiness(businessId) {
      if (!businessId) throw new Error('productRepository: businessId requerido');
      return {
        async create({ name, price, categoryId, ... }) {
          // la categoría se valida contra el MISMO businessId — B2/B3 dejan de ser posibles
          const owns = await categoryRepository(pool).forBusiness(businessId).exists(categoryId);
          if (!owns) throw new ForbiddenError('La categoría no pertenece a este negocio');
          ...
        },
        update: (id, data) => pool.query('UPDATE products SET ? WHERE id=? AND business_id=?', [data, id, businessId]),
        delete: (id) => pool.query('DELETE FROM products WHERE id=? AND business_id=?', [id, businessId]),
      };
    }
  };
}
```

No se expone ningún método fuera de `forBusiness`: olvidar el filtro deja de ser una opción.

**Dependency Injection — composition root a mano** (mata E2). `container.js` instancia
`pool → repos → services` y los inyecta; `createApp(container)` recibe todo ya cableado. Sin
dependencias nuevas y sin magia: cada `require` de `getPool()` a nivel de módulo desaparece, y
un test puede inyectar un pool de prueba o un repo falso.

```js
// container.js
function createContainer(config) {
  const pool = createPool(config.db);
  const repos = {
    businesses: businessRepository(pool),
    categories: categoryRepository(pool),
    products:   productRepository(pool),
  };
  const services = {
    menu: menuService(repos),
    qr:   qrService(config),
  };
  return { pool, repos, services };
}

// app.js
const app = createApp(createContainer(config));
```

**Capa de servicios** (mata E3). La lógica de negocio sale de los handlers: `qrService` reemplaza
las dos copias de generación de QR, `businessService.createWithDefaults()` unifica el alta de
negocio+horarios entre `seed.js` y `superadmin.js`, `DAYS` vive en un solo lugar.

**Errores de dominio + error handler central** (mata B4, B5, B6, B7, S7, S8). Los servicios lanzan
`NotFoundError`/`ForbiddenError`/`ValidationError`; un único middleware al final los mapea a
status + formato correcto — JSON para `/api`, EJS para el resto. Ahí se resuelve de una vez que
`/api` devuelva `401` en vez de `302`, y que "no encontrado" deje de responder `{ok:true}`.
`asyncHandler(fn)` envuelve cada ruta async para que ningún throw quede huérfano.

**Factory** para `createPool`, `createApp` y `forBusiness`. **Strategy** en `storageService`, para
que mover uploads de disco a S3 mañana no toque ningún controller. **Mapper** en `menuService`,
que absorbe el armado de `menuData` que hoy vive en `routes/public.js`.

**Validación en el borde**: middleware `validate(schema)` con zod por recurso (`slug` con regex,
`price` numérico positivo, `email`) — mata E5, B5 y S7 juntos.

---

## Fases

Cada fase es una rama propia, mergeable y verificable sola, siguiendo `WORKFLOW.md`
(rama → probar contra `enelmapa_dev` → `npm test` → `QA_CHECKLIST.md` → merge → avisar del
`git pull` manual).

**Fase 0 — Cerrar `feat-backend-testing-qa`.** QA manual pendiente (arranque en frío, dos
tenants, grep del diff) y merge a `main`. Sin esto el refactor no tiene red.

**Fase 1 — Fixes (rama corta, antes de mover nada).** Cada uno con su test de regresión:
B1 reordenar rutas, B2+B3 validar pertenencia de `category_id`, S1 `secure` según entorno,
S3 bcrypt + `timingSafeEqual` para el superadmin. El test `[BUG CONOCIDO]` de
`tests/integration/tenant-scoping.test.js:132` se invierte acá: pasa a exigir el rechazo.

**Fase 2 — Cimientos: `config/` + errores + `asyncHandler`.** Config central con fail-fast en
producción si falta `SESSION_SECRET` (S2, E4), jerarquía de errores, error handler al final de
`app.js`, `asyncHandler` en todas las rutas async. Sin cambios de lógica de negocio.

**Fase 3 — DI: `container.js` + `createPool` + `createApp(container)`.** Mecánico: `getPool()`
deja de importarse a nivel de módulo; todo recibe sus dependencias. Los tests pasan a inyectar
el pool en vez de depender de `tests/env.setup.js` para forzar la base.

**Fase 4 — Repositories con scoping forzado.** Cinco repos + `forBusiness`. Los handlers pasan a
llamar repos en vez de SQL inline. Es la fase de mayor valor y mayor riesgo: se hace recurso por
recurso (categorías → productos → negocio → usuarios → horarios), corriendo la suite entre cada uno.

> **Nota de alcance agregada el 2026-08-07 — transacciones.** Los repos se construyen sobre un
> *ejecutor*, no sobre el pool: `buildRepos(db)` donde `db` puede ser el pool o una
> `PoolConnection` (en `mysql2` los dos exponen la misma `.query()`, así que el repo no necesita
> saber cuál le tocó). El container expone `withTransaction(fn)`, que abre una conexión y le pasa
> a `fn` un juego nuevo de repos atado a ella.
>
> Se decide acá y no más tarde porque define la firma de los cinco repos. La alternativa —un
> parámetro `{ conn }` opcional en cada método— duplica ~25 firmas y basta olvidarlo en una para
> perder la atomicidad en silencio; adentro de `withTransaction` sólo existe `tx`, así que mezclar
> una llamada del pool con una de la conexión deja de ser posible.
>
> El uso llega en la Fase 5, con los servicios. Los dos únicos call sites que lo necesitan:
> `POST /superadmin/create` (negocio + usuario + 7 horarios) y `POST /api/settings` (negocio +
> loop de horarios). El resto son escrituras de una sola sentencia.
>
> Motivo concreto, reproducido contra `enelmapa_dev` el 2026-08-07: si el `admin_email` ya existe
> (`users.email` es UNIQUE y `POST /create` sólo pre-chequea el `slug`), el negocio se inserta, el
> usuario falla, y queda un negocio con 0 admins y 0 horarios — con el slug ocupado, así que el
> operador no puede ni reintentar.
>
> Guardarraíl: `withTransaction` no es el default. Envolver sólo el tramo de escrituras, nunca
> subida de imágenes ni generación de QR — una transacción abierta retiene una conexión de un pool
> de 10.

**Fase 5 — Servicios + controllers.** `routes/` queda como cableado puro. Se eliminan las cuatro
duplicaciones de E3. `db/seed.js` pasa a usar `businessService`, así deja de ser una tercera copia.

**Fase 6 — Endurecimiento.** Validación zod (E5), CSRF (S4), rate limiting en logins (S5),
`fileFilter` con magic bytes en multer (S6), y session store real en MySQL (S9) — este último
cierra los 302 aleatorios que hoy afectan también al flujo de `cargar-menu-pdf`.

**Fase 7 — Migraciones versionadas.** Runner propio (~50 líneas, tabla `schema_migrations`) con el
schema actual congelado como `001_initial.sql`. Reemplaza el `ALTER` en `try/catch`. Va último
porque toca producción de la forma más delicada y conviene hacerlo con todo lo demás ya estable.

**Nota de alcance:** las vistas EJS no se tocan. El contrato de `/api` se mantiene salvo dos
cambios deliberados y documentados: `401` en vez de `302` (S8) y `404`/`403` donde hoy hay
`{ok:true}` falso (B4). Ambos afectan al JS inline de `views/admin/*.ejs`, que se ajusta en la
misma fase que los introduce.

---

## Verificación

- **Por fase**: `npm test` en verde + `QA_CHECKLIST.md` completo antes de cada merge. La suite
  actual (23 tests) es el contrato de no-regresión: si el refactor la rompe, el refactor está mal.
- **Fase 1**: los tests nuevos deben fallar *antes* del fix y pasar después. Ojo con el de B1: hoy
  no "falla" limpio, revienta el worker de Jest con un unhandled rejection — así que conviene
  escribirlo junto con el error-handler mínimo, o aceptar que el rojo se vea feo la primera vez.
- **Fase 4**: además del test genérico, prueba manual de dos tenants contra `enelmapa_dev`
  (login como A y como B, confirmar cero fuga cruzada), que es lo que el checklist ya exige.
- **Cobertura nueva por fase**: cada repo con test de aislamiento, cada servicio con unit test
  (ya son funciones puras o inyectables), cada error de dominio con su test de mapeo a HTTP.
- **End-to-end al cerrar**: `npm run dev` en frío contra `enelmapa_dev` con datos del seed,
  recorrer admin completo (login → categorías → productos con imagen → settings con logo/banner →
  QR) y el menú público en `/s/caficultor`, confirmando cero diferencias visibles con hoy.
- **Antes del `git pull` en el servidor**: backup de la base de producción, obligatorio a partir
  de la fase 7.

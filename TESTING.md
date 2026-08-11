# Testing — enelmapa

Jest + Supertest. `npm test` corre toda la suite (`unit/` y `integration/`)
contra la base de datos local `enelmapa_test` (separada de `enelmapa_dev` y
de producción).

## Setup (una sola vez)

```bash
sudo mysql -e "
CREATE DATABASE IF NOT EXISTS enelmapa_test CHARACTER SET utf8mb4;
GRANT ALL PRIVILEGES ON enelmapa_test.* TO 'enelmapa_dev'@'localhost';
FLUSH PRIVILEGES;
"
```

Reusa el usuario `enelmapa_dev`/`enelmapa_dev_local` que ya existe para el
entorno de desarrollo (ver `.claude/skills/enelmapa-dev/SKILL.md`).

## Correr los tests

```bash
npm test
```

## Estructura

- `tests/unit/` — funciones puras, sin HTTP ni DB real. Ejemplo:
  `tests/unit/subdomain.test.js` contra `services/subdomain.js`.
- `tests/integration/` — Supertest contra la app real (armada con
  `createTestApp()`), con MySQL real (`enelmapa_test`). Cubren rutas
  completas: auth, scoping por `business_id`, etc.
- `tests/repositories/` — el repo directo contra MySQL real, sin HTTP ni
  sesión. Prueban que el aislamiento por `business_id` se sostiene aunque a
  un repo lo llame un servicio o un script en vez de una ruta, y que no hay
  forma de saltearse `forBusiness`. Cada repo nuevo de la Fase 4 trae el suyo.
- `tests/helpers/container.js` — `createTestApp()`, `getTestPool()`,
  `getTestRepos()`, `getTestContainer()`. Desde la Fase 3 la app se construye
  con dependencias inyectadas, así que un test la arma acá en vez de
  `require('../../app')`.
- `tests/helpers/db.js` — `resetDb()` (aplica las migraciones pendientes y
  hace `DELETE FROM businesses`, que limpia el resto en cascada por FK) y
  `closeDb()` (cierra el pool y el store de sesión al final; si no, Jest queda
  colgado esperando el timer de limpieza del store).
- `tests/helpers/sesion.js` — `loginAdmin()` / `loginSuperadmin()`, que hacen
  login **y adjuntan el token CSRF**. Desde que hay CSRF toda mutación lo
  necesita, y la suite no lo desactiva: usa el stack real.
- `tests/helpers/fixtures.js` — `createBusiness(...)` /
  `createTwoBusinesses()` para levantar negocios de prueba completos
  (admin, categoría, producto) rápido en cualquier test nuevo.
- `tests/env.setup.js` — fuerza `DB_NAME=enelmapa_test` de forma
  incondicional (sin `||`) antes de que cualquier test importe `app.js`.
  **No tocar esto para "apuntar a otra base rápido"** — es la única barrera
  de código (no solo convención) que impide que `npm test` toque
  `enelmapa_dev` o producción por error.

## Gotchas

- **Un solo `afterAll(closeDb)` por ARCHIVO**, no por `describe`: el `afterAll`
  de un bloque corre al terminar ese bloque, así que cerrar el pool ahí deja al
  siguiente `describe` del mismo archivo sin conexión.
- **`--runInBand` es obligatorio** (ya está en el script `test` de
  `package.json`). No hay transacciones ni sandboxing por test — todos
  comparten la misma DB `enelmapa_test`, así que dos archivos corriendo en
  paralelo se pisarían el estado. Si algún día se necesita paralelismo real,
  hay que migrar a una DB (o schema) por worker primero.
- Las rutas de `/api/*` sin sesión responden `401` JSON; las de `/admin`,
  `302` al login. Eso cambió en la Fase 2 (antes `/api` también redirigía, y
  el `fetch()` del panel recibía el HTML del login como si fuera la respuesta
  a su petición). Ver `middleware/auth.js`.
- Las mutaciones de `/api` que no afectan ninguna fila responden `404`, y es
  **404 también cuando la fila existe pero es de otro negocio** (cierre de B4).
  Un `403` ahí confirmaría que ese id existe en otro negocio, y con eso se
  podrían enumerar los datos ajenos: hay un test que fija que los dos casos son
  indistinguibles desde afuera.
- Toda mutación necesita el **token CSRF**. La suite no lo desactiva: usar
  `loginAdmin()` / `loginSuperadmin()` de `tests/helpers/sesion.js`, que lo
  adjuntan. Un `request.agent(app)` pelado va a recibir `403` en cualquier POST.
- El **rate limiting de los logins está desactivado** en la suite
  (`RATE_LIMIT_LOGIN_MAX=0` en `env.setup.js`), porque hace decenas de logins
  desde la misma IP. Se prueba aparte, con su propio límite chico, en
  `tests/integration/rate-limit.test.js`.
- El **logger está silenciado** (`LOG_SILENT`), porque la suite provoca cientos
  de errores a propósito y mezclarlos con la salida de jest hace imposible
  distinguir una falla real.
- El middleware de subdominio en `app.js` trata cualquier Host con 3+
  partes separadas por punto (cuya primera parte no sea `www`/`admin`) como
  un slug de negocio — incluye IPs tipo `127.0.0.1`. Si un test le pega a
  `GET /` y necesita la home (no el menú público), hay que forzar
  `.set('Host', 'localhost')` en la request (ver comentario en
  `tests/integration/smoke.test.js`).

## Cómo agregar un test nuevo

1. ¿Es lógica pura, sin DB ni HTTP? → `tests/unit/`, sin fixtures.
2. ¿Prueba una ruta completa? → `tests/integration/`, usar
   `resetDb()`/`closeDb()` de `tests/helpers/db.js` y, si hace falta más de
   un negocio, `createTwoBusinesses()` de `tests/helpers/fixtures.js`.
3. Si el test documenta un bug conocido en vez de la conducta deseada
   (como `tests/integration/tenant-scoping.test.js` con el `category_id`
   cruzado), nombrarlo con el prefijo `[BUG CONOCIDO]` y dejar un comentario
   explicando por qué no se arregla ahí — así el día que se arregle, el
   test falla a propósito y obliga a actualizarlo con intención, no
   desaparece en silencio.

Ver `QA_CHECKLIST.md` para el paso manual que va después de que los tests
pasen, y `plans/testing-qa-integration-setup.md` para el plan original con
el que se armó todo esto.

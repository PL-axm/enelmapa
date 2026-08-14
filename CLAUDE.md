# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**enelmapa** — multi-tenant digital menu platform (`enelmapa.co`). Each tenant is a "business" (a restaurant/café) with its own slug, categories, products, and public menu page. Plain Node.js + Express + EJS + MySQL, no frontend build step and no bundler.

## Commands

```
npm start        # node server.js
npm run dev       # node --watch server.js (auto-restart on change)
npm run seed      # node db/seed.js — wipes ALL data and re-seeds one demo business ("caficultor")
npm test          # jest --runInBand (integration + unit, ~280 tests)
```

There is no lint or build step. `npm test` is the gate before any merge — see `QA_CHECKLIST.md`, which is the only gate this project has (no CI, no staging).

**Tests need their own database.** `tests/env.setup.js` forces `enelmapa_test` and refuses to run against anything else, so the suite can never touch dev or production data. `--runInBand` is not optional: the suite shares one database and parallel workers would clear each other's fixtures mid-test.

### Environment variables

`PORT`, `DOMAIN` (default `enelmapa.co`), `SESSION_SECRET`, `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`, `SUPER_EMAIL`, `SUPER_PASS` / `SUPER_PASS_HASH` (superadmin login; the plaintext defaults `admin@enelmapa.co` / `super2026` are insecure on purpose and only acceptable in local dev), `LOG_LEVEL`, `LOG_SILENT`, `RATE_LIMIT_WINDOW_MIN`, `RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_SUPER_MAX` (a rate limit of `0` disables the limiter — that's how the tests do dozens of logins from one IP).

**`SESSION_SECRET` is mandatory under `NODE_ENV=production`**: `loadConfig` throws instead of booting, because a deployment that forgot it would otherwise sign every session with the default secret that lives in this public repo.

## Architecture

### Dependency injection — no module-level singletons

Nothing imports a shared pool or a shared config object. `server.js` calls `loadConfig()`, hands it to `createContainer(config)` (the composition root, `container.js`), and passes the container to `createApp(container)`.

The rule that keeps this honest: **the container stops at `createApp`.** It destructures the container and hands each router and middleware only what that piece uses — `createAdminRouter({ repos, services, config })`, `createTenantMiddleware({ repos })`, `createPublicRouter({ services })`. Nothing below `app.js` receives the container. Passing it further down would make dependencies invisible again and force every test to build the world; that's a service locator, not DI. When you add a route file, follow the same shape: export a `createXRouter({ ... })` factory, destructure only your dependencies, and wire it in `app.js`.

**No router receives the pool.** That's the load-bearing detail: there is no SQL outside `repositories/`, so `pool` appearing in a router signature means something skipped the repository layer.

`app.js` is wired from one place on purpose. `server.js` and `tests/helpers/container.js` both pass the whole container — when they each assembled the app separately they drifted, the suite stayed green, and the real server 500'd on every route.

`config/index.js` exports only `loadConfig(env)` — importing it has no side effects and cannot throw. It is the single source for `process.env`: `config.db`, `config.superadmin`, `config.session`, `config.log`, `config.rateLimit`, `config.domain`, `config.port`, `config.nodeEnv`/`isProduction`. Do not read `process.env` anywhere else.

Tests build their own app with `tests/helpers/container.js` (`createTestApp()`, `getTestPool()`, `getTestContainer()`).

### Repositories — tenant scoping is not optional

`repositories/` holds all SQL. The tenant-scoped repos (`categories`, `products`, `businesses`, `users`) **expose no table-level methods at all**: the only entry point is `forBusiness(businessId)`, which returns the methods already bound to that business. There is no unscoped variant to call by mistake, and `forBusiness` throws on a non-positive-integer id rather than issuing `WHERE business_id = NULL` — which matches nothing in MySQL, so a read would come back empty and a write would do nothing, both silently and both looking like success.

Operations that genuinely cannot be scoped (login by email, the superadmin's cross-business views) live under a separate `platform` surface, so reading `repos.users.platform.x` is a visible statement that this call is deliberately unscoped.

Writes return whether they affected a row. Handlers must use that: `404` when nothing matched. A foreign row returns `404`, not `403`, on purpose — `403` would confirm the row exists and turn the endpoint into an id enumerator.

Repos are built over an *executor*, not the pool: `buildRepos(db)` where `db` is the pool or a `PoolConnection` (in `mysql2` both expose the same `.query()`). That's what lets `container.withTransaction(fn)` hand `fn` a fresh set of repos bound to one connection. Use it only for invariants spanning several writes (creating a business + its admin + its 7 hour rows); never wrap image uploads or QR generation, since an open transaction holds one of the pool's 10 connections.

### Services

`services/` holds decisions that aren't routing or storage: `authService` (bcrypt cost, and the decoy hash that equalizes login timing), `businessService.createWithDefaults()` (the `withTransaction` call site), `qrService`, `menuService`, `promos`, `logger`, `imageUpload`, `jsonInline`, `subdomain`, `superadminAuth`. `routes/` is wiring: read input, call a service or repo, render or respond.

**`jsonInline(valor)`** is how data gets embedded in a page — never bare `JSON.stringify`. It escapes `<`, `>`, `&`, the single quote and U+2028/2029 as `\uXXXX`, which stays valid JSON *and* valid JavaScript. Two live bugs came from not having it: a product named `</script><img src=x onerror=…>` closed the menu's script tag, and a description containing `pico e' gallo` truncated an `onclick='…'` attribute so the Edit button stopped working. It deliberately does **not** escape double quotes (they're structural in `JSON.stringify` output), so its contract requires **single-quoted** attributes.

### `theme/` — the menu's look, as data

Three independent axes, each a registry with one list and several consumers:

| Axis | Column | Registry |
|---|---|---|
| Colour (palette) | `menu_theme` — *despite the name, it is only colours* | `theme/paletas.js` |
| Layout (skin) | `menu_template` | `theme/templates.js` |
| Type size | `menu_scale` | `theme/escalas.js` |

Any combination of the three is valid, which is why they're three columns and not one "style".

**Add a palette, skin or scale in `theme/` and nowhere else.** The validator builds its `z.enum` from the registry, the settings view iterates it to draw the options, and the menu emits the CSS from it. That list used to be written three times and it desynchronised: the panel offered `navy` while the validator accepted `blue`, so the fifth palette returned 400 and `blue` saved fine but had no CSS and silently rendered as light. `tests/unit/theme.test.js` now fails if the validator and the registry disagree.

The scale is a **multiplier**, not a table of sizes: `font-size: calc(14.5px * var(--escala))`. The tuned px values stay where they are and keep changing per breakpoint; the scale only stretches them proportionally. `normal` is exactly `1`. A test reads every `calc(Npx * var(--escala))` in the shell and all skins and refuses a resulting size under 11px.

### Skins: shell + `views/menu/*.ejs`

`views/menu.ejs` is the **shell**: head, palette/scale CSS variables, the shared chrome (banner, header, category nav, search, product modal, info modal, footer, WhatsApp FAB, promo popup) and the script that drives navigation, scroll-spy, search and the modal. It includes one skin.

A skin is its own `<style>` plus one object, and nothing else:

```js
window.SKIN = {
  contenedorProductos()          // where a category's cards go
  tarjetaProducto(p, helpers)    // the DOM node for one card
};
```

`contenedorProductos` is what makes the contract worth having: `clasico` returns a `DocumentFragment` (its list needs no wrapper), `grilla` returns a `div` with `display: grid`. `helpers.formatPrice` is passed in rather than read as a global, because the skin's script runs in `<head>` before the shell defines anything.

Two rules that are easy to get wrong:

- **The shell calls `tarjetaProducto` twice** — for the menu and for search results. Never build a card by hand somewhere else; that's how the search version ended up concatenating `p.name` into `innerHTML` while the menu used `textContent`.
- **Anything the chrome uses is declared in the chrome.** `.product-price-old` and `.promo-badge` live in the shell because the product modal uses them. They were in `clasico.ejs` and looked fine only because it was the single skin.

**The skin is resolved in the router**, via `plantillaOPorDefecto`, never from `business.menu_template` in the view: the shell does `include('menu/' + plantilla)`, so a value hand-written into that column would otherwise become an arbitrary include.

### Promotions

A promotional price on an existing product, with validity. There's no standalone "promo" entity.

```sql
products.promo_price DECIMAL NULL   -- NULL is the on/off switch
products.promo_label VARCHAR(40)    -- "2x1", "-30%"
products.promo_from / promo_to DATE -- NULL = no start / no expiry, both inclusive
products.promo_days CHAR(7)         -- '0010100'; POSITION 0 IS SUNDAY
businesses.promos_enabled TINYINT   -- governs promos AND the flyer
businesses.promo_flyer VARCHAR(500) -- one image, shown as a popup on load
```

**A promotion exists when there is a promotional price OR a label** — both are legitimate: lowering the price shows the old one struck through, while a `2x1` or a "wings Tuesday" doesn't change the unit price at all, it changes what you get. The first version required a price, which made the most common restaurant promotion impossible to enter. That switch is duplicated in three places by necessity (`validators`, `services/promos.js`, `productRepository`) and each one says so.

`promo_price` is what makes the strikethrough appear — not a separate `promo_active`, because two sources for one fact end up contradicting each other; and `NULL` rather than `0` because `0` is a valid price. `promo_days` position 0 is **Sunday**, matching `business_hours.day_index` and `Date.getDay()`; a second weekday convention in the same database is a silent off-by-one waiting to happen.

`services/promos.js` decides validity and is **pure**: `estado(producto, hoy)` returns `activa` / `programada` / `vencida` / `fuera-de-dia` / `sin-promo`, and the panel shows that state per product — without it the owner loads a promo, doesn't see it in the menu and has no way to know why.

**The clock, and it is the delicate part:**

- Evaluated **server-side**. A promo that appears according to the visitor's phone clock cannot be supported.
- In the business's timezone (`config.zonaHoraria`, `America/Bogota`), never UTC. If the process runs in UTC, "today" flips at 7pm Colombian time and a promo expiring "on the 31st" would switch off on the 30th at 19:00.
- **The date is injected, never read inside**: the router computes `promos.hoyEn(config.zonaHoraria)` and passes it. A `new Date()` in there would make a "Tuesday promo" test pass today and fail on Thursday.
- **mysql2 returns a `DATE` column as a `Date` at the process's *local* midnight.** `toISOString()` on that shifts the date by a day on any server east of Greenwich. Use `promos.aFechaTexto`, which reads the local components — the ones mysql2 put there.

`menuService.buildMenu` returns `{ promos, categorias }`. `promos` is `null` when the section is off, when nothing is valid today, or when no date was passed, so **the decision to show the section lives in one place**. A product on promotion appears in the section *and* in its own category: the section is a shortcut, not a move.

### Request-edge conventions

- **Validation**: zod schemas in `validators/`, applied by `middleware/validate.js`, which *replaces* `req.body` with the coerced data — so a handler never sees a raw string where it expects a number. On failure it also deletes any file multer already wrote to disk.
- **CSRF**: `middleware/csrf.js`, synchronizer-token pattern, compared with `crypto.timingSafeEqual`. `provide` exposes the token to views (only for authenticated sessions, so an anonymous menu visitor doesn't get a `sessions` row); `createProtect` verifies it on every mutation. The two logins are exempt — they're the only mutations with no prior session, so no token can exist yet. Views send it as a `_csrf` hidden input or an `X-CSRF-Token` header (`apiFetch` in `views/partials/admin-head.ejs` adds it automatically).
- **Errors**: throw from `errors/index.js`; `asyncHandler` catches async rejections and `middleware/errorHandler.js` (last `app.use` in `app.js`) renders or serializes them. Don't write `try/catch` + `res.status(500)` in a handler.
- **Sessions**: `req.session.regenerate()` before writing session data at login (`regenerarSesion` in `middleware/sesion.js`), or a pre-planted cookie stays valid as the victim's session. Logout is **POST** with a CSRF token — as a GET, any `<img src="/admin/logout">` would log the admin out, and browser preloaders visit GETs on their own.

### Three separate auth realms, one Express app

- **Public menu** — no auth. Resolves a tenant and renders its menu.
- **`/admin`** (`routes/admin.js`, `middleware/auth.js`) — a business owner managing *their own* business only. Session holds `userId` + `businessId`; every admin/API query is scoped by `req.session.businessId`.
- **`/superadmin`** (`routes/superadmin.js`, `middleware/superauth.js`) — a single hardcoded platform operator (`SUPER_EMAIL`/`SUPER_PASS`, not a DB row) who can create/edit/delete any business and reset any admin's password.

These are independent session flags (`session.userId` vs `session.isSuper`) — a superadmin session does not imply admin access to a specific business, and vice versa.

### Tenant resolution (multi-tenancy)

A business is addressed two ways, both handled by `middleware/tenant.js`:
1. **Subdomain**: `<slug>.enelmapa.co` — `server.js`'s `getSubdomain()` extracts the first host segment (excluding `www`/`admin`) and rewrites the request as if it hit `/s/:slug`.
2. **Path**: `/s/:slug` — used directly, e.g. for local dev where subdomains aren't practical.

`tenantMiddleware` loads the business + its hours/categories/active products and attaches them to `req.business`, `req.businessHours`, `req.categories`, `req.products`. `routes/public.js` is a catch-all (`router.get('*', ...)`) that just shapes this into `menuData` and renders `views/menu.ejs` — it has no idea which tenant it's rendering, that's entirely the middleware's job.

### Route/data split: `/admin` renders pages, `/api` mutates data

`routes/admin.js` only handles page rendering (login, dashboard, settings, categories, products, QR) and reads. All create/update/delete/reorder operations — for business settings, categories, products, image uploads (multer), and QR generation — live under `routes/api/index.js`, guarded by the same `authRequired` middleware, scoped by `req.session.businessId`, and return JSON. When adding a new mutating admin feature, the handler belongs in `routes/api/index.js`, not `routes/admin.js`.

The inline JS in `views/admin/*.ejs` must check `res.ok` and surface the error. It used to fire the request and call `location.reload()` regardless, which is why failed writes looked like successful ones for a long time.

### Database (MySQL via `mysql2/promise`)

`db/pool.js` exports `createPool(config.db)` — a factory, not a singleton.

**Schema changes go in `db/migrations/`.** Add a new `NNN_name.sql` file; the runner (`db/migrate.js`) applies pending files in alphabetical order at startup and records each one in `schema_migrations`. Keep the numeric prefix zero-padded (`004_`, not `4_`) or the ordering breaks at the tenth migration.

Two constraints worth knowing before writing one:

- **There is no rollback.** MySQL DDL is auto-commit, so a half-applied `ALTER` cannot be undone by a transaction. Keep each migration small and idempotent — `CREATE TABLE IF NOT EXISTS`, and for columns the `information_schema` + `PREPARE` guard used in `002_menu_theme.sql`, since MySQL has no `ADD COLUMN IF NOT EXISTS`.
- **Migrations run on their own connection** with `multipleStatements` enabled. The app pool does not have it and must not get it: enabling it there would turn any injection into arbitrary statement chaining.

`001_initial.sql` is the schema frozen at the point migrations were introduced, written with `IF NOT EXISTS` so it is a no-op against the production database that already had those tables.

Core tables: `businesses` (1 per tenant, has `slug`, contact/social fields, `is_open`, `menu_theme`/`menu_template`/`menu_scale`, `promos_enabled`, `promo_flyer`) → `business_hours` (7 rows/business), `categories` → `products` (with the `promo_*` columns), and `users` (admin logins, one business each via `business_id` FK), plus `schema_migrations` and `sessions`. All tenant-scoped queries filter by `business_id`.

**Adding a column to `businesses` means touching THREE places**, and missing any one makes the save return `200` without saving that field:

1. the schema in `validators/index.js`,
2. the `TENANT_FIELDS` whitelist in `repositories/businessRepository.js`,
3. the destructuring in the `/api/settings` handler.

This has bitten twice — `menu_scale` and then `promos_enabled`, the second time with a warning comment already sitting next to it. So it stopped being something to remember: the test *"cada campo de Configuración se guarda de verdad"* sends every field and checks each one landed in the database. Add the new field to that test and a forgotten wiring fails the suite.

`sessions` (`express-mysql-session`, built in `db/sessionStore.js`) does **not** hang off `businesses`, so the `ON DELETE CASCADE` chain never reaches it — anything that clears tenant data has to clear it separately. Sessions live in MySQL rather than the default `MemoryStore` because Passenger recycles Node processes, which used to drop every in-memory session and produce random `302`s to `/admin/login` seconds after a successful login.

Note: `db/enelmapa.db` is a leftover SQLite file from an earlier iteration and is **not** used by the current code (everything goes through the MySQL pool) — don't be misled by its presence. `.gitignore` excludes `db/*.db` and `uploads/`.

### File uploads

`multer` diskStorage writes to `uploads/<businessId>/` (created on demand) with randomized filenames; served statically at `/uploads`. Business banner/logo and product images all follow this same per-business directory convention.

Three layers guard it, in `services/imageUpload.js` and `app.js`: multer's `fileFilter` rejects by declared mimetype, then the written file's **magic bytes** are checked and it is deleted if they don't match an image (the declared type is attacker-controlled; the first bytes are the actual content), and `/uploads` is served with `X-Content-Type-Options: nosniff` so nothing that slipped through gets interpreted as HTML or JS — it shares an origin with the panel.

### Deployment

`.htaccess` proxies all requests to a locally running Node process via Passenger (`PASSENGER_BASE_PORT`) — this is a cPanel/Passenger-style deployment, not a standalone container/PM2 setup.

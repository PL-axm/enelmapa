# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**enelmapa** — multi-tenant digital menu platform (`enelmapa.co`). Each tenant is a "business" (a restaurant/café) with its own slug, categories, products, and public menu page. Plain Node.js + Express + EJS + MySQL, no frontend build step, no bundler, no test framework.

## Commands

```
npm start        # node server.js
npm run dev       # node --watch server.js (auto-restart on change)
npm run seed      # node db/seed.js — wipes ALL data and re-seeds one demo business ("caficultor")
```

There is no lint, build, or test command configured. There are no automated tests in this repo.

### Environment variables

`PORT`, `DOMAIN` (default `enelmapa.co`), `SESSION_SECRET`, `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`, `SUPER_EMAIL`, `SUPER_PASS` (superadmin login, defaults to `admin@enelmapa.co` / `super2026` — insecure defaults, only acceptable in local dev).

## Architecture

### Dependency injection — no module-level singletons

Nothing imports a shared pool or a shared config object. `server.js` calls `loadConfig()`, hands it to `createContainer(config)` (the composition root, `container.js`), and passes what comes out to `createApp({ pool, config })`.

The rule that keeps this honest: **the container is never passed down.** Each router and middleware is a factory that receives only what it uses — `createAdminRouter({ pool, config })`, `createTenantMiddleware({ pool })`, `createPublicRouter()`. Handing the whole container around would make dependencies invisible again and force every test to build the world; that's a service locator, not DI. When you add a route file, follow the same shape: export a `createXRouter({ ... })` factory, destructure only your dependencies, and wire it in `app.js`.

`config/index.js` exports only `loadConfig(env)` — importing it has no side effects and cannot throw. It is the single source for `process.env`: `config.db`, `config.superadmin`, `config.session`, `config.domain`, `config.port`. Do not read `process.env` anywhere else.

Tests build their own app with `tests/helpers/container.js` (`createTestApp()`, `getTestPool()`).

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

### Database (MySQL via `mysql2/promise`)

`db/pool.js` exports `createPool(config.db)` — a factory, not a singleton. `db/schema.js` is now only `initDb(pool)`, run once at server startup (`server.js`) before `app.listen`. There is no migration framework: schema evolution is done by adding new `CREATE TABLE IF NOT EXISTS` blocks and/or best-effort `ALTER TABLE` statements wrapped in `try/catch` (see the `menu_theme` column add in `initDb`) so re-running is always safe. Follow this pattern for new columns/tables rather than introducing a migration tool.

Core tables: `businesses` (1 per tenant, has `slug`, contact/social fields, `is_open`, `menu_theme`) → `business_hours` (7 rows/business), `categories` → `products`, and `users` (admin logins, one business each via `business_id` FK). All tenant-scoped queries filter by `business_id`.

Note: `db/enelmapa.db` is a leftover SQLite file from an earlier iteration and is **not** used by the current code (everything goes through the MySQL pool) — don't be misled by its presence. `.gitignore` excludes `db/*.db` and `uploads/`.

### File uploads

`multer` diskStorage writes to `uploads/<businessId>/` (created on demand) with randomized filenames; served statically at `/uploads`. Business banner/logo and product images all follow this same per-business directory convention.

### Deployment

`.htaccess` proxies all requests to a locally running Node process via Passenger (`PASSENGER_BASE_PORT`) — this is a cPanel/Passenger-style deployment, not a standalone container/PM2 setup.

# Buenas prácticas de desarrollo — enelmapa

Diagnóstico del código actual + recomendaciones concretas, priorizadas por impacto. Basado en investigación de prácticas estándar de la comunidad Node/Express para 2026 (ver Fuentes) aplicadas específicamente a este repo. Es un documento de referencia, no implica que ya se hayan aplicado los cambios.

## Diagnóstico rápido

El proyecto sigue un patrón **routes → DB directo**: los controladores (`routes/*.js`) llaman `getPool()` y escriben SQL inline con parámetros (`?`) — eso ya evita inyección SQL, que es lo más importante y está bien hecho. Lo que falta es todo lo que normalmente vive *entre* la ruta y la base de datos: capa de servicio, validación, manejo de errores centralizado, y algunas protecciones de seguridad estándar en SaaS multi-tenant.

## 1. Arquitectura: introducir capa de servicio (sin reescribir todo)

Patrón recomendado para Express: **Controller → Service → Repository**, donde el controller solo parsea el request y decide el status code, el service tiene la lógica de negocio, y el repository encapsula el SQL.

Hoy el proyecto ya tiene la carpeta `routes/`, pero mezcla las tres capas en un solo archivo. La brecha más costosa concretamente en este repo es la **duplicación de lógica** entre archivos que deberían compartir una sola fuente:

| Lógica duplicada | Ubicaciones | Riesgo |
|---|---|---|
| Generación de QR (mismo código case por case) | [routes/admin.js:84-93](routes/admin.js#L84-L93) y [routes/api/index.js:141-150](routes/api/index.js#L141-L150) | Si cambia el color/tamaño del QR hay que recordar tocar 2 archivos |
| Extracción de subdominio (`host.split('.')`) | [server.js:33-40](server.js#L33-L40) y [middleware/tenant.js:9-14](middleware/tenant.js#L9-L14) | Si cambia la regla (ej. soportar `www.slug.`) hay que sincronizar 2 lugares a mano |
| Array de días de la semana | [db/seed.js:197](db/seed.js#L197) y [routes/superadmin.js:63](routes/superadmin.js#L63) | Typo en un solo lugar rompe horarios de negocios nuevos vs. el seed |
| Creación de negocio + horarios por defecto | [db/seed.js:188-200](db/seed.js#L188-L200) y [routes/superadmin.js:53-67](routes/superadmin.js#L53-L67) | Misma lógica de alta de negocio escrita dos veces |

**Recomendación**: crear `services/` con funciones puras reutilizables, por ejemplo:
- `services/qr.js` → `generateMenuQr(slug, opts)`
- `services/subdomain.js` → `getSubdomain(hostname)`
- `services/businessHours.js` → `DAYS`, `createDefaultHours(businessId)`

Esto no es una reescritura: son 3-4 archivos nuevos y reemplazar las duplicaciones por un `require`.

## 2. Repository con scoping de tenant forzado (el hallazgo más importante)

En un SaaS multi-tenant, la regla de seguridad #1 es que el filtro de tenant no dependa de que cada desarrollador recuerde escribir `WHERE business_id = ?` en cada query. Hoy eso es exactamente lo que pasa: **cada** query en [routes/api/index.js](routes/api/index.js) y [routes/admin.js](routes/admin.js) repite `req.session.businessId` manualmente. Funciona mientras nadie lo olvide, pero un solo `UPDATE`/`DELETE` sin ese filtro sería una fuga de datos entre negocios.

**Recomendación**: envolver el pool en un pequeño repository que reciba el `businessId` una vez y lo aplique siempre, ej.:

```js
// db/repositories/productsRepo.js
function forBusiness(businessId) {
  const db = getPool();
  return {
    delete: (id) => db.query('DELETE FROM products WHERE id = ? AND business_id = ?', [id, businessId]),
    // ...
  };
}
```

Así el desarrollador ya no puede "olvidar" el filtro porque no tiene forma de llamar al método sin pasar por `forBusiness(...)`.

## 3. Seguridad — hallazgos concretos (de mayor a menor prioridad)

1. **Contraseña del superadmin en texto plano.** [routes/superadmin.js:14-21](routes/superadmin.js#L14-L21) compara `password === SUPER_PASS` directo contra una env var, mientras que los admins de negocio sí usan `bcrypt` ([routes/admin.js:16](routes/admin.js#L16)). Inconsistente y más débil justo para la cuenta con más privilegios. Al menos debería compararse con `crypto.timingSafeEqual` para evitar timing attacks, o mejor, tratar al superadmin como un usuario más en la tabla `users` con un rol.
2. **`SESSION_SECRET` con default inseguro.** [server.js:20](server.js#L20) cae a un secreto hardcodeado si la env var no está seteada. Si algún despliegue olvida configurarla, todas las sesiones quedan firmadas con un secreto público en el código fuente. Recomendado: que el arranque falle (`process.exit(1)`) si `NODE_ENV=production` y `SESSION_SECRET` no está definida.
3. **Sin protección CSRF** en los endpoints de mutación bajo `/api` y `/admin`/`/superadmin` (login, crear/editar/borrar negocio, productos, categorías) — todos dependen de la cookie de sesión. Con `sameSite: 'lax'` ([server.js:26](server.js#L26)) hay mitigación parcial para navegación cross-site, pero no para `<form>` POST desde otro sitio. Recomendado: `csurf`/token CSRF en los formularios de `/admin` y `/superadmin`, o al menos validar `Origin`/`Referer` en las rutas de escritura.
4. **Sin rate limiting en los logins.** [routes/admin.js:11](routes/admin.js#L11) y [routes/superadmin.js:14](routes/superadmin.js#L14) no tienen límite de intentos — abre la puerta a fuerza bruta, especialmente grave en `/superadmin` porque compromete *todos* los negocios. Recomendado: `express-rate-limit` en ambas rutas de login.
5. **Subida de archivos sin validar tipo.** [routes/api/index.js:9-20](routes/api/index.js#L9-L20) el `multer.diskStorage` solo limita tamaño (5MB), no `mimetype`/extensión. Como `uploads/` se sirve estático ([server.js:17](server.js#L17)), alguien podría subir un archivo no-imagen. Recomendado: `fileFilter` que solo acepte `image/*` reales (chequear magic bytes, no solo el `Content-Type` del cliente).

## 4. Manejo de errores — falta una red de seguridad centralizada

[server.js](server.js) tiene un handler de 404 ([server.js:69-71](server.js#L69-L71)) pero **no** un error-handling middleware (`(err, req, res, next) => ...`) al final. En Express 4, si un handler `async` lanza una excepción no capturada (ej. `bcrypt.hashSync(admin_password, 10)` en [routes/superadmin.js:59](routes/superadmin.js#L59) si `admin_password` viene vacío), la promesa rechazada no la atrapa Express automáticamente: la request se queda colgada sin respuesta en vez de devolver un 500 controlado.

Solo `routes/api/index.js` envuelve algunas rutas en `try/catch` (ver [routes/api/index.js:26-61](routes/api/index.js#L26-L61)); el resto de rutas async (`admin.js`, `superadmin.js`, la ruta `/` en `server.js`) no tiene ese resguardo.

**Recomendación**: agregar un middleware de error único al final de `server.js`, y un pequeño wrapper (`asyncHandler(fn)`) para no repetir `try/catch` en cada ruta:

```js
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('404', { message: 'Error interno' });
});
```

## 5. Validación de entrada

No hay ninguna librería de validación; los `req.body` se usan tal cual (ej. `parseFloat(price)` en [routes/api/index.js:103](routes/api/index.js#L103) sin chequear `NaN`; `slug` en [routes/superadmin.js:53](routes/superadmin.js#L53) sin validar formato, y un slug con puntos o mayúsculas rompería el matching de subdominio en [server.js:33-40](server.js#L33-L40)).

**Recomendación**: no hace falta un framework pesado — con `zod` (o incluso funciones guard manuales) alcanza para validar en el borde: `slug` (regex `^[a-z0-9-]+$`), `price` (número positivo), `email` en altas de admin.

## 6. Configuración centralizada

Los mismos `process.env.X || default` se repiten en varios archivos (`DOMAIN` en [server.js:8](server.js#L8), [routes/admin.js:89](routes/admin.js#L89) y [routes/api/index.js:146](routes/api/index.js#L146); `SUPER_EMAIL`/`SUPER_PASS` en [routes/superadmin.js:7-8](routes/superadmin.js#L7-L8)). Un `config/index.js` que centralice y exporte estos valores una sola vez evita que un default cambie en un archivo y no en otro.

## 7. Cobertura de pruebas

No hay ningún test en el repo. Dado que no hay capa de servicio todavía, lo más rentable para empezar es **tests de integración con `supertest`** contra las rutas `/api` (que ya son las más críticas: mutan datos y están detrás de auth), en vez de unit tests prematuros sobre código que aún no está separado en funciones puras.

## Plan de adopción sugerido (incremental, no big-bang)

1. Agregar error-handling middleware + `asyncHandler` (bajo esfuerzo, evita requests colgadas).
2. Extraer las duplicaciones de la sección 1 (`services/qr.js`, `services/subdomain.js`, `services/businessHours.js`).
3. Corregir los 2 hallazgos de seguridad más baratos de arreglar: `fileFilter` en multer y `SESSION_SECRET` que falle en producción.
4. Rate limiting en logins.
5. Repository con scoping de tenant forzado (más esfuerzo, mayor beneficio a largo plazo — hacerlo cuando se toque products/categories de nuevo).
6. CSRF + validación de inputs (`zod`) — hacerlo junto con cualquier formulario nuevo que se agregue.

## Fuentes

- [nodebestpractices (goldbergyoni) — The Node.js best practices list](https://github.com/goldbergyoni/nodebestpractices)
- [How to Structure Express.js Projects for Scale](https://oneuptime.com/blog/post/2026-02-02-express-project-structure/view)
- [Node.js project architecture best practices — LogRocket](https://blog.logrocket.com/node-js-project-architecture-best-practices/)
- [Breaking Free from MVC Hell: Service-Repository-Controller Pattern](https://medium.com/@mohammedbasit362/breaking-free-from-mvc-hell-why-your-node-js-code-needs-the-service-repository-controller-pattern-c080725ab910)
- [Mastering the Controller - Service - Repository Pattern in Node.js](https://www.w3tutorials.net/blog/controller-service-repository-pattern-nodejs/)
- [Building a Secure Multi-Tenant SaaS Application with Node.js](https://nicholasdiamond.hashnode.dev/building-a-secure-multi-tenant-saas-application-with-nodejs)
- [How to Build Multi-Tenant APIs in Node.js](https://oneuptime.com/blog/post/2026-01-25-multi-tenant-apis-nodejs/view)

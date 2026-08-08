# Orden de las fases restantes y dónde va cada hallazgo suelto

Decidido el 2026-08-08, después de mergear la Fase 4. Reemplaza el orden 5 → 6 → 7
de `plans/refactor-arquitectura-repository-di.md` y asigna los hallazgos que ese
plan había dejado sin fase (B4, E7, E8).

## Por qué se cambia el orden

El plan original ordenaba las fases por dependencia técnica: primero servicios,
después endurecimiento. Pero a esta altura las dependencias ya están resueltas —
los repositories son la base que faltaba— y lo que queda se puede ordenar por
**impacto hoy y riesgo**, que es un criterio mejor cuando el código ya está en
producción.

Dos cosas pesan:

- **S9 (sesión en MemoryStore) es el único hallazgo que molesta ahora mismo**:
  causa los 302 aleatorios bajo Passenger, que afectan también al flujo de carga
  de menús. Arreglarlo son pocas líneas y no depende de servicios.
- **S4 (CSRF) es el de mayor riesgo para el front**: toca todos los formularios y
  todos los `fetch()` inline de las vistas. Conviene hacerlo con todo lo demás
  estable y solo, para que si algo se rompe se sepa qué fue.

Así que la Fase 6 original se parte en dos: lo chico y seguro va temprano, lo
grande y riesgoso va tarde.

## Orden

### A — Cerrar B4 y limpieza (rama corta)

**Por qué acá:** los repos ya devuelven si afectaron filas y los handlers lo
tiran a la basura. Si se dejara para después, los servicios de la fase siguiente
se construirían sobre semántica equivocada y habría que refactorizarlos dos veces.

- **B4** — `{ok:true}` sin mirar `affectedRows`: pasa a `404` cuando no existe y
  `403` cuando no es del negocio. Arrastra el `500` de `reset-password` con un
  userId inexistente (mismo síntoma, misma causa).
- **Front**: el JS inline de `views/admin/*.ejs` ignora la respuesta y hace
  `location.reload()`. Hay que hacer que mire `res.ok` y muestre el error — si no,
  el cambio de contrato es invisible y las fallas siguen siendo silenciosas.
- **E7** — se sirve `public/` y el directorio no existe. Se crea, y de paso entra
  el favicon: hoy cada visita deja un `404 /favicon.ico` en el log.

### B — Sesión y endurecimiento liviano

**Por qué acá:** máximo valor con mínimo riesgo. Ninguno toca el front.

- **S9** — session store real en MySQL. Cierra los 302 aleatorios.
- **S5** — rate limiting en los dos logins.
- **S6** — `fileFilter` con magic bytes en multer.

### C — Servicios y controllers (la Fase 5 original)

- `qrService` (última duplicación de E3), `authService`, `menuService`,
  `storageService` con Strategy.
- `businessService.createWithDefaults()` envuelto en **`withTransaction`** — mata
  el negocio huérfano que se reproduce hoy si el email del admin ya existe.
- `routes/` queda como cableado puro.

### D — Validación

- **E5** — zod por recurso. **B5** — `parseFloat` sin `NaN`. **S7** — `slug` sin
  formato ni unicidad validada.

Van juntos porque los tres son el mismo problema: nada valida lo que entra.

### E — CSRF y logging

- **S4** — CSRF en todas las mutaciones. El de mayor superficie de front.
- **E8** — logger con niveles en vez de `console.error` suelto. Va acá porque es
  cuando más falta hace: si CSRF rompe algo en producción, el log es lo único que
  lo va a explicar.

### F — Migraciones versionadas (la Fase 7 original)

Runner propio + `001_initial.sql`. Sigue yendo última: es la que toca producción
de la forma más delicada y conviene con todo lo demás estable.

## Reglas que siguen valiendo

Cada letra es una rama propia. Antes de cada merge: `npm test` en verde,
`QA_CHECKLIST.md` completo, **y verificación del front en navegador** — ninguna
puede romper nada, ni back ni front. Todo se prueba en localhost contra
`enelmapa_dev`, nunca contra producción.

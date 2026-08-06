# QA Checklist — antes de mergear cualquier cambio de backend

Aplica a cambios que tocan `routes/`, `middleware/`, `db/`, `services/`,
`app.js` o `server.js`. Cambios solo de vistas EJS/CSS quedan exceptuados.

Sin CI/CD ni staging (ver `WORKFLOW.md`), este checklist es el único gate
antes de mergear — reemplaza a un pipeline automático que no existe.

- [ ] `npm test` en verde localmente contra `enelmapa_test`.
- [ ] Si el cambio toca `/api` o cualquier query con `business_id`:
      reproducir a mano una vez el escenario de dos tenants contra
      `enelmapa_dev` (login como negocio A y como negocio B, confirmar cero
      fuga cruzada específica de la feature/fix que se acaba de tocar) —
      los tests automáticos cubren el caso genérico, este paso cubre lo que
      los fixtures no pensaron.
- [ ] Reiniciar `npm run dev` en frío una vez (no hot-reload) y probar el
      flujo tocado — detecta fallos de `initDb()` o de sesión que solo
      aparecen en boot limpio (relevante por MemoryStore + reciclado de
      procesos en Passenger, ver regla no-negociable #4 de
      `.claude/skills/enelmapa-dev/SKILL.md`).
- [ ] Revisar la consola del server durante la prueba manual por errores no
      atrapados / requests colgadas (no hay error-handler centralizado
      todavía, `BEST_PRACTICES.md` sección 4 — la terminal es la única red
      de seguridad hoy).
- [ ] Si el cambio agrega/modifica columnas o tablas: correr `npm run dev`
      dos veces seguidas contra una `enelmapa_dev` con datos, confirmar que
      `initDb()` sigue siendo idempotente y no rompe en el segundo boot.
- [ ] Si el cambio toca sesión/auth: probar logout + re-login a mano una vez.
- [ ] `git diff` propio: grep por nuevos `db.query(` sobre
      `categories`/`products`/`business_hours`/`users` y confirmar que cada
      uno filtra por `business_id` (regla no-negociable #3 de SKILL.md).
- [ ] Confirmar `echo $DB_NAME` antes de correr tests o seed a mano — nunca
      debe apuntar a producción (regla no-negociable #1 de SKILL.md). Los
      tests automáticos ya se protegen solos vía `tests/env.setup.js`, este
      paso es para cuando corras algo a mano fuera de `npm test`.

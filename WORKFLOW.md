# Flujo de trabajo — EnElMapa

Acordado con el usuario el 2026-08-06. Aplica a cualquier sesión de Claude
Code que trabaje en este proyecto, en cualquier máquina.

```mermaid
flowchart TD
    A[Nueva tarea] --> B{¿Desarrollo o<br/>subida de contenido?}

    B -->|Subida de contenido| C[skill: cargar-menu-pdf]
    C --> C1[Extraer/estructurar el PDF]
    C1 --> C2[Plan + preguntas sobre ambigüedades]
    C2 --> C3{¿Aprueba?}
    C3 -->|Sí| C4[Categorías + productos + imágenes vía API]
    C4 --> C5[Verificar en /s/slug]

    B -->|Desarrollo| D{Tamaño del cambio}
    D -->|Chico, 1-2 archivos,<br/>sigue un patrón existente| E[Fullstack mode<br/>plan corto]
    D -->|Toca schema, seguridad,<br/>multi-tenancy o todos<br/>los tenants| F[Team mode<br/>plan con alternativas<br/>y trade-offs]

    E --> G[Guardar plan en<br/>plans/*.md]
    F --> G
    G --> H{¿Aprueba?}
    H -->|Sí| I[Ejecutar SOLO en<br/>el modo elegido]
    I --> J[Rama nueva por cambio<br/>main protegida]
    J --> K[Probar contra<br/>enelmapa_dev local]
    K --> K1{¿Toca backend?<br/>routes/middleware/db/<br/>services/app.js/server.js}
    K1 -->|Sí| K2[npm test: unit + integración]
    K2 --> K3[QA_CHECKLIST.md]
    K3 --> L
    K1 -->|No, solo vistas/CSS| L[Merge a main]
    L --> M["⚠ Deploy = git pull manual<br/>en el servidor (no automático)"]
```

## Reglas fijas (en ambos caminos)

- Nunca ejecutar sin plan aprobado primero.
- Nunca correr `npm run seed` contra producción — borra **todos** los
  tenants (ver `.claude/skills/enelmapa-dev/SKILL.md`).
- Nunca tocar `products`/`categories`/etc. sin filtrar por `business_id`.
- Todo cambio que toque `routes/`, `middleware/`, `db/`, `services/`,
  `app.js` o `server.js` requiere `npm test` en verde y `QA_CHECKLIST.md`
  completo antes de mergear. Cambios solo de vistas/CSS quedan exceptuados.
- Un merge a `main` **no** implica que ya esté desplegado — el deploy es un
  `git pull` manual en el servidor, avisar explícitamente cuando algo está
  listo para eso.

## Dónde vive cada cosa

- `.claude/skills/cargar-menu-pdf/` — cómo cargar el menú (PDF) de un negocio
  al admin ya desplegado, por HTTP, sin tocar código.
- `.claude/skills/enelmapa-dev/` — cómo desarrollar sobre este repo (setup
  local, reglas no-negociables, convenciones de código).
- `tests/` — suite Jest + Supertest (unit + integración). Ver `TESTING.md`.
- `QA_CHECKLIST.md` — checklist manual pre-merge para cambios de backend.
- `.claude/memory-snapshot/` — contexto acumulado en la máquina donde se
  armó este flujo por primera vez (ver el README ahí).
- `PROCEDIMIENTO_CARGA_MENU.md` — versión larga/narrativa del procedimiento
  de carga de menús (el skill es la versión accionable de esto).

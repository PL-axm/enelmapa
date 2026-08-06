---
name: enelmapa-project-structure
description: "Cómo está organizado el directorio menumap — todo (skills, docs, código) vive dentro de enelmapa/, única fuente de verdad, versionada en git"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6dcfd2ac-90eb-4484-a8aa-0731dff642cc
  modified: 2026-08-06T15:34:35.041Z
---

El directorio de trabajo `menumap` (`/home/betterway/Proyectos/Flaco/menumap`)
es solo un wrapper vacío — **todo vive dentro de `enelmapa/`**
(`https://github.com/PL-axm/enelmapa.git`, ver [[enelmapa-github-repo]]),
que es un repo git real y la única fuente de verdad:

- `.claude/skills/cargar-menu-pdf/` — cargar contenido de un negocio al SaaS
  vía su API de admin (por HTTP, sin tocar código).
- `.claude/skills/enelmapa-dev/` — desarrollar sobre el código (Node.js +
  Express + EJS + MySQL, SaaS multi-tenant).
- `CLAUDE.md` / `BEST_PRACTICES.md` / `BUSINESS_MODEL.md` / `WORKFLOW.md` —
  documentación del propio repo.

Antes hubo copias duplicadas de los skills a nivel de `menumap/` raíz (fuera
del repo git) — se borraron a pedido explícito del usuario ("en un solo
lugar") el 2026-08-06 porque generaban riesgo de desalineación. No volver a
crear esa duplicación.

**Por qué importa**: son dos modos de trabajo distintos con el mismo
producto, ambos documentados dentro del mismo repo. "Cargar el menú de tal
negocio" = HTTP contra producción, sin código. "Agregar una feature /
arreglar un bug" = código en `enelmapa/`.

**Cómo aplicar**: si el usuario pide algo ambiguo entre los dos (ej. "agrega
un campo nuevo al producto"), aclarar si es un cambio de contenido (vía API,
un negocio) o un cambio de plataforma (schema/código, afecta a todos los
tenants) antes de actuar — son operaciones de alcance muy distinto.

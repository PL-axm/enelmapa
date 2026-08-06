---
name: enelmapa-project-structure
description: "Cómo está organizado el directorio menumap — herramientas operativas en la raíz, código fuente de la app EnElMapa clonado en enelmapa/"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6dcfd2ac-90eb-4484-a8aa-0731dff642cc
  modified: 2026-08-06T15:05:10.371Z
---

El directorio de trabajo `menumap` (`/home/betterway/Proyectos/Flaco/menumap`)
tiene dos cosas distintas conviviendo:

1. **Raíz del proyecto** — herramientas/documentación operativas para cargar
   contenido de negocios reales al SaaS EnElMapa vía su API de admin (por
   HTTP, sin tocar código): `PROCEDIMIENTO_CARGA_MENU.md` y el skill
   `.claude/skills/cargar-menu-pdf/`.
2. **`enelmapa/`** — clon del código fuente real de la plataforma
   (`https://github.com/PL-axm/enelmapa.git`, ver [[enelmapa-github-repo]]).
   Node.js + Express + EJS + MySQL, SaaS multi-tenant. Trae su propio
   `CLAUDE.md` (arquitectura autoritativa) y `BEST_PRACTICES.md` (auditoría
   con plan de adopción). Para trabajar acá usar el skill `enelmapa-dev`.

**Por qué importa**: son dos modos de trabajo distintos con el mismo
producto. "Cargar el menú de tal negocio" = HTTP contra producción, sin
código. "Agregar una feature / arreglar un bug" = código en `enelmapa/`.

**Cómo aplicar**: si el usuario pide algo ambiguo entre los dos (ej. "agrega
un campo nuevo al producto"), aclarar si es un cambio de contenido (vía API,
un negocio) o un cambio de plataforma (schema/código, afecta a todos los
tenants) antes de actuar — son operaciones de alcance muy distinto.

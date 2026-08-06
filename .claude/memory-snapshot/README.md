# Snapshot de memoria de proyecto

Esto es una copia versionada de la memoria persistente que Claude Code
acumuló trabajando en este proyecto desde la máquina original (donde el
working directory era `~/Proyectos/Flaco/menumap`, con `enelmapa/` clonado
adentro).

La memoria real de Claude Code **no se sincroniza vía git** — vive en
`~/.claude/projects/<ruta-del-proyecto-escapada>/memory/` en cada máquina, y
se genera/actualiza sola durante las conversaciones. Este snapshot existe
para que ese contexto no se pierda si alguien retoma el trabajo desde otra
máquina o con otro working directory.

## Cómo usarlo en una máquina nueva

No hace falta copiar nada a mano. Al empezar a trabajar acá, pedile a Claude
que lea esta carpeta (`.claude/memory-snapshot/`) y guarde memorias
equivalentes para el proyecto actual — así queda indexado en `MEMORY.md`
igual que en la máquina original, ajustado a la ruta real de este checkout.

## Contenido

- `MEMORY.md` — índice original.
- `enelmapa_project_structure.md` — confirma que este repo es la única
  fuente de verdad (no hay duplicados fuera de acá) y por qué existen los dos
  skills por separado.
- `enelmapa_github_repo.md` — referencia al repo.
- `skill_building_philosophy.md` — cómo se decidió crear skills en este
  proyecto (desde patrones repetidos) y la preferencia de definir workflows
  de forma colaborativa con el usuario — esto sí aplica igual en cualquier
  máquina.

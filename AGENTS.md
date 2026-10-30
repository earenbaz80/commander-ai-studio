# AGENTS.md — Commander AI Studio

## Reglas para agentes autónomos
- Lee antes de editar: usa `fs.read` / `fs.glob` / `fs.grep` para contexto exacto.
- Ediciones mínimas: prefiere `fs.edit` con `oldString` exacto; solo `fs.write` para crear.
- No rompas build: tras editar TS, el proyecto debe pasar `tsc --noEmit` y `vite build`.
- Commits con índice temporal: si necesitas commitear sólo algunos hunks, trabaja con un `GIT_INDEX_FILE` propio y **devuelve el índice normal a HEAD antes de terminar** (`git restore --staged -- <rutas>`). Commitear con el índice temporal deja el normal apuntando a la foto vieja de esos archivos: `git status` muestra deleciones «staged» de código que sigue en disco y, si alguien commitea así, el árbol no compila. Cierra con `git diff --cached --stat` vacío.
- Seguridad: nunca ejecutes comandos fuera de allowlist (npm/npx/node/python/git/ls/cat/echo/tsc/vite). Pide aprobación para writes.
- Estilo: TypeScript estricto, Tailwind, UI retro Norton (azul #000080, cyan #00ffff, amarillo #ffff55).
- Responde con JSON válido al orquestador: thought/plan/toolCalls/answer/finish.
- Si terminas, marca `finish:true` con resumen de archivos tocados.

# AGENTS.md — Commander AI Studio

## Reglas para agentes autónomos
- Lee antes de editar: usa `fs.read` / `fs.glob` / `fs.grep` para contexto exacto.
- Ediciones mínimas: prefiere `fs.edit` con `oldString` exacto; solo `fs.write` para crear.
- No rompas build: tras editar TS, el proyecto debe pasar `tsc --noEmit` y `vite build`.
- Tests de endpoints: pide el server con `startServer()` de `tests/helpers/serverHarness.ts` y corre la suite con `npm run test:node`. No arranques un server propio (`spawn` a mano, `PORT` fijo, `app.listen` en el test): el padre levanta uno compartido por corrida y compila `server.ts` sólo cuando algún archivo lo pide. Detalle y modo de uso: [README § Suite de tests (node)](README.md#suite-de-tests-node).
- Tests de endpoints y tiempos: `startServer()` ya espera lo que haga falta (90 s a que `server.ts` arranque y anuncie el puerto, 30 s a `/api/health`, 30 s por petición). No asumas que el server compartido está caliente, ni metas `sleep` fijos, ni acortes esos márgenes en un test: un `sleep` corto pasa en local y falla en CI. Si un caso necesita más, sube la constante del arnés y explica el motivo en el comentario.
- Commits con índice temporal: si necesitas commitear sólo algunos hunks, trabaja con un `GIT_INDEX_FILE` propio y **devuelve el índice normal a HEAD antes de terminar** (`git restore --staged -- <rutas>`). Commitear con el índice temporal deja el normal apuntando a la foto vieja de esos archivos: `git status` muestra deleciones «staged» de código que sigue en disco y, si alguien commitea así, el árbol no compila. Cierra con `git diff --cached --stat` vacío.
- Chequeo rápido del índice: el síntoma de un índice fijado a un árbol viejo es un archivo que aparece **a la vez** en lo staged y en lo no staged, porque su entrada no coincide ni con HEAD ni con el disco. Detéctalo con `comm -12 <(git diff --cached --name-only | sort) <(git diff --name-only | sort)`: vacío es sano. Cada ruta que salga se arregla sin tocar disco con `git restore --staged -- <rutas>` y, si el commit ya está hecho, `git update-index --cacheinfo 100644,$(git rev-parse HEAD:<ruta>),<ruta>`; después, `git diff --cached --stat` vacío y `tsc` en verde.
- Seguridad: nunca ejecutes comandos fuera de allowlist (npm/npx/node/python/git/ls/cat/echo/tsc/vite). Pide aprobación para writes.
- Estilo: TypeScript estricto, Tailwind, UI retro Norton (azul #000080, cyan #00ffff, amarillo #ffff55).
- Responde con JSON válido al orquestador: thought/plan/toolCalls/answer/finish.
- Si terminas, marca `finish:true` con resumen de archivos tocados.

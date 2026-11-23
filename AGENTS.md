# AGENTS.md — Commander AI Studio

## Reglas para agentes autónomos
- Lee antes de editar: usa `fs.read` / `fs.glob` / `fs.grep` para contexto exacto.
- Ediciones mínimas: prefiere `fs.edit` con `oldString` exacto; solo `fs.write` para crear.
- No rompas build: tras editar TS, el proyecto debe pasar `tsc --noEmit` y `vite build`.
- Tests de endpoints: pide el server con `startServer()` de `tests/helpers/serverHarness.ts` y corre la suite con `npm run test:node`. No arranques un server propio (`spawn` a mano, `PORT` fijo, `app.listen` en el test): el padre levanta uno compartido por corrida y compila `server.ts` sólo cuando algún archivo lo pide. Detalle y modo de uso: [README § Suite de tests (node)](README.md#suite-de-tests-node).
- Tests de endpoints y tiempos: `startServer()` ya espera lo que haga falta (90 s a que `server.ts` arranque y anuncie el puerto, 30 s a `/api/health`, 30 s por petición). No asumas que el server compartido está caliente, ni metas `sleep` fijos, ni acortes esos márgenes en un test: un `sleep` corto pasa en local y falla en CI. Si un caso necesita más, sube la constante del arnés y explica el motivo en el comentario.
- **Excepción: app de referencia de PL3** (`tests/unit/pl3ExampleApp.test.ts`). El arnés compartido levanta `server.ts`, que es Commander y **no** monta la app de ejemplo: `examples/pl3-backend-app` es un artefacto aparte, no forma parte del server de la suite y no hay nada que compartir con él. Por eso su test se sirve con `http.createServer(app)` y `listen(0, '127.0.0.1')` dentro del propio proceso, sin `spawn` ni puerto fijo, y cierra servidor y base en `afterAll`: no compite con el server compartido ni asume que esté caliente. La excepción vale **sólo** para apps bajo `examples/`; cualquier endpoint de Commander sigue yendo por `startServer()`.
- Commits con índice temporal: si necesitas commitear sólo algunos hunks, trabaja con un `GIT_INDEX_FILE` propio y **devuelve el índice normal a HEAD antes de terminar** (`git restore --staged -- <rutas>`). Commitear con el índice temporal deja el normal apuntando a la foto vieja de esos archivos: `git status` muestra deleciones «staged» de código que sigue en disco y, si alguien commitea así, el árbol no compila. Cierra con `git diff --cached --stat` vacío.
- Chequeo rápido del índice: el síntoma de un índice fijado a un árbol viejo es un archivo que aparece **a la vez** en lo staged y en lo no staged, porque su entrada no coincide ni con HEAD ni con el disco. Detéctalo con `comm -12 <(git diff --cached --name-only | sort) <(git diff --name-only | sort)`: vacío es sano. Cada ruta que salga se arregla sin tocar disco con `git restore --staged -- <rutas>` y, si el commit ya está hecho, `git update-index --cacheinfo 100644,$(git rev-parse HEAD:<ruta>),<ruta>`; después, `git diff --cached --stat` vacío y `tsc` en verde. Automatizado: `npm run check:index` (corre también en CI).
- Firma de los commits: la única identidad es `Edel Arencibia Baez <edelarencibiabaez@gmail.com>`, como autor **y** committer. La única excepción es el committer sintético `GitHub <noreply@github.com>` que la plataforma escribe al hacer squash o rebase de un PR: se acepta como committer, nunca como autor. Nada de trailers de herramientas o IA (`🤖 Generated with …`, `Co-Authored-By: <herramienta>`), ni firmas, badges o menciones a asistentes en el mensaje: si la herramienta los agrega, se quitan antes de commitear. `.mailmap` mantiene los alias del autor bajo ese nombre.
- Hook de pre-push: empujar corre, en este orden y cortando en el primer fallo, `npm run typecheck`, `npm run test:node` y el subconjunto e2e (`npx playwright test tests/e2e/agentVerificationArtifact.spec.ts --project=chromium`). El e2e sirve el bundle con `vite preview`, así que el hook reconstruye `dist/` si falta o quedó más viejo que `src/`. Bypass: `git push --no-verify`, sólo para rescates puntuales; CI corre estos mismos pasos sin bypass, de modo que saltearlo no evita el rojo, lo traslada al run.
- Seguridad: nunca ejecutes comandos fuera de allowlist (npm/npx/node/python/git/ls/cat/echo/tsc/vite). Pide aprobación para writes.
- Estilo: TypeScript estricto, Tailwind, UI retro Norton (azul #000080, cyan #00ffff, amarillo #ffff55).
- Responde con JSON válido al orquestador: thought/plan/toolCalls/answer/finish.
- Si terminas, marca `finish:true` con resumen de archivos tocados.

## Referencias de PR con la firma vieja (no reintentar)

El 2026-11-19 se reescribió el historial para que la firma sea una sola. `main` y la
tag `v2.5.1` quedaron limpias, y las 12 tags `archive/*` se borraron también del
remoto. Ese mismo día se borraron y purgaron los refs locales que guardaban la
historia vieja —`refs/backup/pre-identity-rewrite`,
`refs/backup/tags/backup/pre-codebuff`, las 12 `refs/backup/tags/archive/*` y
`f2-closed-2026-11-10`— con `git reflog expire --expire=now --all && git gc
--prune=now`: **no queda ninguna red de seguridad local** y esos commits con la
firma vieja son irrecuperables. Sólo sobrevive `refs/backup/tags/v2.5.1`, que
duplica el objeto de tag del remoto, no historia vieja. Lo único que sigue
apuntando a los commits viejos son los `refs/pull/N/head` de 11 PRs cerrados (#1,
23, 24, 25, 27, 29, 30, 33, 34, 35, 36), y **no existe una vía que los limpie sin
perder el historial de revisión**:

- Los `refs/pull/*` son de sólo lectura: `git push --mirror` falla en ellos por diseño ([docs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)).
- No hay endpoint ni opción de UI para borrar un PR: la API sólo permite cerrarlo, y borrar la rama deja el PR y su ref en pie.
- Soporte de GitHub borra PRs **sólo con datos sensibles**, y al hacerlo elimina conversación, reviews y diffs: justo lo que se quiere conservar.
- Reescribir la rama del PR no reescribe el ref, y en estos PRs la rama ya estaba borrada, así que no hay nada que empujar.

Lo único disponible sin perder nada es **archivar** esos PRs: salen de la vista pública (404 para quien no tiene triage o más) y el historial queda para el mantenedor, pero los refs y sus commits siguen existiendo ([docs](https://docs.github.com/en/communities/moderating-comments-and-conversations/archive-pull-requests)).

Archivar **sólo funciona con PRs cerrados sin mergear**: la mutación `archivePullRequest` responde `Cannot archive a merged pull request` en los demás. Estado al 2026-11-19: #24 y #25 archivados (404 público verificado) y los otros nueve —#1, 23, 27, 29, 30, 33, 34, 35, 36— mergeados, sin forma de archivarlos. Para desarchivar: `unarchivePullRequest` o el filtro `is:archived` en la UI.

**No volver a reescribir el historial por este motivo.** Los commits nuevos están cubiertos por `npm run check:commit-signature` y el hook `.husky/commit-msg`.

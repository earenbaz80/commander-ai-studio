# Commander AI Studio v2.5.1

Entorno retro Norton para ingeniería de prompts + **agente autónomo**, modelos Gemini/HF y exportador nativo (Electron/Tauri).

**Roadmap visual (página, no código):** [earenbaz80.github.io/commander-ai-studio/roadmap-autonomo.html](https://earenbaz80.github.io/commander-ai-studio/roadmap-autonomo.html)

GitHub muestra los `.html` como código en el visor de archivos: el roadmap renderizado se abre en ese enlace.

## Documentación

- [Referencia de API](docs/API.md): endpoints de IA, agente, plugins y seguridad.
- [LM Studio](docs/API.md#lm-studio): generación, carga automática del modelo y aviso de contexto en la UI.
- [Roadmap](ROADMAP.md): el único roadmap del proyecto — paridad F0–F6, plataforma PL0–PL7 y UX 1.0, con estado, criterios, puertas y secuencia.

## Run Locally

Requiere Node.js 22.13+ (el backend usa `node:sqlite`).

1. `npm install`
2. Copia `.env.example` a `.env` y define `GEMINI_API_KEY`
3. `npm run dev` → http://localhost:3283 (el script fija `PORT=3283`; un `PORT` exportado no lo cambia)
4. Checks: `npm run lint`, `npm test` ([suite Vitest](#suite-de-tests-vitest)), `npm run test:node` ([suite node y server compartido](#suite-de-tests-node))

### CLI instalable

`npm run build:cli` empaqueta `bin/commander.ts` en `cli-dist/commander.mjs`
(esbuild, ~5 MB con todo el JS inlineado; quedan externos `node-pty`,
`playwright` y `vite`, que llegan por `npm` o por el repo). El `bin` del
paquete apunta ahí y `prepack` lo regenera. La UI es obligatoria: si falta
`dist/index.html`, `build:cli` corta con un mensaje que pide `npm run build`
en vez de dejar un tarball sin `cli-dist/dist`.

- `npm run build && npm pack` deja un tarball de ~2,36 MB con `cli-dist/` (CLI, servidor y UI), `package.json` y este README. `check:cli-package` ya hace ese build antes de empacar.
- `npm i -g ./commander-ai-studio-2.5.1.tgz` instala `commander` (`--version`,
  `doctor`, `agent`, `repl`, `config`, `session`, `mcp`, `skills`, `completion`).
- `commander serve` funciona desde el paquete instalado: sirve la UI de
  `cli-dist/dist` sin depender del repo ni del cwd del operador.

`commander build` y `commander serve --dev` siguen siendo del repo: necesitan
las fuentes y `vite`. Fuera de un checkout del Studio cortan con un motivo en
vez de ejecutar el `npm run build`/`dev` del cwd.

La distribución sin registro npm es manual: `npm run build && npm pack` deja un
`.tgz` que se comparte o se instala directamente. No hay publicación en npm ni
asset automático en GitHub Releases. Para instalar el tarball:

```bash
npm i -g ./commander-ai-studio-2.5.1.tgz
commander serve
```

### Avatares

`npm run dev` y `npm run build` regeneran antes `public/avatars/manifest.json`
con `avatars:sync`: indexa los PNG de esa carpeta (nombre plano, PNG válido, sin
ids duplicados) y conserva las etiquetas del manifiesto anterior. Si no hay PNG,
el selector usa los 12 SVG de `src/features/user/avatarCatalog.ts`.

`npm run avatars:audit` genera `.commander/avatar-audit.html` con los 12 SVG,
seis temas y los tamaños 18/32/40, leyendo los tokens reales de `src/index.css`.

### Emulador de Firebase

Con `VITE_FIREBASE_EMULATOR=1` en `.env`, Auth y Firestore apuntan a
`127.0.0.1:9099` y `127.0.0.1:8080`, y Firestore usa la base `(default)` que crea
el emulador. Sin la variable se usa el proyecto real y su base nombrada. El
emulador no se arranca solo: tiene que estar escuchando en esos puertos.

## Convención de ramas

- **Toda rama parte de `main`.** `git switch -c fix/algo origin/main`; nunca de una
  historia reconstruida ni de otra rama de trabajo. Así el PR compara contra la
  base real y no arrastra commits ajenos.
- **Entrega por PR** contra `main`, con CI verde (`.github/workflows/tests.yml`) y
  sin push directo a `main`. Un solo commit o varios, pero el merge es **squash**.
- **Si las historias difieren** (rama nacida de otra raíz: `git merge-base` vacío),
  GitHub rechaza el PR con *«has no history in common with main»*. Se crea una
  rama puente desde `main` con el árbol final y se abre el PR desde ella:

  ```bash
  git switch -c fix/algo-main origin/main
  git read-tree --reset -u fix/algo   # deja el árbol de la rama en la puente
  git commit -m "…"
  git push origin fix/algo-main
  ```

  La rama original no se mergea: queda con su historia para revisar y el squash
  mantiene `main` lineal.
- **Archivar con tag antes de borrar.** Una rama cuyo contenido ya está en `main`
  (mismo árbol, o sólo artefactos temporales) se etiqueta y después se elimina:

  ```bash
  git tag -a archive/<rama>-AAAA-MM-DD -m "Archivo de <rama> (<sha>): contenido ya presente en main" <rama>
  git push origin archive/<rama>-AAAA-MM-DD
  git push origin --delete <rama>
  git branch -D <rama>
  ```

  El tag es la referencia permanente de esa historia: `git checkout archive/<rama>-AAAA-MM-DD`.
- **Comprobar antes de borrar.** `git diff --stat origin/main <rama>` (si sólo
  aparecen `tests/tmp-*`, la rama no aporta contenido) y
  `git diff --name-status origin/main..<rama> | grep '^A'` para listar lo exclusivo.

## Hosting estático (Vercel)

El panel **Publicar** crea releases locales inmutables y las publica en Vercel
sin volver a compilar. Vercel es el único backend remoto: si faltan
`VERCEL_TOKEN` o `VERCEL_PROJECT_ID`, el destino aparece como **no configurado**
y las acciones remotas se desactivan; el publicador local sigue funcionando. No
hay fallback fake en producción. El token vive sólo en el servidor: nunca se
envía al renderer ni se imprime en errores.

La suite cubre el adaptador con un `fetch` simulado y un E2E contra un servidor
HTTP local que implementa el contrato de Vercel (subida por SHA, preview,
promoción, rollback y descarga del HTML/asset). Ese E2E **no es una cuenta
Vercel**: la primera publicación real sigue pendiente de credenciales.

- **Preflight:** `GET /api/deploy/preflight?root=…&releaseId=…` revisa la
  release sin subir nada. Si hay problemas, el preview responde `400` antes de
  llamar al proveedor.
- **Preview:** `POST /api/deploy/preview` sube la release ya construida.
- **Producción:** `POST /api/deploy/production` promueve el deployment elegido.
- **Rollback:** `POST /api/deploy/rollback` vuelve a la producción anterior.
- **Preflight:** antes de subir se rechazan `.env*`, `.npmrc`, `.netrc`, claves
  privadas, credenciales, source maps, symlinks y tokens conocidos (GitHub,
  OpenAI, Stripe, AWS, Slack, Google). El error nombra el archivo, nunca el valor.
- **Demo:** `examples/vite-static` y `npm run deploy:example` (o
  `npm run deploy:example -- --production`).

Configura las variables en `.env` (ver `.env.example`) y reinicia el servidor.
Vercel Hobby sólo permite volver a la producción inmediatamente anterior.

## Modo Agente

- Sidebar → **Modo Agente**. Describe tarea → INICIAR TAREA.
- Tools (vía `POST /api/agent/run-tool`,Rate-limit 60/min):
  - `fs.read/write/edit/glob/list/grep`, `shell.run` (allowlist), `web.fetch/search`, `code.run` (vm sandbox), `mcp.call/list`.
  - `shell.pty`: sesión interactiva persistente (REPL, `npm init`, un TUI) con `open/read/write/resize/close/list`. Proceso real con TTY, sin shell interpretando la orden y con el `cwd` dentro del proyecto.
  - `ask_user`: el agente pregunta y espera tu respuesta (opciones clicables y texto libre) por el canal de aprobación, así que la corrida se para hasta que contestas.
  - Reglas de permisos por patrón para `shell.run` y las tools de escritura (`allow`/`ask`/`deny`, `*` como comodín, gana la última que coincide); se guardan en la máquina, no en el repo.
  - Deshacer y rehacer el último paso que escribió en disco (`PASO ATRÁS` / `REHACER`): cada escritura guarda el contenido previo y, antes de revertir, se captura el estado actual para poder rehacerlo.
  - Comandos y agentes del proyecto en `.commander/commands/*.md` y `.commander/agents/*.md` (front-matter opcional `name`/`description`). Escribir `/nombre args` expande el cuerpo con `$ARGUMENTS` o `$1..$9` (y añade los args al final si la plantilla no tiene marcadores); el agente elegido prefija sus instrucciones al objetivo. `GET /api/agent/prompts?root=…` los lista.
  - GitHub: `github.pr` lee un PR (metadatos, cuerpo y diff por archivo) y `github.comment` publica un comentario con aprobación previa. Conéctalo en **Ajustes → Extensiones → Integraciones** (OAuth 2.0 + PKCE, scopes `repo` y `read:user`) o define `GITHUB_TOKEN`; el conector tiene prioridad y el token nunca viaja al modelo.
  - Linear: `linear` con `whoami`, `list_teams`, `list_issues` y `create_issue` (esta última pide aprobación). Conéctalo en **Ajustes → Extensiones → Integraciones**; el flujo es OAuth 2.0 + PKCE y el token se guarda cifrado con AES-256-GCM en `~/.commander/vault` (nunca en `commander.json` ni en `localStorage`). Configura `LINEAR_CLIENT_ID` y registra en Linear el callback que muestra la UI; `LINEAR_CLIENT_SECRET` sólo hace falta para apps confidenciales.
  - `code.analyze` / `code.refactor` / `code.fix`: análisis, renombrado y formateo **sin modelo** (ver [Análisis nativo](#análisis-nativo-sin-modelo)).
- `danger=true` pide aprobación con diff preview (`fs.edit/write`).
- Reglas repo: `AGENTS.md`, `.cursorrules`, `CLAUDE.md` se inyectan al prompt.
- Llamadas repetidas: si el modelo pide dos veces la misma tool con los mismos argumentos, el bucle registra `Llamada repetida` y le añade un aviso al turno ("ya tienes ese resultado, da el siguiente paso"). Una escritura limpia la cuenta: releer el mismo fichero después de editarlo no se marca.
- Enrutado de modelo: la cadena de respaldo vive en `commander.json` → `providers.google.fallbackModels` y se edita en el panel derecho (**CADENA DE RESPALDO**: añadir/quitar y reordenar con flechas, porque el orden es la prioridad; máx. 5). Cada fila tiene un botón de probar que hace **una** llamada mínima a ese modelo con `fallbackModels: []` (así un «✓» no puede significar «respondió otro») y deja el resultado pegado al id; no guarda nada. **PROBAR ORDEN** recorre la cadena tal cual está y **para en el primero que responda** —lo mismo que hará el servidor—, así que en el caso sano cuesta una sola llamada; dice qué modelo respondería y en qué posición, y cuando hay alguno caído por delante lo señala. Usa la misma sonda que la comprobación previa de las evaluaciones (`src/lib/modelProbe.ts`) o vía `GET/POST /api/gemini/fallback-models`. Las peticiones ya no necesitan mandarla: `POST /api/gemini/generate` (y `/api/gemini/stream`) sigue aceptando `fallbackModels: string[]` y esa lista manda sobre la config. Sin config propia se usa la de fábrica (`GEMINI_FALLBACK_MODELS`); un array **vacío**, en la config o en la petición, **desactiva el respaldo** y devuelve 503 en vez de cambiar de modelo por detrás. La respuesta declara `model` (quien contestó), `requestedModel` y `fallback: {from, to} | null`, y el agente deja un paso `Modelo sustituido`.
- Freebuff: proveedor propio (`freebuff/…` → `POST /api/freebuff/generate`, proxy OpenAI-compatible a `freebuff.com/api/v1/paid`). Sus modelos **no** vienen en el catálogo por defecto porque sin `FREEBUFF_API_KEY` fallarían al elegirlos: `npm run models:freebuff` mete los que declaran tool-calling (hoy 9 de 280; el resto sólo hace chat) y se repite cuando el proveedor añada modelos. Los ids viven en `src/config/freebuff-models.json`, que leen a la vez el agente (`toolDialectForModel`), el proxy y el propio script.
- MCP: panel lateral (add/list/toggle, persiste `localStorage`). Schemas MCP se anexan al `toolSchema`.
- Sesiones: auto-guardado en `localStorage` (20), restore/fork/delete. Métricas por tool en panel.

### Contrato del plan

El agente mantiene el plan con `update_plan`, una pseudo-tool que no toca el
workspace: sólo refleja el progreso. Acepta la lista completa de pasos o
entradas parciales `{id, status}` (también `{id, done}`) para cambiar un paso
existente sin repetir su texto.

| Campo | Tipo | Reglas |
| --- | --- | --- |
| `id` | string | Identificador estable. Hace falta para actualizar un paso existente; si falta en uno nuevo, se genera. |
| `text` | string | Descripción corta, máximo 160 caracteres. Un parcial conserva el texto anterior si no se reenvía. |
| `status` | `pending` \| `in_progress` \| `done` \| `blocked` | Fuente de verdad del estado. Un paso nuevo sin estado nace `pending`. |
| `files` | string[] opcional | Archivos que toca el paso: máximo 20, sin duplicados y 300 caracteres por ruta. Un parcial conserva los anteriores si no se reenvían. |
| `criteria` | string opcional | Criterio de aceptación, máximo 500 caracteres. Un parcial conserva el anterior si no se reenvía. |
| `done` | boolean | Derivado de `status` (`done` es el único estado que lo pone en `true`). Se mantiene para clientes antiguos. |

El plan completo se limita a 20 pasos. Se descartan las entradas sin texto ni
`id` conocido, los `id` repetidos se ignoran a partir del primero y un valor que
no sea un array no borra el plan actual. Los planes guardados antes de F1-13
sólo tienen `done`: se migran al leerse (`true` → `done`, `false` → `pending`).

```json
{"items":[{"id":"p1","text":"leer el repo","status":"in_progress","files":["src/a.ts"],"criteria":"localizar el bug"}]}
{"items":[{"id":"p1","status":"done"}]}
```

El plan viaja en `SessionStateV2.plan`, se guarda con la sesión (incluido
`--resume`) y se expone en `GET /api/agent/sessions/:id` y en el evento `plan`.
La TUI lo pinta como `☐` pendiente, `▸` en curso, `✔` hecho y `!` bloqueado.

### Adjuntarse a una corrida del escritorio

Cuando el escritorio lanza una sesión, la terminal puede seguirla sin arrancar
un segundo bucle ni cancelarla:

```bash
commander attach <sessionId> --server http://127.0.0.1:3280
commander attach <sessionId> --json --after 42
```

El comando abre `GET /api/agent/sessions/:id/stream`, reanuda desde el cursor
indicado y reconecta con `Last-Event-ID`. En modo humano pinta el estado y los
eventos; con `--json` emite NDJSON y termina con un evento `done`. La corrida
sigue siendo del servidor: cerrar la terminal no la detiene.

Si el stream pide una aprobación, la terminal muestra la tool (con el diff de
las escrituras) y permite decidir sin volver al escritorio:

- `↑/↓` (o `j`/`k`) y `Enter`, o directamente `1`, `2`, `3`.
- `1` permite una vez, `2` deniega y `3` permite esa tool+objetivo durante la
  sesión (`allow-session`).
- `Esc` deja la decisión al escritorio; `Ctrl+C` corta el adjunto. La respuesta
  se envía a `POST /api/agent/sessions/:id/approvals/:approvalId`, así que la
  semántica (timeout, idempotencia, 409) es la misma que en la UI. Con `--json`
  o sin TTY no se pregunta: la decisión sigue siendo del escritorio.

### Agente de GitHub Actions

`.github/workflows/commander-agent.yml` reutiliza el CLI headless: arranca el
servidor embebido, espera `/api/health` y ejecuta `commander agent --json`
contra el checkout del evento (en comentarios de PR, `refs/pull/N/head`). No
duplica el bucle del agente.

- `/commander <tarea>` en un issue o PR: modo plan (sólo lectura), publica la
  respuesta como comentario. Sólo owner, miembros y colaboradores pueden
  invocarlo; los comentarios de bots se ignoran.
- `/commander --write <tarea>` en un issue: modo build, commitea los cambios en
  una rama y abre un PR con `Refs #N` (no lo cierra). En pull requests se
  rechaza: no se puede actualizar de forma segura la rama de un fork.
- `workflow_dispatch` acepta `task`, `issue_number` opcional y `write`.

Configura en **Settings → Secrets and variables → Actions** la clave del
proveedor (por ejemplo `GEMINI_API_KEY`) y, si quieres fijar el modelo, la
variable `COMMANDER_MODEL`. También puedes ajustar `COMMANDER_MAX_STEPS` y
`COMMANDER_AGENT_TIMEOUT_MS` como variables. El workflow no le pasa el token de
GitHub al servidor: los comentarios y el PR los crea el script, nunca el modelo.

## API agente

- `POST /api/agent/run-tool {toolId, input}` — sandbox a `process.cwd()`, validación y allowlist shell.
- `GET /api/integrations` — catálogo de conectores con estado y callback.
- `POST /api/integrations/:provider/authorize` — inicia OAuth y devuelve la URL.
- `GET /api/integrations/:provider/status` — estado sin exponer el token.
- `POST /api/integrations/:provider/disconnect` — revoca el token en el proveedor y borra el local; si el proveedor falla, borra igualmente el local y devuelve un aviso.
- `GET /api/health` — smoke.

## Backend multiinquilino (local)

`/api/backend` da a Commander una superficie de datos con cuentas aisladas sin
dependencias ni servicios externos. Cada registro crea un inquilino y su usuario
propietario; el resto de rutas exige `Authorization: Bearer <token>`.

- `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`.
- `GET/POST /records`, `GET/PATCH/DELETE /records/:id`.
- `GET/POST /files`, `GET/DELETE /files/:id`. El binario se manda en el cuerpo,
  con `Content-Type` y, opcionalmente, `X-Commander-File-Name`; máximo 10 MiB.

El `tenant_id` sale siempre de la sesión, nunca del body ni de la query. Un
recurso de otro inquilino responde 403, uno inexistente 404 y una petición sin
sesión 401. La base es SQLite (`.commander/tenants.db`) y los bytes viven en
`.commander/tenant-storage/<tenant>/<uuid>`; ambas rutas se pueden mover con
`COMMANDER_TENANT_DB_PATH` y `COMMANDER_TENANT_STORAGE_DIR`. Las contraseñas usan
scrypt + salt, los tokens se guardan sólo como SHA-256 y las respuestas llevan
`Cache-Control: no-store`. Contrato completo en
[docs/API.md](docs/API.md#backend-multiinquilino).

Es el backend local de Commander: no aprovisiona bindings para apps publicadas
(eso sigue en **PL3** de [ROADMAP.md](ROADMAP.md) §4). La vista
**Workbench → Backend** permite crear o iniciar sesión, gestionar registros y
subir, descargar y borrar archivos contra `/api/backend`; el token vive en
`sessionStorage` y se borra al cerrar sesión.

## Sesiones PTY

`shell.run` ejecuta y devuelve salida; `shell.pty` abre un proceso y lo mantiene vivo entre llamadas:

```json
{"toolId": "shell.pty", "input": {"action": "open", "executable": "node", "args": ["-i"]}}
{"toolId": "shell.pty", "input": {"action": "write", "id": "pty-1", "data": "1+1
"}}
{"toolId": "shell.pty", "input": {"action": "read", "id": "pty-1", "cursor": 0}}
{"toolId": "shell.pty", "input": {"action": "close", "id": "pty-1"}}
```

`read` devuelve la salida nueva y el `cursor` actualizado: se pasa en la siguiente lectura para no repetir lo ya entregado (si el buffer descartó lo viejo, lo dice en `dropped`). Hay un máximo de 4 sesiones, cada una ligada a la tanda del agente que la abrió, y se cierran solas tras 15 minutos sin uso.

## Análisis nativo (sin modelo)

Tres tools que no llaman a ningún proveedor del LLM: funcionan sin clave, sin cuota y sin red, y su resultado lo firma el compilador.

- **`code.analyze { path, symbol? }`** — diagnósticos del archivo (language service de TypeScript), imports que no se usan, reglas del repo (`color-token`, `i18n-literal`) y, con `symbol`, sus referencias en todo el proyecto. Sólo lee, así que entra en modo plan.
- **`code.refactor { path, symbol | line+column, newName }`** — renombrado con las mismas posiciones que usaría el editor. Devuelve un diff por archivo y **no escribe**: se aplica con `fs.write`, que es lo que pasa por aprobación.
- **`code.fix { paths[] }`** — `eslint --fix` y después `prettier --write`, con los binarios del proyecto (`node_modules`, nunca `npx`: no hay red que asumir). Es la acción «revisar» de un clic; escribe, así que está en `EXEC_TOOLS` y en modo plan responde 403.

`fs.propose.write/edit` typechequean el borrador **por defecto** (`diagnose: false` lo desactiva) y devuelven `rules`: sólo las violaciones que el cambio introduce, no la deuda que ya tenía el archivo.

### Reglas del repo

`npm run check:rules` (también dentro de `npm run lint`) compara con `HEAD` y falla sólo por violaciones **nuevas**, comparando por regla+fragmento y no por línea:

- `color-token`: colores literales (`#ff0000`) en vez de la paleta Norton.
- `i18n-literal`: texto de interfaz que no pasa por `L(es, en)` / `t` / `deText`.

Así se puede exigir «no añadas deuda» sin limpiar los ~3.000 colores que ya existen. `--all` enseña todo, `--base <ref>` cambia la referencia y `--files a,b` limita el alcance.

En el editor del Workbench, el botón de revisar abre un panel con ese análisis, el formato (`code.fix`) y el renombrado (`code.refactor`) con sus diffs por archivo; no aplica nada si el resultado deja errores de tipos.

Las listas blancas de `allowedTools` escritas antes de estas tools no las incluyen: `code.analyze` y `code.refactor` están en `CORE_TOOLS` (no escriben) y entran igual; `code.fix` escribe, así que hay que permitirla a mano en el proyecto.

## Plugins del proyecto

Un plugin es un módulo ESM en `.commander/plugins/<id>/index.js` (o `index.mjs`) con ganchos opcionales. Se carga desde el proyecto que estás trabajando, se recarga solo cuando cambia el fichero y no hace falta reiniciar el servidor.

Junto al módulo, `plugin.json` declara la API y los permisos:

```json
{ "apiVersion": 1, "permissions": ["lifecycle", "tools"] }
```

Con manifiesto, el runtime lo valida **antes de importar** el módulo: una `apiVersion` mayor distinta de la soportada rechaza el plugin sin ejecutar una línea, y sólo se despachan los hooks cuyo permiso está declarado (`lifecycle` para sesión/modelo, `tools` para `beforeTool`/`afterTool`). Sin `plugin.json` el plugin se carga como legado con todos sus hooks.

```js
export default {
  sessionStart: (ctx) => console.log('arranca', ctx.sessionId),
  beforeModel: (ctx) => console.log('turno', ctx.turn),
  afterModel: (ctx) => console.log('respuesta', ctx.ok),
  // Puede reemplazar la entrada devolviendo { input }.
  beforeTool: (ctx) => ({ input: { ...ctx.input, path: String(ctx.input.path || '').trim() } }),
  // Puede reemplazar el resultado devolviendo { result }.
  afterTool: (ctx) => ({ result: { ...ctx.result, data: { ...ctx.result.data, plugin: ctx.toolId } } }),
  sessionEnd: (ctx) => console.log('cierra', ctx.answer),
  stop: (ctx) => console.log('cancelado', ctx.reason),
  error: (ctx) => console.error('falló', ctx.error),
};
```

Los hooks de tool reciben `toolId`, `input` y `root`; `afterTool` añade `result`. Los de sesión reciben `sessionId`, `root`, `goal` y `model`; `beforeModel`/`afterModel` añaden `phase`, `turn` y, al cerrar, `ok`/`error`. `sessionEnd` recibe `answer`, `stop` recibe `reason` y `error` recibe el mensaje.

El lifecycle corre en orden alfabético por id de plugin. `sessionEnd` es el cierre normal; `stop` y `error` son cierres alternativos. Cada hook tiene un timeout de 5 s y un fallo o un cuelgue no rompe la corrida: los errores quedan en `getPluginErrors()` y los hooks de tool también se adjuntan a `data.pluginErrors`. Los hooks corren dentro del proceso del servidor con sus mismos permisos: son código de confianza, como un script de `package.json`. Un plugin que no compila tampoco impide cargar los demás.

El bucle del servidor (`AgentSession`) ejecuta los hooks en proceso. El del navegador (`AgentLoop`) y el del CLI (`runAgent`) ejecutan el agente fuera del servidor y mandan cada hook a `POST /api/plugins/lifecycle`, que reutiliza ese mismo runtime: `sessionStart` antes del primer modelo, `beforeModel`/`afterModel` por llamada y un único cierre (`sessionEnd`, `stop` o `error`). Un fallo de red o un servidor sin plugins no cambia la corrida.

`examples/plugins/reference-plugin` es el plugin de referencia: registra todos los hooks en `.commander/reference-plugin.log` sin alterar nada. Incluye `plugin.json` con la API 1 y ambos permisos.

### Catálogo de plugins (marketplaces de Claude)

Configuración → Extensiones → Plugins lista los plugins publicados en `.claude-plugin/marketplace.json` de `anthropics/claude-plugins-official` y `anthropics/claude-code` (se puede cambiar con `COMMANDER_PLUGIN_MARKETPLACES=owner/repo,...`). El catálogo se lee por `raw.githubusercontent.com`, así que abre aunque la API de GitHub esté limitada; se cachea 10 minutos. Si una entrada publica `checksum` (`sha256:…`), la instalación lo compara con la descarga antes de escribir nada y responde 409 si no coincide; el valor queda en el manifiesto y `GET /api/plugins` lo devuelve.

Instalar no guarda un zip opaco: trae los archivos del plugin y los convierte en piezas nativas —`.md` de `commands/` y `agents/` a `skills/plugins/<id>/commands` y `skills/plugins/<id>/agents` con front matter, y `.mcp.json` a los servidores de la config—, deja una copia en `.commander/plugins/<id>/files/` y apunta lo escrito en `.commander/plugins/<id>.manifest.json`. Cada plugin va en su propia carpeta para que `skills/plugins/` pueda ignorarse en bloque sin ocultar las skills del proyecto. Desinstalar borra exactamente esas rutas, la copia y el manifiesto; los servidores MCP que añadió salen de la config.

La instalación sí usa la API de GitHub para listar el árbol del repo: sin token son 60 peticiones por hora. Define `GITHUB_TOKEN` (o `GH_TOKEN`) en el entorno del servidor para subir el límite. Los plugins cuya fuente es un repo completo sin carpeta concreta no son instalables y el catálogo lo explica en su lugar.

- `npm run electron:dev` / `npm run build:electron` (puerto embebido 3280).
- SW deshabilitado en Electron; rutas `index.html` relativas (`./`) para `loadFile`.

## Seguridad

- Headers base + CORS allowlist (`CORS_ORIGINS`) + rate global por IP: 1.200 lecturas y 300 escrituras por minuto, con `/api/health` exento.
- Debug `listModels` 403 en prod. Export ZIP con escape HTML y filename sanitizado.
- `firestore.rules`: `/users` self-only, `likesCount` solo ±1, likes no públicos.

## Dependencias y auditoría

El CI exige **cero vulnerabilidades en producción**: `npm audit --omit=dev --audit-level=low` corre en cada push y PR.

`dependencies` es sólo lo que tiene que existir en `node_modules` al ejecutar: hoy `node-pty` (módulo nativo de la terminal, que además viaja como `extraResources` al paquete de Electron) y nada más. El resto de la app —UI, servidor, SDKs— se empaqueta con Vite y esbuild, así que vive en `devDependencies`: no se resuelve en runtime y no engorda un `npm i -g` del CLI. Que el bundle siga siendo autosuficiente lo vigila `npm run check:cli-package`; los advisories de ese conjunto los cubre el vigilante semanal del audit completo.

- **Reintento sólo de red.** El paso corre `scripts/audit-prod.ts`, que lee el JSON de npm: un fallo de transporte (`EAI_AGAIN`, `ETIMEDOUT`, `ECONNREFUSED`, 5xx del registry) se reintenta **una** vez a los 3 s y, si tampoco llega, falla diciendo que no es un veredicto sobre las dependencias. Un JSON con `vulnerabilities` **nunca** se reintenta: se listan los paquetes y sale 1. Un error de npm que no es de red (config, lock ilegible) también falla al primer intento, para no retrasar el diagnóstico.

`npm audit` **completo** no está en cero y no puede estarlo hoy: los **11** avisos `moderate` que quedan son todos de dependencias de desarrollo y cuelgan de un único advisory, [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (ReDoS en `minimatch` por amplificación de `globparts`). Ese 11 cuenta **paquetes afectados**, no advisories: el propio `minimatch` más sus dependientes (`@electron/universal`, `app-builder-lib`, `dmg-builder`, `electron-builder`, `electron-builder-squirrel-windows` y la cadena de `@typescript-eslint`). Como es un recuento que se mueve cuando npm deduplica el árbol —una lectura anterior de esta sección decía 25—, lo que decide qué hacer es el advisory, no el total.

- **Sólo parcheado en `minimatch` 11.0.1.** El advisory cubre `7.0.0 - 11.0.0` (extremos incluidos): no hay fix dentro de 7.x, 8.x, 9.x, 10.x ni 11.0.0, y las últimas versiones de los consumidores siguen pinneando major anteriores: `eslint` (`^10.2.6`), `@typescript-eslint/typescript-estree` (`^10.2.2`) y `app-builder-lib` (`^10.2.5`). Actualizar ESLint o electron-builder dentro de las majors actuales no quita ni un aviso: el único `fixAvailable` que reporta npm para el advisory es un **downgrade** a `electron-builder` 25.1.0 (`isSemVerMajor: true`), no una actualización.
- **Forzar la 11 rompe el empaquetado.** Con `overrides: { "minimatch": "^11.0.1" }` el audit completo baja a 0 y el lint sigue verde, pero `@electron/asar` —que usa `glob@7` con `minimatch@3`— falla: `TypeError: Cannot read properties of undefined (reading 'charAt')`, y el `.asar` sale con **0 entradas**. Un aviso moderado en tooling es preferible a una app vacía, así que ese override no se mantiene.
- **Cuándo revisarlo.** Cuando `electron-builder` migre a `@electron/asar` 4 / `glob` 13 (o minimatch 11 llegue a la cadena de ESLint), se puede reintentar el override y subir el gate a `npm audit` completo. No apuntar el gate a dev antes de eso: 11 avisos de herramientas taparían un aviso real de producción. Ese día lo detecta el job de vigilancia.
- **Vigilancia semanal.** [`.github/workflows/audit-watch.yml`](.github/workflows/audit-watch.yml) (lunes 06:00 UTC, o a mano con *workflow_dispatch*) corre `scripts/audit-watch.ts`: `npm audit` completo más la resolución **real** de la cadena contra el registry (`npm view <pkg>@<rango>`), no el lockfile instalado. Falla y anota un aviso si aparece un advisory distinto del conocido, o si toda la cadena ya admite `minimatch` >= 11.0.1 —la señal de que toca actualizar y apuntar el gate a dev—. En verde significa «sigue bloqueado y no hay novedades», que es lo esperado. `--offline` se salta el registry y sólo audita el árbol instalado.
- **Issue automático.** Cuando el vigilante encuentra algo que hacer no se queda en el run rojo: deja un issue abierto con las tablas (cadena y advisories nuevos) y qué hacer marcado como checklist. Si ya hay uno abierto con prefijo `audit-watch:` en el título, comenta ahí en vez de duplicarlo. Un fallo de red **no** abre issue: el script no deja informe en ese caso, porque un registry intermitente no es un hallazgo.
- **Cierre automático.** Cuando una corrida vuelve a verde **con veredicto completo** (audit sin advisories nuevos, cadena medida y todavía sin admitir el parche), comenta el motivo en ese issue y lo cierra: el aviso no se queda colgado. El disparador es el archivo `cierre.md`, que el script sólo escribe en ese caso, así que un `--offline` o un registry a medias —que igual salen en verde— no pueden cerrar nada. Si el problema reaparece, la corrida siguiente abre un issue nuevo.
- **Override vigente.** `@grpc/grpc-js` (^1.14.7) fuerza la versión parcheada que Firestore sigue pineando en `~1.9.0`; ese transporte es la vía Node de Firestore y la app lo usa desde el renderer, no desde `server.ts`.
- **Prueba del camino `gh`.** El mismo workflow, lanzado con *workflow_dispatch* y el input `self_test` marcado, no audita: abre un issue `[self-test] audit-watch — …`, lo comenta, lo cierra y **lee el estado** para confirmar que quedó `CLOSED` (salir 0 al cerrar no lo prueba); luego intenta borrarlo. Corre en un job aparte, sin checkout ni `npm ci`, así que el único motivo posible de fallo es el token o los permisos de issues. El título no empieza por `audit-watch:` a propósito, para que una corrida real nunca lo tome por el suyo. Borrar un issue pide permiso de administración: si el token no lo tiene, la prueba pasa igual y avisa de que el issue de prueba queda cerrado.

## Suite de tests (Vitest)

`npm test` corre los dos proyectos de `vitest.config.ts`, y cada uno se puede lanzar solo:

- **`ui`** — `tests/ui/**` (47 ficheros) con jsdom y `tests/ui/setup.ts`: los polyfills que jsdom no trae (ResizeObserver, IntersectionObserver, `matchMedia`, `scrollIntoView`, Web Speech) y los matchers de `@testing-library/jest-dom`.
- **`node`** — `tests/unit/**` y `tests/mcp/**` (39 ficheros) con entorno `node` y `tests/unit/setup.ts`, que **no** carga nada de DOM: esta suite es lógica pura y no lo necesita. Ese setup sólo blinda el estado que comparten por correr en un proceso real: devuelve el cwd a la raíz si un test que hizo `process.chdir` falla antes de restaurarlo, y desactiva fake timers que hayan quedado activos.

  La separación la vigila `tests/unit/noDom.test.ts`: comprueba que en esa suite no existe `window` ni `document`, escanea las dos carpetas buscando APIs del DOM o imports de `@testing-library`/`jsdom`, y sigue los imports de forma transitiva (relativos y `@/`) hasta lo que cada test carga de `src/`, porque el caso realista es que el test esté limpio y el DOM entre por un helper. Ignora comentarios, imports de sólo tipo (se borran al compilar) y los usos ya cubiertos por una guarda de entorno: `typeof window !== 'undefined' && …` en la misma línea, y el `if (typeof window === 'undefined') return;` o `if (typeof window !== 'undefined') { … }` de más arriba (también con la condición partida en varias líneas), pero **sólo dentro de su bloque** (todo el fichero si está en el nivel superior). Una guarda en otra función no exime, una guarda guardada en una variable (`const enNode = typeof window === 'undefined'`) tampoco —no se puede saber si luego se comprueba—, y un `if (...) { … }` deja de cubrir al cerrar su bloque. Cuando falla dice fichero, línea, API y la cadena de imports que llevó hasta ahí, así que la respuesta es mover el test a `tests/ui` o partir el módulo, no añadir polyfills.

  El guard vigila también su propio coste, porque ya se degradó dos veces: resolver los imports con `existsSync`/`statSync` por candidato (~1.200 llamadas, ~450 ms) y recorrer el repo entero (`src-tauri/target` son miles de artefactos, 1,4 s). Ahora los directorios se listan una vez, cada fichero se lee una sola vez y el grafo en frío tiene presupuesto de 1 s con una medición de ~90 ms. Las tres cosas fallan la suite: más lecturas que ficheros, más directorios listados que ficheros alcanzados, o pasarse del presupuesto.

```bash
npm test                                   # los dos proyectos
npx vitest run --project node              # sólo lógica (~5 s)
npx vitest run --project ui                # sólo UI (~20 s)
npx vitest run tests/unit/config.test.ts   # un fichero
```

- **`pool: 'vmForks'`.** El entorno se instancia una vez por worker en vez de una por fichero: la suite completa pasó de ~149 s a ~30 s en esta máquina y el aviso «jsdom was created 38 times» desaparece. El aislamiento se mantiene, porque cada fichero sigue corriendo en su propio contexto de VM. No cambiar a `vmThreads`, que también reutiliza el entorno: los tests de MCP hacen `process.chdir`, y eso no existe dentro de un worker thread.
- **Entorno por suite, no por fichero.** Un mock global de la UI o un polyfill de jsdom no puede tapar un fallo de la lógica, y viceversa.

## Suite de tests (node)

La de arriba va aparte: `npm run test:node` corre los `tests/*.test.ts` de la raíz y los `tests/cli/*.test.ts` con el runner de Node. Un solo archivo también: `npm run test:node -- tests/persistence.test.ts`.

`node --test` abre **cada archivo en su propio proceso**, así que un server compartido en memoria no serviría de nada. Lo resuelve `scripts/test-node.ts`: abre un canal de control en loopback y compila `server.ts` **la primera vez que algún archivo pide la URL**, nunca antes. Un archivo que no toca HTTP no paga el arranque (`ningún archivo usó HTTP: no se arrancó el server`); los que sí, reutilizan el mismo y no lo matan, porque no es suyo. Al acabar la suite se para el server y se borra la base temporal.

- **Modo**: `NODE_ENV=production` y una SQLite en un directorio temporal. No es «desplegar»: con Vite montado como middleware el primer re-optimizado bloqueaba el proceso y una petición de test moría por timeout. La superficie `/api/*` es la misma; los endpoints exclusivos de desarrollo no están.
- **Sin padre**: `startServer()` del arnés arranca y para su propio server, así que `tsx --test tests/serverEndpoints.test.ts` sigue funcionando solo.
- **CLI E2E (F1-14)**: `tests/cli/e2e.test.ts` lanza `bin/commander.ts agent --json` contra `tests/helpers/fakeAgentServer.ts`, un HTTP local que imita `/api/health`, `/api/gemini/generate`, `/api/gemini/stream` y `/api/agent/run-tool`. No usa clave ni red; cada caso deja un recibo en `os.tmpdir()` con stdout/stderr/peticiones y la última línea NDJSON.
- **Worktrees y `--label`**: la caducidad de aprobaciones del CLI se commiteó en `25c30ef` (flag `--label`, `retryLabel`, prompt y TUI). Desde ese commit un worktree en `HEAD` corre la suite node completa —914 tests, incluido el caso `--label`— sin fallos. Antes el flag vivía en cambios sin commitear y el caso salía con `error: unknown option '--label'` (exit 1, cero eventos NDJSON) aunque el test ya estuviera en `ef46438`; si reaparece, comprobar que el worktree está sobre un commit que incluye `bin/commander.ts`.

- **Peticiones**: `node:http` con `agent: false`. `fetch` reutiliza sockets que el server cierra a los 5 s y un POST moría con `ECONNRESET`.
- **Si el server muere**: el test falla diciéndolo; no se arranca otro por detrás, que escondería el fallo tras una instancia distinta de la que se cree.

### Ensayar un slice en un worktree

`tsc` y Vitest resuelven `node_modules` subiendo directorios, así que no necesitan nada especial. `npm run test:node` sí: `npm run` añade al `PATH` sólo el `node_modules/.bin` del worktree, y el CLI E2E y otros tests lanzan procesos que buscan `<cwd>/node_modules/tsx/dist/cli.mjs`. Sin el junction aparecen fallos por `tsx` no encontrado que no son del slice.

```bash
REPO=$(git rev-parse --show-toplevel)
WT="$REPO/.git/slice-wt"
git worktree add --detach "$WT" HEAD
# Windows (Git Bash): junction al node_modules real
cmd //c mklink //J "$(cygpath -w "$WT")\\node_modules" "$(cygpath -w "$REPO")\\node_modules"
# Linux/macOS:
# ln -s "$REPO/node_modules" "$WT/node_modules"
cd "$WT"
export PATH="$REPO/node_modules/.bin:$PATH"
npm run test:node -- tests/apiRoutes.test.ts   # o los archivos focales del slice
```

- **Cobertura**: el servidor compartido compila `server.ts` del worktree y atiende en un puerto efímero; no hace falta `dist/` para las rutas `/api/*` (sólo faltan los estáticos, y el log lo dice).
- **Cierre**: primero `cmd //c rmdir "$(cygpath -w "$WT")\\node_modules"` (quita el junction; nunca `rm -rf`, que borraría el `node_modules` real), después `git worktree remove --force "$WT"` y `git worktree prune`.
- **`--label`**: sin limitación desde `25c30ef`; el caso de caducidad pasa también en worktrees (ver la viñeta de worktrees y `--label`).

## Guardia de secretos

`npm run test:node` incluye `tests/envLeakGuard.test.ts`: falla si una credencial real aparece escrita en un fichero versionado.

- **Origen de las claves**: variables del proceso, `.env`/`.env.local`/`.env.production`/`.env.development` (ignorados por git) y los valores con nombre de credencial de los bloques `env` de `commander.json` — una clave que vive sólo en el `env` de un servidor MCP no está en ningún otro sitio, así que sin esa fuente no se buscaría. Sólo nombres `*_API_KEY`, `*_API_TOKEN`, `*_ACCESS_TOKEN`, `*_TOKEN`, `*_SECRET`, de 12+ caracteres y sin pinta de relleno (`your…`, `changeme`, `<…>`, `${…}`).
- **Qué revisa**: los ficheros de `git ls-files` y **todos los blobs del historial** (`git rev-list --objects --all` + `cat-file --batch`), saltando binarios y los de más de 2 MB. Sin git usa una lista de reserva (`commander.json`, `.env.example`, `package.json`, `README.md`) y lo dice en el mensaje.
- **Historial**: una clave borrada del árbol sigue en los commits antiguos. El fallo indica `ruta @ blob` y los commits que tocaron ese blob. Rotar la credencial es obligatorio: reescribir el historial no la vuelve secreta.
- **Qué imprime**: sólo `fichero ← VARIABLE`; nunca el valor, para que el propio error no sea otra fuga.
- **Sin credenciales locales** pasa y avisa por consola de que no había nada que comparar.

## Evaluaciones del agente

`npm run eval` mide el agente con tareas reales del repo: `evals/tasks.ts` define el objetivo, el guion y las comprobaciones; `evals/harness.ts` las ejecuta sobre copias temporales de los ficheros (el repo no se toca).

- **Replay (por defecto, y en CI)**: modelo guionizado, herramientas reales (`AgentLoop` → `/api/agent/run-tool` → `executeAgentTool`). Determinista y sin claves. Corre también dentro de `npm run test:node` (`tests/evals.test.ts`).
- **Live**: `npm run eval:live` con el modelo de verdad (`EVAL_MODEL`). Cuesta tokens y no es determinista; no va en CI. Cada tarea tiene 300 s y 30 pasos de presupuesto (en replay son 20 s y 16 pasos: cada tool cuesta dos pasos y el preflight también consume; `pipeline-agujereado` necesita lectura + dos ediciones). `EVAL_TIMEOUT_MS` cambia el tiempo.
- **Comprobación previa**: antes de la primera tarea, la pasada live hace **una** llamada mínima al modelo pedido (`evals/preflight.ts`). Si contesta otro, **aborta con código 1** en vez de gastar las cinco tareas en una pasada que no se registraría; el mensaje dice qué modelo contestaría. Sin respuesta ninguna (key, cuota, `EVAL_BASE_URL`) también aborta, con el motivo real. `--allow-fallback` (o `EVAL_ALLOW_FALLBACK=1`) deja medir el sustituto a sabiendas, avisando de que esa pasada no se registra.
- **Modelo sustituido**: si el modelo pedido no responde (cuota agotada, modelo retirado) y contesta otro, la pasada lo avisa (`⚠ modelo sustituido: X → Y`) y **no se guarda en el historial**: `sin registrar en …: no midió el modelo pedido`. La serie del historial es por modelo, así que anotar ahí resultados de otro modelo convierte la línea base en una mezcla y ya no se sabe contra qué se mide. Sin cuota se puede repetir la pasada live sin ensuciar nada; la primera que sí mida el modelo pedido se comparará con la última que también lo midió. El dato sale del paso `Modelo sustituido` que escribe el agente; el aviso en el texto del proveedor queda como respaldo.
- **Exigir el modelo**: `--require-model` (o `EVAL_REQUIRE_MODEL=1`) hace fallar la pasada si hubo sustitución: medir otro modelo no es un resultado peor, es no medir.
- **Esperar la cuota**: `npm run eval:wait` sondea la cadena con una llamada mínima por modelo y, en cuanto uno se conteste **a sí mismo** (sonda con `fallbackModels: []`, así un lite de rebote no cuenta), lanza la pasada **completa** con `--require-model` — la única que registra línea base. Los lite quedan fuera salvo que se pidan con `--models`. Opciones: `--interval <min>` (15 por defecto), `--rounds <n>` (0 = sin límite), `--dry-run` (sondea y no lanza la pasada), `--models a,b`. Sale con 0 si la pasada corrió, 1 si se agotaron las rondas sin cuota y 2 si no queda nada que sondear.
- **Servidor del modo live**: no hay que arrancarlo a mano. Si algo ya responde en la URL objetivo (`EVAL_BASE_URL`; si no, `EVAL_PORT` o `PORT`; si no, `http://127.0.0.1:3280`) se reutiliza y no se toca; si no hay nada y la URL es loopback, el runner arranca `server.ts`, espera a `/api/health` y apaga **sólo ese proceso** al terminar. La espera es de hasta 120 s porque al arrancar el optimizer de Vite bloquea el event loop y el health tarda aunque el puerto ya escuche; por eso, si el puerto escucha pero aún no contesta, se reutiliza en vez de intentar arrancar otro. Una `EVAL_BASE_URL` remota que no responde es un error explícito: arrancar algo local no la haría responder.
- Las tareas derivan sus cadenas del contenido actual: si el fichero cambia de forma que la premisa desaparece, la tarea falla en vez de pasar por casualidad.
- `pipeline-agujereado` inyecta dos regresiones en una copia de `src/agent/shellCommand.ts` y su veredicto **importa el módulo ya parcheado** y ejecuta una tabla de casos: comportamiento, no texto. Se comprobó que falla sin arreglo y con cada arreglo parcial.
- **Diagnóstico**: al fallar, el runner imprime el diff de lo que cambió el agente en el workspace (ficheros modificados, nuevos y borrados, recortado a 40 líneas por fichero) y, si no tocó nada, lo dice. La foto inicial se toma después de `setup`, así que los ficheros de la propia tarea no cuentan como cambios. Se ignoran `.git`, `.commander` y `node_modules`: los checkpoints que la app escribe dentro del workspace son estado interno, no trabajo del agente. El mismo diff viaja en `EvalOutcome.diffs`, de modo que el mensaje de fallo de CI también lo enseña.

### Historial de pasadas live

Cada pasada live se anota en `evals/results.jsonl` con el commit (`git rev-parse --short HEAD`), la marca de árbol sucio (`dirty`), el modelo, **qué modelos contestaron de verdad** (`answeredModels`, leído del campo `model` de cada respuesta, no del aviso de sustitución) y el veredicto de cada tarea. Si `answeredModels` no es `[modelo pedido]`, `npm run eval:history` lo muestra (`· respondió: X`, o `⚠ respondió: X, Y` si en la misma pasada contestaron varios) y la comparación añade `· modelo que respondió: antes X · ahora Y`, porque el mismo resultado medido por otro modelo no es la misma medida. El fichero se **versiona a propósito**: comparar contra la pasada anterior sólo sirve si la historia viaja con el repo.

- **Comparación automática**: al terminar una pasada live, el runner imprime el delta contra la última pasada del mismo modelo: qué tarea se rompió (`↓`, con la comprobación que falló), cuál se arregló (`↑`), cuáles siguen fallando y cuáles son nuevas.
- **Diagnóstico persistente**: las tareas fallidas guardan `changedFiles` (ruta y estado: `modificado`, `nuevo`, `borrado`); las que pasan no, para no engordar el historial. En la línea `↓` sale como `[tocó: src/… (modificado)]`, o `[sin cambios]` si no tocó nada; un registro anterior a este campo no se inventa el dato. Así el diagnóstico de un fallo se puede comparar entre commits sin depender del log de la terminal.
- **Alcance**: si el agente toca ficheros que la tarea no declara en `files`, la pasada se marca `⚠ sospechosa` con esos ficheros **aunque los checks pasen**: un arreglo que funciona por la vía equivocada no debe quedar verde sin más. No cambia el veredicto ni el código de salida de `npm run eval`, pero queda en el historial (`outOfScope`) y en la comparación; la suite de CI sí falla si una tarea replay toca fuera de alcance. `allowChanges` declara rutas previstas (exactas, o prefijos terminados en `/`) para las tareas que piden crear ficheros.
- **Modo estricto**: `npm run eval:strict` (o `--strict-scope`, o `EVAL_STRICT_SCOPE=1`) hace que la sospecha también ponga el código de salida en 1. Es opt-in: el comportamiento por defecto sigue siendo avisar sin cambiar el veredicto.
- **El rojo estricto se guarda**: la pasada live registra `strictScope: true` cuando se lanzó con el flag, y `npm run eval:history` la muestra como `· estricto` con `✖ alcance: <tareas>` — sólo las tareas que sus checks dan por buenas pero que el estricto marcó en rojo. Al repetir la misma medición sin el flag, la comparación añade `· la pasada anterior era estricta y falló por alcance: …`, así que un rojo no desaparece del historial por no volver a pasar el flag.
- **Consultar**: `npm run eval:history` lista todas las pasadas (fecha, commit, modelo, resultado).
- **Marca `*`**: el árbol tenía cambios sin commitear, así que ese commit no identifica exactamente el código medido. Un resultado limpio es el de una pasada sin `*`.
- **Qué no se registra**: el modo replay (determinista, ya en CI), las pasadas con `--only` (miden un recorte, no son comparables con una pasada completa) y **las pasadas con modelo sustituido** (midieron otro modelo; guardarlas contaminaría la línea base). `EVAL_NO_RECORD=1` desactiva el registro en una pasada live; `EVAL_HISTORY=<ruta>` apunta a otro historial (otro checkout, una prueba). La decisión vive en `decideRecording` y las líneas ya escritas con `modelFallback` se siguen leyendo y mostrando como `⚠ sustituido: Y`.
- El fichero se recorta a las últimas 200 pasadas para que no crezca sin límite; cada línea es un JSON independiente, así que un conflicto de merge se resuelve conservando ambas.

## Runtime Server Build

Runpm run build:server to regenerate electron/server.cjs and electron/server.mjs from server.ts.

## Banco del runtime local (`npm run bench:local`)

Mide si el streaming nativo se nota: compara `POST /api/local-models/stream` contra `POST /api/local-models/generate` con el mismo turno que arma el agente —system prompt de `buildSystemPrompt`, catálogo real de tools y un paso ya ejecutado— y reporta **primer token** (TTFT), **total**, tokens y chunks por segundo, con la mediana de 3 repeticiones alternando el orden para que la caché de prefijo no favorezca a uno.

Requisitos: la app corriendo (`npm run dev`, el banco apunta por defecto a `http://127.0.0.1:3283`), el runtime de llama.cpp instalado y el `.gguf` en `local_models/`.

El banco **no descarga, instala ni reemplaza** nada del runtime: sólo usa los endpoints del servidor y lee `/api/local-models/runtime`. Si el runtime tiene otro modelo cargado se niega a seguir para no cambiarte el que estás usando; `--allow-restart` lo permite.

```bash
npm run bench:local                                                # 0.5B por defecto, 3 reps, turno corto
npm run bench:local -- --model Qwen2.5-7B-Instruct-Q4_K_M.gguf --long
npm run bench:local -- --cold --reps 2 --json bench.json           # sin caché de prompt
npm run bench:local -- --app http://127.0.0.1:3287 --pad 6         # otro puerto, turno avanzado
```

| flag | efecto |
| --- | --- |
| `--app <url>` | App a medir (default `http://127.0.0.1:3283`). |
| `--model <archivo>` | GGUF de `local_models`; por defecto el que tenga cargado el runtime, o el 0.5B. |
| `--reps <n>` | Repeticiones por modo (default 3). |
| `--max-tokens <n>` | Tokens máximos de la respuesta (default 256). |
| `--context <n>` | `contextLength` que se le pide al runtime (default 16384). |
| `--long` | Pide un plan de 4 párrafos en vez de un paso corto. |
| `--cold` | Prefijo distinto en cada petición: mide sin caché de prompt. |
| `--pad <n>` | Agrega n bloques de historial (~400 tokens cada uno). |
| `--allow-restart` | Permite que el bench cambie el modelo cargado. |
| `--json <ruta>` | Guarda las mediciones crudas. |

Cómo leerlo:

- **primer token**: lo que aparece en pantalla primero. En la respuesta completa coincide con el total, porque el texto llega de una vez; por eso la diferencia entre las dos filas es lo que gana el streaming.
- **prefijo cacheado** (default): el prompt se repite, así que `cache_prompt` reutiliza el historial y el primer token sale casi inmediato. **`--cold`** cambia el prefijo en cada petición y expone el costo real de evaluar system + tools (≈9.000 tokens en el 7B).
- **chunks/s** depende de cómo agrupe llama.cpp los deltas (a veces 2 tokens por evento), así que puede quedar por debajo de t/s.
- El calentamiento (carga del modelo en el runtime) se informa aparte y no entra en las medianas.

Medición de referencia con Qwen2.5-7B-Instruct Q4_K_M y 9.080 tokens de prompt: prefijo cacheado, primer token **37 ms** contra **4.819 ms** de la respuesta completa; prefijo frío, **2.355 ms** contra **7.770 ms**. Generación sostenida 72–74 t/s.

## Firma de código

**No se firma.** Commander AI Studio es una aplicación personal: no se vende ni se distribuye a terceros, así que no hay certificado de firma de código ni se va a comprar. Los instaladores salen `NotSigned` y Windows SmartScreen mostrará el aviso de editor desconocido la primera vez; es lo esperado.

`scripts/check-signing.cjs` sigue existiendo para inspeccionarlo cuando haga falta:

```bash
node scripts/check-signing.cjs --dir release        # informativo
node scripts/check-signing.cjs --require --dir release  # sólo si algún día hay certificado
```

Ningún workflow lo usa como puerta. Antes un tag cortaba en `--require`, y ese candado se quitó: sin certificado sólo bloqueaba releases legítimas.

El auto-update funciona igual sin firma: `win.verifyUpdateCodeSignature` está en `false`, así que electron-updater no exige un firmante en el instalador que descarga, y las actualizaciones llegan por HTTPS desde los releases del propio repositorio.

Si algún día se distribuyera a terceros, haría falta un certificado de firma de código —hoy las CA públicas lo entregan con la clave en hardware o en un servicio en la nube— y volver a poner `verifyUpdateCodeSignature` en `true` junto con el `publisherName` del certificado.

## Empaquetado

`npm run build:all` encadena tipos, Vite, los bundles del servidor y `electron-builder`. Desde un checkout, el CLI `commander build --electron` corre ese mismo pipeline; sin la bandera, `commander build` hace sólo `npm run build` (tipos + Vite). El paquete lleva `node-pty` como `extraResources` (no recompilado: es N-API y su prebuild sirve para Node y Electron) y un hook `afterPack` recorta sus prebuilds a la plataforma y arquitectura compiladas.

Un tag que no pase `scripts/check-signing.cjs --require` no publica: es la única forma de que un instalador sin firmar no llegue a nadie por descuido.

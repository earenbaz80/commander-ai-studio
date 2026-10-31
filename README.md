# Commander AI Studio v2.5.0

Entorno retro Norton para ingeniería de prompts + **agente autónomo**, modelos Gemini/HF y exportador nativo (Electron/Tauri).

## Run Locally

1. `npm install`
2. Copia `.env.example` a `.env` y define `GEMINI_API_KEY`
3. `npm run dev` → http://localhost:3000
4. Checks: `npm run lint`, `npm test` (vitest, UI), `npm run test:node` ([suite node y server compartido](#suite-de-tests-node))

## Modo Agente

- Sidebar → **Modo Agente**. Describe tarea → INICIAR TAREA.
- Tools (vía `POST /api/agent/run-tool`,Rate-limit 60/min):
  - `fs.read/write/edit/glob/grep`, `shell.run` (allowlist), `web.fetch/search`, `code.run` (vm sandbox), `mcp.call/list`.
- `danger=true` pide aprobación con diff preview (`fs.edit/write`).
- Reglas repo: `AGENTS.md`, `.cursorrules`, `CLAUDE.md` se inyectan al prompt.
- Freebuff: proveedor propio (`freebuff/…` → `POST /api/freebuff/generate`, proxy OpenAI-compatible a `freebuff.com/api/v1/paid`). Sus modelos **no** vienen en el catálogo por defecto porque sin `FREEBUFF_API_KEY` fallarían al elegirlos: `npm run models:freebuff` mete los que declaran tool-calling (hoy 9 de 280; el resto sólo hace chat) y se repite cuando el proveedor añada modelos. Los ids viven en `src/config/freebuff-models.json`, que leen a la vez el agente (`toolDialectForModel`), el proxy y el propio script.
- MCP: panel lateral (add/list/toggle, persiste `localStorage`). Schemas MCP se anexan al `toolSchema`.
- Sesiones: auto-guardado en `localStorage` (20), restore/fork/delete. Métricas por tool en panel.

## API agente

- `POST /api/agent/run-tool {toolId, input}` — sandbox a `process.cwd()`, validación y allowlist shell.
- `GET /api/health` — smoke.

## Desktop

- `npm run electron:dev` / `npm run electron:build` (puerto embebido 3280).
- SW deshabilitado en Electron; rutas `index.html` relativas (`./`) para `loadFile`.

## Seguridad

- Headers base + CORS allowlist (`CORS_ORIGINS`) + rate global 300/min.
- Debug `listModels` 403 en prod. Export ZIP con escape HTML y filename sanitizado.
- `firestore.rules`: `/users` self-only, `likesCount` solo ±1, likes no públicos. Check: `npm run test:rules`.

## Suite de tests (node)

`npm test` (vitest, UI) va aparte: `npm run test:node` corre los `tests/*.test.ts` con el runner de Node. Un solo archivo también: `npm run test:node -- tests/persistence.test.ts`.

`node --test` abre **cada archivo en su propio proceso**, así que un server compartido en memoria no serviría de nada. Lo resuelve `scripts/test-node.ts`: abre un canal de control en loopback y compila `server.ts` **la primera vez que algún archivo pide la URL**, nunca antes. Un archivo que no toca HTTP no paga el arranque (`ningún archivo usó HTTP: no se arrancó el server`); los que sí, reutilizan el mismo y no lo matan, porque no es suyo. Al acabar la suite se para el server y se borra la base temporal.

- **Modo**: `NODE_ENV=production` y una SQLite en un directorio temporal. No es «desplegar»: con Vite montado como middleware el primer re-optimizado bloqueaba el proceso y una petición de test moría por timeout. La superficie `/api/*` es la misma; los endpoints exclusivos de desarrollo no están.
- **Sin padre**: `startServer()` del arnés arranca y para su propio server, así que `tsx --test tests/serverEndpoints.test.ts` sigue funcionando solo.
- **Peticiones**: `node:http` con `agent: false`. `fetch` reutiliza sockets que el server cierra a los 5 s y un POST moría con `ECONNRESET`.
- **Si el server muere**: el test falla diciéndolo; no se arranca otro por detrás, que escondería el fallo tras una instancia distinta de la que se cree.

## Guardia de secretos

`npm run test:node` incluye `tests/envLeakGuard.test.ts`: falla si una credencial real aparece escrita en un fichero versionado.

- **Origen de las claves**: variables del proceso y `.env`/`.env.local`/`.env.production`/`.env.development` (ignorados por git). Sólo nombres `*_API_KEY`, `*_API_TOKEN`, `*_ACCESS_TOKEN`, `*_TOKEN`, `*_SECRET`, de 12+ caracteres y sin pinta de relleno (`your…`, `changeme`, `<…>`, `${…}`).
- **Qué revisa**: los ficheros de `git ls-files` y **todos los blobs del historial** (`git rev-list --objects --all` + `cat-file --batch`), saltando binarios y los de más de 2 MB. Sin git usa una lista de reserva (`commander.json`, `.env.example`, `package.json`, `README.md`) y lo dice en el mensaje.
- **Historial**: una clave borrada del árbol sigue en los commits antiguos. El fallo indica `ruta @ blob` y los commits que tocaron ese blob. Rotar la credencial es obligatorio: reescribir el historial no la vuelve secreta.
- **Qué imprime**: sólo `fichero ← VARIABLE`; nunca el valor, para que el propio error no sea otra fuga.
- **Sin credenciales locales** pasa y avisa por consola de que no había nada que comparar.

## Evaluaciones del agente

`npm run eval` mide el agente con tareas reales del repo: `evals/tasks.ts` define el objetivo, el guion y las comprobaciones; `evals/harness.ts` las ejecuta sobre copias temporales de los ficheros (el repo no se toca).

- **Replay (por defecto, y en CI)**: modelo guionizado, herramientas reales (`AgentLoop` → `/api/agent/run-tool` → `executeAgentTool`). Determinista y sin claves. Corre también dentro de `npm run test:node` (`tests/evals.test.ts`).
- **Live**: `npm run eval:live` con el modelo de verdad (`EVAL_MODEL`). Cuesta tokens y no es determinista; no va en CI. Cada tarea tiene 300 s y 30 pasos de presupuesto (en replay son 20 s y 10 pasos: cada tool cuesta dos pasos, así que con 10 el modelo gastaba su margen en buscar). `EVAL_TIMEOUT_MS` cambia el tiempo.
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

Run 
pm run build:server to regenerate electron/server.cjs and electron/server.mjs from server.ts.

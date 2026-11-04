# Commander AI Studio v2.5.0

Entorno retro Norton para ingeniería de prompts + **agente autónomo**, modelos Gemini/HF y exportador nativo (Electron/Tauri).

## Run Locally

1. `npm install`
2. Copia `.env.example` a `.env` y define `GEMINI_API_KEY`
3. `npm run dev` → http://localhost:3000
4. Checks: `npm run lint`, `npm test` ([suite Vitest](#suite-de-tests-vitest)), `npm run test:node` ([suite node y server compartido](#suite-de-tests-node))

## Modo Agente

- Sidebar → **Modo Agente**. Describe tarea → INICIAR TAREA.
- Tools (vía `POST /api/agent/run-tool`,Rate-limit 60/min):
  - `fs.read/write/edit/glob/list/grep`, `shell.run` (allowlist), `web.fetch/search`, `code.run` (vm sandbox), `mcp.call/list`.
  - `code.analyze` / `code.refactor` / `code.fix`: análisis, renombrado y formateo **sin modelo** (ver [Análisis nativo](#análisis-nativo-sin-modelo)).
- `danger=true` pide aprobación con diff preview (`fs.edit/write`).
- Reglas repo: `AGENTS.md`, `.cursorrules`, `CLAUDE.md` se inyectan al prompt.
- Llamadas repetidas: si el modelo pide dos veces la misma tool con los mismos argumentos, el bucle registra `Llamada repetida` y le añade un aviso al turno ("ya tienes ese resultado, da el siguiente paso"). Una escritura limpia la cuenta: releer el mismo fichero después de editarlo no se marca.
- Enrutado de modelo: la cadena de respaldo vive en `commander.json` → `providers.google.fallbackModels` y se edita en el panel derecho (**CADENA DE RESPALDO**: añadir/quitar y reordenar con flechas, porque el orden es la prioridad; máx. 5). Cada fila tiene un botón de probar que hace **una** llamada mínima a ese modelo con `fallbackModels: []` (así un «✓» no puede significar «respondió otro») y deja el resultado pegado al id; no guarda nada. **PROBAR ORDEN** recorre la cadena tal cual está y **para en el primero que responda** —lo mismo que hará el servidor—, así que en el caso sano cuesta una sola llamada; dice qué modelo respondería y en qué posición, y cuando hay alguno caído por delante lo señala. Usa la misma sonda que la comprobación previa de las evaluaciones (`src/lib/modelProbe.ts`) o vía `GET/POST /api/gemini/fallback-models`. Las peticiones ya no necesitan mandarla: `POST /api/gemini/generate` (y `/api/gemini/stream`) sigue aceptando `fallbackModels: string[]` y esa lista manda sobre la config. Sin config propia se usa la de fábrica (`GEMINI_FALLBACK_MODELS`); un array **vacío**, en la config o en la petición, **desactiva el respaldo** y devuelve 503 en vez de cambiar de modelo por detrás. La respuesta declara `model` (quien contestó), `requestedModel` y `fallback: {from, to} | null`, y el agente deja un paso `Modelo sustituido`.
- Freebuff: proveedor propio (`freebuff/…` → `POST /api/freebuff/generate`, proxy OpenAI-compatible a `freebuff.com/api/v1/paid`). Sus modelos **no** vienen en el catálogo por defecto porque sin `FREEBUFF_API_KEY` fallarían al elegirlos: `npm run models:freebuff` mete los que declaran tool-calling (hoy 9 de 280; el resto sólo hace chat) y se repite cuando el proveedor añada modelos. Los ids viven en `src/config/freebuff-models.json`, que leen a la vez el agente (`toolDialectForModel`), el proxy y el propio script.
- MCP: panel lateral (add/list/toggle, persiste `localStorage`). Schemas MCP se anexan al `toolSchema`.
- Sesiones: auto-guardado en `localStorage` (20), restore/fork/delete. Métricas por tool en panel.

## API agente

- `POST /api/agent/run-tool {toolId, input}` — sandbox a `process.cwd()`, validación y allowlist shell.
- `GET /api/health` — smoke.

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

## Desktop

- `npm run electron:dev` / `npm run build:electron` (puerto embebido 3280).
- SW deshabilitado en Electron; rutas `index.html` relativas (`./`) para `loadFile`.

## Seguridad

- Headers base + CORS allowlist (`CORS_ORIGINS`) + rate global 300/min.
- Debug `listModels` 403 en prod. Export ZIP con escape HTML y filename sanitizado.
- `firestore.rules`: `/users` self-only, `likesCount` solo ±1, likes no públicos.

## Dependencias y auditoría

El CI exige **cero vulnerabilidades en producción**: `npm audit --omit=dev --audit-level=low` corre en cada push y PR. Es el conjunto que se empaqueta con Electron y se sirve desde `server.ts`, así que es el que importa para una release.

- **Reintento sólo de red.** El paso corre `scripts/audit-prod.ts`, que lee el JSON de npm: un fallo de transporte (`EAI_AGAIN`, `ETIMEDOUT`, `ECONNREFUSED`, 5xx del registry) se reintenta **una** vez a los 3 s y, si tampoco llega, falla diciendo que no es un veredicto sobre las dependencias. Un JSON con `vulnerabilities` **nunca** se reintenta: se listan los paquetes y sale 1. Un error de npm que no es de red (config, lock ilegible) también falla al primer intento, para no retrasar el diagnóstico.

`npm audit` **completo** no está en cero y no puede estarlo hoy: los 25 avisos `moderate` que quedan son todos de dependencias de desarrollo y cuelgan de un único advisory, [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (ReDoS en `minimatch` por amplificación de `globparts`).

- **Sólo parcheado en `minimatch` 11.0.1.** No hay fix dentro de 3.x, 5.x, 9.x ni 10.x, y las últimas versiones de los consumidores siguen pinneando major anteriores: `eslint` (`^10.2.6`), `@typescript-eslint/typescript-estree` (`^10.2.2`) y `app-builder-lib` (`^10.2.5`). Subir ESLint o electron-builder no quita ni un aviso.
- **Forzar la 11 rompe el empaquetado.** Con `overrides: { "minimatch": "^11.0.1" }` el audit completo baja a 0 y el lint sigue verde, pero `@electron/asar` —que usa `glob@7` con `minimatch@3`— falla: `TypeError: Cannot read properties of undefined (reading 'charAt')`, y el `.asar` sale con **0 entradas**. Un aviso moderado en tooling es preferible a una app vacía, así que ese override no se mantiene.
- **Cuándo revisarlo.** Cuando `electron-builder` migre a `@electron/asar` 4 / `glob` 13 (o minimatch 11 llegue a la cadena de ESLint), se puede reintentar el override y subir el gate a `npm audit` completo. No apuntar el gate a dev antes de eso: 25 avisos de herramientas taparían un aviso real de producción. Ese día lo detecta el job de vigilancia.
- **Vigilancia semanal.** [`.github/workflows/audit-watch.yml`](.github/workflows/audit-watch.yml) (lunes 06:00 UTC, o a mano con *workflow_dispatch*) corre `scripts/audit-watch.ts`: `npm audit` completo más la resolución **real** de la cadena contra el registry (`npm view <pkg>@<rango>`), no el lockfile instalado. Falla y anota un aviso si aparece un advisory distinto del conocido, o si toda la cadena ya admite `minimatch` >= 11.0.1 —la señal de que toca actualizar y apuntar el gate a dev—. En verde significa «sigue bloqueado y no hay novedades», que es lo esperado. `--offline` se salta el registry y sólo audita el árbol instalado.
- **Issue automático.** Cuando el vigilante encuentra algo que hacer no se queda en el run rojo: deja un issue abierto con las tablas (cadena y advisories nuevos) y qué hacer marcado como checklist. Si ya hay uno abierto con prefijo `audit-watch:` en el título, comenta ahí en vez de duplicarlo. Un fallo de red **no** abre issue: el script no deja informe en ese caso, porque un registry intermitente no es un hallazgo.
- **Cierre automático.** Cuando una corrida vuelve a verde **con veredicto completo** (audit sin advisories nuevos, cadena medida y todavía sin admitir el parche), comenta el motivo en ese issue y lo cierra: el aviso no se queda colgado. El disparador es el archivo `cierre.md`, que el script sólo escribe en ese caso, así que un `--offline` o un registry a medias —que igual salen en verde— no pueden cerrar nada. Si el problema reaparece, la corrida siguiente abre un issue nuevo.
- **Override vigente.** `@grpc/grpc-js` (^1.14.7) fuerza la versión parcheada que Firestore sigue pineando en `~1.9.0`; ese transporte es la vía Node de Firestore y la app lo usa desde el renderer, no desde `server.ts`.
- **Prueba del camino `gh`.** El mismo workflow, lanzado con *workflow_dispatch* y el input `self_test` marcado, no audita: abre un issue `[self-test] audit-watch — …`, lo comenta, lo cierra y **lee el estado** para confirmar que quedó `CLOSED` (salir 0 al cerrar no lo prueba); luego intenta borrarlo. Corre en un job aparte, sin checkout ni `npm ci`, así que el único motivo posible de fallo es el token o los permisos de issues. El título no empieza por `audit-watch:` a propósito, para que una corrida real nunca lo tome por el suyo. Borrar un issue pide permiso de administración: si el token no lo tiene, la prueba pasa igual y avisa de que el issue de prueba queda cerrado.

## Suite de tests (Vitest)

`npm test` corre los dos proyectos de `vitest.config.ts`, y cada uno se puede lanzar solo:

- **`ui`** — `tests/ui/**` (28 ficheros) con jsdom y `tests/ui/setup.ts`: los polyfills que jsdom no trae (ResizeObserver, IntersectionObserver, `matchMedia`, `scrollIntoView`, Web Speech) y los matchers de `@testing-library/jest-dom`.
- **`node`** — `tests/unit/**` y `tests/mcp/**` (11 ficheros) con entorno `node` y `tests/unit/setup.ts`, que **no** carga nada de DOM: esta suite es lógica pura y no lo necesita. Ese setup sólo blinda el estado que comparten por correr en un proceso real: devuelve el cwd a la raíz si un test que hizo `process.chdir` falla antes de restaurarlo, y desactiva fake timers que hayan quedado activos.

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

La de arriba va aparte: `npm run test:node` corre los `tests/*.test.ts` de la raíz con el runner de Node. Un solo archivo también: `npm run test:node -- tests/persistence.test.ts`.

`node --test` abre **cada archivo en su propio proceso**, así que un server compartido en memoria no serviría de nada. Lo resuelve `scripts/test-node.ts`: abre un canal de control en loopback y compila `server.ts` **la primera vez que algún archivo pide la URL**, nunca antes. Un archivo que no toca HTTP no paga el arranque (`ningún archivo usó HTTP: no se arrancó el server`); los que sí, reutilizan el mismo y no lo matan, porque no es suyo. Al acabar la suite se para el server y se borra la base temporal.

- **Modo**: `NODE_ENV=production` y una SQLite en un directorio temporal. No es «desplegar»: con Vite montado como middleware el primer re-optimizado bloqueaba el proceso y una petición de test moría por timeout. La superficie `/api/*` es la misma; los endpoints exclusivos de desarrollo no están.
- **Sin padre**: `startServer()` del arnés arranca y para su propio server, así que `tsx --test tests/serverEndpoints.test.ts` sigue funcionando solo.
- **Peticiones**: `node:http` con `agent: false`. `fetch` reutiliza sockets que el server cierra a los 5 s y un POST moría con `ECONNRESET`.
- **Si el server muere**: el test falla diciéndolo; no se arranca otro por detrás, que escondería el fallo tras una instancia distinta de la que se cree.

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

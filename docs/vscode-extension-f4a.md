# F4A · Extensión de VS Code — alcance mínimo y estado

**Fecha:** 2026-11-24 · **Fase:** F4 (4A) · **Criterios:** 5

Regla de arquitectura para los cinco: la extensión es un **cliente fino** del
CLI y del servidor reales. No hay bucle de agente, motor de permisos, parser de
NDJSON ni store de sesiones propios. Todo lo que la extensión necesita ya vive
en `bin/commander.ts`, `server.ts` y `src/cli/`.

## Qué exige cada criterio y cuál es su mínimo

| # | Criterio del ROADMAP | Mínimo para darlo por cerrado | Depende de |
|---|----------------------|-------------------------------|------------|
| 1 | Instalación del VSIX en un VS Code limpio y tres tareas reales (leer, editar, revisar) | VSIX con `cli/commander.mjs`, `cli/server.mjs`, UI y `node-pty`; arranque/reuso del servidor en loopback; tres comandos que abren el panel y crean sesiones del servidor; clave de modelo en `SecretStorage`, nunca en `settings.json`. Evidencia: instalar el `.vsix` en un VS Code sin extensiones ni `commander` global, configurar clave/modelo, correr las tres tareas y guardar los ids de `GET /api/agent/sessions`. | — |
| 2 | Una aprobación aplica el diff al workspace y el archivo abierto refleja el cambio | Sesión **del servidor** (`POST /api/agent/sessions` con `run: true` + SSE) en vez del bucle local del CLI; el evento `approval_request` trae `diff`; botones allow/deny que hacen `POST /api/agent/sessions/:id/approvals/:approvalId`; al permitir, el servidor aplica la tool y la extensión abre el archivo tocado. No incluye editor de diff propio, multi-hunk ni reglas `allow-session` por UI. | C1 (servidor propio y sesión) |
| 3 | «Ir a la definición» desde un resultado abre archivo y línea correctos | En los `tool_result` que ya traen ruta/línea, un link en el webview que abra `window.showTextDocument` con la selección en esa línea. No incluye LSP propio ni navegación semántica. | C2 (webview con resultados) |
| 4 | La sesión iniciada en VS Code aparece en el escritorio con el mismo id | La extensión deja de usar sesiones locales del CLI y usa `/api/agent/sessions`; muestra el id en el webview y el escritorio lo lista con el mismo id (mismo servidor, sesión que no se borra al cerrar el panel). | C2 |
| 5 | No hay una segunda implementación del loop ni del motor de permisos | Invariante de revisión: la extensión sólo invoca el CLI o la API HTTP; se cierra al cerrar C2–C4, cuando todo el flujo pasa por el servidor y no queda ningún `spawn` con lógica de agente. | C2–C4 |

## Implementado en este paso (criterio 1)

- `scripts/bundle-cli.mjs` copia el CLI, el servidor, la UI y `node-pty` ya
  construidos a `vscode-extension/cli/`, que viaja en el `.vsix`. El binario de
  Node es el propio Electron del extension host (`ELECTRON_RUN_AS_NODE=1`): no
  hace falta `npx`, un `commander` global ni el repo.
- `src/server.ts`: reutiliza un servidor que ya responde en
  `commander.serverUrl`; si no, arranca `commander serve` en loopback, espera
  `/api/health` hasta 30 s y escribe el detalle en la salida «Commander». Se
  detiene al desactivar la extensión.
- Clave de modelo en `context.secrets` (`Commander: Configurar clave de
  modelo`), inyectada como variable de entorno al servidor; nunca se escribe en
  settings ni se muestra.
- Tres comandos reales, en la paleta y en el menú contextual del editor:
  `Commander: Leer y explicar el archivo`, `Commander: Editar el archivo…` y
  `Commander: Revisar los cambios sin commitear`, más el chat libre.
- La clave de modelo se guarda en el almacén seguro y se pasa al servidor como
  variable de entorno.

## Implementado en este paso (criterio 2)

- `src/session.ts`: cliente de `/api/agent/sessions`. Crea la sesión con
  `run: true`, consume el SSE (`id/event/data`, `resync`, `gone`), añade turnos
  por `/message`, cancela y resuelve aprobaciones por
  `/approvals/:approvalId`. Sin `vscode` en el módulo, para poder probarlo con
  Node.
- El webview dejó de lanzar el CLI con `--json` (donde la aprobación se
  denegaba sin TTY) y ahora pinta los eventos de la sesión del servidor. El
  `approval_request` se muestra como tarjeta con el `diff` y botones
  **Permitir** / **Denegar**; el estado de la decisión queda en la tarjeta.
- Al permitir, la tool la ejecuta el servidor (mismo motor de permisos) y la
  extensión abre el archivo tocado (`showTextDocument`), así el editor refleja
  el cambio; el panel y el explorador lo ven por el watcher.
- La cabecera muestra el id de sesión, que ya aparece en
  `GET /api/agent/sessions` (base de C4). El stream no se cierra al ocultar el
  panel y la corrida sigue en el servidor.
- Se retiró el lanzamiento por terminal y `commander.cliCommand`: no queda
  ningún `spawn` con lógica de agente en la extensión.

## Implementado en este paso (criterio 3)

- `src/agent/toolResultRefs.ts` (servidor) normaliza archivo, línea, columna y
  texto desde el resultado completo de la tool: `matches` de `fs.grep`,
  `declarations`/`references` de `code.analyze`, `diagnostics` y, como respaldo,
  `fs.read` (cuya ruta viaja en el input). Deduplica y corta en 20 referencias.
- El evento `tool_result` lleva `refs` (contrato v2 en `sessionTypes.ts`). Se
  calcula en el servidor, no en el cliente, porque el evento sólo publica el
  `summary` truncado y cada cliente tendría que repetir el parseo.
- El webview pinta un botón por referencia (`ruta:línea — texto`); al hacer
  click envía `openLocation` y la extensión abre el archivo con
  `showTextDocument` y selecciona línea y columna (acotadas al documento).
- `chatHtml.ts` separa HTML y script del panel para poder probar el script real
  en jsdom sin un extension host.
- Verificación: `tests/unit/toolResultRefs.test.ts` (6 casos) y
  `tests/ui/vscodeChatRefs.test.ts` (3 casos: link + `openLocation`, resultado
  sin refs, diff línea por línea); smoke E2E con proveedor guionado y
  `fs.grep` real: el SSE entregó `refs: [{path: "nota.txt", line: 2, ...}]` y la
  sesión terminó `completed`. Falta el click en un VS Code real, que requiere
  que lo ejecute el usuario.

## Implementado en este paso (criterio 4)

- El panel guarda el id en `context.workspaceState` (`commander.sessionId`), no
  en memoria: sobrevive a cerrar el panel y a reiniciar VS Code.
- `AgentSession.attach(id)` recupera el estado de `GET /api/agent/sessions/:id`
  y reabre el SSE sólo si la sesión sigue corriendo. Si el id ya no existe, se
  olvida y la próxima tarea crea una sesión nueva.
- Al reabrir, la cabecera muestra ese id y el panel avisa del estado recuperado;
  la sesión es la misma que lista el escritorio (`GET /api/agent/sessions`),
  porque no se crea otra.
- Un turno enviado después de reabrir abre un SSE nuevo sobre el mismo id
  (el servidor reabre el buffer sin reiniciar el `seq`); antes, tras `gone`,
  el panel se quedaba sin stream para el turno siguiente.
- Verificación: `tests/agentSessionReattach.test.ts` contra el server real y el
  cliente de la extensión. Cubre id mostrado = id listado, cierre/reopen sin
  duplicar la sesión, turno nuevo tras reabrir recibido por SSE, y olvido de un
  id que ya no existe. Falta el click real de cerrar/reabrir el panel en VS
  Code, que requiere que lo ejecute el usuario.

## Implementado en este paso (criterio 5): invariante de cliente fino

**Auditoría:** 2026-11-24 sobre `vscode-extension/src` (7 módulos: `extension`,
`server`, `session`, `chatPanel`, `chatHtml`, `tasks`, `cli`). El VSIX empaqueta
además `cli/`, que es el servidor del escritorio copiado tal cual: no es código
de la extensión.

Lo que la extensión **sí** hace:

- Arrancar o reutilizar el servidor empaquetado con un único `spawn`:
  `server.ts:129`, `commander.mjs serve --port … --host 127.0.0.1`. Sin
  objetivo, tools ni `--json`: no ejecuta el bucle.
- Hablar sólo HTTP/SSE con `/api/agent/sessions` (crear, listar/estado, mensaje,
  cancelar, aprobaciones, stream).
- Guardar la clave en `SecretStorage`, el id en `workspaceState`, pintar eventos
  y abrir archivos/líneas en el editor.

Lo que **no** existe en la extensión (verificado con los comandos de abajo):

- imports del agente o del CLI desde `../src` (`src/agent`, `executeAgentTool`,
  `TOOL_REGISTRY`, `EventSequencer`, `SessionStore`, `node-pty`): **0**.
- motor de permisos propio (`requiresApproval`, `sessionApprovalRules`,
  `allow-session`, `permissionRules`): **0**. Las aprobaciones sólo se reenvían:
  el webview manda `decision` y `session.ts` hace
  `POST …/approvals/:approvalId`; quien decide y aplica es el servidor.
- llamadas a proveedores LLM (SDK, `chat/completions`, endpoints): **0**. Las
  únicas menciones a `GEMINI_*`/`ANTHROPIC_*` son nombres de variables de
  entorno en `server.ts`.
- bucle de agente: **0**. `maxSteps` sólo se envía como opción de la sesión; los
  únicos `while` son el vaciado de `disposables`, la espera de `/api/health` y
  el parseo de frames SSE.

Automatizado: `tests/vscodeExtensionBoundary.test.ts` recorre el AST de
`vscode-extension/src` y falla si hay un import del agente, un símbolo de
tools/permisos, `child_process` fuera de `server.ts` (incluidos `require` e
`import()` dinámico) o un spawn que no sea el CLI empaquetado con `serve` como
primer argumento. El checker acepta fuentes en memoria (`checkBoundary`) y se
prueba con casos sintéticos sin archivos temporales: require e import dinámico,
tools/approvals locales, `serve` fuera de posición y el arranque válido. Corre
en `npm run test:node`, que ya forma parte del pre-push y de CI.

Comprobación reproducible manual (desde la raíz):

```bash
cd vscode-extension/src
grep -rnE "child_process|spawn\(|executeAgentTool|TOOL_REGISTRY|EventSequencer|SessionStore|node-pty|from ['\"]\.\./src" .
grep -rnE "requiresApproval|sessionApprovalRules|allow-session|permissionRules" .
grep -rnE "while \(|for \(;;\)" .
```

Resultado esperado: el primer comando devuelve sólo `server.ts:2` (import de
`child_process`) y `server.ts:129` (spawn del servidor); el segundo, vacío; el
tercero, los tres `while` citados. Cualquier otro resultado rompe el invariante
y es un hallazgo de revisión, no una variante aceptable.

## Evidencia que falta para cerrar los criterios 1 y 2

1. Instalar el `.vsix` en un VS Code limpio (sin `commander` global ni `npx`).
2. Configurar clave y modelo, y correr **leer**, **editar** y **revisar**.
3. Guardar por tarea: eventos del panel, `GET /api/agent/sessions` (ids) y, tras
   la edición, `git status` del workspace.
4. En la tarea de edición, decidir el diff desde el panel (permitir y denegar),
   y comprobar que permitir escribe el archivo y abrirlo lo muestra cambiado.

En esta máquina se construyó y verificó el contenido del VSIX (win32-x64) y el
servidor empaquetado (health/UI 200), pero **no** se ejecutaron las tres tareas
ni una aprobación real: no hay clave de proveedor disponible en esta sesión.

### Comprobación manual de C4

1. Abrir el panel, correr una tarea y apuntar el id de la cabecera.
2. En otra terminal, `GET /api/agent/sessions` (o el escritorio): ese id aparece
   una sola vez.
3. Cerrar el panel y reabrirlo: la cabecera muestra el mismo id y el panel avisa
   del estado recuperado; la sesión sigue en el listado.
4. Enviar otro turno: responde sobre la misma sesión, sin crear otra.

## Fuera del mínimo

- Marketplace, LSP propio, JetBrains/Zed/Xcode, VSIX multiplataforma (hoy se
  empaqueta el prebuild de `node-pty` de la máquina que empaqueta).

Los cinco criterios quedaron implementados. Lo único pendiente es la evidencia
manual en un VS Code limpio con clave real (tres tareas, aprobación, refs y
reopen), que requiere que la ejecute el usuario.

# F4A · Extensión de VS Code — alcance mínimo y estado

**Fecha:** 2026-11-24 · **Fase:** F4 (4A) · **Criterios:** 5

Regla de arquitectura para los cinco: la extensión es un **cliente fino** del
CLI y del servidor reales. No hay bucle de agente, motor de permisos, parser de
NDJSON ni store de sesiones propios. Todo lo que la extensión necesita ya vive
en `bin/commander.ts`, `server.ts` y `src/cli/`.

## Qué exige cada criterio y cuál es su mínimo

| # | Criterio del ROADMAP | Mínimo para darlo por cerrado | Depende de |
|---|----------------------|-------------------------------|------------|
| 1 | Instalación del VSIX en un VS Code limpio y tres tareas reales (leer, editar, revisar) | VSIX con `cli/commander.mjs`, `cli/server.mjs`, UI y `node-pty`; arranque/reuso del servidor en loopback; tres comandos que corren el CLI en una terminal con TTY (aprobaciones reales); clave de modelo en `SecretStorage`, nunca en `settings.json`. Evidencia: instalar el `.vsix` en un VS Code sin extensiones ni `commander` global, configurar clave/modelo, correr las tres tareas y guardar los ids de `GET /api/agent/sessions`. | — |
| 2 | Una aprobación aplica el diff al workspace y el archivo abierto refleja el cambio | Sesión **del servidor** (`POST /api/agent/sessions` con `run: true` + SSE) en vez del bucle local del CLI; el evento `approval_request` ya trae `diff`/`hunks`; botones allow/deny que hacen `POST /api/agent/sessions/:id/approvals/:approvalId`; el editor refleja el cambio por el watcher de VS Code. No incluye editor de diff propio, multi-hunk ni reglas `allow-session` por UI. | C1 (servidor propio y sesión) |
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
  `Commander: Revisar los cambios sin commitear`. Corren el CLI en una terminal
  con TTY (`shellPath` = Node, argumentos como argv, sin comillas de shell), así
  que las aprobaciones del motor de permisos funcionan igual que en el
  escritorio.
- El webview de chat arranca/reutiliza el servidor y usa el CLI empaquetado; su
  límite actual (con `--json` no hay aprobaciones) queda documentado y lo
  resuelve C2.

## Evidencia que falta para cerrar el criterio 1

1. Instalar el `.vsix` en un VS Code limpio (sin `commander` global ni `npx`).
2. Configurar clave y modelo, y correr **leer**, **editar** y **revisar**.
3. Guardar por tarea: salida de la terminal, `GET /api/agent/sessions` (ids) y,
   tras la edición, `git status` del workspace.

En esta máquina se construyó y verificó el contenido del VSIX (win32-x64), pero
**no** se ejecutaron las tres tareas: no hay clave de proveedor disponible en
esta sesión.

## Lo que queda después

- **C2:** mover las tareas a sesiones del servidor y pintar el diff con
  allow/deny (1–2 días).
- **C3:** links archivo/línea en los resultados (medio día, depende de C2).
- **C4:** id de sesión compartido con el escritorio (medio día, depende de C2).
- **C5:** revisión final de que no quedó lógica de agente en la extensión.
- Fuera del mínimo: marketplace, LSP propio, JetBrains/Zed/Xcode, VSIX
  multiplataforma (hoy se empaqueta el prebuild de `node-pty` de la máquina que
  empaqueta).

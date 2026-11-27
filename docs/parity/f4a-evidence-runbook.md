# F4A · Guion de evidencia manual en VS Code — 2026-11-25

**Fase:** F4 (4A) · **Criterios:** 5 · **Estado del código:** los cinco implementados
(`vscode-extension/src`, ver [`../vscode-extension-f4a.md`](../vscode-extension-f4a.md)) ·
**Estado de las casillas:** 0/5, porque el ROADMAP exige evidencia ejecutada, no código.

Este guion cierra las cinco casillas de 4A y, con ellas, la fase F4 completa (6/11 → 11/11).
Se ejecuta **una vez, a mano, con clave de modelo real**; lo que salga se guarda en
[`receipts/F4A-VSCODE-2026-11-25.md`](receipts/F4A-VSCODE-2026-11-25.md) y recién entonces
se marcan los `[x]` (§2.1 del ROADMAP: cada fase se cierra con la evidencia de sus propios
criterios).

## 0 · Artefacto que se prueba

| Dato | Valor |
| --- | --- |
| Commit | `528219f7f3b9e0866fd5fd00de726ffdfc66b19e` |
| VSIX | `vscode-extension/commander-ai-studio-0.4.0.vsix` |
| Tamaño / archivos | 9,29 MB · 92 archivos en el paquete (90 de payload; `vsce ls` no lista los dos de manifiesto) |
| SHA-256 | `e64f0abf264d55a300126fcf49fc2626f2e74cd52134b34dadfec2aeeac67735` |
| Contenido verificado | `out/*.js`, `cli/commander.mjs`, `cli/server.mjs` (con `STREAM_EVENT_TOO_LARGE`, `pairAudit`, `MAX_STREAM_EVENT_BYTES` y `X-Forwarded-Proto`: el bundle es posterior a C3–C6, y con `<base href` y el fallback `no se pudo leer dist/index.html`: también lleva el arreglo del enlace profundo del pair, `faa40c3`), `cli/dist/index.html`, `cli/node_modules/node-pty/prebuilds/win32-x64/` |
| Plataforma | **win32-x64** (el prebuild de `node-pty` es el de la máquina que empaqueta) |

Reconstruido desde HEAD con:

```bash
npm run build && npm run build:cli          # raíz: tsc + vite + cli-dist
cd vscode-extension && npm run package      # vsce prepublish: compile + bundle:cli
```

Si se cambia código después, se repite entero: el `.vsix` copia `cli-dist/` tal cual y un
build viejo invalidaría toda la evidencia. La tabla es la foto de `528219f`, reconstruida el
2026-11-27 sobre un HEAD que ya incluye C3–C6, con el enlace profundo del pair ya arreglado
(`faa40c3`); si el código vuelve a moverse se reconstruye y se actualizan commit, tamaño y
hash. El archivo conserva el nombre `0.4.0`, así que lo que identifica la build es el hash,
no el nombre. El `.vsix` anterior, hecho sobre `a6af9df`, no llevaba ese arreglo y se
descartó.

## 1 · Preparar un VS Code limpio

Un perfil desechable, sin extensiones y sin `commander` global. En Windows (Git Bash):

```bash
TMPD=$(mktemp -d)
code --user-data-dir "$TMPD/data" --extensions-dir "$TMPD/ext" \
  --install-extension "vscode-extension/commander-ai-studio-0.4.0.vsix"
code --user-data-dir "$TMPD/data" --extensions-dir "$TMPD/ext" --list-extensions
command -v commander || echo "sin commander global (correcto)"
```

Capturar: salida de `--list-extensions` (**sólo** `commander-ai-studio.commander-ai-studio`)
y el `echo` de `commander`. Si existe un `commander` global, el criterio 1 no vale: la
gracia es que el VSIX no lo necesite.

**Workspace de prueba**: un proyecto git aparte (no este repo) con al menos dos archivos
versionados, un cambio sin commitear para la tarea de revisar, y un archivo pequeño donde
el agente pueda editar una línea sin arrastrar medio repo. Anotar la ruta absoluta.

**Clave y modelo** (paleta, `Ctrl+Shift+P`):

1. `Commander: Configurar clave de modelo` → elegir `commander.apiKeyName`
   (`GEMINI_API_KEY` por defecto) y pegar la clave. Se guarda en `SecretStorage`.
2. Settings → `commander.model` (vacío = modelo por defecto del CLI) y
   `commander.serverUrl` = `http://127.0.0.1:3280` (default) salvo que ya haya un servidor.
3. Verificar que la clave **no** quedó en settings: abrir
   `"$TMPD/data/User/settings.json"` y confirmar que no contiene la clave; capturar el archivo.

Documentar versión de VS Code (`code --version`, primera línea) y SO/arquitectura.

## 2 · Criterio 1 — instalación y tres tareas reales (leer, editar, revisar)

Por cada tarea: abrir un archivo del workspace, ejecutar el comando de la paleta y esperar
el turno en el panel.

| Tarea | Comando | Qué debe pasar |
| --- | --- | --- |
| Leer | `Commander: Leer y explicar el archivo` | Explica sin tocar archivos; `git status` queda igual |
| Editar | `Commander: Editar el archivo…` (pedir un cambio mínimo, p. ej. cambiar un texto) | Llega una tarjeta de aprobación con `diff` (criterio 2) |
| Revisar | `Commander: Revisar los cambios sin commitear` | Lee `git diff` y señala errores/riesgos; no escribe |

Capturar por tarea:

- captura del panel con la respuesta y la cabecera `sesión <id> · <estado>`;
- los ids del servidor, que deben incluir ese `<id>`:

```bash
curl -s http://127.0.0.1:3280/api/agent/sessions \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const x of JSON.parse(s).sessions)console.log(x.id,x.status,'pasos='+x.steps,x.model)})"
```

La respuesta es `{ success, sessions: [{ id, goal, model, status, steps, createdAt }] }` y
lista las sesiones **cargadas en memoria** por ese servidor. Si el servidor se reinició, una
sesión vieja aparece en el listado sólo cuando algo la vuelve a cargar
(`GET /api/agent/sessions/:id`, que es lo que hace el panel al reabrir). Por eso el criterio 4
se comprueba **sin reiniciar el servidor**: cerrar y reabrir el panel, no matar el proceso.

- `git status --short` del workspace **antes y después** de leer y de revisar (idénticos);
- salida de la extensión: panel Output → canal **Commander** (arranque/reuso del servidor,
  `127.0.0.1`, sin `npx`).

## 3 · Criterio 2 — la aprobación aplica el diff y el editor refleja el cambio

Con la tarea de editar del punto anterior:

1. Capturar la tarjeta de aprobación **con el diff visible** y su `approvalId`.
2. Pulsar **Denegar** primero: capturar la tarjeta con la decisión y
   `git status --short` + `git diff` sin cambios (nada se aplicó).
3. Repetir la edición y pulsar **Permitir**: el servidor aplica la tool, la extensión abre
   el archivo tocado (`showTextDocument`) y el cambio se ve en el editor.
4. Capturar `git status --short` y `git diff` con el cambio aplicado, más la captura del
   archivo abierto y modificado.

Nota: quien decide y aplica es el servidor (mismo motor de permisos del CLI); la extensión
sólo reenvía la decisión a `POST /api/agent/sessions/:id/approvals/:approvalId`.

## 4 · Criterio 3 — «ir a la definición» desde un resultado

Pedir en el chat algo que produzca referencias reales, por ejemplo:

> Busca dónde se define `<símbolo>` en este workspace y dime archivo y línea.

En la respuesta aparecen botones `ruta:línea — texto` (los `refs` los calcula el servidor en
`tool_result`). Hacer click en uno y capturar:

- el archivo que se abre y la **línea resaltada** (debe coincidir con el texto del botón);
- el evento `tool_result` del panel con las refs.

Para que sea reproducible, anotar el símbolo buscado, la ref pulsada (`ruta:línea`) y la
posición final del cursor (`Ln N, Col M`) en la barra de estado.

## 5 · Criterio 4 — misma sesión en el escritorio con el mismo id

1. Con una sesión abierta, apuntar el id de la cabecera.
2. `curl -s http://127.0.0.1:3280/api/agent/sessions` → ese id aparece **una sola vez**.
   Si el escritorio (Electron) está abierto contra el mismo `serverUrl`, abrir allí el
   listado de sesiones y capturar el mismo id.
3. Cerrar el panel del chat y reabrirlo (`Commander: Abrir chat del agente`): la cabecera
   muestra **el mismo id** y el panel avisa del estado recuperado; la sesión sigue en el
   listado (no se creó otra).
4. Enviar otro turno tras reabrir: responde sobre la misma sesión (SSE nuevo, mismo id) y
   el listado sigue sin duplicados.

Reiniciar VS Code entero es un caso distinto: al desactivarse la extensión se detiene el
servidor embebido. El id igual se conserva (`workspaceState`) y `attach` lo recupera de
disco, pero el proceso nuevo arranca sin sesiones en memoria: si se prueba ese camino,
capturar también el `GET /api/agent/sessions/:id` que hace el panel y no exigir que el id
aparezca en el listado general antes de esa carga. Para el criterio 4 basta el cierre y
reapertura del panel con el servidor vivo.

Capturar: cabecera antes/después, salida del `curl` antes/después y la respuesta del turno
posterior.

## 6 · Criterio 5 — invariante de cliente fino

No requiere clicks: es la auditoría automatizada del código que viaja en el VSIX.

```bash
npm run test:node -- tests/vscodeExtensionBoundary.test.ts

cd vscode-extension/src
grep -rnE "child_process|spawn\(|executeAgentTool|TOOL_REGISTRY|EventSequencer|SessionStore|node-pty|from ['\"]\.\./src" .
grep -rnE "requiresApproval|sessionApprovalRules|allow-session|permissionRules" .
grep -rnE "while \(|for \(;;\)" .
```

Esperado: el primer `grep` devuelve **sólo** `server.ts:2` (import de `child_process`) y
`server.ts:129` (spawn del servidor empaquetado con `serve`); el segundo, vacío; el tercero,
los tres `while` (vaciado de `disposables`, espera de `/api/health`, parseo de frames SSE).
Cualquier otra línea es un hallazgo, no una variante.

Capturar: la salida de los cuatro comandos y el `git rev-parse HEAD` usado.

## 7 · Recibo y cierre

1. Crear `docs/parity/receipts/F4A-VSCODE-2026-11-25.md` con: commit, VSIX (tamaño/hash
   `sha256sum`), versión de VS Code, SO/arquitectura, y una tabla criterio → evidencia
   (captura o salida pegada) → veredicto. Sin claves, tokens ni rutas de usuario completas.
2. Solo si **los cinco** tienen evidencia, actualizar el ROADMAP (abajo). Si alguno no se
   pudo ejecutar, se deja `[ ]` y el recibo dice por qué: no se marca por código.
3. Commit con la firma única de siempre, sin trailers, y correr `npm run check:index`
   después.

### Archivos a actualizar (y sólo si el recibo está completo)

| Archivo | Qué cambia |
| --- | --- |
| `docs/parity/f4a-evidence-runbook.md` | Este guion: agregar al final «Ejecutado: <fecha>, recibo en …» |
| `docs/parity/receipts/F4A-VSCODE-2026-11-25.md` | Nuevo: el recibo con la evidencia |
| `docs/vscode-extension-f4a.md` | Estado final: los cinco criterios verificados en VS Code limpio, enlace al recibo; reemplazar «Evidencia que falta» y la nota de «no se ejecutaron las tres tareas» |
| `ROADMAP.md` §3 · F4 | Encabezado `6/11` → `11/11` y «Parcial» → «Hecho y verificado en VS Code»; las cinco casillas de 4A pasan a `[x]` |
| `ROADMAP.md` §1 | Paridad `33/47` → `38/47`; total `67/95 (71 %)` → `72/95 (76 %)`; «4 fases cerradas» → «5 fases cerradas» (F0, PL0, UX 1.0, F2, F4); «7 parciales» → «6 parciales», de donde sale F4 |
| `ROADMAP.md` §10 | «Ahora»: F4A deja de figurar como pendiente de evidencia; queda sólo F3 (tras G2), PL3/G3 y G1 |

Si además se decide el punto abierto de PL5 (`repo` vs `public_repo`), eso va en su propio
commit: no se mezcla con el cierre de F4.

# Commander AI Studio — Extensión VS Code (scaffold)

Extensión mínima para usar Commander AI Studio desde VS Code.

## Comandos

| Comando | Qué hace |
|---------|----------|
| `Commander: Abrir chat del agente` | Abre un **webview de chat** que lanza el CLI headless (`npx commander agent "<tarea>" --json`) y pinta los eventos en vivo (streaming, tools, respuesta). |
| `Commander: Abrir Studio` | Abre la web del estudio (`commander.serverUrl`) en el *Simple Browser*. |
| `Commander: Ejecutar agente sobre una tarea` | Pide una tarea y la lanza en la terminal con el CLI headless (`npx commander agent "<tarea>"`). |

## Cómo funciona

La extensión **no** reimplementa el agente: delega en el CLI (`bin/commander.ts`)
que, a su vez, habla por HTTP con el servidor embebido de Commander AI Studio.
Así hay una sola implementación del bucle del agente.

```
VS Code ──┬─(terminal)──▶  commander agent "<tarea>"            ──HTTP→  servidor (3280)
          └─(webview) ──▶  commander agent "<tarea>" --json ──HTTP→  servidor (3280)
```

El webview de chat y el CLI se comunican por **NDJSON**: `commander agent --json`
emite un evento JSON por línea (`status`, `chunk`, `tool_call`, `tool_result`,
`answer`, `error`, `done`) que la extensión reenvía al webview para pintarlo.

## Desarrollo

```bash
cd vscode-extension
npm install
npm run compile         # genera ./out
```

Para probar: abre esta carpeta en VS Code y pulsa **F5** (Run Extension), o
instala el `.vsix` generado con `npm run package`.

### Configuración

| Ajuste | Por defecto | Descripción |
|--------|-------------|-------------|
| `commander.serverUrl` | `http://127.0.0.1:3280` | Servidor embebido del Studio. |
| `commander.cliCommand` | `npx commander` | Comando del CLI headless. |

## Estado

Scaffold funcional:
- ✅ **Webview de chat** que lanza `commander agent --json` y pinta los eventos NDJSON.
- ✅ Comandos `Abrir Studio` (Simple Browser) y `Ejecutar agente` (terminal).

Siguientes pasos posibles:
- Selector de modelo y proveedor en el webview.
- Diagnósticos/LSP propios del editor de VS Code.
- Historial de conversación persistente (`retainContextWhenHidden` ya activado).

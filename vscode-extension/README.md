# Commander AI Studio — Extensión VS Code

Cliente fino del agente de Commander AI Studio dentro de VS Code (F4A).
La extensión **no** reimplementa el agente: el bucle, las tools y el motor de
permisos son los mismos del escritorio (`bin/commander.ts` + `server.ts`).

## Comandos

| Comando | Qué hace |
|---------|----------|
| `Commander: Leer y explicar el archivo` | Corre el agente sobre el archivo/rango activo y explica qué hace, sin modificar nada. |
| `Commander: Editar el archivo…` | Pide el cambio y lo corre en una terminal con TTY; el diff se aprueba ahí mismo. |
| `Commander: Revisar los cambios sin commitear` | Revisa `git diff` (staged incluido) y señala errores, riesgos y pruebas faltantes. |
| `Commander: Abrir chat del agente` | Webview con streaming NDJSON (sólo lectura: con `--json` no hay aprobaciones). |
| `Commander: Abrir Studio` | Abre el Studio en el Simple Browser sobre el servidor embebido. |
| `Commander: Ejecutar agente sobre una tarea` | Pide una tarea libre y la corre en una terminal. |
| `Commander: Configurar clave de modelo` | Guarda la clave en el almacén seguro de VS Code (nunca en settings). |
| `Commander: Borrar clave de modelo` | Elimina la clave guardada. |

Las tres tareas también están en el menú contextual del editor.

## Cómo funciona

El VSIX viaja con el CLI y el servidor ya construidos en `cli/`:

```
VS Code ──(terminal, TTY)──▶  cli/commander.mjs agent "…"  ──HTTP→  cli/server.mjs (127.0.0.1:3280)
```

- Si ya hay un servidor respondiendo en `commander.serverUrl`, se reutiliza.
- Si no, se arranca `commander serve` en loopback con el Node del extension
  host (`ELECTRON_RUN_AS_NODE=1`), sin `npx` ni instalación global.
- La clave de modelo se guarda con `SecretStorage` y se pasa al servidor como
  variable de entorno; el valor no se escribe en disco ni se muestra.
- La corrida va en una terminal real, así el prompt de aprobación del motor de
  permisos funciona (con `--json` y sin TTY la escritura se deniega).

## Desarrollo

```bash
# en la raíz del repo: CLI + servidor + UI construidos
npm run build && npm run build:cli

cd vscode-extension
npm install
npm run compile
npm run bundle:cli      # copia ../cli-dist y node-pty a cli/
```

Abrí esta carpeta en VS Code y pulsá **F5** (Run Extension).

### Empaquetar el VSIX

```bash
cd vscode-extension
npm run package         # tsc + bundle:cli + vsce package
code --install-extension commander-ai-studio-0.2.0.vsix
```

`cli/` es un artefacto: se regenera con `npm run bundle:cli` y no se versiona.
El prebuild de `node-pty` que viaja es el de la plataforma que empaqueta.

### Configuración

| Ajuste | Por defecto | Descripción |
|--------|-------------|-------------|
| `commander.serverUrl` | `http://127.0.0.1:3280` | Servidor a reutilizar/arrancar (sólo loopback para auto-arranque). |
| `commander.autoStartServer` | `true` | Arrancar el servidor empaquetado si no responde. |
| `commander.model` | `""` | Modelo de las corridas (vacío = el del CLI). |
| `commander.apiKeyName` | `GEMINI_API_KEY` | Variable que recibe la clave guardada. |
| `commander.cliCommand` | `""` | Comando alternativo para desarrollo (`npx commander`). Vacío = CLI del VSIX. |

## Estado F4A

- ✅ Criterio 1 implementado: VSIX con CLI/servidor embebidos, tres tareas con
  TTY y clave en almacén seguro.
- ⏳ Falta la evidencia en un VS Code limpio con clave real (tres corridas).
- ⏳ Criterios 2–5: alcance mínimo y orden en `docs/vscode-extension-f4a.md` (repo).

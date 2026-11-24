# Commander AI Studio — Extensión VS Code

Cliente fino del agente de Commander AI Studio dentro de VS Code (F4A).
La extensión **no** reimplementa el agente: el bucle, las tools y el motor de
permisos son los mismos del escritorio (`bin/commander.ts` + `server.ts`).

## Comandos

| Comando | Qué hace |
|---------|----------|
| `Commander: Leer y explicar el archivo` | Sesión del servidor sobre el archivo/rango activo; explica qué hace sin modificar nada. |
| `Commander: Editar el archivo…` | Pide el cambio; el diff de la aprobación se ve en el panel y se permite o deniega ahí. |
| `Commander: Revisar los cambios sin commitear` | Revisa `git diff` (staged incluido) y señala errores, riesgos y pruebas faltantes. |
| `Commander: Abrir chat del agente` | Panel de chat con streaming SSE y aprobaciones con diff. |
| `Commander: Abrir Studio` | Abre el Studio en el Simple Browser sobre el servidor embebido. |
| `Commander: Ejecutar agente sobre una tarea` | Pide una tarea libre y la corre en el panel (sesión del servidor). |
| `Commander: Configurar clave de modelo` | Guarda la clave en el almacén seguro de VS Code (nunca en settings). |
| `Commander: Borrar clave de modelo` | Elimina la clave guardada. |

Las tres tareas también están en el menú contextual del editor.

## Cómo funciona

El VSIX viaja con el CLI y el servidor ya construidos en `cli/`:

```
VS Code ──(POST /api/agent/sessions)──▶  cli/server.mjs (127.0.0.1:3280)
        ◀──(SSE: eventos, diff)─────────
        ──(POST …/approvals/:id)───────▶  aplica fs.write / fs.edit
```

- Si ya hay un servidor respondiendo en `commander.serverUrl`, se reutiliza.
- Si no, se arranca `commander serve` en loopback con el Node del extension
  host (`ELECTRON_RUN_AS_NODE=1`), sin `npx` ni instalación global.
- La clave de modelo se guarda con `SecretStorage` y se pasa al servidor como
  variable de entorno; el valor no se escribe en disco ni se muestra.
- La tarea corre en el bucle del servidor (el mismo del escritorio). El panel
  pinta el `approval_request` con su `diff`; al permitir, el servidor aplica la
  tool y el editor abre el archivo para mostrar el cambio.
- El id de la sesión se muestra en la cabecera y queda en
  `GET /api/agent/sessions`, igual que las del escritorio. Al cerrar y reabrir
  el panel se restaura ese id y, si la corrida sigue, el SSE se reengancha.
- **Invariante:** la extensión no tiene bucle ni motor de permisos. No importa
  `src/agent`, no ejecuta tools y no decide aprobaciones: sólo reenvía la
  decisión por HTTP. El único proceso que arranca es `commander serve`.

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
code --install-extension commander-ai-studio-0.4.0.vsix
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

## Estado F4A

- ✅ Criterio 1: VSIX con CLI/servidor embebidos, tres tareas y clave en
  almacén seguro.
- ✅ Criterio 2: sesiones del servidor + SSE, diff del approval en el panel y
  allow/deny que aplica el cambio al workspace.
- ✅ Criterio 3: los resultados con `refs` abren el archivo en su línea.
- ✅ Criterio 4: el id sobrevive a cerrar/reabrir el panel y coincide con el que
  lista el escritorio.
- ✅ Criterio 5: cliente fino auditado; sin bucle ni motor de permisos propios
  (invariante y comandos de comprobación en `docs/vscode-extension-f4a.md`).
- ⏳ Falta la evidencia manual en un VS Code limpio con clave real: tres tareas,
  una aprobación, un ref y el reopen del panel.

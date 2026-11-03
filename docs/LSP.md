# LSP en Commander AI Studio

Integración de **Language Server Protocol** para TypeScript / JavaScript dentro
del editor del Workbench, sin depender del editor del sistema.

## Alcance

| Feature | Atajo | Estado |
|---------|-------|--------|
| Hover (tipo / documentación) | pasar el ratón | ✅ |
| Autocompletado | `Ctrl+Space` (o al teclear) | ✅ |
| Ir a definición | `F12` | ✅ |
| Referencias | `Shift+F12` | ✅ |
| Símbolos del documento (outline) | `Ctrl+Shift+O` | ✅ |
| Rename (workspace edit) | `Ctrl+Shift+R` | ✅ |
| Símbolos del workspace | `Ctrl+P` | ✅ |
| Diagnósticos por archivo (gutter) | automático | ✅ |
| Panel «Problemas» agregado | pestaña Workbench | ✅ |

Sólo TS/JS. Los demás lenguajes no van al language server.

## Arquitectura

```
Renderer (React)                Main (Electron)              Proceso hijo
─────────────────               ───────────────              ────────────
useLSPClient  ── IPC ──▶  electron/main.cjs  ── stdio ──▶  typescript-language-server
   ▲                            │  (JSON-RPC)                    │
   │                            └── lspBridge.cjs ◀──────────────┘
   └── preload.cjs (electronAPI.lsp)
```

- `electron/lspBridge.cjs`: lanza `typescript-language-server --stdio`, habla
  JSON-RPC y reenvía `textDocument/publishDiagnostics` como evento
  `lsp:diagnostics`.
- `electron/main.cjs`: registra los handlers IPC `lsp:*`.
- `electron/preload.cjs`: expone `window.electronAPI.lsp` (incl.
  `onDiagnostics` con `removeListener` preciso).
- `src/hooks/useLSPClient.ts`: ciclo de vida (init por proyecto, `didOpen` /
  `didClose` por archivo, suscripción única a diagnósticos).
- `src/components/panel/CodeEditor.tsx`: puente a CodeMirror (`setDiagnostics`,
  autocompletado, overlays de resultado y rename).
- `src/utils/lspProblems.ts`: store global para el panel «Problemas».
- `src/components/SymbolSearchModal.tsx`: búsqueda `workspace/symbol` con
  `Ctrl+P`; al elegir un resultado emite `commander:open-location`, igual que
  el panel «Problemas».

### URIs

El servidor publica URIs inconsistentes (`file:///c%3A/...` vs `file:///C:/...`).
El renderer normaliza siempre con `normalizeFsPath` antes de comparar.

## Requisitos

```bash
npm install --save-dev typescript-language-server --ignore-scripts --legacy-peer-deps
```

Verificación rápida (sin Electron):

```bash
node node_modules/typescript-language-server/lib/cli.mjs --version   # → 6.0.2
```

## Prueba manual en Electron

> El renderer habla con el main por IPC; sólo se puede verificar con la app real.

1. `npm run electron:dev`.
2. Abre el **Workbench** (panel derecho) → pestaña **Editor**.
3. Selecciona un archivo `.ts` / `.tsx` / `.js` del proyecto.
4. Comprueba el indicador inferior izquierdo: **● LSP typescript** (verde).
   Si aparece **● LSP error** (rojo), pasa el ratón por encima para ver el
   mensaje.

Checklist:

- [ ] Indicador **● LSP** visible tras abrir un `.ts`.
- [ ] **Hover** sobre un símbolo muestra tipo/documentación.
- [ ] **`Ctrl+Space`** abre la lista de completado (también al teclear).
- [ ] **`F12`** salta a la definición (mismo archivo y otro archivo).
- [ ] **`Shift+F12`** lista referencias; el panel es clicable.
- [ ] **`Ctrl+Shift+O`** lista los símbolos del documento.
- [ ] **`Ctrl+Shift+R`** renombra (overlay); propaga a otros archivos.
- [ ] Introducir un error de tipo → sale marcado en el gutter.
- [ ] Pestaña **Problemas** lista los diagnósticos y el badge cuenta errores.
- [ ] Click en un problema abre el archivo en la línea correcta.

## Solución de problemas

| Síntoma | Causa probable | Acción |
|---------|----------------|--------|
| No hay indicador LSP | Falta el binario o no es `electron:dev` | Reinstala `typescript-language-server`; usa `window.electronAPI.lsp` |
| `● LSP error` | El servidor no arrancó | Revisa la consola del main (`lsp:initialize`) |
| `F12` no navega | Archivo sin ruta absoluta (untitled) | Guarda primero el archivo |
| Sin completado | Servidor aún inicializando | Espera 1–2 s y reintenta `Ctrl+Space` |
| Diagnósticos de otro archivo | URI no normalizada | Reporta el URI en consola |

## Limitaciones conocidas

- Sólo TypeScript/JavaScript.
- Los diagnósticos llegan por archivo abierto (`didOpen`); no hay escaneo
  completo del proyecto en segundo plano.
- `workspace/symbol` está expuesto con `Ctrl+P`; `Ctrl+T` sigue reservado para
  abrir una pestaña nueva. La búsqueda cubre el proyecto que haya inicializado
  el editor, no un workspace multi-root.
- No verificado en este entorno de CI (requiere Electron real).

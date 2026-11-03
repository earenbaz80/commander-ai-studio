# Hoja de ruta UX — Commander AI Studio

Estilo retro Norton intacto. Solo mejoras de practicidad/intuición/versatilidad.

## Principios
- No tocar paleta (#000080/#00ffff/#ffff55), tipografía retro, ni Nono como diferenciador.
- Mantener single-process (Express+Vite en 127.0.0.1:3280).
- Cada item debe pasar `tsc --noEmit` y `vite build` (la regla del repo en [AGENTS.md](AGENTS.md); sin `--skipLibCheck`, que afloja la comprobación).

## Estado real

Revisado contra el árbol: varias fases ya están hechas, así que no hay que reimplementarlas.

| Fase | Estado | Evidencia |
| --- | --- | --- |
| 1. Command palette | **Hecho** | `src/components/CommandPalette.tsx` (204 líneas) importado en `App.tsx`; el atajo vive en `src/hooks/useCommandPaletteShortcut.ts` |
| 2. Layout 3 paneles | **Hecho** | `src/components/ResizableSplit.tsx` monta el asa y `src/stores/layoutStore.ts` guarda claves y límites; Workbench y Nono ya lo usan |
| 3. Diff viewer | **Hecho** | `src/components/DiffViewer.tsx` integrado en `AgentApprovalModal.tsx` con aceptación por hunk, sobre `diffLines`/`mergeHunks` de `src/utils/patch.ts` |
| 4. Status bar | **Hecho** | `src/components/StatusBar.tsx` importado en `App.tsx` |
| 5. Nono acoplable | **Hecho** | `src/features/nono/NonoDock.tsx` monta el asistente acoplado sobre `ResizableSplit`; el toggle ya persistía en `commander_nono_docked` |
| 6. Streaming de shell.run | **Hecho** | `ShellJobLog.tsx` consulta `shell.job` cada 1000 ms desde el paso `tool_result` de un `shell.run` con `background: true`: salida en vivo, corte al terminar y botón de parar |
| 7. Sidebar de sesiones | **Hecho** | El historial del `Sidebar` lista las sesiones del servidor agrupadas por proyecto y `handleSelectServerSession` las reanuda con un clic (historial unificado, commit `9f78089`) |
| 8. Atajos | **Hecho** | `src/hooks/useKeyboardShortcuts.ts` cubre `Ctrl+B`, `Ctrl+/`, `Ctrl+,`, `Ctrl+P`, `Ctrl+Shift+P` (paleta) y ``Ctrl+` `` (Workbench en la terminal); el modal de atajos los documenta |
| 9. Empty states | **Hecho** | `src/components/EmptyState.tsx` lo usan `ChatPlayground` (sin sesión), `FileTreeView` (sin proyecto) y `AgentMode` (sin pasos) |
| 10. Consolidar playgrounds | Parcial | `src/components/Playground.tsx` ya es el armazón único: barra de modos, modelo activo a la vista y montaje del activo. Falta absorber la lógica de cada pantalla (Composer y Compare son multi-modelo) |

Orden sugerido por retorno: **6 → 7 → 8**, y dejar la 10 para el final (toca pantallas que ya funcionan sin añadir capacidad).

## Fases (orden por impacto/día)

### Fase 1 — Command palette (Ctrl+K)  [EN CURSO]
Búsqueda universal: archivos, comandos, sesiones, tools, agentes. Fuzzy filter, Enter ejecuta, Esc cierra.
Archivos: src/components/CommandPalette.tsx, src/hooks/useCommandPaletteShortcut.ts, App.tsx (atajo global).

### Fase 2 — Layout 3 paneles redimensionables
File tree | editor | agent. Paneles colapsables, tamaños persistidos en localStorage. Splitter arrastrable.
Archivos: src/components/ResizableSplit.tsx, src/stores/layoutStore.ts.

### Fase 3 — Diff viewer visual para aprobaciones
Vista lado a lado con checkboxes por hunk. Reusa src/utils/patch.ts (diffLines/mergeHunks).
Archivos: src/components/DiffViewer.tsx, integración en AgentMode.

### Fase 4 — Status bar Norton
Modelo, rama git, conteo de diagnósticos, estado del agente. Pie fijo.
Archivos: src/components/StatusBar.tsx.

### Fase 5 — Nono acoplable (dock)
Opción de anclar Nono como panel lateral además de flotante. Toggle en memoria UI.
Archivos: src/features/nono/NonoDock.tsx.

### Fase 6 — Streaming de shell.run
Output en vivo en AgentMode (polling shell.job logs cada 500ms).
Archivos: AgentMode.tsx (polling), sin cambios server.

### Fase 7 — Sidebar de sesiones con scoping por proyecto
Lista de threads por proyecto, resume con un click. Usa /api/threads.
Archivos: src/components/SessionSidebar.tsx.

### Fase 8 — Atajos de teclado
Ctrl+P archivos, Ctrl+Shift+P comandos, Ctrl+` terminal, Ctrl+B sidebar.
Archivos: src/hooks/useKeyboardShortcuts.ts (ya existe; ampliar).

### Fase 9 — Empty states guiados
Onboarding mínimo: "sin proyecto", "sin archivo", "sin sesión".
Archivos: componentes EmptyState reutilizables.

### Fase 10 — Consolidar Playgrounds
Un solo tab con selector de modelo (Anthropic/OpenAI/Gemini/HF/local).
Archivos: src/components/Playground.tsx (unificación).

## Fuera de alcance (no tocar)
- Paleta, tipografía, Nono como diferenciador, single-process, agent core.
- LSP real y file watcher (descartables).

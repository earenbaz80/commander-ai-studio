# Commander AI Studio - Refactor Plan

> **Estado: histórico.** Este plan se escribió antes del trabajo de octubre de
> 2026 y no describe el repo actual. Parte de la Fase 3 ya existe
> (`src/hooks/useLSPClient.ts`, `src/agent/tools/git.ts`, `repoIndex.ts`,
> `codeSearch.ts`); la retirada de `FloatingAssistant`/Nono que propone la Fase 1
> se descartó y la mascota está hoy cubierta por
> `tests/ui/FloatingAssistant.test.tsx`. Se conserva como registro de decisiones,
> no como hoja de ruta.

**Objetivo:** Llevar el código al nivel de OpenCode / FreeBuff / Antigravity - un agente de coding real, no un juguete.

---

## 🔴 ELIMINAR (Bloat que no aporta valor)

| Componente/Feature | Líneas | Razón |
|---|---|---|
| `FloatingAssistant.tsx` | 963 | Mascota distractora, lógica de chat duplicada, animaciones innecesarias |
| `ChatPlaygroundFreeform.tsx` | ~400 | Modo redundante |
| `ChatPlaygroundStructured.tsx` | ~300 | Modo redundante |
| `ChatPlaygroundCompare.tsx` | ~200 | Nicho, poco usado |
| `ChatPlaygroundHuggingFace.tsx` | ~500 | Local models = nicho, complejidad alta |
| `ChatPlaygroundLiveVoice.tsx` | ~300 | Medio implementado |
| `TelemetryDashboard.tsx` | ~400 | Solo interno |
| `CompilerModal.tsx` | ~200 | Build nativo no es core |
| `GalleryModal.tsx` + `LibraryModal.tsx` + `ProjectModal.tsx` | ~600 | Sistema de modales fragmentado |
| `NonoAnimations.tsx` / `NonoBehaviors.ts` | ~300 | Complejidad visual sin utilidad |
| `useNonoAnimations.ts` | ~150 | Hook innecesario |

**Total a eliminar: ~4,500 líneas de bloat**

---

## 🟡 SIMPLIFICAR (Consolidar)

### 1. Modos → Solo 3
```
ANTES (9):  chat | freeform | structured | composer | compare | huggingface | telemetry | agent | live_voice
DESPUÉS (3): chat | agent | composer
```

### 2. Stores → Uno solo
```
ANTES (5+): chatStore + uiStore + tabsStore + authStore + providerStore
DESPUÉS (1): useAppStore (Zustand) con slices claros:
  - chat: messages, sessions, streaming
  - ui: panels, modals, layout
  - tabs: files, editors, terminals
  - auth: user, tokens
  - providers: config, health, metrics
```

### 3. Provider System → Config única
```
ANTES: Múltiples archivos, hooks, contextos, validaciones dispersas
DESPUÉS: src/providers/index.ts - single source of truth
  - ProviderConfig (schema con Zod)
  - ProviderRegistry (specs + factory)
  - useProviders() hook único
```

### 4. Componentes UI → Atomic Design real
```
src/components/
├── atoms/      # Button, Input, Icon, Badge, Tooltip
├── molecules/  # MessageBubble, FileTab, TerminalPane, ProviderCard
├── organisms/  # ChatPanel, FileTree, TabBar, SidePanel
├── templates/  # ChatLayout, AgentLayout, ComposerLayout
└── pages/      # ChatPage, AgentPage, ComposerPage
```

---

## 🟢 CONSTRUIR (Lo que falta para ser un agente real)

### 1. File Watcher + Hot Reload
```typescript
// src/agent/fileWatcher.ts
// chokidar + debounce → events → agent context update
```

### 2. LSP Client Real
```typescript
// src/agent/lspClient.ts
// vscode-languageserver-protocol + language servers (typescript, python, etc.)
// → goto definition, hover, diagnostics, completions
```

### 3. Git Integration Nativa
```typescript
// src/agent/git.ts
// simple-git wrapper → status, diff, commit, branch, worktree
// Checkpoint system = git worktree per session
```

### 4. Session Persistence
```typescript
// src/session/persistence.ts
// Save: chat history, open files, agent state, plan, checkpoints
// Resume: restore exact state on restart
```

### 5. Workspace Indexing
```typescript
// src/agent/indexer.ts
// ripgrep + AST parsing → symbol index → semantic search
// Used by agent for "find all usages", "go to definition"
```

### 6. Streaming Tool Output
```typescript
// src/agent/streaming.ts
// Tool calls emit events in real-time
// UI shows progress, partial results, can interrupt
```

### 7. Parallel Tool Execution
```typescript
// src/agent/orchestrator.ts
// DAG-based tool execution
// Independent tools run in parallel
// Dependent tools wait for predecessors
```

### 8. Plan-and-Execute with Checkpoints
```typescript
// src/agent/planner.ts
// LLM generates plan → steps with dependencies
// Each step = checkpoint (git worktree)
// Can rollback, branch, continue
```

---

## 📋 PLAN DE EJECUCIÓN (Fases)

### Fase 1: Limpieza (Día 1-2)
- [ ] Eliminar componentes marcados en 🔴
- [ ] Consolidar 9 modos → 3 en `App.tsx` y routing
- [ ] Eliminar `FloatingAssistant` o reducir a widget mínimo (<100 líneas)
- [ ] Limpiar imports huérfanos, dead code

### Fase 2: Arquitectura de Estado (Día 3-4)
- [ ] Crear `useAppStore` (Zustand) con slices
- [ ] Migrar `chatStore`, `uiStore`, `tabsStore`, `authStore` → slices
- [ ] Eliminar Context providers redundantes
- [ ] Unificar `ProviderManager` + provider hooks → `useProviders()`

### Fase 3: Core Agent (Día 5-8)
- [ ] `fileWatcher.ts` - chokidar integration
- [ ] `lspClient.ts` - TypeScript language server primero
- [ ] `git.ts` - simple-git wrapper + worktree checkpoints
- [ ] `persistence.ts` - save/resume session state
- [ ] `indexer.ts` - ripgrep + ts-morph para símbolos TS/JS

### Fase 4: Agent Loop Moderno (Día 9-12)
- [ ] `orchestrator.ts` - DAG-based parallel execution
- [ ] `streaming.ts` - real-time tool output events
- [ ] `planner.ts` - plan generation + checkpoints
- [ ] Integrar en `ChatPlayground.tsx` (modo Agent)

### Fase 5: UI Polish (Día 13-14)
- [ ] Atomic design restructure
- [ ] 3 layouts: ChatLayout, AgentLayout, ComposerLayout
- [ ] Keyboard shortcuts, command palette
- [ ] Theme system (ya tienen retro Norton, mantener)

### Fase 6: Backend Cleanup (Paralelo)
- [ ] Split `server.ts` → routers por dominio
- [ ] `/api/agent/*` - agent endpoints
- [ ] `/api/lsp/*` - LSP proxy
- [ ] `/api/git/*` - git operations
- [ ] `/api/index/*` - workspace indexing
- [ ] WebSocket para streaming tool output

---

## 🎯 MÉTRICAS DE ÉXITO

| Métrica | Actual | Objetivo |
|---|---|---|
| `App.tsx` líneas | 1279 | <300 |
| `FloatingAssistant.tsx` | 963 | 0 (eliminado) o <100 |
| Modos | 9 | 3 |
| Stores | 5+ | 1 |
| Componentes | 100+ | ~40 |
| `server.ts` líneas | 2000+ | <500 (routers separados) |
| Tiempo cold start | ~5s | <2s |
| Agent puede: editar archivos, correr tests, git, LSP | Parcial | ✅ Completo |
| Session resume | No | ✅ Sí |
| Parallel tool exec | No | ✅ Sí |

---

## 🚫 NO HACER (Anti-patrones)

- ❌ No añadir más "features" visuales (animaciones, mascotas, dashboards)
- ❌ No crear más modales - usar panels/drawers inline
- ❌ No duplicar lógica entre frontend/backend - single source of truth
- ❌ No usar `any` en TypeScript - strict mode siempre
- ❌ No mezclar UI logic con agent logic - separar capas

---

## 📁 ESTRUCTURA FINAL PROPUESTA

```
src/
├── app/
│   ├── App.tsx              # <300 líneas, solo routing + providers
│   ├── routes.tsx           # 3 routes: /chat, /agent, /composer
│   └── providers.tsx        # AppStoreProvider, LSPProvider, etc.
├── components/
│   ├── atoms/               # 15 componentes base
│   ├── molecules/           # 15 componentes compuestos
│   ├── organisms/           # 8 paneles principales
│   ├── templates/           # 3 layouts
│   └── pages/               # 3 páginas
├── stores/
│   └── useAppStore.ts       # Zustand store único
├── hooks/
│   ├── useProviders.ts      # Provider system unificado
│   ├── useSession.ts        # Persistence
│   ├── useLSP.ts            # LSP client
│   └── useGit.ts            # Git operations
├── agent/
│   ├── orchestrator.ts      # DAG execution
│   ├── planner.ts           # Plan + checkpoints
│   ├── streaming.ts         # Real-time output
│   ├── fileWatcher.ts       # chokidar
│   ├── lspClient.ts         # LSP protocol
│   ├── git.ts               # simple-git
│   ├── indexer.ts           # workspace index
│   ├── tools/               # Tool implementations
│   │   ├── read.ts
│   │   ├── write.ts
│   │   ├── edit.ts
│   │   ├── glob.ts
│   │   ├── grep.ts
│   │   ├── bash.ts
│   │   ├── lsp.ts
│   │   └── git.ts
│   └── AgentLoop.tsx        # Main agent component
├── providers/
│   ├── index.ts             # Single entry point
│   ├── schema.ts            # Zod schemas
│   ├── registry.ts          # Provider specs
│   └── types.ts
├── session/
│   └── persistence.ts       # Save/resume
└── utils/
    └── ...
```

---

## ✅ PRÓXIMO PASO INMEDIATO

¿Empezamos por **Fase 1: Limpieza**? Eliminar `FloatingAssistant` y los 5 playgrounds redundantes.

O prefiere que empiece por **Fase 2: Estado** (crear `useAppStore` unificado)?
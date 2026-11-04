# Commander AI Studio — Arquitectura

## 🏗️ Stack

| Capa | Tecnología |
|------|------------|
| Frontend | React 19, TypeScript 7 estricto, Tailwind CSS 4 |
| Desktop | Electron 33 (frameless, custom titlebar, sandbox) |
| Build | Vite 8 + Rolldown |
| Estado | React Context + useReducer (`src/stores/`) |
| Backend embebido | Express 5 (puerto 3280) |
| IA | Google Gemini, Anthropic Claude, HF Transformers.js, Ollama, OpenRouter, Pollinations, Custom |
| Agente | AgentOrchestrator + AgentLoop + ToolRegistry |
| Testing | Vitest (unit/UI) + Playwright (E2E) |
| CI/CD | GitHub Actions |

## 📁 Estructura

```
commander-ai-studio/
├── src/
│   ├── stores/              # ← NUEVO: estado global centralizado
│   │   ├── index.ts         # AppStoreProvider + exports
│   │   ├── chatStore.ts     # messages, mode, model, params
│   │   ├── uiStore.ts       # modals, theme, layout, battery
│   │   ├── tabsStore.ts     # multi-tab workspace
│   │   └── authStore.ts     # Firebase auth + guest
│   ├── lib/
│   │   ├── aiProviders.ts   # ← NUEVO: lógica de proveedores centralizada
│   │   ├── firebase.ts      # Auth, Firestore, Gallery
│   │   └── agentProjects.ts # Allowlist de proyectos
│   ├── agent/               # Agente autónomo
│   │   ├── orchestrator.ts  # Estado, plan, steps, approval
│   │   ├── loop.ts          # AgentLoop (native/JSON fallback)
│   │   ├── registry.ts      # TOOL_REGISTRY (16 tools)
│   │   ├── llm.ts           # callAgentLLM / callAgentLLMTools
│   │   ├── mcp.ts           # Model Context Protocol client
│   │   └── tools/           # fs, shell, git, web, mcp, task
│   ├── components/          # 40+ componentes (lazy-loaded)
│   ├── hooks/               # useTabs, useIdentity, useAgent
│   ├── data/                # models, presets, templates
│   ├── utils/               # patch, diff, mentions, etc.
│   ├── types/               # studio.ts, electron.d.ts
│   └── i18n/                # traducciones ES/EN
├── electron/                # Main process + preload + server
├── tests/
│   ├── ui/                  # Vitest + React Testing Library
│   └── e2e/                 # ← NUEVO: Playwright E2E tests
├── docs/
│   └── API.md               # ← NUEVO: API reference
└── .github/workflows/
    ├── tests.yml            # ← ACTUALIZADO: CI completo
    └── release.yml          # ← NUEVO: build multiplataforma
```

## 🔄 Flujo de Estado

```
AppStoreProvider
├── AuthStoreProvider    → currentUser, guestName, authModal
├── ChatStoreProvider    → messages, mode, model, params, history
├── UIStoreProvider      → modals, theme, sidebar, workbench, battery
└── TabsStoreProvider    → tabs[], activeId, agentRoots, projects
```

## 🎯 Modos

| Modo | Descripción |
|------|-------------|
| `chat` | Conversación multi-turno con streaming SSE |
| `freeform` | Completado de texto libre |
| `structured` | Salida JSON/Tabla con esquemas |
| `composer` | Agente multi-archivo + diffs + Live Sandbox |
| `compare` | Ejecución paralela en múltiples modelos |
| `agent` | Agente autónomo (fs/shell/git/web/MCP) |
| `live_voice` | Voz bidireccional (Gemini Live) |
| `huggingface` | Modelos locales ONNX/WebGPU |
| `telemetry` | Dashboard de métricas |

## 🔐 Seguridad

- **Electron**: `contextIsolation`, `sandbox`, `nodeIntegration: false`
- **shell.run**: Allowlist de comandos seguros + denylist de peligrosos (fail-safe)
- **shell.pty**: Ejecutable + argv, sin shell; denylist, `cwd` validado y sesiones por agente
- **fs.***: Validación de rutas contra allowlist de proyectos
- **API Keys**: Solo al servidor embebido vía HTTPS
- **CORS**: Restringido al origen de la app

## 🚀 Comandos

```bash
npm run dev          # Dev server (Vite)
npm run build        # Typecheck + build de producción
npm run electron     # Lanzar Electron
npm run test         # Tests unitarios (Vitest)
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npx playwright test  # Tests E2E
```

## 📱 Compilación Nativa

Electron Builder soporta:
- **Windows**: NSIS (x64/arm64), Portable (x64)
- **macOS**: DMG (x64/arm64)
- **Linux**: AppImage, deb, rpm (x64/arm64)

Capacitor para móvil:
- Android (APK/AAB)
- iOS (Xcode)

PWA con Service Worker para offline-first.
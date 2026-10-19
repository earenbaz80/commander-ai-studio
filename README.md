# Commander AI Studio v2.5.0

Entorno retro Norton para ingeniería de prompts + **agente autónomo**, modelos Gemini/HF y exportador nativo (Electron/Tauri).

## Run Locally

1. `npm install`
2. Copia `.env.example` a `.env` y define `GEMINI_API_KEY`
3. `npm run dev` → http://localhost:3000
4. Checks: `npm run lint`, `npm test` (unit + reglas), `npm run test:smoke`, `npm run test:agent`

## Modo Agente

- Sidebar → **Modo Agente**. Describe tarea → INICIAR TAREA.
- Tools (vía `POST /api/agent/run-tool`,Rate-limit 60/min):
  - `fs.read/write/edit/glob/grep`, `shell.run` (allowlist), `web.fetch/search`, `code.run` (vm sandbox), `mcp.call/list`.
- `danger=true` pide aprobación con diff preview (`fs.edit/write`).
- Reglas repo: `AGENTS.md`, `.cursorrules`, `CLAUDE.md` se inyectan al prompt.
- MCP: panel lateral (add/list/toggle, persiste `localStorage`). Schemas MCP se anexan al `toolSchema`.
- Sesiones: auto-guardado en `localStorage` (20), restore/fork/delete. Métricas por tool en panel.

## API agente

- `POST /api/agent/run-tool {toolId, input}` — sandbox a `process.cwd()`, validación y allowlist shell.
- `GET /api/health` — smoke.

## Desktop

- `npm run electron:dev` / `npm run electron:build` (puerto embebido 3280).
- SW deshabilitado en Electron; rutas `index.html` relativas (`./`) para `loadFile`.

## Seguridad

- Headers base + CORS allowlist (`CORS_ORIGINS`) + rate global 300/min.
- Debug `listModels` 403 en prod. Export ZIP con escape HTML y filename sanitizado.
- `firestore.rules`: `/users` self-only, `likesCount` solo ±1, likes no públicos. Check: `npm run test:rules`.

## Runtime Server Build

Run 
pm run build:server to regenerate electron/server.cjs and electron/server.mjs from server.ts.

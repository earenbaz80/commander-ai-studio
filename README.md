# Commander AI Studio v2.5.0

Entorno retro Norton para ingeniería de prompts + **agente autónomo**, modelos Gemini/HF y exportador nativo (Electron/Tauri).

## Run Locally

1. `npm install`
2. Copia `.env.example` a `.env` y define `GEMINI_API_KEY`
3. `npm run dev` → http://localhost:3000
4. Checks: `npm run lint`, `npm test` (vitest, UI), `npm run test:node` ([suite node y server compartido](#suite-de-tests-node))

## Modo Agente

- Sidebar → **Modo Agente**. Describe tarea → INICIAR TAREA.
- Tools (vía `POST /api/agent/run-tool`,Rate-limit 60/min):
  - `fs.read/write/edit/glob/grep`, `shell.run` (allowlist), `web.fetch/search`, `code.run` (vm sandbox), `mcp.call/list`.
- `danger=true` pide aprobación con diff preview (`fs.edit/write`).
- Reglas repo: `AGENTS.md`, `.cursorrules`, `CLAUDE.md` se inyectan al prompt.
- Freebuff: proveedor propio (`freebuff/…` → `POST /api/freebuff/generate`, proxy OpenAI-compatible a `freebuff.com/api/v1/paid`). Sus modelos **no** vienen en el catálogo por defecto porque sin `FREEBUFF_API_KEY` fallarían al elegirlos: `npm run models:freebuff` mete los que declaran tool-calling (hoy 9 de 280; el resto sólo hace chat) y se repite cuando el proveedor añada modelos. Los ids viven en `src/config/freebuff-models.json`, que leen a la vez el agente (`toolDialectForModel`), el proxy y el propio script.
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

## Suite de tests (node)

`npm test` (vitest, UI) va aparte: `npm run test:node` corre los `tests/*.test.ts` con el runner de Node. Un solo archivo también: `npm run test:node -- tests/persistence.test.ts`.

`node --test` abre **cada archivo en su propio proceso**, así que un server compartido en memoria no serviría de nada. Lo resuelve `scripts/test-node.ts`: abre un canal de control en loopback y compila `server.ts` **la primera vez que algún archivo pide la URL**, nunca antes. Un archivo que no toca HTTP no paga el arranque (`ningún archivo usó HTTP: no se arrancó el server`); los que sí, reutilizan el mismo y no lo matan, porque no es suyo. Al acabar la suite se para el server y se borra la base temporal.

- **Modo**: `NODE_ENV=production` y una SQLite en un directorio temporal. No es «desplegar»: con Vite montado como middleware el primer re-optimizado bloqueaba el proceso y una petición de test moría por timeout. La superficie `/api/*` es la misma; los endpoints exclusivos de desarrollo no están.
- **Sin padre**: `startServer()` del arnés arranca y para su propio server, así que `tsx --test tests/serverEndpoints.test.ts` sigue funcionando solo.
- **Peticiones**: `node:http` con `agent: false`. `fetch` reutiliza sockets que el server cierra a los 5 s y un POST moría con `ECONNRESET`.
- **Si el server muere**: el test falla diciéndolo; no se arranca otro por detrás, que escondería el fallo tras una instancia distinta de la que se cree.

## Runtime Server Build

Run 
pm run build:server to regenerate electron/server.cjs and electron/server.mjs from server.ts.

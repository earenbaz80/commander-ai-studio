# Commander AI Studio — API Reference

Base URL: `/api` (Express server embebido en Electron, puerto 3280)

---

## 📡 Endpoints de IA

### `POST /api/gemini/generate`
Genera respuesta con Google Gemini (sin streaming).

**Body:**
```json
{
  "apiKey": "string",
  "contents": [{"text": "string"}],
  "systemInstruction": "string",
  "model": "gemini-2.0-flash",
  "temperature": 0.7,
  "topP": 0.95,
  "topK": 40,
  "maxTokens": 2048,
  "thinkingLevel": "LOW",
  "responseMimeType": "application/json",
  "responseSchema": "string",
  "tools": [{"googleSearch": {}}]
}
```

**Response:**
```json
{
  "success": true,
  "text": "string",
  "metrics": {"latencyMs": 123, "totalTokens": 456},
  "groundingSources": [],
  "webSearchQueries": [],
  "functionCalls": []
}
```

### `POST /api/gemini/stream`
Streaming SSE en tiempo real para Gemini.

**Body:** Igual que `/api/gemini/generate`

**Response:** SSE stream
```
data: {"type":"chunk","text":"..."}
data: {"type":"done","fullText":"...","groundingSources":[],"metrics":{}}
data: {"type":"error","error":"..."}
```

### `POST /api/gemini/interactions/create`
Agente Antigravity (Gemini Interactions API).

**Body:**
```json
{
  "agent": "antigravity-preview-09-2026",
  "input": "string",
  "environment": "remote",
  "previous_interaction_id": "string",
  "tools": [{"type":"google_search"}],
  "apiKey": "string"
}
```

---

### `POST /api/anthropic/generate`
Genera respuesta con Anthropic Claude (sin streaming).

**Body:**
```json
{
  "prompt": "string",
  "messages": [{"role":"user","content":"string"}],
  "model": "claude-3-5-sonnet-20241022",
  "anthropicApiKey": "string",
  "systemInstruction": "string",
  "temperature": 0.7,
  "maxTokens": 2048
}
```

### `POST /api/anthropic/stream`
Streaming SSE para Claude.

---

### `POST /api/hf/generate`
Ejecución local Hugging Face (Transformers.js / WebGPU).

**Body:**
```json
{
  "prompt": "string",
  "model": "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B",
  "hfApiToken": "string",
  "systemInstruction": "string",
  "temperature": 0.7,
  "maxTokens": 2048,
  "geminiApiKey": "string"
}
```

---

### `POST /api/ollama/generate`
Ollama local.

**Query:** `?host=http://localhost:11434`

**Body:**
```json
{
  "prompt": "string",
  "model": "llama3.2",
  "systemInstruction": "string",
  "temperature": 0.7,
  "maxTokens": 2048,
  "ollamaHost": "http://localhost:11434"
}
```

### `POST /api/openrouter/generate`
OpenRouter (modelos gratuitos).

**Body:**
```json
{
  "prompt": "string",
  "model": "deepseek/deepseek-chat-v3-0324:free",
  "systemInstruction": "string",
  "temperature": 0.7,
  "maxTokens": 2048,
  "openrouterApiKey": "string"
}
```

### `POST /api/pollinations/generate`
Pollinations (gratis, sin key).

**Body:**
```json
{
  "prompt": "string",
  "model": "openai",
  "systemInstruction": "string",
  "temperature": 0.7,
  "maxTokens": 2048
}
```

### `POST /api/custom/generate`
Endpoint OpenAI-compatible personalizado.

**Body:**
```json
{
  "prompt": "string",
  "model": "string",
  "systemInstruction": "string",
  "temperature": 0.7,
  "maxTokens": 2048,
  "baseURL": "http://localhost:1234/v1",
  "apiKey": "string"
}
```

---

## 🤖 Endpoints del Agente

### `POST /api/agent/run-tool`
Ejecuta una tool del agente en el servidor.

**Body:**
```json
{
  "toolId": "fs.read",
  "input": {"path": "README.md"}
}
```

**Tools disponibles:**
- `fs.read` — Leer archivo (no requiere aprobación)
- `fs.write` — Crear/reescribir archivo (requiere aprobación)
- `fs.edit` — Editar archivo (requiere aprobación)
- `fs.glob` — Buscar archivos por patrón
- `fs.list` — Listar un directorio con tipo y tamaño (no requiere aprobación)
- `fs.grep` — Buscar texto en archivos
- `shell.run` — Ejecutar comando shell (requiere aprobación según allowlist/denylist); `cwd` corre en un subdirectorio, `allowUnlisted` ejecuta fuera de la allowlist tras aprobación e `interactive` abre stdin para `shell.job`
- `shell.job` — Trabajos en segundo plano: `list`, `logs`, `read` (salida nueva desde un cursor), `write` (stdin del proceso interactivo) y `stop`
- `shell.pty` — Sesión interactiva persistente (proceso real con TTY): `open` abre un ejecutable con `args` en array y devuelve `id`; `read` devuelve sólo la salida nueva desde un `cursor`; `write` manda texto al stdin; `resize` cambia filas/columnas; `close` la termina; `list` lista las abiertas. Sin shell ni pipes de por medio: el ejecutable se valida, el `cwd` vive dentro del proyecto y `open`/`close` piden aprobación
- `ask_user` — Pregunta al usuario y espera respuesta: `question` (obligatorio), `header`, `options` (máx. 6) y `allowFreeText`. La corrida queda en pausa hasta que respondes y el texto vuelve como resultado de la tool.
- `github.pr` — Lee un pull request: `repo` ("owner/repo") + `number`, o `url`. Devuelve título, estado, autor, cuerpo y diff por archivo (recortado a 4 000 caracteres por archivo). Sin `GITHUB_TOKEN` responde con el motivo, sin salir a la red.
- `github.comment` — Publica un comentario en el PR (`body` obligatorio). Pide aprobación y usa el mismo `GITHUB_TOKEN`.
- `read_diagnostics` — Leer diagnósticos de TypeScript
- `task` — Lanzar sub-tarea
- `git.status` / `git.diff` / `git.log` / `git.commit` — Operaciones git
- `web.fetch` — Obtener contenido web
- `web.search` — Buscar en la web
- `code.run` — Ejecutar código
- `mcp.call` / `mcp.list` — Model Context Protocol

**Response:**
```json
{
  "ok": true,
  "data": {}
}
```

---

## 📁 Endpoints de Proyectos

### `GET /api/agent/roots`
Lista directorios permitidos (allowlist del servidor).

**Response:**
```json
[
  {"path": "/home/user/projects", "name": "projects"}
]
```

### `POST /api/agent/roots/add`
Añade directorio a la allowlist.

**Body:** `{"path": "/absolute/path"}`

### `POST /api/agent/roots/remove`
Quita directorio de la allowlist.

**Body:** `{"path": "/absolute/path"}`

### `POST /api/agent/roots/create`
Crea un nuevo proyecto.

**Body:** `{"name": "mi-proyecto"}`

---

## 🔐 Seguridad

- **CORS**: Solo permite solicitudes desde el origen de la app
- **Path Traversal**: Todas las rutas de fs.* se validan contra la allowlist de proyectos
- **shell.run**: Allowlist de comandos seguros + denylist de peligrosos (fail-safe)
- **shell.pty**: Ejecutable + argv (sin shell), lista negra de binarios, `cwd` validado y sesiones ligadas a su agente
- **ask_user**: Sólo transporta texto; no toca el workspace y la pregunta siempre pasa por el modal (nunca se autocompleta).
- **github.pr / github.comment**: El token sale de `GITHUB_TOKEN` en el servidor, nunca del modelo ni del navegador. `comment` es escritura externa y siempre pide aprobación.
- **Reglas de permisos por patrón**: `shell.run`, `fs.write`/`fs.edit` y `fs.propose.*` aceptan reglas `allow`/`ask`/`deny` con `*` como comodín, y gana la última que coincide. `allow` ejecuta sin modal, `deny` bloquea antes de ejecutar y `ask` fuerza el modal; viven en el `localStorage` de la máquina, no en el repo.
- **API Keys**: Se envían por HTTPS al servidor embebido, nunca expuestas al público
- **Electron**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`

---

## 🧪 Tests

```bash
npm run test        # Vitest (unitarios + UI)
npm run test:watch  # Modo watch
npx playwright test # E2E
```
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

<a id="lm-studio"></a>

### `POST /api/lmstudio/generate`
Genera con LM Studio (Chat Completions) y **auto-carga el modelo si aún no está en memoria**.

**Body:**
```json
{
  "prompt": "string",
  "model": "qwen/qwen2.5-coder-14b",
  "systemInstruction": "string",
  "temperature": 0.7,
  "maxTokens": 2048,
  "contextLength": 32768,
  "host": "http://192.168.1.20:1234",
  "tools": [],
  "toolChoice": "auto"
}
```

- `model` acepta el id con o sin prefijo `lmstudio/`. Sin modelo se usa el `defaultModel` del proveedor; si tampoco hay, responde `{ "ok": false, "error": "Modelo requerido" }`.
- `host` es opcional. Se resuelve con la cadena de [hosts local y remoto](#lmstudio-hosts): el del body manda y, si no, se usa el primero que responda a una sonda cacheada 15 s; si ninguno responde, el primero configurado. Se normaliza a `/v1`.
- `contextLength` es el contexto que se pide al cargar. Si falta o no es válido, se usa el contexto publicado por el modelo (`max_context_length` o el de su instancia cargada).
- `tools` y `toolChoice` se reenvían sólo si hay tools. Las `tool_calls` de LM Studio se normalizan a `toolCalls: [{ id, name, args }]`.

**Response:**
```json
{
  "success": true,
  "text": "string",
  "toolCalls": [{ "id": "call_1", "name": "fs.read", "args": {} }],
  "metrics": {
    "promptTokens": 123,
    "responseTokens": 45,
    "totalTokens": 168,
    "latencyMs": 0
  }
}
```

En error responde `{ "ok": false, "error": "..." }`; si el fallo fue de carga, también queda registrado para el aviso.

#### Flujo de auto-carga

1. `ensureLmStudioModelLoaded(host, model, contextLength)` consulta el estado real del modelo:
   - primero `GET {root}/api/v0/models` (id exacto, incluye variantes como `@q8_0` y su `state`);
   - si v0 no está disponible o no trae el modelo, `GET {root}/api/v1/models` y busca el modelo en `loaded_instances`.
   - `loaded` y `unknown` no disparan carga: el chat puede resolverla por JIT. `loading` se trata como ya cargado para no lanzar una segunda carga.
2. Si el estado es `not-loaded`, registra la carga en memoria (`{ model, startedAt, contextLength? }`) y hace `POST {root}/api/v1/models/load` con `{ model, context_length? }`, con timeout de 5 minutos.
3. La generación **espera** a que termine la carga. Un 404 (versión sin endpoint de carga) o un 409/«already loaded» se consideran éxito y dejan que LM Studio cargue por JIT; cualquier otro fallo se devuelve y la ruta de generación lo guarda por modelo.
4. Al terminar, la entrada de carga se elimina y el siguiente sondeo del aviso ve `loading: false`.
5. Sólo entonces se llama a `POST {host}/chat/completions`.

#### Aviso de carga en la UI

`LmStudioLoadingNotice` se monta una vez en `App` y usa `useLmStudioLoading(selectedModel, busy)`:

- sólo consulta si el modelo empieza por `lmstudio/` y hay una generación o corrida en curso; en reposo no hace peticiones;
- sondea cada segundo y muestra el modelo, el cronómetro y el contexto solicitado (`Contexto 32K`, con los tokens exactos en el tooltip; `Contexto auto` si no se pidió una ventana);
- al ver `loading: false` deja de sondear y retira el aviso;
- al terminar la ejecución hace una última consulta para recoger un fallo que LM Studio hubiera reportado al final; si hay `error`, mantiene una alerta hasta que se descarte o se abra la configuración del proveedor;
- el fallo se guarda por modelo, así que cambiar de modelo no arrastra el error anterior.

### `GET /api/lmstudio/models`

Lista los modelos del LM Studio que responde, sin cargar ninguno. Es la fuente del selector de modelos y del botón «Probar» del gestor.

**Query opcional:** `?host=http://192.168.1.20:1234` — prueba ese host antes que los guardados.

**Response (LM Studio responde):**
```json
{
  "success": true,
  "models": ["qwen/qwen2.5-coder-14b", "deepseek-r1-distill-qwen-14b"],
  "host": "http://192.168.1.20:1234/v1"
}
```

Si responde pero no hay ningún modelo, añade `"warning": "LM Studio responde, pero no tiene modelos cargados."` y sigue siendo `success: true`.

**Response (ningún host responde):**
```json
{
  "success": false,
  "models": ["qwen/qwen2.5-coder-14b"],
  "cached": true,
  "updatedAt": "2026-11-06T18:00:00.000Z",
  "error": "No se pudo conectar a LM Studio en http://localhost:1234/v1. Comprueba el puerto 1234, que «Serve on Local Network» esté activo y el firewall."
}
```

- Siempre responde **200**: `success: false` significa «ninguno de los hosts contestó», no un error HTTP.
- `models` es la unión de las listas guardadas, empezando por la del host más reciente. Sin caché devuelve `[]` y `cached: false` (y omite `updatedAt`). La caché vive en `~/.config/commander/local-models.json` (o `COMMANDER_LOCAL_MODELS_CACHE`), por proveedor y host normalizado, y sólo guarda ids: una respuesta vacía no borra la lista anterior.
- La sonda pide en paralelo `GET {host}/models` (OpenAI) y `GET {raíz}/api/v0/models` (nativa), con 7 s por petición, y une los ids de las que respondan. Así funciona también con versiones que sólo tienen una de las dos rutas.

### `POST /api/lmstudio/models`

Igual que el `GET`, pero permite probar un host que aún no está guardado (lo que hace el botón «Probar» del gestor). No persiste la configuración del host: sólo lo prueba y, si responde, recuerda sus modelos en la caché por host.

**Body:**
```json
{ "host": "http://192.168.1.20:1234" }
```

`host` es opcional; si falta, se resuelve igual que en el `GET`. La respuesta es la misma en ambos casos.

<a id="lmstudio-hosts"></a>

### Hosts local y remoto

LM Studio puede correr en este equipo (`localHost`) o en otro de la red (`host`, normalmente el de casa). La app no obliga a elegir: prueba los hosts configurados en orden y usa el primero que responda, así que al mover el portátil sigue funcionando sin editar nada.

**Orden de resolución** (cada valor se normaliza y se eliminan duplicados):

1. `host` del body (sólo en `POST /api/lmstudio/models` y `POST /api/lmstudio/generate`).
2. `?host` de la query.
3. `LMSTUDIO_HOST` guardado como API key en la cookie httpOnly de la sesión (lo escribe el modal de modelos locales).
4. `LMSTUDIO_HOST` del entorno del servidor.
5. `providers.lmstudio.localHost` de `commander.json`.
6. `providers.lmstudio.host` de `commander.json`.
7. `http://localhost:1234/v1`.

`normalizeLmStudioHost` acepta `192.168.1.20:1234`, `http://192.168.1.20:1234` o `http://192.168.1.20:1234/v1`: añade `http://` si falta el esquema y `/v1` si la ruta no termina en `/vN`. El resolver sondea cada host con 1,2 s de timeout y cachea el resultado 15 s; devuelve el primero que responda y, si ninguno lo hace, el primero de la lista (el más específico). Ese es el host que usan `POST /api/lmstudio/generate` y `GET/POST /api/lmstudio/models`; `GET /api/providers` lo muestra como `host` del proveedor.

- **Local:** `http://localhost:1234/v1` (o `127.0.0.1`/`[::1]`). En el gestor de proveedores es el campo **local**.
- **Remoto:** la IP del otro equipo en la LAN, por ejemplo `http://192.168.1.20:1234`; en su LM Studio activa **Serve on Local Network** y abre el puerto 1234 en el firewall. En el gestor es el campo **remoto**.
- Si el remoto está apagado o fuera de la red, la sonda cae en el local sin borrar la configuración. Si ambos responden y no hay un host explícito (body, query o `LMSTUDIO_HOST`), gana `localHost` porque va antes en el orden. Para fijar uno, usa `LMSTUDIO_HOST` (cookie o entorno), que tiene prioridad sobre ambos campos; para una prueba puntual sin guardar, usa `?host` o el `host` del body.

La configuración vive en `commander.json`:

```json
{
  "providers": {
    "lmstudio": {
      "host": "http://192.168.1.20:1234/v1",
      "localHost": "http://localhost:1234/v1"
    }
  }
}
```

### `GET /api/lmstudio/loading`
Estado que consume el aviso. No se cachea (`Cache-Control: no-store`).

**Query:** `?model=<id>` (con o sin `lmstudio/`; vacío devuelve cualquier carga en curso).

**Carga en curso:**
```json
{
  "success": true,
  "loading": true,
  "model": "qwen/qwen2.5-coder-14b",
  "startedAt": 1760000000000,
  "contextLength": 32768
}
```

**Sin carga y sin fallo reciente:**
```json
{ "success": true, "loading": false }
```

**Sin carga, con fallo reciente:**
```json
{
  "success": true,
  "loading": false,
  "model": "qwen/qwen2.5-coder-14b",
  "error": "No se pudo cargar el modelo ...",
  "failedAt": 1760000000000
}
```

- `contextLength` es la ventana que se envió a `/api/v1/models/load`; si no se envió, se omite y la UI muestra `Contexto auto`.
- El error se conserva 2 minutos por modelo y se borra al empezar un intento nuevo. Es estado en memoria del servidor: se pierde al reiniciarlo.
- Siempre responde 200 con `success: true`; un LM Studio caído no convierte este sondeo en error, simplemente no hay carga que anunciar.

**`startedAt` y cronómetro**

- `startedAt` es el instante (epoch en milisegundos) en que el servidor registró la carga, justo antes de `POST /api/v1/models/load`. No es el momento en que LM Studio empieza a cargar. Sólo viaja con `loading: true`; las respuestas sin carga no lo incluyen y el fallo usa `failedAt`.
- Cada intento de carga tiene su propio `startedAt`. La UI lo usa como origen del contador, así que si llega a una carga ya iniciada muestra el tiempo real transcurrido, no un contador desde que abrió el aviso.
- Si el campo falta (servidor antiguo) o no es un número finito mayor que 0, la UI usa el instante de la primera respuesta con `loading: true` y lo conserva mientras dure esa carga.
- Con el aviso visible, el cronómetro se repinta cada segundo y calcula `max(0, floor((Date.now() - startedAt) / 1000))`. Muestra `Ns` hasta 59 s y `Xm SSs` desde el primer minuto (por ejemplo, `1m 05s`).
- El texto que cambia cada segundo lleva `aria-hidden="true"` para que el lector de pantalla no anuncie cada tick; el aviso sigue siendo `role="status"` con `aria-live="polite"`.
- Al recibir `loading: false`, el cronómetro se retira con el aviso. Un fallo reciente se muestra como alerta con su mensaje, sin contador; un intento nuevo empieza de cero con su nuevo `startedAt`.

**Pruebas:** `tests/wiredRoutes.test.ts` cubre la carga en curso, su apagado, el contexto solicitado y el error del último intento; `tests/ui/LmStudioLoadingNotice.test.tsx` cubre el aviso, el cronómetro, el contexto, su desaparición y el error.

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
- `read_diagnostics` — Leer diagnósticos del proyecto: `tsc` si hay `tsconfig.json` y, además, Python (`pyright`), Go (`go vet`) o Rust (`cargo check`) según los marcadores de la raíz (`pyproject.toml`, `go.mod`, `Cargo.toml`). `path` filtra a un archivo. `data.languages` dice qué se detectó y qué herramienta faltaba; una herramienta ausente es una nota, nunca un error.
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

## 🔌 Endpoints de Plugins

Un plugin instalado desde la UI vive como manifiesto en `.commander/plugins/<id>.manifest.json`; el runtime ejecuta además `.commander/plugins/<id>/index.js`.

### `GET /api/plugins?root=`
Lista los manifiestos instalados: `{success, plugins: [{id, name, version, entr}]}`.

### `POST /api/plugins`
**Body:** `{id, name?, version?, entrypoint?, root?}`. El `id` es un nombre de archivo (`[A-Za-z0-9._-]`, sin `..`); cualquier otra cosa responde 400.

### `DELETE /api/plugins/:id?root=`
Borra el manifiesto y el `.zip` del plugin, con el mismo filtro de `id`.

### Hooks del runtime
`beforeTool(ctx)` y `afterTool(ctx)` en `.commander/plugins/<id>/index.js` (ESM). `beforeTool` devuelve `{input}` para reemplazar la entrada; `afterTool` devuelve `{result}`. `ctx` incluye `toolId`, `input`, `root` y, en `afterTool`, `result`. Si un hook lanza, la tool se ejecuta igual y el fallo aparece en `data.pluginErrors`.

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

<a id="backend-multiinquilino"></a>

## 🧱 Backend multiinquilino

Base URL: `/api/backend`. Es un backend local separado de `studio.db`; no
depende de Firebase ni de un proveedor externo. Cada registro crea un inquilino
con su usuario propietario y todas las consultas se filtran por el `tenant_id`
de la sesión. La base y el storage se pueden mover con
`COMMANDER_TENANT_DB_PATH` y `COMMANDER_TENANT_STORAGE_DIR` (por defecto
`.commander/tenants.db` y `.commander/tenant-storage`).

### Sesión

Todas las rutas salvo registro y login exigen:

```http
Authorization: Bearer <token>
```

#### `POST /api/backend/auth/register`

**Body:**
```json
{
  "email": "ana@example.com",
  "password": "mínimo 8 caracteres",
  "name": "Ana",
  "tenantName": "Equipo de Ana"
}
```

`tenantName` es opcional. **Response `201`:**
```json
{
  "success": true,
  "token": "token-opaco",
  "expiresAt": 1760000000000,
  "user": {"id": "…", "email": "ana@example.com", "name": "Ana", "createdAt": "2026-11-07T…"},
  "tenant": {"id": "…", "name": "Equipo de Ana"}
}
```

El email se normaliza a minúsculas y es único globalmente; repetirlo responde
`409`. Contraseña corta o email inválido responden `400`.

#### `POST /api/backend/auth/login`

**Body:** `{"email": "ana@example.com", "password": "…"}`. Devuelve el mismo
sobre de sesión que el registro. Credenciales incorrectas: `401`.

#### `POST /api/backend/auth/logout`

Invalida el token de la cabecera. **Response:** `{"success": true}`.

#### `GET /api/backend/auth/me`

**Response:** `{success, user: {id, email, name}, tenant: {id, name}}`.

Los tokens son aleatorios de 32 bytes, se guardan sólo como SHA-256 y caducan a
los 30 días. Las contraseñas usan `scrypt` con salt aleatorio.

### Registros

#### `GET /api/backend/records`

Lista sólo los registros del inquilino de la sesión, ordenados por actualización:
```json
{"success": true, "records": [{"id": "…", "title": "…", "body": "…", "createdAt": "…", "updatedAt": "…"}]}
```

#### `POST /api/backend/records`

**Body:** `{"title": "…", "body": "…"}`. `title` es obligatorio (máx. 200
caracteres); `body` es opcional (máx. 100 000). **Response `201`:**
`{success, record}`.

#### `GET /api/backend/records/:id`

Devuelve el registro propio o `404` si no existe. Un registro de otro inquilino
responde `403`.

#### `PATCH /api/backend/records/:id`

**Body:** `{"title"?: "…", "body"?: "…"}`. Actualiza sólo los campos enviados.

#### `DELETE /api/backend/records/:id`

Borra el registro propio. **Response:** `204`.

Los recursos no incluyen `tenantId` en la respuesta y cualquier `tenantId` que
mande el cliente se ignora.

### Archivos

#### `GET /api/backend/files`

Lista los metadatos del inquilino: `{success, files: [{id, name, mime, size, createdAt}]}`.

#### `POST /api/backend/files`

El cuerpo es el binario, no JSON:

```http
Content-Type: application/octet-stream
X-Commander-File-Name: informe.pdf

<bytes>
```

`X-Commander-File-Name` es opcional (por defecto `archivo.bin`). El nombre se
sanitiza y se guarda sólo como metadato; el archivo físico usa un UUID. Límite:
10 MiB; un cuerpo mayor responde `413`, uno vacío `400`. **Response `201`:**
`{success, file: {id, name, mime, size, createdAt}}`.

#### `GET /api/backend/files/:id`

Devuelve el binario con su `Content-Type`, `Content-Length` y
`Content-Disposition: attachment`. Un archivo de otro inquilino responde `403`;
uno inexistente, `404`.

#### `DELETE /api/backend/files/:id`

Borra el archivo y sus metadatos. **Response:** `204`.

### Errores y aislamiento

- `401`: falta el bearer o la sesión no es válida/caducó.
- `403`: el recurso pertenece a otro inquilino.
- `404`: el recurso no existe.
- `409`: el email ya está registrado.
- `413`: el archivo supera el límite.
- Todas las respuestas llevan `Cache-Control: no-store`.

El servidor obtiene `tenant_id` y `user_id` de la sesión, nunca del cliente. Los
bytes se guardan bajo `<storage>/<tenant>/<uuid>` con permisos de archivo
restringidos; un nombre como `../../x` no puede escapar del storage. La suite
`tests/tenantBackend.test.ts` verifica 401, aislamiento entre dos cuentas, 403
cruzado, login/logout y el ciclo de vida de registros y archivos.

---

## 🧠 Sesiones de agente (contrato v2)

Todo evento de sesión —el NDJSON de `commander agent --json`, el SSE y la
TUI— usa el mismo sobre:

```json
{"schemaVersion":2,"seq":12,"sessionId":"sess_ab12cd34","type":"tool_call","tool":"fs.read","input":{"path":"README.md"}}
```

- `seq` es estrictamente creciente **por sesión**: empieza en 1 y la línea
  final `done` consume el siguiente.
- `type` documentados: `session`, `status`, `chunk`, `thought`, `tool_call`,
  `tool_result`, `plan`, `approval_request`, `approval_result`, `question`,
  `answer`, `error`, `done`.
- La lectura es tolerante: los campos y los `type` desconocidos se ignoran, y
  `decodeEvent` devuelve `null` para una línea ilegible en vez de lanzar.

`SessionStateV2` es el estado persistido y el que devuelve
`GET /api/agent/sessions/:id`:

```json
{
  "schemaVersion": 2,
  "id": "sess_ab12cd34",
  "goal": "arreglar el faro",
  "cwd": "/proyecto",
  "model": "custom/mi-modelo",
  "mode": "build",
  "status": "completed",
  "turns": [{"role": "user", "text": "…", "ts": 1700000000000}],
  "steps": [{"id": "step_1", "type": "thought", "title": "…", "content": "…", "status": "completed", "ts": 1700000000000}],
  "plan": [{"id": "p1", "text": "…", "status": "in_progress", "files": ["src/a.ts"], "criteria": "…", "done": false}],
  "pendingApproval": null,
  "createdAt": 1700000000000,
  "updatedAt": 1700000001000,
  "answer": "…"
}
```

`status` es `idle | running | completed | failed | cancelled`. Los estados
legados del servidor se migran al leer: `done` → `completed`, `error` →
`failed`, `stopped` → `cancelled`.

### Plan (`SessionStateV2.plan` y evento `plan`)

`plan` es una lista ordenada de pasos. `status` es la fuente de verdad y vale
`pending | in_progress | done | blocked`; `done` es derivado (`true` sólo con
`status: "done"`) y se conserva por compatibilidad. `text` se recorta a 160
caracteres y cada paso puede incluir `files` (máximo 20 rutas, sin duplicados y
300 caracteres por ruta) y `criteria` (máximo 500 caracteres).

`update_plan` acepta la lista completa o parciales `{id, status}` (o
`{id, done}`) para actualizar un paso existente sin repetir su texto; un parcial
conserva `text`, `files` y `criteria` si no los reenvía. Los pasos nuevos sin
`status` nacen `pending`; el plan se limita a 20 pasos, se descartan las entradas
sin texto ni `id` conocido, los `id` repetidos se ignoran a partir del primero y
un valor que no sea un array no borra el plan actual. Un plan legado con
`done: true/false` se migra a `done`/`pending` al leerlo. El estado completo se
devuelve en `GET /api/agent/sessions/:id` y el evento `plan` lleva el mismo array.

### `POST /api/agent/sessions`

Crea la sesión. Sin `run` mantiene el comportamiento histórico: es un contexto
padre para subagentes y no arranca (`status: "idle"`).

```json
{
  "goal": "arreglar el faro",
  "cwd": "/proyecto",
  "model": "custom/test",
  "mode": "build",
  "maxSteps": 20,
  "run": true,
  "persist": true,
  "approvalTimeoutMs": 300000,
  "keys": {
    "CUSTOM_BASE_URL": "http://127.0.0.1:1234/v1",
    "CUSTOM_API_KEY": "…",
    "CUSTOM_MODEL": "mi-modelo"
  }
}
```

`run: true` la arranca y la persiste. `persist: true` sólo la persiste.
`approvalTimeoutMs` es opcional (50–300000 ms; por defecto 300000) y acorta la
espera de una aprobación, útil para pruebas y clientes que quieren un timeout
propio. **Response 200:** `{success, session: {id, goal, cwd, model, status},
state}`. `400` si falta `goal`, supera 2000 caracteres o el `cwd` no está
permitido.

### `GET /api/agent/sessions/:id`

Carga lazy desde disco y devuelve el estado completo. **Response 200:**
`{success, running, state}`; `running` es `true` sólo si el bucle autoritativo
del servidor está en vuelo (un `status: "running"` de un CLI interrumpido no
cuenta). `400` con un id inválido (por ejemplo `..` o `a/b`) y `404` si no
existe. Nunca arranca la sesión sola.

### `GET /api/agent/sessions/:id/stream`

SSE reanudable de la sesión. El cursor se pasa con `Last-Event-ID` (cabecera)
o `?after=<seq>`; si vienen ambos, manda el query. Cada evento normal lleva
`id: <seq>` y `data` con el `CliEventV2` completo.

- Buffer en memoria de los últimos 1.000 eventos por sesión.
- Si el cursor fue desalojado, o la sesión se cargó de disco sin buffer, se
  emite `event: resync` con el `SessionStateV2` completo y el `id` del último
  `seq`.
- Keep-alive cada 15 s mediante un comentario SSE (`: keep-alive`).
- Al cancelar, borrar o terminar la corrida se emite `event: gone`
  (`{sessionId, reason}`) y se cierra limpiamente.
- `404` antes de abrir el stream si la sesión no existe; `400` con un id o un
  cursor inválido. Desconectar al cliente no detiene la corrida del servidor.

### `POST /api/agent/sessions/:id/message`

**Body:** `{"text": "…"}`. Añade un turno de usuario y arranca el bucle.
**Response 202:** `{success, state}`. `409` si la sesión ya está en ejecución
(dos peticiones concurrentes no pueden duplicar pasos); `400`/`404` como en
`GET`.

### `POST /api/agent/sessions/:id/approvals/:approvalId`

Resuelve una aprobación pendiente. El bucle del servidor se detiene antes de
ejecutar una tool peligrosa y publica el `ApprovalRequestV2` en
`state.pendingApproval` y en el evento SSE `approval_request`:

```json
{
  "id": "apr_ab12cd34",
  "sessionId": "sess_ab12cd34",
  "tool": "fs.write",
  "input": {"path": "nota.txt", "content": "…"},
  "diff": "--- a/nota.txt\n+++ b/nota.txt\n@@ …",
  "createdAt": 1700000000000,
  "expiresAt": 1700000300000
}
```

`input` se redacta (claves y valores con tokens habituales) y `diff`/`hunks`
sólo se calculan para escrituras dentro del proyecto. **Body:**
`{"decision":"allow"|"deny"|"allow-session","reason":"…"}`.

- `allow` ejecuta la tool; `deny` la omite y la corrida continúa. La decisión
  queda en el paso `tool_result` como `approval: {id, decision, reason?}`.
- `allow-session` añade una regla en memoria para ese `tool` + patrón (el
  comando de `shell.run`, la ruta relativa de `fs.write`/`fs.edit` o el PR de
  `github.comment`). No se escribe en disco y no afecta a otra sesión.
- El timeout (5 min por defecto) resuelve `deny` con `reason: "timeout"`.
  Cancelar, borrar o fallar la sesión deniega todas las pendientes con
  `reason: "cancelled"`, `"failed"` o `"timeout"`.
- Repetir la misma decisión responde `200` con el mismo cuerpo; una decisión
  distinta sobre una ya resuelta responde `409`. Una aprobación desconocida
  responde `404` y una decisión inválida `400`. Los errores no incluyen tokens
  ni rutas fuera del proyecto.

Si el servidor se reinicia con aprobaciones pendientes, el `GET` las sigue
mostrando mientras no venza su `expiresAt` (también en `pendingApprovals`
cuando hay más de una). Decidir después del reinicio no ejecuta la llamada
vieja: la decisión queda como permiso o denegación de un solo uso, atado a la
misma `tool` + `input` exactos. Si la sesión se reanuda y el modelo repite esa
llamada, se aplica una vez; si no la repite, no se ejecuta nada. Las que
vencieron durante la caída se cierran como `deny` con `reason: "timeout"` y se
borran del estado. `allow-session` sigue siendo una regla en memoria del
proceso: no se persiste.

El bucle pide aprobación para toda escritura (`fs.write`, `fs.edit`,
`git.commit`), `github.comment`, las tools con `danger` y `shell.run` cuando el
comando no está en la allowlist. Las lecturas no preguntan.

### `POST /api/agent/sessions/:id/fork`

Bifurca la sesión. Copia historial, pasos y plan en una sesión nueva con id
propio, `status: "idle"` y sin `answer`/`error`; la fuente no se modifica.

**Body opcional:** `{"text": "…", "run": false}`. `text` añade el primer turno
de la copia y `run: true` arranca su bucle (si no, queda lista para un
`message`). **Response 201:** `{success, session, state}`. `409` si la fuente
está ejecutándose, `404` si no existe y `400` con un id inválido o un `text`
demasiado largo.

### `PUT /api/agent/sessions/:id/state`

Checkpoint de una corrida que ejecuta el bucle en el cliente (el CLI conserva
así el streaming). **Body:** `{"state": SessionStateV2}` con el mismo `id`.
Sólo se reemplazan turnos, pasos, plan, estado y respuesta; el objetivo, cwd y
modelo de la sesión no cambian. **Response 200:** `{success, state}`. `409` si
el bucle autoritativo del servidor está en marcha, `400` si el estado es
inválido o de otra sesión.

### `POST /api/agent/sessions/:id/cancel`

Para la sesión autoritativa y sus subagentes. **Response 200:**
`{success, cancelled, ids, jobsStopped, ptysClosed, parentCancelled}`.

### `DELETE /api/agent/sessions/:id`

Quita la sesión de memoria y borra su archivo de estado; un `GET` posterior
responde `404`.

### Persistencia y límites

- Un archivo por sesión en `.commander/agent-sessions/<id>.json` (se puede
  cambiar con `COMMANDER_AGENT_SESSIONS_DIR`), con `schemaVersion: 2`.
- Escritura write-through atómica: `tmp` + `rename`, nunca un JSON a medias.
- 50 sesiones (se borran las de mtime más viejo), 200 pasos y 2 MB por archivo.
  Al recortar por tamaño se descartan pasos y turnos antiguos, y el JSON sigue
  siendo válido.

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
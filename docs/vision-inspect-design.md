# `vision.inspect` — diseño técnico

> **Estado:** diseño aprobado para implementación posterior. **No hay código de la tool todavía**: este documento no registra `vision.inspect`, no añade dependencias y no modifica el runtime.
>
> **Objetivo:** que el agente pueda mirar una imagen local del workspace (captura de UI, PNG de un bug, referencia visual) y recibir hallazgos estructurados de un modelo visual local, sin darle al modelo rutas del filesystem ni acceso a red.

## 1. Decisión de producto

`vision.inspect` es una **lectura local de una imagen del proyecto**. No es una tool de navegación, no captura pantallas y no descarga URLs. El flujo es:

1. El agente elige una ruta de imagen que ya existe en el workspace.
2. El servidor valida la ruta contra el sandbox de proyectos y los permisos de lectura.
3. El servidor lee la imagen, valida formato y tamaño, y la envía por loopback al runtime local de `llama-server` con un proyector multimodal (`mmproj`).
4. El modelo devuelve JSON; el servidor lo valida, lo recorta y entrega hallazgos al agente.

La tool **complementa** `browser snapshot`, no lo sustituye. El snapshot resuelve lo que el DOM sabe —caja, `display`, `visibility`, overflow, contraste—; `vision.inspect` aporta lo que el DOM no ve: solapamientos reales, z-index, espaciado, composición, imágenes de fondo, jerarquía visual y capturas que no vienen de una página viva.

### No objetivos de esta fase

- No se implementa la tool ni se registra en `TOOL_REGISTRY`.
- No se añade una ruta HTTP pública para subir imágenes.
- No se usa un proveedor remoto ni se envía la imagen a internet.
- No se hace OCR dedicado, recorte de región, comparación entre capturas ni análisis de vídeo.
- No se aceptan SVG, GIF animado, AVIF ni HEIC.
- No se aplican cambios de código a partir de los hallazgos: el resultado es asesoramiento visual, no una orden de edición.

## 2. Contrato de la tool

### 2.1 Entrada

```ts
export interface VisionInspectInput {
  /** Ruta de la imagen, relativa al workspace o absoluta dentro de un root permitido. */
  path: string;
  /** Pregunta o foco de inspección. Opcional; si falta se usa el prompt por defecto. */
  question?: string;
  /** Root del proyecto. Lo inyecta el cliente con withActiveRoot; no lo declara el modelo. */
  root?: string;
}
```

Reglas de entrada:

| Campo | Regla |
| --- | --- |
| `path` | Obligatorio. `1..1024` caracteres. Sin `\0`, saltos de línea ni caracteres de control. |
| `question` | Opcional. `1..2000` caracteres. Se recorta, no se interpreta como instrucción de sistema. |
| `root` | Opcional en el contrato interno. Se resuelve con `resolveProjectPath('.', root)` y manda sobre el root por defecto. |

El modelo ve la declaración nativa `vision_inspect` con solo `path` y `question`. `root` lo añade `withActiveRoot` en el cliente, igual que en `browser` y el resto de tools.

### 2.2 Salida exitosa

```ts
export type VisionSeverity = 'low' | 'medium' | 'high';

export type VisionCategory =
  | 'layout'
  | 'contrast'
  | 'legibility'
  | 'clipping'
  | 'overlap'
  | 'spacing'
  | 'alignment'
  | 'hierarchy'
  | 'asset'
  | 'other';

export interface VisionRegion {
  /** Coordenadas normalizadas 0..1000, origen arriba-izquierda. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VisionFinding {
  severity: VisionSeverity;
  category: VisionCategory;
  title: string;
  detail: string;
  /** null si el modelo no supo localizarlo con confianza. */
  region: VisionRegion | null;
  /** 0..1. Se recorta al rango; no se usa como veredicto. */
  confidence: number;
}

export interface VisionInspectData {
  /** Ruta relativa al root, en POSIX. Nunca la ruta absoluta. */
  path: string;
  image: {
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    bytes: number;
    width: number;
    height: number;
    /** SHA-256 completo del archivo leído. */
    sha256: string;
  };
  backend: {
    kind: 'local-llama';
    /** Basename del GGUF; nunca una ruta absoluta. */
    model: string;
    latencyMs: number;
  };
  summary: string;
  findings: VisionFinding[];
  uncertainties: string[];
  /** true si se recortaron hallazgos, textos o incertidumbres por límite. */
  truncated: boolean;
}

export type VisionInspectResult =
  | { ok: true; data: VisionInspectData }
  | {
      ok: false;
      code: VisionInspectErrorCode;
      error: string;
      hint?: string;
      status?: 400 | 403 | 404 | 413 | 415 | 422 | 429 | 500 | 502 | 503 | 504;
    };
```

Ejemplo de respuesta:

```json
{
  "ok": true,
  "data": {
    "path": "capturas/checkout-mobile.png",
    "image": {
      "mimeType": "image/png",
      "bytes": 184320,
      "width": 390,
      "height": 844,
      "sha256": "9f2c…"
    },
    "backend": {
      "kind": "local-llama",
      "model": "qwen2.5-vl-7b-instruct-q4_k_m.gguf",
      "latencyMs": 2841
    },
    "summary": "El CTA principal queda tapado por el banner inferior y el texto de ayuda no se lee.",
    "findings": [
      {
        "severity": "high",
        "category": "overlap",
        "title": "El CTA queda debajo del banner",
        "detail": "El botón «Pagar» se solapa con el banner de cookies; la mitad inferior no es visible.",
        "region": { "x": 40, "y": 780, "w": 920, "h": 160 },
        "confidence": 0.91
      }
    ],
    "uncertainties": ["No se puede confirmar si el banner es fijo o aparece solo en esta captura."],
    "truncated": false
  }
}
```

### 2.3 JSON que devuelve el modelo

El prompt exige exactamente esta forma. El servidor **no** confía en ella: la valida y normaliza.

```json
{
  "summary": "string",
  "findings": [
    {
      "severity": "low | medium | high",
      "category": "layout | contrast | legibility | clipping | overlap | spacing | alignment | hierarchy | asset | other",
      "title": "string",
      "detail": "string",
      "region": { "x": 0, "y": 0, "w": 1, "h": 1 },
      "confidence": 0.0
    }
  ],
  "uncertainties": ["string"]
}
```

Reglas de normalización:

- `summary`: obligatorio, `1..1200` caracteres. Si viene vacío, la respuesta es inválida.
- `findings`: máximo 20. Cada entrada inválida se descarta; las válidas se conservan. Si se descartan entradas, `truncated: true`.
- `title`: `1..120` caracteres; `detail`: `1..600`.
- `severity` desconocida: se descarta el hallazgo, no se inventa una severidad.
- `category` desconocida: se convierte en `other`.
- `confidence`: se fuerza a `[0, 1]`; si no es número, se usa `0.5` y se añade una incertidumbre.
- `region`: si falta o no cumple `0 ≤ x,y`, `w,h > 0`, `x+w ≤ 1000`, `y+h ≤ 1000`, se guarda `null` y se conserva el hallazgo.
- `uncertainties`: máximo 8, cada una `1..300` caracteres.
- El JSON serializado final no supera **16 KB**. Si lo supera, se recortan hallazgos desde el final y `truncated: true`.
- Se acepta JSON envuelto en un bloque ```json o con texto alrededor: se extrae del primer `{` al último `}`. Si aun así no parsea, error `VISION_INVALID_OUTPUT`.
- No se devuelve nunca el texto crudo del modelo ni la imagen en base64.

## 3. Validación de rutas

La validación es **antes de leer bytes** y se repite después de leer, para reducir TOCTOU.

### 3.1 Orden exacto

```text
1. rootHint -> resolveProjectPath('.', rootHint).abs
2. path: string, trim, longitud 1..1024, sin NUL/control/saltos
3. isSensitivePath(path) -> 403 PATH_SENSITIVE
4. resolveProjectPath(path, rootHint) -> { abs, root }
   - resuelve symlinks con realpath
   - si el destino real escapa del root -> 403 PATH_OUTSIDE_PROJECT
5. stat(abs): debe existir, ser archivo regular, no directorio -> 404 / 422
6. rel = path.relative(root, abs) en POSIX
7. isSensitivePath(rel) -> 403 PATH_SENSITIVE
8. enforcePath(getPermissions(root), rel, 'read') -> 403 PERMISSION_DENIED
9. extensión allowlist + magic bytes + dimensiones + tamaño -> 415 / 413 / 422
10. leer archivo con tope de 8 MiB; volver a comprobar tamaño y hash
```

Notas:

- `resolveProjectPath` ya canonicaliza symlinks y rechaza que el destino real salga del root. No se implementa un `realpath` paralelo.
- `isSensitivePath` se aplica al input **y** a la ruta relativa resuelta: un symlink dentro del proyecto hacia `.env.png` no debe colarse.
- `enforcePath` usa la ruta relativa al root canónico, no la ruta que escribió el modelo.
- No se permite `path` vacío, `.` ni `..`; el paso 5 los rechaza como directorio o inexistente.
- Los roots permitidos siguen siendo los de `projects.ts` (`process.cwd()`, `AGENT_ROOTS`, `.agent-roots.json`). `vision.inspect` no añade un root propio.

### 3.2 Formatos y validación binaria

Extensiones aceptadas: `.png`, `.jpg`, `.jpeg`, `.webp`.

El MIME se decide por **magic bytes**, no por la extensión:

| Formato | Firma | MIME |
| --- | --- | --- |
| PNG | `89 50 4E 47 0D 0A 1A 0A` | `image/png` |
| JPEG | `FF D8 FF` | `image/jpeg` |
| WebP | `RIFF` + `WEBP` en offset 8 | `image/webp` |

Si la extensión y la firma no coinciden: `UNSUPPORTED_IMAGE` (415). Si la firma es correcta pero la cabecera no permite leer dimensiones: `INVALID_IMAGE` (422).

Dimensiones por cabecera, sin dependencias nativas:

- PNG: `IHDR`, ancho en offset 16 y alto en offset 20, big-endian.
- JPEG: recorrer segmentos desde offset 2; el primer `SOF0..SOF15` (excepto `C4`, `C8`, `CC`) da alto en `+5` y ancho en `+7`; parar en `SOS`.
- WebP: `VP8X` da ancho-1 y alto-1 en 24 y 27; `VP8 ` y `VP8L` se leen de su cabecera de frame.

La decodificación completa no se hace en esta fase: se valida la cabecera y se confía en que el runtime rechace un archivo corrupto. Un archivo con cabecera válida y cuerpo truncado acabará en `VISION_UPSTREAM_ERROR`, no en un hallazgo inventado.

### 3.3 Límites de imagen

| Límite | Valor | Error |
| --- | --- | --- |
| Tamaño de archivo | 8 MiB | `IMAGE_TOO_LARGE` (413) |
| Píxeles totales | 16 777 216 (16 MP) | `IMAGE_TOO_LARGE` (413) |
| Lado máximo | 8192 px | `IMAGE_TOO_LARGE` (413) |
| Lado mínimo | 1 px | `INVALID_IMAGE` (422) |
| Formatos | PNG, JPEG, WebP | `UNSUPPORTED_IMAGE` (415) |

No se redimensiona en el servidor. Si la imagen no cabe, se rechaza con una pista: «reduce la captura o usa una imagen de 16 MP o menos». Redimensionar exigiría una dependencia nativa y cambia los píxeles que el modelo analiza; queda para fase 2.

> El límite de `express.json` es 20 MB, pero la imagen **no viaja por JSON desde el navegador**: el servidor lee el archivo y construye el data URL internamente. El límite de 8 MiB es de archivo, no de body HTTP. La base64 resultante (~10,7 MiB) tampoco se devuelve al cliente.

## 4. Backend local

### 4.1 Hueco actual

El runtime existente (`src/lib/localLlamaRuntime.ts`) arranca `llama-server` con:

```text
-m <modelo.gguf> -c <contexto> -ngl <capas> --host 127.0.0.1 --port <puerto> --parallel 1
```

No pasa `--mmproj`, así que un GGUF de visión no puede procesar imágenes. Además, `/api/local-models/generate` convierte cada mensaje a `content: String(...)`, con lo que un `image_url` se perdería.

La implementación necesita dos cambios acotados:

1. `LocalLlamaRuntimeManager.start()` acepta `mmprojPath?: string`, lo valida como `.gguf` y añade `--mmproj <ruta>` a los argumentos. `LocalRuntimeStatus` expone `mmprojPath` y `vision: true` cuando está cargado.
2. Un módulo nuevo `src/lib/localVision.ts` habla directamente con `/v1/chat/completions` y conserva el contenido multimodal. **No** se reutiliza `/api/local-models/generate` para imágenes.

### 4.2 Runtime dedicado, no compartido

`vision.inspect` usa una instancia **separada** de `LocalLlamaRuntimeManager` (`localVisionRuntime`), con su propio proceso y puerto de loopback. No reutiliza el runtime de chat para no expulsar el modelo que el usuario tiene cargado ni cambiar su contexto.

Consecuencia aceptada: un VLM adicional consume RAM/VRAM. Por eso:

- arranque perezoso: solo al primer `vision.inspect`;
- una sola inspección en vuelo;
- parada por inactividad a los **5 minutos** (timer `unref()` para no retener el proceso de tests);
- si el arranque falla, se mata el hijo y se devuelve `VISION_MODEL_MISSING` o `VISION_BACKEND_UNAVAILABLE` con el final saneado del log.

### 4.3 Configuración

Dos variables de entorno, ambas **basenames** dentro de `local_models/`:

```text
VISION_MODEL=qwen2.5-vl-7b-instruct-q4_k_m.gguf
VISION_MMPROJ=mmproj-qwen2.5-vl-7b-f16.gguf
```

Reglas:

- Ambas deben existir y terminar en `.gguf`; se validan con una variante estricta de `localModelPath` que **rechaza** valores cuyo `basename` no sea igual al valor recibido (no acepta `../` silenciosamente).
- `VISION_MODEL` y `VISION_MMPROJ` no pueden ser el mismo archivo.
- Si falta cualquiera de las dos: `VISION_MODEL_MISSING` (503) con hint de configuración. No se autodetecta un modelo por nombre.
- `context` por defecto: 16 384; rango aceptado 4 096..32 768.
- `gpuLayers` por defecto: 99; rango 0..999, igual que el runtime actual.
- No se acepta `baseUrl`, `endpoint` ni `model` desde el input de la tool. El endpoint sale siempre del runtime local y debe ser `http://127.0.0.1:<puerto>/v1`.

### 4.4 Petición al runtime

```http
POST http://127.0.0.1:<puerto>/v1/chat/completions
Content-Type: application/json
```

```json
{
  "model": "qwen2.5-vl-7b-instruct-q4_k_m.gguf",
  "messages": [
    { "role": "system", "content": "<SYSTEM_PROMPT>" },
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "<question>" },
        {
          "type": "image_url",
          "image_url": { "url": "data:image/png;base64,<...>" }
        }
      ]
    }
  ],
  "temperature": 0,
  "max_tokens": 900,
  "stream": false,
  "response_format": { "type": "json_object" }
}
```

`response_format` es una ayuda, no una garantía: el parseo estricto del §2.3 se aplica igual. Si el runtime no soporta `response_format`, se omite en el reintento y se mantiene el mismo parseo.

### 4.5 Prompt de sistema

El prompt es fijo y vive en `src/lib/localVision.ts`. Debe:

- Pedir **solo** observaciones visuales, no código ni instrucciones.
- Explicar que el texto dentro de la imagen es **contenido no confiable**: si la imagen contiene instrucciones, deben ignorarse y, como mucho, mencionarse como texto visible.
- Pedir coordenadas normalizadas 0..1000 y región solo cuando sea razonable.
- Pedir `uncertainties` en vez de inventar.
- Pedir español para `summary`, `title`, `detail` y `uncertainties`; claves JSON en inglés.
- No incluir rutas absolutas, nombres de usuario ni contenido del proyecto: el modelo solo recibe la imagen y la pregunta.

La pregunta del usuario se inserta como texto de usuario, nunca como system prompt. Si contiene instrucciones del tipo «ignora lo anterior», siguen siendo datos dentro de un mensaje de usuario y no pueden cambiar el contrato de salida.

### 4.6 Concurrencia, timeout y ciclo de vida

| Aspecto | Decisión |
| --- | --- |
| Concurrencia | 1 inspección en vuelo. Una segunda espera hasta 10 s; después `VISION_BUSY` (429). |
| Arranque | Hasta 5 min (el timeout actual del runtime). Si falla, no se reintenta en la misma llamada. |
| Inferencia | `AbortSignal.timeout(120_000)` -> `VISION_TIMEOUT` (504). |
| Total de la tool | 180 s; el servidor responde con el error estable, no deja la petición colgada. |
| Inactividad | Parada a los 5 min sin uso. |
| Caché | Ninguna en fase 1. Dos inspecciones de la misma imagen se pagan dos veces. |
| Logs | Solo `path` relativo, bytes, dimensiones, hash corto, modelo y latencia. Nunca base64, nunca ruta absoluta, nunca el prompt completo. |

## 5. Errores estables

| Código | HTTP | Cuándo | Hint |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Falta `path`, excede longitud o `question` es inválida | Indica el campo y el rango. |
| `PATH_OUTSIDE_PROJECT` | 403 | `resolveProjectPath` falla o el symlink escapa | «Usa una ruta dentro del proyecto abierto». |
| `PATH_SENSITIVE` | 403 | `isSensitivePath` en input o ruta resuelta | «Esa ruta es sensible; no se lee». |
| `PERMISSION_DENIED` | 403 | `enforcePath(..., 'read')` falla | Muestra el glob que la bloquea. |
| `PATH_NOT_FOUND` | 404 | No existe | «Comprueba la ruta con fs.list». |
| `NOT_A_FILE` | 422 | Es directorio u otro tipo | «vision.inspect solo acepta archivos de imagen». |
| `UNSUPPORTED_IMAGE` | 415 | Extensión/firma no permitida | Lista PNG/JPEG/WebP. |
| `IMAGE_TOO_LARGE` | 413 | >8 MiB, >16 MP o lado >8192 | «Reduce la captura». |
| `INVALID_IMAGE` | 422 | Cabecera ilegible o dimensiones 0 | «La imagen parece corrupta». |
| `VISION_MODEL_MISSING` | 503 | Faltan `VISION_MODEL`/`VISION_MMPROJ` o no existen | Muestra las dos variables, no rutas absolutas. |
| `VISION_BACKEND_UNAVAILABLE` | 503 | No hay `llama-server` o no arranca | «Descarga el runtime o revisa el log». |
| `VISION_BUSY` | 429 | Ya hay una inspección y la cola expiró | «Reintenta cuando termine». |
| `VISION_TIMEOUT` | 504 | Inferencia >120 s | «Prueba una imagen más pequeña o un modelo más rápido». |
| `VISION_UPSTREAM_ERROR` | 502 | `llama-server` responde != 2xx | Incluye estado HTTP y 300 caracteres saneados. |
| `VISION_INVALID_OUTPUT` | 502 | JSON inválido o sin `summary` | No incluye el texto crudo. |
| `VISION_INTERNAL` | 500 | Fallo inesperado | Mensaje genérico; detalle solo en log. |

`agentTools.ts` devuelve estos campos tal como ya hace `ToolResult` (`ok`, `code`, `error`, `hint`, `status`). El cliente no necesita parsear el mensaje para decidir.

## 6. Permisos, aprobación y seguridad

- **Sin aprobación humana.** La tool solo lee un archivo local y habla con loopback; no hay salida a internet ni escritura. `requiresApproval: () => false`, `danger: false`.
- **Modo plan/readonly:** permitida. No entra en `EXEC_TOOLS` ni en `FILE_WRITE_TOOLS`.
- **Listas del proyecto:** `allowedTools`/`deniedTools` se aplican igual que al resto. Si el proyecto usa lista blanca y no incluye `vision.inspect`, queda bloqueada; no se añade a `CORE_TOOLS` porque es una tool nueva y opcional.
- **Globs de lectura:** se aplican con `enforcePath(..., 'read')` sobre la ruta relativa canónica.
- **Secretos:** `isSensitivePath` bloquea `.env*`, claves y material criptográfico. Una imagen puede contener un secreto visual; eso no se puede detectar de forma fiable y se declara como limitación, no como garantía.
- **Prompt injection:** el texto de la imagen es dato no confiable. El system prompt lo dice explícitamente; los hallazgos nunca se ejecutan ni se convierten en tool calls.
- **SSRF / red:** no se acepta URL. El único `fetch` va a `127.0.0.1` y el módulo rechaza cualquier endpoint que no sea loopback.
- **Base64:** no se registra, no se devuelve y no se escribe en un archivo temporal. Vive en memoria hasta que termina la petición.
- **Rutas en la salida:** solo la relativa al root. El modelo no ve rutas absolutas.

## 7. Puntos de integración (implementación futura)

| Archivo | Cambio |
| --- | --- |
| `src/agent/types.ts` | Añadir `'vision.inspect'` a `ToolId`. |
| `src/agent/tools/vision.ts` | Nuevo `ToolDefinition` que llama a `/api/agent/run-tool` con `withActiveRoot`; `requiresApproval: false`. |
| `src/agent/registry.ts` | Registrar `visionTool`. |
| `src/agent/fnTools.ts` | Declaración `vision_inspect` y mapeo `FN_TO_TOOL['vision_inspect'] = 'vision.inspect'`. |
| `security.ts` | Añadir `'vision.inspect'` a `AGENT_TOOLS`. |
| `agentTools.ts` | Rama `vision.inspect`: permisos, ruta, límites y llamada al inspector. |
| `src/lib/localVision.ts` | Nuevo: validación de imagen, prompt, cliente loopback, parseo y normalización. |
| `src/lib/localLlamaRuntime.ts` | `mmprojPath` en `start()`, estado y args `--mmproj`. |
| `server.ts` | Construir el inspector con `localModelsDir` y `runtimeDir`; no añadir ruta HTTP pública. |
| `tests/unit/localLlamaRuntime.test.ts` | Casos de `--mmproj`, reutilización y error sin proyector. |

No se toca `browserSession.ts` ni `browserTarget.ts`: la inspección visual de imágenes es un camino distinto.

## 8. Matriz de pruebas

### 8.1 Unitarias puras (sin servidor, sin modelo)

**`tests/unit/visionInspectPath.test.ts`**

- Ruta relativa válida dentro del root.
- Ruta absoluta dentro del root.
- Ruta fuera del root -> `PATH_OUTSIDE_PROJECT`.
- Symlink dentro del root que apunta fuera -> `PATH_OUTSIDE_PROJECT`.
- `.env.png`, `id_rsa` y `.env.local.png` -> `PATH_SENSITIVE`.
- Directorio -> `NOT_A_FILE`.
- Inexistente -> `PATH_NOT_FOUND`.
- `path` vacío, >1024, con `\0` o salto de línea -> `BAD_REQUEST`.
- Globs de lectura que permiten y que deniegan -> `PERMISSION_DENIED`.

**`tests/unit/visionImageHeader.test.ts`**

- PNG 1×1, JPEG 1×1 y WebP 1×1: MIME y dimensiones correctos.
- Extensión `.png` con bytes JPEG -> `UNSUPPORTED_IMAGE`.
- Firma correcta y cabecera truncada -> `INVALID_IMAGE`.
- Dimensiones 0 -> `INVALID_IMAGE`.
- 8193 px de lado -> `IMAGE_TOO_LARGE`.
- 4097×4097 (16,8 MP) -> `IMAGE_TOO_LARGE`.
- Archivo de 8 MiB + 1 byte -> `IMAGE_TOO_LARGE` sin leerlo entero.
- SVG, GIF, AVIF y HEIC -> `UNSUPPORTED_IMAGE`.

**`tests/unit/visionInspectContract.test.ts`**

- JSON válido mínimo -> `summary` y `findings` normalizados.
- JSON con bloque ```json y texto alrededor -> se extrae.
- JSON inválido -> `VISION_INVALID_OUTPUT`.
- `summary` vacío -> `VISION_INVALID_OUTPUT`.
- 21 hallazgos -> 20 y `truncated: true`.
- Severidad desconocida -> se descarta el hallazgo.
- Categoría desconocida -> `other`.
- `confidence` fuera de rango -> se recorta.
- Región fuera de 0..1000 -> `region: null`, hallazgo conservado.
- Textos largos -> se recortan y `truncated: true`.
- Salida >16 KB -> se recorta por el final.
- El resultado nunca contiene base64, ruta absoluta ni texto crudo del modelo.

### 8.2 Backend con doble local (sin llama.cpp)

**`tests/unit/visionInspectBackend.test.ts`**

Se levanta un `http.createServer` en `127.0.0.1:0` que actúa como OpenAI-compatible y se inyecta en `createVisionInspector({ fetch, endpoint })`.

- Petición correcta: `POST /v1/chat/completions`, `temperature: 0`, `stream: false`, `image_url` con data URL y MIME correcto.
- El prompt no contiene la ruta absoluta ni el nombre del proyecto.
- Respuesta 200 con JSON -> datos normalizados y `latencyMs >= 0`.
- Respuesta 500 -> `VISION_UPSTREAM_ERROR` con estado y sin base64.
- Respuesta con JSON inválido -> `VISION_INVALID_OUTPUT`.
- Timeout del doble -> `VISION_TIMEOUT` y el `AbortSignal` se dispara.
- Endpoint no loopback -> se rechaza antes de llamar a `fetch`.
- Dos llamadas concurrentes -> la segunda espera y, si expira, `VISION_BUSY`.
- El data URL no aparece en logs ni en el resultado.

**`tests/unit/localLlamaRuntime.test.ts` (ampliación)**

- `start({ mmprojPath })` añade `--mmproj` en el orden esperado.
- Mismo modelo + mismo `mmprojPath` reutiliza el proceso.
- Cambiar solo `mmprojPath` reinicia el proceso.
- `mmprojPath` con `../` o extensión distinta de `.gguf` -> error de validación.
- Sin `mmprojPath`, el comportamiento actual no cambia (regresión).

### 8.3 Integración de la tool

**`tests/agentTools.test.ts` (ampliación)**

- `vision.inspect` sin `path` -> `BAD_REQUEST`.
- Ruta fuera del root -> 403.
- Ruta sensible -> 403.
- Modo `plan` permite la lectura (no hay `EXEC_TOOLS`).
- `deniedTools: ['vision.inspect']` -> 403.
- Sin modelo configurado -> 503 `VISION_MODEL_MISSING` (no lanza excepción).
- La tool no pide aprobación (`requiresApproval` falso).

**`tests/toolRegistry.test.ts` (ampliación)**

- `'vision.inspect'` está en `AGENT_TOOLS` y en `TOOL_REGISTRY`.
- La declaración `vision_inspect` mapea a `vision.inspect`.
- No hay una ruta HTTP pública nueva que apunte a la tool.

### 8.4 E2E opcional con modelo real

**`tests/visionInspect.e2e.test.ts`**, solo con `VISION_E2E=1` y las dos variables configuradas:

- Inspecciona un PNG de fixture con un botón de bajo contraste y un solapamiento evidente.
- Verifica que llega `summary`, al menos un `finding` y que el proceso de visión se detiene al final.
- Si faltan variables, el test se marca `skip`, no `pass`.

Comando:

```bash
VISION_E2E=1 VISION_MODEL=... VISION_MMPROJ=... npm run test:node -- tests/visionInspect.e2e.test.ts
```

### 8.5 Regresión

- `tests/browserVisualBugs.test.ts` sigue pasando: `vision.inspect` no cambia el snapshot ni el detector de contraste/overflow.
- `npm run typecheck`, `npm run lint` y `npm run build` deben seguir verdes.
- No se añaden dependencias nuevas. Si se propone una, se justifica aparte y no entra en esta fase.

## 9. Criterios de aceptación

La implementación se considera terminada cuando:

1. `vision.inspect` acepta una ruta relativa o absoluta **solo** dentro de un root permitido, y rechaza symlinks que escapan.
2. Una ruta sensible se rechaza antes de leer bytes.
3. Solo se aceptan PNG, JPEG y WebP reales (firma), dentro de 8 MiB, 16 MP y 8192 px de lado.
4. La imagen se envía únicamente a `127.0.0.1`, mediante `image_url` data URL, sin ruta absoluta en el prompt.
5. El runtime arranca con `--mmproj` y no reutiliza el proceso de chat.
6. Sin modelo o sin `llama-server`, la tool devuelve 503 con un código y un hint accionables; no rompe el turno.
7. Una segunda inspección concurrente no corrompe la primera; recibe `VISION_BUSY` o espera.
8. Un timeout aborta la petición y no deja el runtime en estado `running` falso.
9. La salida es JSON válido, recortada a los límites, sin base64 ni rutas absolutas.
10. `vision.inspect` funciona en modo plan/readonly y no pide aprobación.
11. `browser snapshot` y sus pruebas siguen intactos.
12. `npm run typecheck`, `npm run lint`, `npm run build` y la matriz anterior pasan.

## 10. Fase 2 (no incluida)

- Selector de modelo visual en la UI, en vez de variables de entorno.
- Recorte de una región concreta (`region` de entrada) para ampliar detalles.
- Redimensionado seguro con una dependencia de imagen o un decoder propio.
- OCR separado para texto pequeño, con coordenadas de palabras.
- Comparación de dos capturas (antes/después) y detección de regresiones.
- Proveedor remoto opcional, con aprobación explícita y política de privacidad propia.
- Caché por `sha256 + question + modelo`.

Nada de esto se implementa ahora: el contrato y los límites de arriba son la base sobre la que se podrá añadir sin romper la tool.

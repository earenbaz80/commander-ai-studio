> **Labels:** `g1`, `p0`, `area:agent`, `area:server`, `area:cli`, `provider` · **Estimación:** 0,5 d-persona · **No depende de:** nada abierto
>
> Issue de paridad de G1, sin número en GitHub: no forma parte del backlog F1 y **no** cambia el criterio de T9 ni los enunciados de dogfooding. Es el diagnóstico del turno vacío que tumbó `G1-D4-03` y `G1-D4-03R`.

**Estado:** Abierto — causa identificada y reproducida; arreglo **no** aplicado.

**Por qué.** Dos corridas seguidas de T9 (`sess_b1d94644`, `sess_b62e39c7`) terminaron con `answer: "(el modelo no devolvió respuesta)"` y el CLI en exit 1 justo en el turno de reanudación, después de que el hito ya estuviera escrito y leído. El texto sintético no dice nada: no había ni rastro de la respuesta del proveedor. Sin saber si el modelo se quedó callado, se truncó o el servidor se comió algo, T9 quedaba como «el modelo no responde al reanudar», que es lo que decía la hoja de D4 y era falso.

**Qué se hizo.** Se reanudó el turno **sin tocar la sesión de evidencia**: se copió el estado exacto de `G1-D4-03R-turn1.json` a una sesión nueva (`sess_eaf5e2bb` y las de §Evidencia) con `POST /api/agent/sessions` + `PUT /api/agent/sessions/:id/state`, y se lanzó el CLI contra un proxy local (`:3284 → :3283`) que guarda cada petición y respuesta. Siete intentos con el mismo historial: **3 respondieron, 4 salieron vacíos**.

## Captura del turno

Petición idéntica en los siete intentos (`capture-*.json`; el prompt es el mismo byte a byte):

| Campo | Valor |
| --- | --- |
| `POST` | `/api/nvidia/generate` |
| `model` | `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b` |
| `temperature` / `maxTokens` | `0.2` / **`2048`** |
| `systemInstruction` | 640 caracteres |
| `prompt` | 1 065 caracteres: `OBJETIVO: T9 PRIMER TURNO…` + `HISTORIAL:` (turno 1 + `TOOL fs.read → {…"content":"uno"…}`) + `USER: T9 SEGUNDO TURNO…` |
| `tools` | 36 declaraciones OpenAI (sin `update_plan` ni `code_run`) |

El servidor lo reenvía a `https://integrate.api.nvidia.com/v1/chat/completions` como `{model: "nvidia/nemotron-3.5-lightning-30b-a3b", messages: [system, user], temperature: 0.2, max_tokens: 2048, tools, tool_choice: "auto"}` (`generateOpenAiCompatible`, `server.ts`).

Respuestas del servidor al CLI, mismo request:

| Intento | Respuesta | `responseTokens` |
| --- | --- | --- |
| `capture-19` (iter 1) | `{"success":true,"text":"uno"}` | 132 |
| `capture-30` (iter 2) | `{"success":true,"text":"","metrics":{"promptTokens":7807,"responseTokens":2048,"totalTokens":9855}}` | **2048** |
| `capture-51` (iter 4) | idéntica a la anterior | **2048** |

`responseTokens: 2048` es exactamente el `max_tokens` pedido: el proveedor **agotó el presupuesto**. El CLI recibe `text: ""` y `toolCalls` ausente, así que `calls.length === 0` y toma el turno como respuesta final (`src/cli/agentClient.ts`, `const answer = thought || '(el modelo no devolvió respuesta)'`), guarda ese texto como turno `assistant` y sale con «Sin respuesta final».

## Respuesta cruda del proveedor

La respuesta cruda no llega al CLI: `generateOpenAiCompatible` sólo propaga `message.content`, `tool_calls` y tres contadores de `usage`; descarta `finish_reason`, `message.reasoning_content` y `completion_tokens_details`. Para verla se reenvió a NVIDIA el **payload exacto** reconstruido con las mismas reglas del servidor (`replay-upstream.mjs`), sin tocar el código.

Sonda controlada con el mismo payload y `max_tokens: 120` (`probe-response-max120.json`) — el caso que reproduce el fallo:

```json
{
  "choices": [{ "finish_reason": "length", "message": { "content": "", "reasoning_content": "…truncado a mitad de frase…" } }],
  "usage": { "prompt_tokens": 7807, "completion_tokens": 120, "completion_tokens_details": { "reasoning_tokens": 120 } }
}
```

`max_tokens: 200` → `finish_reason: "stop"`, `content: "uno"`. `max_tokens: 4096` → `content: "uno"`, 1 175 tokens de razonamiento. Con `max_tokens: 2048` y once reenvíos del mismo prompt: razonamiento entre **109 y 1 731** tokens, siempre con contenido.

## Causa

El modelo (Nemotron 3.5 Lightning) razona en `reasoning_content` **dentro del mismo presupuesto** que la respuesta. En el turno de reanudación ese razonamiento es largo —tiene que releer el turno 1 duplicado en el historial, el `fs.read` y la instrucción nueva— y, cuando pasa de 2 048 tokens, NVIDIA corta con `finish_reason: "length"`, `content: ""` y `completion_tokens == max_tokens`. El servidor convierte eso en un éxito con texto vacío, y el CLI en «el modelo no devolvió respuesta».

Es **intermitente**, no determinista: el mismo historial dio 4 vacíos y 3 respuestas correctas en 7 reanudaciones (las 2 del dogfooding y 5 controladas), y el razonamiento medido varía entre 109 y más de 2 048 tokens. Por eso `G1-D4-03` y su repetición fallaron las dos, mientras que la primera reanudación de diagnóstico respondió «uno» en 2 pasos.

Reproducción estable sin esperar a la lotería: bajar `max_tokens` a 120 con el payload capturado y mirar `finish_reason` (comando en §Evidencia).

## Qué **no** es

- **No** es la reanudación: el historial se reconstruye bien (`userTurns=2`, una sola escritura, `hito.txt` intacto), el `--resume` no duplica tool calls y el turno 1 del mismo modelo responde sin problema con el mismo presupuesto.
- **No** es el servidor de sesiones ni el estado persistido: el estado copiado del artifact produce tanto respuestas buenas como vacías.
- **No** es un prompt demasiado largo: 7 807 tokens de prompt con `cached_tokens: 6 288`; el problema es el presupuesto de **salida**, no la entrada.
- **No** es un error HTTP: `200` y `success: true` en todos los casos; el fallo viaja disfrazado de éxito.

Compatible con los turnos vacíos de `G1-D2-03` y `G1-D3-01` (mismo texto sintético tras varias lecturas y otro `allow`/`deny`), aunque allí no se capturaron `metrics` y no se puede afirmar sin repetir la captura.

## Arreglo (implementado en los puntos 1, 2 y 4)

1. **Servidor (hecho, todas las rutas que atienden al agente):** `/api/custom`, `/api/openai|nvidia`, `/api/openrouter`, `/api/ollama`, `/api/lmstudio`, `/api/gemini` y `/api/freebuff` devuelven `{success:false, error:'respuesta truncada por max_tokens …'}` cuando el turno llega cortado por presupuesto, sin contenido y sin tool calls —Gemini lo llama `MAX_TOKENS`, Ollama lo dice en `done_reason: "length"`—, y el `finishReason` viaja en el éxito. La regla vive en `truncatedTurnError()` (`src/agent/providers.ts`), las guardas por ruta en `src/agent/providerResponses.ts`, y hay un caso por ruta en `tests/unit/providerResponses.test.ts`; `/api/ollama`, `/api/custom`, `/api/openrouter`, `/api/openai`, `/api/nvidia`, `/api/lmstudio` y `/api/gemini` se piden de verdad al server del arnés con `host`/`baseURL`/`baseUrl` apuntando a un upstream falso local y se comprueba el cuerpo `{success:false, error}` en `tests/generateRoutesTruncation.test.ts` (para LM Studio el falso sirve también `/v1/models`, que es lo que sondea la ruta; el cliente `@google/genai` admite `httpOptions.baseUrl`, así que la base de Gemini es inyectable por cuerpo igual que la de OpenRouter y custom), y el handler de Freebuff se ejecuta con `fetch` falso en `tests/freebuffHandlers.test.ts`. Quedan fuera `/api/pollinations` (texto plano, el proveedor no informa `finish_reason`) y `/api/anthropic` (el bucle del agente no la usa: un id `claude` cae en `/api/custom`). En el cliente, `callLlmNative`/`callLlmJson` lanzan ese error en vez de leer `text:''`, y `stepNative` cierra con el paso `Respuesta truncada` en lugar de reintentar en JSON (que se volvería a cortar): un turno truncado no es una respuesta final ni un fallo de tool-use.
2. **Presupuesto de salida (hecho):** `agentMaxTokens()` sube a **4 096** para los modelos que razonan (`isReasoningModel()`: nemotron, DeepSeek R1, QwQ, qwen3, gpt-oss, o-series) y deja 2 048 para el resto; se aplica a los tres turnos del agente (`callLlmNative`, `callLlmJson` y la reparación de JSON).
3. **CLI (pendiente):** no persistir `(el modelo no devolvió respuesta)` como turno `assistant`: contamina la reanudación siguiente con una respuesta que el modelo nunca dio.
4. **Camino del subagente (hecho):** un turno vacío ya no se convierte en cierre exitoso. `stepNative` lo detecta (sin pensamiento, sin llamadas, sin plan), lo anota como paso `Turno vacío`, **reintenta una vez** y, si vuelve vacío, cierra la sesión con `fail()`: el hijo queda `failed` con error, nunca `ok:true` con «Objetivo completado.». Cubierto por dos casos en `tests/agentTaskIntegration.test.ts` (reintento que recupera y turno vacío persistente que se marca fallido). El padre sigue como estaba: ahí el turno vacío no se disfraza de respuesta inventada por este camino y cambiar su conducta movería las mediciones de T9/T10 ya cerradas.

Ninguno cambia el criterio de T9 en §4.5 de la hoja: `G1-D4-03` y `G1-D4-03R` siguen `failed` con 7/8.

## Efecto en la hoja de D4

`G1-D4-03R` se anotó como «el turno vacío no era puntual». Con esta captura la lectura correcta es: **el fallo se repite con frecuencia pero es intermitente y su causa es el presupuesto de salida**, no el camino `--resume`. La repetición sigue siendo válida como evidencia de fallo; sólo cambia la explicación, que queda en este issue.

## También en los hijos de `spawn_agents` (`G1-D5-07`)

Los dos hijos de la corrida extra `G1-D5-07` cerraron en 300–363 ms con `steps: 2` y `stepTitles: ["Inicio", "Finalizado"]` ([hoja de D5 §4.2](../dogfooding-g1-d5.md)). `Inicio` lo escribe `start()` (`agentSession.ts:826`) antes del primer turno; si no hay `Razonamiento`, el proveedor devolvió el turno vacío y el código tomó `native.thought || 'Objetivo completado.'` (`agentSession.ts:1283`). Los hijos se anotaron `ok:true` y el evaluador los contó como terminados bien.

Es el mismo defecto por otra puerta, y con peor consecuencia: en el padre el turno vacío deja la sesión incompleta y se nota; en el hijo se convertía en **cierre exitoso con respuesta de relleno**, así que T10 fallaba por el texto («Objetivo completado.») y no por el contrato de cierre. Ya no: el hijo reintenta una vez y, si sigue vacío, queda `failed` (punto 4 del arreglo arriba). Con eso, la próxima medición de T10 sí habla del contrato de cierre.

## El reintento, medido en vivo (`G1-D5-08`)

Seis hijos de tres `spawn_agents` en la sesión `sess_218d4b05` (`sess_6f475cb2`, `sess_764963d9`, `sess_87b00e73`, `sess_6ddccd99`, `sess_0d367c89`, `sess_cabe3864`) cerraron con `stepTitles: ["Inicio", "Turno vacío", "Finalizado sin respuesta"]`, `calls:[]` y estado `failed` ([hoja de D5 §4.2](../dogfooding-g1-d5.md)). Dos cosas quedan demostradas:

- **El arreglo del hijo no disfraza el fallo.** El reintento corrió una vez en cada hijo (el paso `Turno vacío` está anotado) y, al volver vacío, el cierre fue `failed` con «El proveedor devolvió turnos vacíos: el subagente no produjo respuesta ni llamadas.», nunca `ok:true` con «Objetivo completado.».
- **El reintento no cura el turno vacío.** 6 de 6 hijos vacíos en la misma ventana, con 0 turnos reales tras el reintento, mientras el padre razonaba y actuaba con normalidad en sus tres intentos. La causa está en el presupuesto de salida, no en el bucle del subagente: por eso los arreglos 1–2 (error en el servidor y 4 096 para los modelos que razonan) atacan el origen, y el reintento y el corte del padre quedan como redes de seguridad.

## Con los dos arreglos en vivo (`G1-D5-09`)

Ocho hijos de cuatro `spawn_agents` en `sess_252fc601` (`HEAD` `4d87952`, `:3285`): **ninguno** cerró con `Turno vacío` ni dejó el paso `Respuesta truncada`, así que ni el turno vacío ni el corte por presupuesto reaparecieron con 4 096 tokens ([hoja de D5 §4.2](../dogfooding-g1-d5.md#42-hijos-uno-por-fila)). Los hijos ya hacen turnos reales —siete de los ocho llaman tools— y fracasan por otra puerta: `Tool-use falló` en el primer turno de todos, «El subagente terminó sin respuesta final» después, dos límites de 120 s y un `LLM HTTP 500`. Sólo B2 cerró con `Finalizado`. Lo que esta corrida sí destapó fue un fallo de la guarda del padre, arreglado después: leía los resultados en una forma que en producción no llega (ver [`G1-SUBAGENT-CLOSE`](G1-SUBAGENT-CLOSE.md)).

## Evidencia

Artefactos locales (`.commander/g1/diag-t9/`, ignorado por git):

| Archivo | Qué es |
| --- | --- |
| `capture-15/19`, `capture-26/30`, `capture-36/40`, `capture-47/51` | petición y respuesta de cada paso `/api/nvidia/generate` de los 4 intentos por proxy |
| `capture-04`/`capture-08` | primer intento manual (respondió «uno» en 2 pasos) |
| `iter-1.out` … `iter-4.out` | salida `--json` del CLI de cada intento |
| `upstream-request-*.json`, `upstream-response-*.json` | payload reconstruido y respuesta cruda (11 reenvíos con `max_tokens: 2048`) |
| `probe-response-max120.json`, `max200`, `max4096` | sonda de presupuesto |
| `replay-session.json` | sesión de diagnóstico sembrada desde `G1-D4-03R-turn1.json` |

Comandos:

```bash
# captura del turno (proxy que registra y reenvía)
node .commander/g1/diag-t9/proxy.mjs            # :3284 -> :3283
node .commander/g1/diag-t9/setup-session.mjs    # siembra el estado de turno 1
npx tsx bin/commander.ts agent --resume <id> 'T9 SEGUNDO TURNO: …' --server http://127.0.0.1:3284 --max-steps 24

# respuesta cruda del proveedor con el payload exacto del servidor
node .commander/g1/diag-t9/replay-upstream.mjs capture-51.json exact
node .commander/g1/diag-t9/probe-budget.mjs upstream-request-trunc-11.json 120 max120
```

Sesiones de diagnóstico: `sess_eaf5e2bb` (ok, 2 pasos), `sess_3aca82ea` (ok), `sess_d6480ed3` (vacío), `sess_9807be6d` (ok), `sess_17aa370e` (vacío). Las sesiones de evidencia (`sess_b1d94644`, `sess_b62e39c7`) no se modificaron.

Hijos con turno vacío: `sess_e421a603` (A) y `sess_57590b94` (B) en `G1-D5-07`; sus filas sobreviven en `.commander/g1/G1-D5-07-subagents.json` con `calls:[]` y `stepTitles:["Inicio","Finalizado"]`.

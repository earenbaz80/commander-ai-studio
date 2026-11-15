# `vision.inspect` — prueba de viabilidad con VLM local

> **Fecha:** 2026-11-14. **Estado:** prueba ejecutada; **no** se implementó `vision.inspect`, no se modificó el runtime y no se añadieron dependencias.
>
> **Diseño relacionado:** [vision-inspect-design.md](vision-inspect-design.md).
>
> **Artefactos:** `.commander/vision-feasibility/` (ignorado por git): scripts, logs, JSON de resultados y la captura controlada. Los modelos quedaron en `local_models/`, también ignorado por git.

## 1. Veredicto

| Pregunta | Respuesta |
| --- | --- |
| ¿Se puede ejecutar un VLM local con el runtime actual? | **Sí**, con el binario actual y `--mmproj`; el servidor acepta `image_url` y responde. |
| ¿Cuánta VRAM usa? | **0 MiB**. El binario instalado es CPU-only y `llama-server --list-devices` devuelve `(none)`. No hay backend CUDA/Vulkan/SYCL en `runtime/llama`. |
| ¿Cuánta RAM usa? | **+4,14 GiB** al cargar el modelo; **~5,22 GiB** de RAM del sistema tras llenar el contexto con las peticiones. |
| ¿Qué latencia tiene? | **38 s** la primera imagen; **44,5 s** una descripción; **71,6–82,1 s** un JSON de hallazgos; **77,8 s** la captura controlada. |
| ¿La calidad alcanza para `vision.inspect`? | **Para describir una pantalla, sí como borrador. Para detectar bugs finos, no**: el 3B detecta lo grande, pero confunde causas, omite defectos y produce falsos positivos. |
| ¿Reemplaza a `browser snapshot`? | **No.** El snapshot DOM sigue siendo la fuente barata y exacta para caja, overflow, display, visibilidad y contraste; el VLM solo aporta una segunda opinión sobre píxeles. |

**Recomendación corta:** se puede prototipar `vision.inspect` como lectura **asíncrona, explícita y de una sola imagen**, con 3 hallazgos como máximo y timeout de 180–240 s. No se debe presentar como detector autónomo de bugs ni prometer VRAM mientras el runtime siga siendo CPU-only.

## 2. Entorno y modelo

| Elemento | Valor |
| --- | --- |
| SO / arquitectura | Windows x64 |
| CPU | Intel Core i7-11700F, 16 hilos lógicos; llama.cpp usa **8 threads** |
| RAM | 63,9 GiB totales; 51,3 GiB libres al inicio de la prueba |
| Runtime | `runtime/llama/llama-server.exe`, versión **1.0.0-dev (build 12375, commit 9d25e0014)** |
| Dispositivos | `llama-server --list-devices` → `(none)`; sin DLL CUDA/Vulkan/SYCL |
| Modelo | `Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf` — 1.929.901.056 B (1,80 GiB) |
| Proyector | `mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf` — 844.757.728 B (805,6 MiB) |
| Tamaño total | 2,77 GB (2,58 GiB) |
| Contexto | 8.192 tokens, `--parallel 1`, `-ngl 99` (sin efecto sin GPU) |
| Disco libre | 162,9 GB |

El binario ya soporta `--mmproj`, `--image-min-tokens` y `--image-max-tokens`. **No hace falta cambiar de versión de llama.cpp para la prueba CPU**; lo que falta es que el wrapper de la app pase el proyector y que el hub sepa emparejarlo con el modelo.

## 3. Método

1. Se descargaron el GGUF y su `mmproj` desde `ggml-org/Qwen2.5-VL-3B-Instruct-GGUF`.
2. Se arrancó el mismo `llama-server` del runtime con los argumentos actuales más `--mmproj`:
   `-m <modelo> -c 8192 -ngl 99 --host 127.0.0.1 --port <libre> --parallel 1 --mmproj <proyector>`.
3. Se midió el arranque hasta `/health`, y luego:
   - un calentamiento con una pregunta corta;
   - una descripción libre de la captura real `screenshot-local-models-wide.png` (1032×929, 97.271 B);
   - dos intentos de JSON con máximo 5 hallazgos y 520 tokens;
   - un JSON estructurado con máximo 3 hallazgos y 900 tokens;
   - una captura controlada con cuatro bugs conocidos y un JSON de máximo 5 hallazgos.
4. La latencia es el reloj de pared de la petición HTTP completa. Los tokens/s salen del bloque `timings` de llama.cpp.
5. La RAM es el delta de `os.freemem()` antes/después; es una medida de sistema, no de proceso aislado.
6. **VRAM:** no se usó `nvidia-smi`. La medida relevante para el producto es la que declara el runtime: `--list-devices` no ve ningún dispositivo y el proceso no asigna buffers GPU. Por eso se registra **0 MiB atribuibles a llama-server**.

> **Límite de la medida:** si el equipo tiene una GPU física, el binario CPU-only no la usa. Este 0 MiB no significa que la máquina no tenga GPU; significa que este runtime no le da ninguna a la tool.

## 4. Rendimiento medido

### 4.1 Captura real de la app

| Caso | Latencia | Salida | Generación | `finish_reason` | Resultado |
| --- | ---: | ---: | ---: | --- | --- |
| Calentamiento | 37,96 s | 57 tok | 16,05 tok/s | `stop` | imagen codificada por primera vez |
| Descripción | 44,51 s | 103 tok | 11,54 tok/s | `stop` | texto correcto a grandes rasgos |
| Hallazgos, 5 / 520 | 81,10 s | 520 tok | 11,97 tok/s | `length` | **JSON truncado**, no parsea |
| Repetición, 5 / 520 | 82,14 s | 520 tok | 12,00 tok/s | `length` | **JSON truncado**, no parsea |
| Estructurado, 3 / 900 | 71,59 s | 371 tok | 10,83 tok/s | `stop` | **JSON válido** |

Datos de carga y memoria:

- arranque hasta `/health`: **2,57 s** (modelo mapeado desde página caliente);
- RAM usada: 14.070,5 MiB → 18.312,4 MiB tras cargar (**+4.241,9 MiB**);
- tras las peticiones: 19.420,5 MiB (**+5.350 MiB** desde el inicio);
- prompt eval: **35,6–38,8 s** para ~1.265–1.362 tokens;
- `cached_tokens`: 93–94; la imagen se vuelve a procesar en cada petición;
- VRAM: **0 MiB**.

**Lectura:** el coste dominante no es generar texto, sino volver a codificar la imagen y evaluar ~1,3k tokens de prompt. La diferencia entre 44 s (descripción corta) y 82 s (520 tokens) es casi toda generación. El prompt caching no reutiliza la imagen entre preguntas.

### 4.2 Captura controlada de bugs

Se generó una UI de 1280×800 con cuatro defectos conocidos:

1. botón gris claro sobre gris (`#777` sobre `#888`), contraste ~1,26;
2. texto “Confirmar compra” cortado por `overflow: hidden`;
3. badge “Nuevo” encima del texto de “Enviar pedido”;
4. CTA verde “Comprar ahora” parcialmente fuera de la tarjeta.

El modelo tardó **77,76 s**, generó **435 tokens** y devolvió JSON válido. Resultado:

| Defecto real | ¿Lo detectó? | Comentario |
| --- | --- | --- |
| Contraste bajo | **Sí** | “El texto … no contrasta con el fondo”; correcto. |
| Texto “Confirmar compra” cortado | **Parcial** | Leyó “Confirmar com”, pero lo describió como solapamiento con “Estado del pedido”, que no existe. |
| Badge “Nuevo” solapando “Enviar pedido” | **No** | No lo mencionó. |
| CTA “Comprar ahora” fuera de la tarjeta | **No** | No lo mencionó. |
| Falsos positivos | **3–4** | “Estado del pedido” cortado, solapamiento inexistente, “Enviar Nuevo” fuera del contenedor, espaciado insuficiente. |

También devolvió `summary: "máximo 180 caracteres"` (eco del prompt), `uncertainties` como objetos en vez de strings y ninguna región. Un validador estricto rechazaría o normalizaría todo eso; el modelo no cumple el contrato por sí solo.

## 5. Calidad

### 5.1 Lo que sí hace bien

- Lee texto grande y nombres de secciones: “HUGGING FACE LOCAL HUB MANAGER”, “Crear”, “Agentes”, “Modelos”, “Herramientas”, “Historial”, el aviso de `llama-server` y nombres de modelos.
- Reconoce el estado general de la pantalla y la diferencia entre lista de modelos, buscador y panel de archivos.
- Detecta contraste bajo cuando el defecto es evidente.
- Responde en español y mantiene el formato JSON cuando el presupuesto alcanza.

### 5.2 Lo que falla

- **Estructura:** en la captura real llamó “barra de menú superior” a la barra lateral; no mencionó las pestañas ni el panel derecho.
- **Localización:** no identificó el recorte horizontal del panel “ARCHIVOS” en la captura real.
- **Causa:** confunde “texto cortado” con “elemento solapado” y con “elemento fuera del contenedor”.
- **Falsos positivos:** marca como hallazgo cosas que están bien o que son solo una descripción (“panel de descarga”, “posición de aviso correctamente alineada”).
- **Contrato:** a 520 tokens no cierra el JSON; con 900 y 3 hallazgos sí. Usa coordenadas 0..1 cuando el contrato pide 0..1000. `uncertainties` puede cambiar de tipo.
- **Cobertura:** no ve defectos finos ni relaciones espaciales sutiles; el 3B no es un QA visual fiable.

### 5.3 Veredicto de calidad

| Uso | Veredicto |
| --- | --- |
| Describir una pantalla o un estado visual | **Aceptable como borrador**, revisando el texto. |
| Segunda opinión sobre contraste/legibilidad evidente | **Útil con cautela**, siempre con el snapshot DOM al lado. |
| Detectar bugs de layout, clipping, solapamiento o z-index | **No fiable** con 3B Q4 en CPU. |
| Generar hallazgos que se apliquen o se reporten sin revisión | **No**. |

Una sola captura no basta para hablar de precisión/recall. Para integrar haría falta un set de 20–30 capturas con verdad conocida y medir por categoría.

## 6. Qué falta para integrarlo

### P0 — sin esto la tool no puede funcionar

1. **`--mmproj` en el runtime.** `LocalLlamaRuntimeManager.start()` no acepta `mmprojPath`, no lo pasa a `llama-server`, no lo guarda en `LocalRuntimeStatus` y no lo incluye en la condición de reutilización del proceso. Sin esto, el wrapper actual carga el VLM como texto y la imagen se pierde.
2. **Modelo y proyector como una unidad.** `LocalModelHub` y `LocalModelDownloadManager` descargan un único `.gguf`; `parseHubGgufFiles()` trata `mmproj-*.gguf` como otro modelo. Falta un registro `{ model, mmproj, vision: true, context, imageMaxTokens }`, descarga atómica de ambos, sidecar con ambos y ocultar el proyector de la lista de modelos de chat.
3. **Camino multimodal interno.** `/api/local-models/generate` hace `content: String(message.content)`, así que no sirve para `image_url`. Hace falta una función interna (no una ruta pública de subida) que lea el archivo, construya el data URL y llame a `/v1/chat/completions`.
4. **Validación de imagen y sandbox.** Reutilizar `resolveProjectPath`, `isSensitivePath` y `enforcePath(..., 'read')`; validar PNG/JPEG/WebP por firma, 8 MiB, 16 MP y 8192 px de lado; rechazar SVG/GIF/AVIF/HEIC. Nada de esto existe todavía en `agentTools.ts`.
5. **Contrato y validador.** El modelo no cumple solo: hay que parsear, recortar y validar. Para la primera versión: máximo **3 hallazgos**, **700–900 tokens**, `region` opcional o aceptar 0..1 y documentarlo, y `uncertainties` como strings. Un `summary` que sea eco del prompt debe rechazarse.
6. **Timeout y concurrencia.** El diseño fijaba 120 s; la medición real llega a **82 s** con 520 tokens y **77,8 s** con 435. Un modelo más verboso o un equipo más lento puede superar 120 s. Subir a **180–240 s**, mantener **1 petición en vuelo** y cancelar con `AbortSignal`. En CPU, dos peticiones compiten por los mismos 8 threads.

### P1 — necesarias para que sea útil y honesta

7. **Runtime GPU y telemetría de VRAM.** El binario actual no ve dispositivos. Para hablar de VRAM hay que distribuir un build CUDA/Vulkan/SYCL, detectarlo con `--list-devices`, elegir el dispositivo y medir. Mientras tanto, la UI debe decir **“CPU, 0 MiB VRAM”**, no prometer aceleración.
8. **Selección y estado en la UI.** El usuario necesita elegir un modelo de visión, ver que el proyector está emparejado y saber si el runtime está cargado. Hoy el hub muestra `mmproj-*.gguf` como si fuera un modelo más.
9. **Presupuesto de imagen.** Qwen2.5-VL avisa: “require at minimum 1024 image tokens to function correctly on grounding tasks”. Hay que fijar `--image-min-tokens 1024` y un `--image-max-tokens` razonable, o redimensionar antes de enviar. Sin eso, la latencia y la calidad varían.
10. **Calibración de calidad.** 3B Q4 en CPU no alcanza para bugs finos. Antes de prometer detección hay que probar un 7B/GPU o un modelo especializado y medir precisión/recall por categoría; el 3B puede quedar como modo “describir” o “segunda opinión”.
11. **Aprovechar el prompt.** Cada pregunta vuelve a procesar la imagen (~35–39 s de prompt eval). Para varias preguntas sobre la misma captura conviene una sola petición con varias tareas, o una caché de imagen si el runtime la soporta. No conviene lanzar una tool por cada detalle.
12. **Gate de producto.** `vision.inspect` debe ser explícito, de solo lectura, con resultado advisory y sin auto-aplicar cambios. El snapshot DOM sigue siendo la primera vía; el VLM solo se justifica para píxeles que el DOM no puede explicar.

## 7. Qué funciona ya y qué no

| Pieza | Estado |
| --- | --- |
| `llama-server` build 12375 con `--mmproj` | **Funciona**; cargó el VLM y respondió imágenes. |
| Petición OpenAI con `image_url` data URL | **Funciona**; no hizo falta endpoint nuevo para la prueba. |
| Carga del modelo | **2,6 s** con página caliente; RAM +4,14 GiB. |
| Generación | **10,8–12,0 tok/s**; 435–520 tokens en 38–43 s. |
| `LocalLlamaRuntimeManager` con `mmproj` | **No**; no acepta el argumento. |
| Hub modelo + proyector | **No**; descarga y lista archivos sueltos. |
| `/api/local-models/generate` con imagen | **No**; aplana el contenido a string. |
| VRAM | **0 MiB**; sin dispositivo GPU visible. |
| Calidad para bugs finos | **No** con 3B Q4 CPU. |

## 8. Recomendación de implementación

Si se decide seguir:

1. Implementar solo el camino **CPU, una imagen, solo lectura**, detrás de una acción explícita.
2. Añadir `mmprojPath` al runtime y un registro de modelo visual en el hub; no reutilizar el modelo de chat.
3. Llamar internamente a `/v1/chat/completions` con `image_url`; no abrir una ruta pública de subida.
4. Validar ruta, formato, tamaño y permisos antes de leer; no mandar rutas absolutas al modelo.
5. Pedir **3 hallazgos máximo**, 900 tokens, `region` opcional; validar y recortar la salida.
6. Timeout 180–240 s, una petición en vuelo, cancelación y parada por inactividad.
7. Medir de nuevo en GPU antes de prometer VRAM o latencia interactiva.
8. No presentar los hallazgos como verdad: son una segunda opinión; el snapshot DOM y la revisión humana siguen mandando.

## 9. Reproducción

Scripts (ignorados por git):

```bash
node .commander/vision-feasibility/make-fixture.mjs
node .commander/vision-feasibility/run.mjs
node .commander/vision-feasibility/run-structured.mjs
node .commander/vision-feasibility/run-bugs.mjs
```

Artefactos:

| Archivo | Contenido |
| --- | --- |
| `.commander/vision-feasibility/results.json` | Captura real: calentamiento, descripción, dos JSON de 520 y métricas. |
| `.commander/vision-feasibility/results-structured.json` | JSON de 3 hallazgos con 900 tokens. |
| `.commander/vision-feasibility/results-bugs.json` | Captura controlada y salida del modelo. |
| `.commander/vision-feasibility/llama-server*.log` | Logs de llama.cpp con timings y carga. |
| `.commander/vision-feasibility/ui-bugs.png` | Captura controlada de 1280×800. |

Los modelos descargados quedan en `local_models/` (2,77 GB). Si no se van a reutilizar, se pueden borrar; no están versionados.

## 10. Limitaciones de esta prueba

- Una sola captura real y una sola controlada; no es una evaluación estadística.
- La VRAM se reporta como 0 MiB porque el runtime no ve GPU; no se midió una GPU física con `nvidia-smi`.
- La RAM es de sistema, no del proceso aislado; incluye ruido de otros procesos.
- La calidad se evaluó manualmente contra cuatro defectos conocidos; no hay set etiquetado ni métricas por categoría.
- No se probó un modelo 7B, un runtime GPU ni un modelo especializado en UI.
- No se implementó `vision.inspect`; todo lo anterior es evidencia para decidir si conviene hacerlo.

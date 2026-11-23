# G1 — Protocolo para re-medir el p95 de aprobación con operador humano

> **Estado:** **ejecutado y cerrado el 2026-11-13 con n=6 → NO CUMPLE**, por la enmienda E1 de §2.2 (el veredicto no podía cambiar con más muestras). Recibo: [`G1-APPROVAL-CAL2-2026-11-13`](receipts/G1-APPROVAL-CAL2-2026-11-13.md). Se redacta el 2026-11-12 para cerrar la regla de §7.1 del [plan G1](dogfooding-g1.md#71-reglas-de-decisión-criterio-de-puerta) que quedó en rojo en el [recibo G1-DOGFOOD-2026-11-12](receipts/G1-DOGFOOD-2026-11-12.md): por el p95 medido de **76 982 ms** frente a la referencia provisional de **15 151 ms**.
> **Qué arregla:** las 40 muestras de G1 las dio un operador automatizado por PTY con sondeo, así que el número mide el sondeo, no la latencia de aprobación. Este protocolo obtiene la muestra con un humano vigilando el TTY y fija, **antes de ver los datos**, cómo se decide si la referencia de 15 151 ms se revisa.
> **Qué no hace:** no reabre las 28 corridas de G1, no toca las cifras por tarea de §7 ni convierte en `passed` nada que no lo fuera. **El umbral no se relaja en ningún escenario de este protocolo.**
> **Base metodológica:** la misma de la [calibración previa](g1-approval-calibration.md) §1–§4 (unidad de muestra, definición de `latencyMs`, forma de T1, `a` en vez de `s`), para que los dos números sean comparables.
> **CAL4 (2026-11-14):** bloque de 20 corridas `CAL4-R02`–`R21`, **n=41** (lectura de 40 idéntica), p95 **26 501 ms**, **14 de 41** por encima de 15 151 ms, publicado como **descriptivo**. Se condujo desde el PTY del agente, no por una persona leyendo el panel: **no es válido como muestra humana** y no acredita la puerta; G1 sigue **NO CERRADO**. Recibo: [`G1-APPROVAL-CAL4-2026-11-14`](receipts/G1-APPROVAL-CAL4-2026-11-14.md). Repetición humana **en pausa por decisión del autor (2026-11-23)** y no ejecutada: [`CAL4H`](g1-approval-cal4-human-runbook.md).

## 1. Qué mide

`approvalLatencyMs` es el tiempo entre `approval_request.createdAt` —cuando el CLI emite la solicitud— y la resolución de la decisión con `approval_result`. El CLI lo publica como `latencyMs` en el evento y en `SessionStepV2.approval`; la TUI además lo imprime en la línea `✓ aprobación allow · N ms`, que es la fuente que se anota a mano.

Incluye: pintado del menú, **lectura humana del diff** y decisión, procesamiento de la tecla y restauración de la terminal. No incluye latencia del modelo, ejecución de la tool ni arranque de sesión.

La unidad de muestra es **una decisión explícita**, no una corrida. Las llamadas cubiertas por `allow-session` no generan muestra porque no vuelven a preguntar.

## 2. Diseño muestral

| Bloque | Corridas | Decisiones esperadas | Estrato | Uso |
| --- | ---: | ---: | --- | --- |
| **Primario** | 20 de T1 (`CAL2-R01`…`CAL2-R20`) | 40 (`fs.edit` + `shell.run` por corrida) | `allow` | **Decide la puerta** |
| **Secundario** | 5 de T8 (`CAL2-D01`…`CAL2-D05`) | ~20 | `deny` | Se reporta aparte; **nunca** se mezcla con el primario |

- El estrato primario replica la forma de la calibración de 2026-11-11 (T1, `fs.edit` sobre `math.mjs` + `shell.run` con `node --test math.test.mjs`, siempre `a`), que es de donde salió el 15 151 ms. Mezclar `deny` o `allow-session` en ese estrato rompería la comparación, así que se publican por separado.
- **Objetivo: n ≥ 40 decisiones incluidas en el primario** (§4.1). Con nearest-rank, el p95 de 40 muestras es la 38.ª (la segunda mayor): sigue siendo **descriptivo**, no una inferencia, igual que el p95 de 10 muestras de la calibración. Se declara así en el recibo.
- Si una corrida produce una o tres decisiones en vez de dos, se anotan las que haya; no se rellena ni se inventa ninguna. Si al cerrar el bloque hay menos de 40, se añaden corridas `CAL2-R21`… con el mismo protocolo hasta llegar a 40 o a 24 corridas, lo que ocurra primero.
- Estas corridas **no cuentan** para las 24 de G1 ni para D1–D5: son calibración, como las `cal-*`.

### 2.1 Latencias que no entran en el bloque

Una latencia medida por el producto **no** es una muestra por sí sola. Las de las corridas de dogfooding —las 28 válidas y sus extras— se quedan en sus fichas como **dato aparte** y no se registran con `g1:cal2 -- add/import`, aunque tengan `latencyMs` numérico y superen el piso de §4.1. El caso que obligó a escribirlo: la aprobación de `spawn_agents` de `G1-D5-05` (`allow`, **68 958 ms**), y la del intento 2 (**76 579 ms**), medidas por el CLI y con su id (`apr_b42b2913`); tampoco la de `G1-D5-06` (`apr_7147edeb`, **51 878 ms**), que ya se anotó así en su ficha.

Razones, en orden de peso:

1. **Régimen distinto.** §3 exige **un operador humano** dedicado; esas aprobaciones las respondió el agente que vigilaba el PTY con sondeo. Es exactamente el régimen que produjo el p95 de 76 982 ms que el bloque intenta sustituir: meter una muestra suya dentro del bloque mezcla los dos regímenes que se quieren separar.
2. **Muestreo prospectivo.** El bloque son 20 corridas nuevas con etiqueta `CAL2-*`, decididas antes de mirar los números; añadir una latencia ya observada rompe esa propiedad y no se puede equilibrar con las siguientes.
3. **Sin declaración de lectura.** I1 pide una justificación de qué se revisó, escrita al cerrar el prompt. Aquí no la hubo (nadie leyó el prompt: lo contestó el bucle), así que entraría como excluida y sólo engordaría el tope de exclusiones del 20 %.
4. **Peso desproporcionado.** Con nearest-rank y n≈40, una sola cola de 68 s se convierte en la referencia del p95 sin describir al operador que se está midiendo.

Si algún día se quiere comparar regímenes, se publica como cifra descriptiva aparte, con su fuente y su operador declarados, y nunca dentro de `samples.jsonl`. Lo mismo vale en sentido contrario: una muestra del bloque respondida por un agente o por un script no cuenta como humana, se excluye y se repite con el operador delante.

### 2.2 Enmienda E1 (2026-11-13): el bloque cierra con n=6

> **Escrita al cerrar el bloque, después de ver seis muestras.** Cambia **cuántas decisiones se recogen**; no toca la referencia de 15 151 ms, ni el piso, ni I1–I4, ni el tope del 20 %, ni la lectura de la puerta. Se declara aquí con fecha y motivo, como pide el encabezado de §7.

El diseño pedía 40 decisiones. Se cierra con **6** porque el resultado ya está determinado:

1. Con nearest-rank, el p95 de 40 es la **38.ª** muestra y la puerta exige `p95 ≤ 15 151 ms`; eso equivale a **como mucho 2 de 40** por encima del umbral.
2. En las seis primeras hay **3** por encima (61 246, 65 056 y 19 702 ms).
3. Añadir muestras no reduce cuántas están por encima, así que la 38.ª será mayor que 15 151 ms con cualquier `n` entre 6 y 40: **el signo no puede cambiar**.

Lo que la enmienda **sí** cuesta, y queda escrito: con n=6 el p95 es el máximo observado y no describe la cola de una muestra grande. Si un ciclo posterior necesita publicar un p95 estable, exige el bloque completo de 40 con su TTY reservado, y la referencia sigue intacta. Las corridas `CAL2-R21`… no se lanzan para este veredicto.

Recibo: [`G1-APPROVAL-CAL2-2026-11-13`](receipts/G1-APPROVAL-CAL2-2026-11-13.md).

## 3. Procedimiento (qué se lanza)

**Precondiciones, todas obligatorias antes de la primera muestra:**

1. Árbol limpio (`git status --short` vacío) y commit fijado con `git rev-parse HEAD`. Nada de código sin commitear durante la muestra.
2. `npm run typecheck && npm run build` en verde; `/api/health` en `http://127.0.0.1:3283` respondiendo.
3. Modelo congelado: `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b`. `maxSteps` 24.
4. **Un solo operador humano** para todo el bloque primario, sin cambios a mitad. Si cambia, el bloque se cierra y el siguiente empieza de cero con otro identificador (`CAL2B-…`).
5. El operador no tiene otra tarea abierta: la latencia incluye su lectura del diff y esa lectura es justamente lo que se mide.

**Por cada corrida:**

```bash
# 1. Sembrar el workspace desechable de T1 (math.mjs roto, math.test.mjs intacto)
npm run g1:seed -- --force --only d1-t1-01

# 2. Lanzar en TTY real, sin --json y sin pipe (con pipe no hay prompt de aprobación)
cd tests/tmp-g1/d1-t1-01
npx tsx ../../../bin/commander.ts agent \
  'El test de `math.mjs` falla: `average([2, 4, 6])` debería dar 4 y `average([10])` debería dar 10. Corrige el defecto en `math.mjs` sin tocar `math.test.mjs`.' \
  --server http://127.0.0.1:3283 \
  --model nvidia/nvidia/nemotron-3.5-lightning-30b-a3b \
  --max-steps 24
```

**Reglas del operador, en el prompt de aprobación:**

- **Leer el diff que el menú imprime** antes de decidir cuando la tool traiga diff (`fs.edit`, `fs.write`). El menú lo pinta solo desde la corrección del [2026-11-13](#128-el-pedido-lleva-el-diff-2026-11-13); `?`/`¿`/`h` queda para diffs multi-hunk o truncados (§4.1, I2).
- Leer y pulsar `a` **en cuanto la decisión esté formada**. Ni antes de leer, ni después de una pausa por otra cosa. Anotar la justificación de una línea nada más cerrar el prompt, mientras se recuerda qué se revisó.
- `a` (permitir una vez) siempre en el bloque primario. **`s` prohibido**: reduce muestras y falsea el estrato.
- `d` sólo si la tool sale del alcance del enunciado; en ese caso la muestra cuenta como `deny` pero **no entra** en el estrato primario, y se anota.
- No escribir en la terminal mientras hay un prompt abierto ni dejar teclas en cola: una tecla residual puede aprobar sin intención (§6 de la hoja de D3) y esa corrida es `invalid`.
- Guardar el log del PTY de cada corrida en `.commander/g1/cal2/<runId>.log` (ignorado por git). La `latencyMs` se lee de la línea de la TUI y se contrasta con `SessionStepV2.approval` cuando el estado la persista.

**Al terminar cada corrida:**

```bash
curl -s http://127.0.0.1:3283/api/agent/sessions/<id> > .commander/g1/cal2/<runId>.json
```

## 4. Qué se anota

Una fila por **decisión**, con estos campos y ninguno más (nada de `input`, diffs con contenido, tokens, cookies ni `.env`). El registro y el cálculo no se llevan a mano: `npm run g1:cal2 -- import …` o `add …` añaden la fila a `.commander/g1/cal2/samples.jsonl` y `npm run g1:cal2 -- summary` publica la tabla y los percentiles con las condiciones de §4.1 aplicadas. Detalle de uso en §6.

**De dónde sale `latencyMs`, en este orden:**

1. **`SessionStepV2.approval.latencyMs`** del estado persistido de la sesión, que es lo que lee `import`. Es la fuente preferida porque no pasa por ninguna transcripción.
2. **La línea `✓ aprobación … · N ms` del log del PTY**, que la TUI imprime al resolver la aprobación. Se teclea con `add --ms` y es la fuente cuando el estado no trae el campo.
3. **Si no existe ninguna de las dos, la muestra no se registra.** No se estima, no se promedia y no se deduce de la diferencia entre pasos: la corrida se repite con etiqueta nueva, porque una latencia sin fuente no es una medida.

**Cuando el estado no persiste el campo**: `import` lo detecta y, por cada aprobación sin `latencyMs`, imprime el comando `add --ms` ya montado con `runId`, tool y decisión, para que lo único que se teclee sea el número. Después se pasa de nuevo `summary`, que recalcula todo.

Ese caso aparece en las **28 corridas de G1**, y no es un fallo del CLI: éste medía y emitía la latencia, pero `stepFrom` (`src/agent/sessionTypes.ts`) reconstruía el `approval` persistido con `id`, `decision` y `reason` y **descartaba `latencyMs`** al normalizar el estado, así que al releer la sesión ya no estaba y las fichas lo anotan como `n/d`. Corregido con test (`tests/unit/sessionApprovalLatency.test.ts`): las corridas nuevas lo conservan y `import` las lee del JSON; las anteriores no se reescriben y siguen necesitando el camino 2. Si una corrida del bloque CAL2 sale sin el campo, el log del PTY sigue siendo obligatorio (§3) y, si tampoco está, la muestra no se registra.

| Campo | Valor |
| --- | --- |
| `sampleId` | `CAL2-01`… en orden de decisión |
| Fecha / hora | ISO-8601 del prompt |
| Commit / modelo / servidor / `maxSteps` | `git rev-parse HEAD` y la configuración congelada |
| `runId` / `sessionId` | `CAL2-R01`… / `sess_…` |
| Tool | `fs.edit` o `shell.run` |
| Decisión | `allow` / `deny` |
| `latencyMs` | entero de la línea `✓ aprobación … · N ms`; si el estado lo persiste, se apunta también y debe coincidir |
| ¿Leyó el diff? | sí / no + **justificación de una línea** de lo revisado (qué archivo, qué cambio, por qué es el pedido). Sin justificación o con una genérica, la muestra no entra (§4.1) |
| `detalleAbierto` | sí / no. El menú **sí** pinta el diff por defecto, así que desde la [enmienda §12](#12-enmienda-2026-11-13--i2-se-mide-sobre-el-log-no-sobre-una-tecla) esto es un dato **descriptivo**, no una condición: lo que acredita I2 es el diff impreso en el log (§12.3) |
| `approval.render` | `{ diffShown, diffTruncated, detailOpened }` que el prompt graba al resolver (`ApprovalRenderFacts`), dentro de `step.approval.render` en el estado de la sesión. Es la evidencia con la que `g1:cal2` decide I2 sin leer el PTY (§12.7) |
| Notas | **sólo** causa de exclusión/invalidación o rareza mecánica |

Además, por corrida: duración, pasos, si hubo turno vacío del proveedor y el resultado del criterio de T1 (test 2/2, hash de `math.test.mjs` intacto, `average([1,2,3,4]) = 2.5`). El criterio de T1 no decide nada aquí, pero una corrida sin dos prompts se explica por él.

### 4.1 Regla de inclusión de la muestra

Para que la latencia mida **lectura y decisión** y no la velocidad de pulsar `a`, una decisión entra en el estrato primario sólo si cumple las cuatro condiciones. Las cuatro se comprueban con lo ya capturado, sin criterio del operador *a posteriori*:

- **I1 — Lectura declarada y justificada.** `¿Leyó el diff? = sí` **y** la justificación de una línea nombra el archivo y el cambio concreto («`math.mjs`: `values.length - 1` → `values.length`»). Sin justificación, o con «ok»/«visto», no entra.
- **I2 — El diff quedó impreso en el log.** El log del PTY contiene, entre el prompt y su resolución, el bloque de diff que pinta el menú (cabeceras `@@` y líneas `+`/`-`), cuando la tool traiga diff (`fs.edit`, `fs.write`). Si ese bloque incluye el aviso `diff truncado en 400, no está completo`, exige además un `hunk i/N` para el tramo omitido. En `shell.run` el comando se muestra en línea, así que esta condición no aplica y se exige sólo I1. La decide el script con `approval.render` (§12.7): `diffShown` y, si `diffTruncated`, `detailOpened`; `--diff-log`/`--detalle` son sólo el respaldo manual de los estados que no traen ese campo. *(Redacción original hasta la [enmienda del 2026-11-13 (§12)](#12-enmienda-2026-11-13--i2-se-mide-sobre-el-log-no-sobre-una-tecla): exigía `?` en el log dando por hecho que el menú no pintaba el hunk. La TUI sabía pintarlo, pero el CLI no adjuntaba `diff` al pedido hasta [§12.8](#128-el-pedido-lleva-el-diff-2026-11-13), así que en las corridas medidas no había bloque que ver.)*
- **I3 — Piso de plausibilidad.** `latencyMs ≥ 1 500 ms`. Es el mínimo declarado, antes de medir, para localizar el hunk y comprobar que el cambio es el pedido; **no** es un objetivo de rapidez ni un umbral de calidad.
- **I4 — Decisión explícita.** Ni `allow-session` ni una llamada cubierta por una aprobación de sesión previa (ya en §2).

**Qué pasa con las que no cumplen:** se listan **fuera** del estrato, con su `latencyMs` y el motivo (`I1`, `I2`, `I3`), y la corrida se repite con etiqueta nueva. Antes de aplicarlas, una condición de procedencia: la decisión tiene que ser de una corrida `CAL2-*` contestada por el operador del bloque. Una latencia medida en dogfooding o por un agente que vigila el PTY no se registra ni siquiera para que salga excluida (§2.1). `n` cuenta sólo las incluidas. Las excluidas no suman ni restan al p95: no entran en el cálculo en ninguna dirección.

**Por qué la regla va en esta dirección.** Excluir una muestra rápida sin lectura sólo puede **subir** el p95 medido, nunca bajarlo; es el sentido correcto para un criterio de calidad, y es lo contrario de «quedarse con las buenas». Y no se puede compensar pulsando `a` a destiempo para caer por encima del piso: I1 exige nombrar el cambio y I2 exige haber abierto el hunk, así que un `a` a 1,6 s sin `?` sigue fuera.

**Tope anti-gaming:** si más del **20 %** de las decisiones del bloque caen por I1–I3, el bloque entero es **inválido** y se repite con otro operador. Un bloque con un quinto de muestras sin lectura dice que no se siguió el protocolo, no que la muestra sea pequeña. El piso de I3 no se sube ni se baja después de ver datos, y el porcentaje de excluidas se publica siempre con su motivo.

## 5. Invalidación (declarada antes de medir)

Dos niveles distintos, que no se mezclan: la **inclusión** de una muestra (§4.1: I1–I4, con la corrida repetida y la muestra listada) y la **invalidación** de una corrida entera, que sólo ocurre por estas causas:

1. Tecla ambigua o en cola que aprobó sin intención (error de operador).
2. Turno vacío del proveedor (`(el modelo no devolvió respuesta)`), documentado en [`issues/G1-EMPTY-TURN.md`](issues/G1-EMPTY-TURN.md).
3. Servidor reiniciado, puerto ocupado o `/api/health` caído a mitad del bloque.
4. Cambio de modelo, commit, `maxSteps` u operador durante el bloque.
5. Workspace contaminado antes de empezar (no está sembrado o ya tiene la corrección aplicada).

**Nunca** se descarta una muestra «por lenta», ni por ser el máximo, ni por quedar fuera de la referencia. Tampoco se descarta por haber leído el diff despacio: eso es exactamente lo que se mide. La corrida descartada se repite con etiqueta nueva y la descartada **se conserva** en la tabla con su motivo.

## 6. Cálculo

Nearest-rank sobre los valores ordenados del **estrato primario incluido** (§4.1), sin ponderar y sin interpolar: `índice = max(1, ceil(p · n))` sobre la lista ordenada. Lo hace el script, no una hoja de cálculo:

```bash
# al cerrar la corrida: latencias del estado de la sesión, si están persistidas
npm run g1:cal2 -- import --run CAL2-R01 \
  --session .commander/g1/cal2/CAL2-R01.json \
  --leido --diff-log --justifica "math.mjs: values.length - 1 → values.length"

# las que el estado no traiga: `import` ya imprime el comando, sólo se teclea el número
npm run g1:cal2 -- add --run CAL2-R01 --tool shell.run --decision allow --ms 2120 \
  --leido --justifica "node --test math.test.mjs, forma canónica"

# al cerrar el bloque (o cuando se quiera ver cómo va)
npm run g1:cal2 -- summary
```

`--leido` es la declaración de lectura y `--justifica` la línea de qué se revisó. `--diff-log` y `--detalle` son **sólo el respaldo manual** de I2 para estados anteriores al campo `render` (§12.7): si la sesión trae `approval.render`, el script decide con eso y las banderas no hacen falta. Sin lectura, justificación ni evidencia de diff, la muestra sale como excluida con su motivo. `--tool` filtra en `import` cuando la justificación es distinta por tool. `import` no duplica: si la aprobación ya estaba registrada (`runId` + `approval.id`), la salta. `summary` imprime la tabla de muestras, el p50/p90/p95/mín/máx/media del primario incluido, el desglose por tool, el estrato `deny` aparte, la lista de excluidas con recuento por condición, el aviso de `n < 40` y el tope del 20 % de exclusiones. El fichero es `samples.jsonl` dentro de `.commander/g1/cal2/` y no se versiona.

Se publican: `n`, p50, p90, p95, mínimo, máximo y media del **estrato primario**, y lo mismo por tool (`fs.edit`, `shell.run`). El bloque `deny` se publica aparte con su propio `n`. Con `n=40`, el p95 es la segunda muestra mayor: se dice en el recibo, sin presentarlo como inferencia.

## 7. Regla de decisión (pre-registrada)

Esta sección se congela **antes** de la primera muestra. Cualquier cambio posterior se declara como enmienda con fecha y motivo, y obliga a repetir el bloque.

### 7.1 La puerta

El estrato primario son **sólo las muestras incluidas** por §4.1; las excluidas se publican aparte y no entran en el p95.

- **p95(primario) ≤ 15 151 ms** → la casilla de §7.1 del plan pasa a verde con este recibo. La referencia **no se toca**.
- **p95(primario) > 15 151 ms** → la casilla sigue en rojo y se aplica §7.2. No hay tercera vía.

### 7.2 Qué decide la muestra, y qué no

Con `n=40` y nearest-rank, **p95 ≤ B es exactamente «como mucho 2 de 40 decisiones por encima de B»**. Así que la puerta se lee en esos términos y la muestra humana **sólo** responde a una pregunta: *¿la aprobación humana cumple el presupuesto de 15 151 ms?*

> **Erratum (2026-11-14).** La redacción original decía «como mucho 1 de 40». El p95 de 40 es la 38.ª muestra, así que el umbral admite **2** por encima; §2.2, la hoja de decisión y el recibo de CAL2 ya usaban 2. Se corrige el texto, no el umbral ni ninguna muestra.

- **No** decide si la referencia se cambia. Una muestra no puede decir si un presupuesto es el correcto: si la distribución humana es la misma que la del operador automatizado, comparar dos muestras para decidir quién manda es una moneda al aire, y por eso aquí no se compara ninguna muestra con otra.
- **No** se usa para estimar un p95 «de referencia» nueva. El p95 de una muestra de 40 es la segunda mayor: cambiar 15 151 por otro número sacado de ahí sería sustituir una referencia provisional por otra igual de provisional, con la diferencia de que la nueva estaría ajustada a los datos que debía juzgar.

Qué se hace según el resultado:

| Resultado del bloque primario | Acción |
| --- | --- |
| p95 ≤ 15 151 ms (≤ 2 de 40 por encima) | Casilla verde. Referencia intacta. |
| p50 ≤ 15 151 < p95 (la típica cumple, la cola no) | Casilla roja + **issue de producto por cola**: tamaño del diff que se pinta, visibilidad del prompt, decisiones que hay que releer. No se toca la referencia. |
| p50 > 15 151 ms (ni la típica cumple) | Casilla roja + análisis de flujo (§7.3). La referencia **sólo** puede cambiar por la vía de §7.3, nunca por este resultado. |

### 7.3 Cómo se cambia la referencia: decisión de presupuesto, no de muestra

La referencia es un **presupuesto de revisión** —cuánto puede tardar una persona en leer un diff y decidir—, no una estadística de lo que el producto hace. Cambiarla es una decisión de producto documentada, y sólo procede si se cumplen **las cuatro** condiciones:

1. **La medición es mecánicamente válida:** n ≥ 40, log de PTY completo por corrida, `latencyMs` de la TUI contrastado con el estado, un solo operador, cero exclusiones por lentitud.
2. **La causa de la lentitud está en el flujo, no en la muestra**, y se documenta con los prompts reales: qué se estaba aprobando, cuántas líneas de diff, si la decisión exigía releer. Una tabla de latencias no basta para mover un presupuesto.
3. **El cambio se escribe en un acto separado y anterior a cualquier medición nueva:** referencia vieja, referencia nueva, motivo, fecha y quién decide. **No vale en el mismo recibo que reporta el fallo**, ni en el mismo commit que la muestra que lo provocó.
4. **El número nuevo se justifica por el trabajo de revisión, no por lo medido.** Se deriva de lo que la persona tiene que leer y decidir (por ejemplo: «diffs de hasta N líneas con vista previa: presupuesto X»), nunca del p95 observado. Si la justificación cita las latencias medidas, la propuesta se rechaza.

Y una regla de cordura, declarada ahora: si la justificación llevara a un presupuesto por encima de **60 604 ms** (4× la referencia actual), no se cambia nada. Un número así no describe aprobación humana razonable, describe fricción de producto: se abre issue y se para.

Cuando se cumplan las cuatro, la referencia nueva se declara **provisional** en el runbook §5.5, en §7.1 del plan y en un recibo propio, con la frase «referencia provisional: \<X ms\>, declarada el \<fecha\>, antes 15 151 ms». **Sólo se cambia una vez por ciclo**; una segunda propuesta exige un ciclo de medición nuevo.

### 7.4 Estado de la casilla mientras la referencia nueva no esté validada

Una referencia recién declarada **no se considera cumplida**, y la casilla no se pone verde con la muestra que motivó el cambio:

- Mientras la referencia nueva **no esté validada**, la casilla de §7.1 queda **NO CUMPLE (referencia provisional sin validar)**. Ni verde, ni «no aplica», ni «pendiente con el umbral antiguo».
- **Validar** significa una muestra **prospectiva**: recogida **después** de congelar la referencia nueva y después de cualquier cambio de flujo, con el mismo protocolo y n ≥ 40, y con **p95 ≤ 0,8 × referencia nueva**. El margen del 20 % está declarado aquí, antes de ver datos, para que el verde no dependa de rozar el número: si la distribución se queda en el borde, no se declara validada.
- Si la muestra prospectiva no alcanza el margen, la referencia **revierte a 15 151 ms**, la casilla sigue roja y el paso siguiente es producto. No se prueban presupuestos sucesivos hasta que uno pase.
- Todo recibo emitido en ese intervalo debe decir, en su primera línea de límites: «referencia provisional: X ms, declarada el \<fecha\>, **sin validar**; la casilla sigue en rojo».

En resumen: **la muestra humana mide cumplimiento contra un número fijo; el número lo fija una decisión de producto documentada; y hasta que una muestra posterior lo valide con margen, la casilla está en rojo.** Ninguna de las tres piezas se compara con otra muestra equivalente.

### 7.5 Lo que no se hace nunca

- Bajar el umbral, o cambiarlo por otro más cómodo, para que la casilla pase.
- Cambiar la referencia en el mismo acto en que se mide el fallo, o justificarla con las latencias observadas.
- Validar la referencia nueva con la muestra que la motivó, o encadenar presupuestos hasta que uno pase.
- Poner la casilla en verde mientras la referencia sea provisional sin validar.
- Descartar muestras lentas, o quedarse con el estrato más favorable, o mezclar `allow`/`allow-session`/`deny` para que el p95 baje.
- Contar en el estrato una muestra sin lectura real (sin el diff en el log, sin justificación o por debajo del piso), o dar el bloque por bueno con más del 20 % de exclusiones por §4.1.
- Bajar el piso de 1 500 ms, o cambiar I1–I3 después de ver datos.
- Declarar el criterio «no aplicable»: el runbook no lo permite para esta métrica y este protocolo no lo propone.

## 8. Qué se publica y qué no cambia

- Recibo saneado nuevo: `docs/parity/receipts/G1-APPROVAL-CAL2-<fecha>.md`, con el formato de [`G1-APPROVAL-CAL-2026-11-11`](receipts/G1-APPROVAL-CAL-2026-11-11.md) (muestras, desglose por tool, p50/p90/p95, exclusiones y decisión). **Emitido:** [`G1-APPROVAL-CAL2-2026-11-13`](receipts/G1-APPROVAL-CAL2-2026-11-13.md) con n=6 por la enmienda E1 de §2.2.
- Crudo en `.commander/g1/cal2/` (logs y estados), ignorado por git.
- Se actualizan, en el mismo acto: §7.1 del plan (valor medido y estado de la casilla), §3 y §8 del recibo de G1, y el runbook §5.5 **sólo** si se declaró una referencia nueva por §7.3.
- **No cambia**: las 28 corridas de G1, las cifras por tarea de §7, el agregado de §5.3 ni la decisión **NO CERRADO** del recibo actual. Un cambio de presupuesto mueve el número de referencia, no la historia medida.

## 9. Coste y tiempos

20 corridas de T1 a 1,5–3 min cada una ≈ **45–60 min** de bloque primario, más 5 de T8 (5–8 min) para el estrato `deny`. Si hubiera que **validar** una referencia nueva (§7.4), la muestra prospectiva es otro bloque de 40 decisiones, con su propio TTY reservado. Presupuesto máximo por corrida: 15 min, con `Ctrl+C` y `cancelled` si se vence. Antes de empezar hay que reservar el TTY: el bloque no se puede atender «de fondo».

## 10. Checklist

- [x] Commit fijado, árbol limpio, `typecheck` y `build` en verde, `/api/health` ok.
- [x] Modelo, servidor y `maxSteps` congelados y anotados.
- [x] Un único operador humano, sin otra tarea abierta, con el TTY a la vista. *Con dos excepciones registradas: `R18` se quedó huérfana al cerrarse el panel y `R19` se decidió desde el chat (descartada).*
- [ ] 20 corridas de T1 sembradas una a una con `--force --only d1-t1-01`. *7 lanzadas (`R13`–`R20`); cierre anticipado por la enmienda E1 de §2.2.*
- [ ] ≥ 40 decisiones `allow` **incluidas** en el estrato primario (I1–I4 de §4.1), todas con `a`, ninguna con `s`; excluidas listadas con su `latencyMs` y su motivo, siempre por debajo del 20 % del bloque. *6 incluidas, 1 de 7 excluidas por I3 (14,3 %): no se llega al objetivo de n por E1, y así se declara en el recibo.*
- [x] Log de PTY y estado de sesión guardados por corrida en `.commander/g1/cal2/`.
- [ ] Bloque `deny` (T8 ×5) reportado aparte, sin mezclarse. *No ejecutado; el recibo no publica estrato `deny`.*
- [x] p50/p90/p95/min/máx/media calculados con nearest-rank y publicados con `n`.
- [x] Descartadas sólo por §5, cada una listada con su motivo y repetida con etiqueta nueva.
- [x] Decisión de §7 aplicada tal cual: puerta con el criterio de §7.2 y, si tocaba, propuesta de presupuesto por §7.3 en acto separado. *NO CUMPLE; no se propone referencia nueva.*
- [x] Si hay referencia nueva, la casilla queda **NO CUMPLE (referencia provisional sin validar)** hasta la muestra prospectiva de §7.4, y así se escribe en el recibo. *No hay referencia nueva: la de 15 151 ms sigue intacta.*
- [x] Recibo saneado en `docs/parity/receipts/` y §7.1 del plan actualizado. *[`G1-APPROVAL-CAL2-2026-11-13`](receipts/G1-APPROVAL-CAL2-2026-11-13.md).*

## 11. Registro del bloque en curso

Bloque empezado el **2026-11-12** contra `HEAD` `9aa19e8` (hoy en el squash #27, `07fc0e1`), servidor `:3283`, modelo `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b`, `--max-steps 24`.

> **Estado (2026-11-13):** **bloque CERRADO con n=6 · NO CUMPLE** ([recibo](receipts/G1-APPROVAL-CAL2-2026-11-13.md), enmienda E1 de §2.2) · **6 de 40** decisiones incluidas · referencia **15 151 ms** (§7.1, no se relaja) · `p95 65 056 ms` con n=6 → **NO CUMPLE** · `CAL2-R16` se cerró sin decisión al caducar el prompt, `CAL2-R18` quedó huérfana al cerrarse el panel y `CAL2-R19` no cuenta (aprobación teledirigida desde el chat, §11.1) · `CAL2-R17` completó el par y sus dos mitades entraron como `CAL2-04` (2 104 ms) y `CAL2-05` (1 792 ms), la primera `shell.run` que pasa I3 desde `R12` · `CAL2-R20` aporta `CAL2-06` (4 641 ms) y pierde su mitad `shell.run` por 53 ms · el veredicto ya no puede cambiar con las 34 muestras que faltan (§12.10) · próximas corridas `CAL2-R21`… con el mismo protocolo · Se actualiza con `npm run g1:cal2 -- summary`.

### 11.1 Corridas descartadas

Una corrida descartada no entra en el bloque: se lista aquí con su motivo (§5) y se repite con etiqueta nueva. Sus filas crudas quedan en `.commander/g1/cal2/discarded-<runId>.jsonl` (ignorado por git) y **no** se registran en `samples.jsonl`, para que no engorden el recuento de exclusiones del 20 % de §4.1.

**Vocabulario de la tabla.** *Panel* es la terminal del operador, donde aparece `⚠ fs.edit espera aprobación` y se decide con `a`/`d`/`s`: es la única vía que graba la evidencia de I2. *Estado* es el JSON de la sesión en `:3283` (`/api/agent/sessions/<id>`), del que `g1:cal2 import` toma aprobaciones, latencias y `approval.render` (el campo que anota qué se pintó antes de decidir y si el prompt caducó, §12.7). *CLI* es el programa de terminal que lanza la corrida (`bin/commander.ts`). *I1–I4* son las condiciones de inclusión de §4.1, y *§5.1*/*§5.3* las causas de invalidación numeradas en §5. *T1* es el criterio de la tarea (los dos tests de `math.test.mjs` en verde): no decide la muestra, pero explica una corrida sin par.

| Corrida | Sesión | Decisión | `latencyMs` | Motivo | Repetición |
| --- | --- | --- | ---: | --- | --- |
| `CAL2-R20` | `sess_b1f5ca8c` | `fs.edit` · `allow` | 4 641 | **Incluida como `CAL2-06` (I1–I4).** Diff impreso y `diffShown:true`; lectura declarada con `math.mjs: values.length - 1 → values.length`. Primera corrida con el bucle de `fs.edit` de §11.3 activo: el modelo repitió la edición, la guarda la bloqueó y esta vez siguió hasta verificar. T1 se cumplió (2/2 tests, hash `be85fe55…` intacto, 17 pasos). | `—` |
| `CAL2-R20` | `sess_b1f5ca8c` | `shell.run` · `allow` | 1 447 | **Fuera por I3: 53 ms por debajo del piso.** Comando `node --test math.test.mjs` leído en el menú (§11.2 punto 8). Es la quinta mitad `shell.run` seguida que no llega a 1 500 ms; el guard de `import` la rechazó antes de escribir y el bloque queda en 1 de 7 decisiones `allow` excluidas (14 %, dentro del tope). | `CAL2-R21` |
| `CAL2-R19` | `sess_e6b600c6` | `fs.edit` · `allow` | 105 222 | **No produce muestra: latencia no atribuible al operador.** Con el panel cerrado, la corrida se relanzó en un PTY del agente y la aprobación se pulsó desde el chat mientras se discutía el menú; esos 105 222 ms miden la conversación, no una lectura. Además el modelo entró en bucle de `fs.edit` (seis reintentos bloqueados) y agotó los pasos sin ejecutar el test, así que tampoco hay mitad `shell.run`. Sí quedó `render.diffShown:true`. | `CAL2-R20` |
| `CAL2-R18` | `sess_38782273` | `fs.edit` · `—` | — | **Sin decisión: sesión huérfana.** El menú llegó a abrirse y el panel de terminal se cerró antes de que nadie decidiera; el CLI murió con él y la sesión sigue marcada `running` en `:3283` sin proceso detrás. No hay latencia ni `render` que anotar. | `CAL2-R20` |
| `CAL2-R17` | `sess_2bcc3d3e` | `fs.edit` · `allow` | 2 104 | **Incluida como `CAL2-04` (I1–I4).** Hunk impreso y `diffShown:true`; lectura declarada con `math.mjs: values.length - 1 → values.length`. Es la `fs.edit` más rápida del bloque, nueve veces por debajo de las de `R13`–`R15`: T1 se cumplió igual (2/2 tests, hash intacto, 13 pasos, 22 260 ms). | `—` |
| `CAL2-R17` | `sess_2bcc3d3e` | `shell.run` · `allow` | 1 792 | **Primera mitad `shell.run` que pasa I3 desde `CAL2-R12`.** Tras cuatro seguidas en 1 300, 1 116, 872 y 993 ms, esta se decidió leyendo el comando y esperando un par de segundos (§11.2 punto 8): supera el piso y entra como `CAL2-05`, con `node --test math.test.mjs` como justificación. Cierra el primer par completo del bloque desde que empezó esta serie. | `—` |
| `CAL2-R16` | `sess_3bb11df9` | `fs.edit` · `deny` | 300 008 | **Cierre mecánico: el prompt caducó, no hubo decisión del operador.** El menú apareció con el hunk impreso (`diffShown:true`) y después el panel se quedó en blanco con el CLI vivo; sin repintado ni tecla, el guardado nuevo lo resolvió a los 5 minutos como `deny` con `reason: "expired"` y dejó la sesión `cancelled` (7 pasos, sin respuesta). No hay lectura ni latencia que medir, así que **no produce muestras**: no es una exclusión de §4.1, es una corrida que no llegó a decidirse. **Qué cambia:** el repintado de §11.2 punto 9 evita el blanco; la corrida se repite con operador delante en `CAL2-R17`. | `CAL2-R17` |
| `CAL2-R15` | `sess_2715e5c3` | `fs.edit` · `allow` | 19 702 | **Pendiente de I1; I2 e I3 ya cumplidas.** El menú imprimió el hunk, `approval.render` trae `diffShown:true`, la decisión fue `a` en el panel y T1 se cumplió (2/2 tests, `math.mjs` corregido, 13 pasos, 39 079 ms). Como en `CAL2-R13` y `R14`, está pendiente de I1 hasta que se declare la lectura; **declarada la lectura, entra como muestra** aunque el par quede incompleto: §2 no rellena la mitad que falta, la compensa con corridas `CAL2-R21`…. | `—`; compensa con `CAL2-R21`… |
| `CAL2-R15` | `sess_2715e5c3` | `shell.run` · `allow` | 993 | **I3: por debajo del piso de 1 500 ms.** Cuarta corrida seguida sin par por la segunda mitad (las tres filas anteriores traen el mismo caso), y esta vez con el operador delante: lo que falla no es que no hubiera nadie, es el ritmo al aprobar un comando. Esta mitad queda fuera y se compensa con corridas `CAL2-R21`…, sin repetir la `fs.edit` de la misma corrida. | `—`; compensa con `CAL2-R21`… |
| `CAL2-R14` | `sess_2135286c` | `fs.edit` · `allow` | 65 056 | **Pendiente de I1; I2 e I3 ya cumplidas.** El menú imprimió el hunk, `approval.render` trae `diffShown:true`, la decisión fue `a` en el panel y T1 se cumplió (2/2 tests, `math.mjs` corregido, 15 pasos, 81 940 ms). Igual que en `CAL2-R13`: pendiente de I1 hasta que se declare la lectura; **declarada, entra como muestra** aunque el par quede incompleto, porque §2 anota las decisiones que haya y compensa la que falta con corridas `CAL2-R21`…. | `—`; compensa con `CAL2-R21`… |
| `CAL2-R14` | `sess_2135286c` | `shell.run` · `allow` | 872 | **I3: por debajo del piso de 1 500 ms.** Tercera corrida seguida sin par por la segunda mitad (las dos filas anteriores traen el mismo caso), así que lo que falla ya no es una corrida suelta: es cómo se aprueba el `shell.run`. Esta mitad queda fuera y se compensa con corridas `CAL2-R21`…, sin repetir la `fs.edit` de la misma corrida. | `—`; compensa con `CAL2-R21`… |
| `CAL2-R13` | `sess_334fd638` | `fs.edit` · `allow` | 61 246 | **Pendiente de I1; I2 e I3 ya cumplidas.** El menú imprimió el hunk, `approval.render` trae `diffShown:true`, la decisión fue `a` en el panel por encima del piso y T1 se cumplió (2/2 tests, `math.mjs` corregido, 14 pasos). Falta sólo la justificación de lectura: **hasta que se declare, esta mitad no entra**; declarada, es muestra primaria aunque el par quede incompleto (la otra mitad cayó por I3), porque §2 anota las decisiones que haya y compensa la que falta con corridas `CAL2-R21`…. | `—`; compensa con `CAL2-R21`… |
| `CAL2-R13` | `sess_334fd638` | `shell.run` · `allow` | 1 116 | **I3: por debajo del piso de 1 500 ms.** Segunda corrida seguida con el `shell.run` decidido en torno al segundo (la fila anterior trae el mismo caso), que es lo que deja el par sin su segunda decisión. Esta mitad queda fuera y se compensa con corridas `CAL2-R21`…; la mitad `fs.edit` de la misma corrida no se repite, cuenta por sí sola. | `—`; compensa con `CAL2-R21`… |
| `CAL2-R12` | `sess_888c1414` | `fs.edit` · `allow` | 13 250 589 | **§3: prompt sin operador delante.** El prompt quedó abierto unas **3 h 40 min**, así que la latencia mide espera y no lectura, igual que `CAL2-R01`. Aquí la evidencia sí es la que se buscaba —`approval.render` trae `diffShown:true` y el menú imprimió el hunk antes de la decisión— y T1 se cumplió (2/2 tests, `math.mjs` corregido, 15 pasos), pero eso acredita el arreglo, no una muestra. Sin justificación declarada (I1). **Qué cambia:** nada que arreglar en el producto; la corrida se repite con operador delante en `CAL2-R13`. | `CAL2-R13` |
| `CAL2-R12` | `sess_888c1414` | `shell.run` · `allow` | 1 300 | **I3: por debajo del piso de 1 500 ms.** El par se repite entero porque la mitad `fs.edit` cayó por §3; con el piso, esta decisión no entraría ni con la otra en regla. | `CAL2-R13` |
| `CAL2-R11` | `sess_4745f621` | `fs.edit` · `allow` | 175 658 | **I2: el pedido no traía diff.** El menú se abrió en el panel y se decidió ahí —`approval.render` está presente, con el servidor ya al día—, pero el CLI todavía no adjuntaba `diff`, así que no había hunk que enseñar ni que desplegar: `diffShown:false` y `detailOpened:false` describen el pedido, no la lectura. Sin justificación declarada (I1). T1 sí se cumplió (2/2 tests, `math.mjs` corregido, 15 pasos, 217 981 ms). **Qué cambia:** el diff viaja con el pedido desde §12.8; el par se repite en `CAL2-R12`. | `CAL2-R12` |
| `CAL2-R11` | `sess_4745f621` | `shell.run` · `allow` | 11 915 | **I1: sin lectura declarada.** Un `shell.run` no lleva diff, así que sólo le falta la justificación; el par se repite entero porque la mitad `fs.edit` cayó por I2. | `CAL2-R12` |
| `CAL2-R10` | `sess_f21744fa` | `fs.edit` · `deny` | 210 192 | **Denegada (I4): una denegación no genera muestra primaria.** El menú estuvo abierto unos tres minutos sin que nadie decidiera y se cerró denegando; el modelo reintentó la misma edición y esa sí se aprobó, en la fila siguiente. | `CAL2-R11` |
| `CAL2-R10` | `sess_f21744fa` | `fs.edit` · `allow` | 3 106 | **I2: el pedido no traía diff.** El menú se pintó en el panel y la aprobación se decidió ahí, pero el CLI no adjuntaba `diff` al pedido, así que el menú no tenía hunk que imprimir ni `?` nada que desplegar. Y ese servidor de `:3283`, arrancado antes del commit `73c820d` (hoy en el squash #27, `07fc0e1`), filtraba el estado sin conocer `approval.render` y lo borraba al guardarlo (comprobado con una sonda: respondía 200 y el campo desaparecía al releerlo), así que tampoco quedó el registro. Sin justificación declarada (I1). T1 sí se cumplió (2/2 tests, `math.mjs` corregido, 15 pasos, 246 344 ms). **Qué cambia:** el servidor se reinició con el código actual (§11.1.1, §11.2 punto 7) y el CLI adjunta el diff desde §12.8; el par se repite en `CAL2-R11`. | `CAL2-R11` |
| `CAL2-R10` | `sess_f21744fa` | `shell.run` · `allow` | 4 549 | **I1: sin lectura declarada**, y sin `render` por el mismo servidor anterior al campo. El par se repite entero en `CAL2-R11`. | `CAL2-R11` |
| `CAL2-R09` | `sess_4236efcd` | `fs.edit` · `allow` | 5 658 | **I2: se decidió sin pasar por el menú del panel.** No apareció ningún prompt en el panel y el estado no trae `approval.render` en ninguna de las dos aprobaciones, así que no hay constancia de que el diff se imprimiera delante del operador: ese dato sólo lo graba el menú. Aun pasando por él no habría bloque que ver, porque el pedido no traía `diff` (§12.8). Sin lectura declarada (I1). T1 sí se cumplió (2/2 tests, `math.mjs` corregido, 14 pasos), que aquí no cambia nada. | `CAL2-R10` |
| `CAL2-R09` | `sess_4236efcd` | `shell.run` · `allow` | 26 197 | **I1: sin lectura declarada**; tampoco trae `render`. El par se repite entero en `CAL2-R10` porque la otra mitad cayó por I2. | `CAL2-R10` |
| `CAL2-R08` | `sess_56945244` | — | — | **§5.3: corrida abortada, sin decisiones.** El panel se reinició cuando la corrida iba por el paso 4: el proceso que estaba corriendo la sesión murió, no hubo ninguna aprobación (`pendingApproval` vacío) y la sesión se quedó marcada `running` hasta cancelarla a mano. Dejó el workspace a medias, así que se siembra otra vez antes de repetir. | `CAL2-R09` |
| `CAL2-R07` | `sess_45f77308` | — | — | **§5.1: corrida cancelada sin decisiones.** Se lanzó durante el diagnóstico de la tecla de detalle y se canceló con el prompt de `fs.edit` abierto (`apr_a2423695` sin responder): cero aprobaciones en el estado. | `CAL2-R08` |
| `CAL2-R06` | `sess_424ef66f` | `fs.edit` · `allow` | 42 672 | **I2: el pedido no traía diff.** El registro no muestra desplegable porque no había hunk: el CLI no adjuntaba `diff` (§12.8) y la tecla, aunque llegara, no tenía nada que abrir. Sin justificación declarada (I1). La corrida completó el par (13 pasos, 88 610 ms), pero su `shell.run` no guardó salida: T1 no se puede acreditar desde el estado. **Qué cambia:** el requisito de la tecla se retiró en la enmienda §12, pero no bastaba: el diff llega al menú desde §12.8 y la evidencia la graba la propia aprobación (§12.7), así que esta causa no puede repetirse. | `CAL2-R08` (con la [enmienda §12](#12-enmienda-2026-11-13--i2-se-mide-sobre-el-log-no-sobre-una-tecla)) |
| `CAL2-R06` | `sess_424ef66f` | `shell.run` · `allow` | 12 456 | **I1: sin lectura declarada.** Un `shell.run` no lleva diff, así que no se le pide evidencia de hunk; el par se repite entero porque la mitad `fs.edit` cayó por I2. **Qué cambia:** nada que hacer con la tecla; el diff llega al menú desde §12.8 y lo que falta es la justificación de lectura en las dos decisiones. | `CAL2-R08` |
| `CAL2-R05` | `sess_2188b182` | `fs.edit` · `allow` | 18 137 | **I2: el pedido no traía diff.** Misma causa que `CAL2-R06`: sin `diff` en el pedido no había hunk que desplegar, y el par completo con T1 en verde (6 pasos, 2/2 tests) no cambia eso. Sin justificación declarada (I1). **Qué cambia:** primero se amplió el mapeo de la tecla a `?/¿/h`, que no era el problema; desde §12.8 el diff llega al menú y la aprobación lo graba. | `CAL2-R06` |
| `CAL2-R05` | `sess_2188b182` | `shell.run` · `allow` | 6 475 | **I1: sin lectura declarada.** Sin diff que enseñar, esta decisión sólo necesita lectura declarada; el par se repite porque la otra mitad cayó por I2. | `CAL2-R06` |
| `CAL2-R04` | `sess_e71d4b99` | `fs.edit` · `allow` | 3 354 | **I2: el pedido no traía diff.** Misma causa que `CAL2-R05`: el registro no muestra desplegable porque el menú nunca recibió el hunk. El par se completó y T1 pasó (2/2 tests, `math.mjs` corregido, 7 pasos), pero la decisión no se acreditó como tomada sobre el diff. Sin justificación declarada (I1). **Qué cambia:** desde §12.8 el diff viaja con el pedido y la aprobación graba `diffShown` (§12.7). | `CAL2-R05` |
| `CAL2-R04` | `sess_e71d4b99` | `shell.run` · `allow` | 53 609 | **I1: sin lectura declarada.** Sin diff, esta decisión sólo necesita lectura; el par se repite entero porque la otra mitad cayó por I2. | `CAL2-R05` |
| `CAL2-R03` | `sess_3743c7b8` | `fs.edit` · `allow` | 225 426 | **I2: el pedido no traía diff, así que el detalle no se pudo abrir.** El registro no muestra desplegable entre el menú y la decisión, y tampoco hay lectura declarada (I1). La corrida produjo **una sola** decisión: el `shell.run` no llegó a pedirse porque el modelo repitió la misma edición hasta cerrar la sesión (§11.3). **Qué cambia:** el diff llega al menú desde §12.8 y el bucle de edición ya no cierra la sesión, así que la segunda decisión sí llega. | `CAL2-R04` |
| `CAL2-R02` | `sess_fc22d49a` | `fs.edit` · `deny` («sin decisión») | 16 325 | **§5.1: prompt cerrado sin decisión.** El menú se resolvió solo como `deny` (el operador salió del detalle con `Esc`, que descarta la decisión en vez de volver al menú). Sin lectura declarada (I1) ni decisión explícita (I4). | `CAL2-R03` |
| `CAL2-R02` | `sess_fc22d49a` | `fs.edit` · **`allow-session`** | 2 382 | **§3: `s` en el estrato primario.** Segunda vez en el bloque; no genera muestra (I4) y deja la corrida sin su par. | `CAL2-R03` |
| `CAL2-R01b` | `sess_3118a916` | — | — | **§5.1: corrida abandonada.** Se lanzó sin operador delante y se canceló con el prompt de `fs.edit` abierto, sin decisión; no hay muestra ni criterio de T1. | `CAL2-R02` |
| `CAL2-R01` | `sess_134cffe0` | `fs.edit` · `allow` | 596 792 | **§3: prompt sin operador delante.** El menú estuvo abierto ~10 min antes de que alguien lo mirara, así que la latencia mide espera, no lectura del hunk. Sin lectura declarada ni justificación (I1) y sin evidencia de `?` (I2). | `CAL2-R02` |
| `CAL2-R01` | `sess_134cffe0` | `shell.run` · **`allow-session`** | 670 073 | **§3: `s` prohibido en el estrato primario.** Una decisión `allow-session` no genera muestra (I4) y la corrida no puede aportar la segunda decisión del par. | — (no produce muestra; el par se repite entero en `CAL2-R02`) |

`CAL2-R02` además cerró sin respuesta final («Bucle detectado: fs.edit repite el mismo input ya aplicado»), lo que no decide la muestra pero explica que el modelo reintentara la misma edición después de la denegación. `CAL2-R03` cerró igual, con el mismo bucle, y por eso no hubo segunda aprobación que anotar.

`CAL2-R01` sí completó T1 (7 pasos, 2/2 tests, `math.test.mjs` intacto con su hash), pero eso no la hace válida como muestra: el criterio de la tarea no es lo que se mide aquí.

### 11.1.1 Estado de las sesiones descartadas (comprobado 2026-11-13)

- Antes de lanzar una corrida se comprueba que el servidor `:3283` no tenga sesiones en `running`: una sesión viva con un prompt abierto falsea el turno del operador.
- El registro de `approval.render` (§12.7) se probó en el panel con una sonda, que devolvió `{"diffShown":true,"diffTruncated":false,"detailOpened":false}`. Tras reiniciar el servidor (necesario cuando cambia el filtrado del estado, §11.2 punto 7) las sesiones que sólo vivían en memoria se pierden: los estados que hagan falta se exportan antes (`/api/agent/sessions/<id>` → `.commander/g1/cal2/`).

### 11.3 El bucle que cortaba las corridas (defecto de producto)

Las corridas `CAL2-R02` y `CAL2-R03` no murieron por la denegación: en `CAL2-R03` hubo **una sola** aprobación (`allow` a los 225 426 ms) y aun así el modelo reemitió la misma `fs.edit` tres veces seguidas. En el cliente del CLI (`src/cli/agentClient.ts`), `completedMutations` sólo se llena cuando la tool **se ejecuta bien** (`result.ok`), así que un `deny` no marca nada y el reintento tras denegar es legítimo; lo que sí pasaba es que la primera repetición de una edición ya aplicada se devolvía como **éxito mudo** («Sin cambios: …») y la segunda **cerraba la sesión** como `failed` con «Sin respuesta final», sin dejar que el agente verificara con `shell.run`.

Arreglado: la primera repetición avisa («No repitas la edición: verifica con shell.run o responde») y las siguientes se devuelven como fallo explícito, sin cerrar la sesión. Lo fija `tests/cli/approvalGate.test.ts` con el escenario `tool-edit-same-three` (tres ediciones idénticas y respuesta final): sin el arreglo el caso falla, con él pasa y sólo se ejecuta una edición.

**Segundo tramo, medido en `CAL2-R19` (2026-11-13).** Tolerar la repetición no basta cuando el modelo no la lee: esa corrida repitió la misma `fs.edit` **seis veces**, la guarda devolvió seis fallos explícitos y el modelo siguió, gastando los 24 pasos sin ejecutar el test ni dar respuesta. Ahora la **cuarta** llamada idéntica a una mutación ya aplicada (`MAX_IDENTICAL_MUTATIONS`) corta la corrida: emite el motivo, lo deja como respuesta final y marca la sesión `failed` con ese error, en vez de consumir el presupuesto hasta el último paso. El escenario `tool-edit-same-six` lo prueba (corta en el paso 4 de 24, una sola edición ejecutada) y la mutación de quitar el corte lo tumba.

### 11.2 Qué se corrige en la siguiente corrida

1. El operador está delante **antes** de lanzar y no cambia de tarea mientras el prompt esté abierto.
2. El diff a la vista antes de decidir en `fs.edit` (el menú lo pinta; `?`/`¿`/`h` sólo si el log avisa de truncado) y `a` —nunca `s`— en las dos decisiones del par.
3. Si una corrida queda sin operador, se cancela y se repite con etiqueta nueva en vez de aprobarla tarde.
4. Tras el detalle, se pulsa **`a`** directamente: `Esc` cierra el prompt **denegando** («sin decisión»), no vuelve al menú. Así se perdió la primera decisión de `CAL2-R02`.
5. El detalle del hunk se abre con **`?`, `¿` o `h`**. En `CAL2-R04`, `R05` y `R06` se atribuyó la falta de detalle al teclado (el prompt de entonces aceptaba sólo `?`), así que se amplió a las tres (`tests/cli/approvalPrompt.test.ts`, caso «? , ¿ y h abren el detalle del hunk»; el menú lo anuncia como `?/¿/h detalle del hunk`). **Desde la [enmienda §12](#12-enmienda-2026-11-13--i2-se-mide-sobre-el-log-no-sobre-una-tecla) la tecla ya no es condición de inclusión:** I2 se cumple con el diff impreso. El motivo real de aquellas tres corridas era otro —el pedido no traía diff ([§12.8](#128-el-pedido-lleva-el-diff-2026-11-13))— y está corregido en el cliente.
6. **Decidir en el menú del panel, no fuera de él.** Si la corrida avanza sin que aparezca el prompt en el panel (como `CAL2-R09`), algo lo resolvió fuera del menú: el estado no traerá `approval.render`, I2 no se cumple y el par no cuenta. En ese caso se cancela y se relanza en vez de esperar a que termine.
7. **Comprobar que el servidor conoce el campo:** tras cualquier cambio en el saneador del estado, reiniciar `:3283` y verificar la ida y vuelta de `approval.render` con una sesión sonda antes de medir. Un servidor anterior al campo no falla: acepta el `PUT` y borra la evidencia en silencio, que es lo que costó `CAL2-R10`.
8. **En `shell.run`, leer el comando antes de pulsar.** No hay hunk que mirar, así que la tentación es pulsar `a` en el mismo segundo en que aparece el prompt: de `CAL2-R12` en adelante **cuatro** mitades `shell.run` seguidas se decidieron en torno al segundo y cayeron por I3. El piso de 1 500 ms se queda como está; lo que cambia es el ritmo: leer la línea, contar un par de segundos y después decidir. Mejor esperar de más que perder el par entero por la mitad más barata.
9. **Si el panel se queda en blanco, el prompt se repinta solo; no pulsar a ciegas.** Pasó en `CAL2-R16`: el menú de `fs.edit` dejó de verse con el prompt abierto, aunque el CLI seguía vivo y el paso no había avanzado. Desde entonces el propio prompt se reescribe ante un **`SIGWINCH`** y con un **latido cada 5 s** (§12.9), sin mover la selección ni decidir nada, así que lo que hay que hacer es **esperar un par de segundos** y volver a mirar. Si aun así la pantalla sigue vacía, es el terminal y no el prompt: se fuerza con `↓` y `↑` (la selección baja a `2) Denegar` y vuelve a `1) Permitir una vez`) antes de decidir. **El menú sigue escuchando aunque no se vea** —`1` y `a` entran igual—, pero decidir sin verlo es exactamente lo que I1 excluye.
10. **Mirar el aviso antes de anotar la corrida.** `npm run g1:cal2 -- import …` avisa por cada aprobación sin `approval.render` y dice si otra de la misma sesión sí lo trae —se decidió fuera del menú— o si no hay constancia; con ese aviso la corrida se repite sin discutir el motivo.

## 12. Enmienda 2026-11-13 — I2 se mide sobre el log, no sobre una tecla

> **Escrita antes de seguir midiendo y después de ver `CAL2-R04`, `CAL2-R05` y `CAL2-R06`.** Cambia **cómo se comprueba** una condición de inclusión; **no** toca la referencia de 15 151 ms, las demás condiciones, ni el estado de las corridas ya descartadas. Al ser una enmienda posterior a muestras observadas, se declara aquí con fecha y motivo (§7, encabezado).

### 12.1 Qué muestran los datos

| Corrida | `fs.edit` | `hunk i/N` en el log | `shell.run` | Criterio T1 |
| --- | --- | --- | --- | --- |
| `CAL2-R04` | `allow` 3 354 ms | no | `allow` 53 609 ms | 2/2 tests |
| `CAL2-R05` | `allow` 18 137 ms | no | `allow` 6 475 ms | 2/2 tests |
| `CAL2-R06` | `allow` 42 672 ms | no | `allow` 12 456 ms *(corregido el 2026-11-13: al escribir la tabla se anotó «pedido después»)* | — (el estado no guardó la salida del test) |

Tres corridas seguidas con el par aprobado por una persona delante, T1 en verde en dos de ellas y **ninguna** con la tecla de detalle en el log. Con `parseApprovalKeys` aceptando ya `?`, `¿` y `h`, la tecla seguía sin llegar. **Corrección del 2026-11-13:** no era la tecla. El pedido no llevaba `diff` (§12.8), así que no había hunk que desplegar; en estas tres filas la columna «`hunk i/N` en el log» mide algo que nunca pudo ocurrir.

### 12.2 La premisa de I2 era cierta con el CLI de entonces

I2 se escribió afirmando que «el menú de aprobación no pinta el hunk por defecto». Esta enmienda lo dio por falso leyendo `promptApprovalDecision`, que llama a `renderDiff(approval.diff, { maxLines: DIFF_MAX_LINES })` antes de `renderMenu`: la TUI **sí** sabe pintarlo, pero sólo cuando la aprobación trae `diff`, y el cliente del CLI (`src/cli/agentClient.ts`) construía el pedido con `id`, `sessionId`, `tool`, `input`, `createdAt` y `expiresAt` sin ese campo. En las corridas medidas el menú enseñaba el título de la tool y nada más, y `?`/`¿`/`h` no tenía hunk que abrir. La premisa original era cierta para el binario que se estaba usando, sólo que la causa estaba en el cliente y no en el prompt.

Con eso, I2 dejó de medir «¿se vio el diff?» y pasó a medir «¿llegó una tecla?», que aquí depende del teclado y del panel. Con el cliente corregido (§12.8) el diff llega y la condición vuelve a medir lo que dice medir.

### 12.3 Nueva redacción de I2

**I2 — El diff quedó impreso en el log antes de la decisión.** Aplica a toda tool que traiga `diff` (`fs.edit`, `fs.write`).

- Se cumple si entre el prompt de aprobación y su resolución el log del PTY contiene el bloque de diff que pinta el menú (cabeceras `@@` y líneas `+`/`-`).
- Si ese bloque incluye el aviso `diff truncado en 400, no está completo`, I2 exige además un `hunk i/N` para el tramo omitido: ahí la tecla sí es la única forma de verlo.
- `detalleAbierto` se sigue anotando por corrida, pero como **dato descriptivo** (cuántas veces se usó `?`/`¿`/`h`), no como condición de inclusión.
- La evidencia no se lee del transcript: la graba la propia aprobación al resolver (`ApprovalRenderFacts`) y viaja con el paso de la sesión hasta `g1:cal2` (§12.7).
- En el script, `--diff-log` queda como respaldo manual para estados viejos; `--detalle` deja de ser obligatorio y pasa a descriptivo.

### 12.4 Qué no cambia

- **I1 sigue siendo obligatoria**: justificación de una línea con archivo y cambio concreto. Sin ella la muestra no entra, y es la que acredita que hubo lectura.
- **I3** (piso de 1 500 ms) e **I4** (nada de `allow-session`) intactas.
- **La referencia y §7, intactos.** Ninguna latencia de esta enmienda se usa para mover el presupuesto.
- **`CAL2-R04`, `R05` y `R06` siguen descartadas.** Se midieron con la regla anterior y no se reincorporan: reabrir muestras ya observadas al cambiar la regla es exactamente «quedarse con las buenas» (§7.5).
- El tope del 20 % de exclusiones por I1–I3 sigue igual.
- El arreglo de teclas (`?`, `¿`, `h`) **no se revierte**: sigue siendo la vía para diffs multi-hunk y para el caso de truncado.

### 12.5 Por qué no las alternativas

- **Dejar I2 como estaba:** excluye por teclado y no por lectura; con tres corridas ya cayó el 100 % de las decisiones `fs.edit`, y el bloque entero sería inválido por el tope del 20 % por una causa mecánica.
- **Quitar I2 sin sustituirla:** dejaría sin comprobación que el diff estuvo delante. Por eso se sustituye por un hecho del log, no se elimina.
- **Cambiar el código para que el diff sólo se vea tras pulsar una tecla:** empeora el producto para que la métrica cuadre, y la condición seguiría midiendo el teclado.

### 12.6 Vigencia

Rige desde la corrida siguiente a este commit (`CAL2-R08` en adelante). `CAL2-R07` se juzga con la regla vigente cuando se lanzó (I2 por tecla) y, si no trae `hunk i/N`, se descarta como las tres anteriores.

**Ocurrido después:** `CAL2-R08` a `CAL2-R11` se juzgaron con esta redacción y cayeron igual por I2, porque el pedido seguía sin `diff` (§12.8). No se reincorporan. La regla con el diff adjunto rige desde `CAL2-R12`.

**Ocurrido:** `CAL2-R07` (`sess_45f77308`) se canceló el 2026-11-13 con el prompt de `fs.edit` sin responder y **cero** aprobaciones, así que no llega a juzgarse por I2 (§11.1.1); su par se repite en `CAL2-R08`.

### 12.7 La evidencia de I2 se graba sola (2026-11-13)

Con I2 enmendada, comprobarla leyendo el transcript del PTY dejaba la condición sin rastro en los datos. Ahora la graba el prompt:

- `promptApprovalDecision` escribe en el propio pedido `ApprovalRenderFacts`: `diffShown` (el menú imprimió el diff), `diffTruncated` (el render avisó de que no cabía completo) y `detailOpened` (se abrió un hunk con `?`/`¿`/`h`). Se graba al resolver, también cuando se resuelve sin decisión.
- **`expired`** es la excepción a «qué se pintó»: el mismo `finish` lo pone a `true` cuando el prompt pasa de `expiresAt` y se resuelve como `deny` sin que nadie decidiera. Viaja por el mismo camino y sólo aparece cuando es `true`, así que un `render` que no lo trae describe una aprobación que sí se decidió. El motivo se repite en `step.approval.reason` (`expired`) y la sesión se cierra como `cancelled` en vez de esperar otro intento. Ninguna corrida del bloque ha caducado todavía: el guardado es posterior a las que hay en §11.1.
- `agentClient` lo adjunta a `step.approval.render` y al evento `approval_result`. El saneador del estado (`renderFactsFrom`) sólo acepta el campo si `diffShown` es booleano: un `render` a medias no se completa con `false`, porque eso afirmaría que no se pintó el diff. El script reutiliza ese mismo saneador, para que no haya dos lecturas del campo que puedan divergir.
- `g1:cal2 import` decide I2 con `diffShown && (!diffTruncated || detailOpened)`. Sin `render` (estados anteriores) cae a `--diff-log`/`--detalle`; sin nada, excluye por I2 y no inventa evidencia.
- Un pedido aprobado desde el escritorio no pasa por la TUI y no trae `render`: no hay I2 y la muestra no entra.
- `import` avisa por cada aprobación sin `render` y **distingue lo que la sesión prueba**: si otra aprobación de la misma sesión sí trae el campo, esa aprobación «se resolvió fuera del prompt del TTY»; si no lo trae ninguna, el aviso dice que **no hay constancia** de que pasara por el prompt, sin atribuirlo al flujo ni a un binario anterior al campo, porque el estado no guarda qué código la ejecutó. En los dos casos I2 queda sin evidencia.

Esto no cambia el veredicto de `CAL2-R04`, `R05` ni `R06`: sus estados se midieron sin el campo y siguen descartadas, como `R09`–`R11`. Rige para `CAL2-R12` en adelante, la primera con el diff adjunto (§12.8).

### 12.8 El pedido lleva el diff (2026-11-13)

**Causa.** `agentClient` no adjuntaba `diff` al pedido de aprobación, así que el `if (approval.diff)` de la TUI nunca se cumplía y `approval.render.diffShown` salía `false` por construcción, no por descuido del operador. La enmienda §12 había dado la premisa por falsa leyendo sólo el prompt; el hueco estaba una capa antes.

**Arreglo.** `src/cli/approvalDiff.ts` reconstruye el diff unificado leyendo el archivo actual y aplicando el cambio en memoria, con el mismo motor que `fs.propose.*` (`applyExactEdit` y `buildUnifiedDiff`). Cubre `fs.edit` —simple y `replacements`— y `fs.write`, con archivo nuevo desde `--- /dev/null`. No fabrica diff cuando no hay nada que enseñar: otra tool, archivo ilegible o de más de 512 KB, `oldString` ausente o cambio que no modifica nada. `agentClient` lo adjunta sólo en ese caso, sin tocar el contrato de `requestApproval`.

**Comprobado el 2026-11-13 en el panel.** Con el arreglo, el menú de `fs.edit` imprime `--- a/…`, la cabecera `@@` y el hunk antes de las opciones, y la aprobación graba `{"diffShown":true,"diffTruncated":false,"detailOpened":false}`. La sonda anterior, con el pedido sin `diff`, daba los tres `false`: el campo describe el pedido, no la intención del operador.

No fue sólo la sonda: en `CAL2-R12` lo mismo ocurrió en una corrida real, y esa corrida se descarta por §3, **no** por I2 (§11.1). Es la primera vez que la condición se cumple con el binario medido.

**Consecuencia para el registro.** Las corridas `CAL2-R04` a `R06` y `R09` a `R11` no cayeron por el teclado ni por el servidor: cayeron porque no había diff que enseñar. Sus filas quedan con ese motivo y no se reincorporan (§12.4).

### 12.9 El menú se repinta solo (2026-11-13)

**Causa.** El prompt pintaba el menú una sola vez, al abrirse, y no volvía a tocarlo. La terminal puede perder lo pintado sin avisar —un reflow, un redibujado del panel, un cambio de tamaño—, y cuando eso pasó en `CAL2-R16` el operador se quedó mirando una pantalla vacía con el prompt abierto: el proceso seguía vivo, el buffer del terminal conservaba el menú y el paso no avanzaba, pero desde la silla no había forma de saberlo. La única salida era pulsar `↓` y `↑` a mano (§11.2 punto 9), que es depender de que alguien se acuerde.

**Arreglo.** El prompt registra un listener de **`SIGWINCH`** y un **latido de 5 s** (`APPROVAL_REPAINT_MS`) mientras espera; los dos llaman al mismo repintado, que reescribe menú y pie **en el sitio** subiendo por las líneas que ocupa —incluidas las del detalle del hunk, que se vuelven a pedir con `?`— sin mover la selección ni decidir nada. El listener y el temporizador se sueltan en el `cleanup`, también cuando el prompt caduca o se aborta, y el latido va con `unref()` para no mantener vivo el proceso.

**Comprobado el 2026-11-13.** `tests/cli/approvalPrompt.test.ts` cubre el caso con un emisor de resize falso y un latido de 20 ms: cada `SIGWINCH` y cada latido reescriben el bloque, la selección final sigue en `❯ 1)`, y tras decidir ya no se repinta ni queda listener. Las mutaciones confirman que muerde: sin el latido falla «el latido repinta mientras el prompt espera», y sin el listener falla «un cambio de tamaño repinta el menú». Las tres suites del CLI quedan en 110/110.

**Consecuencia para el registro.** §11.2 punto 9 deja de ser un procedimiento del operador y pasa a ser diagnóstico de última instancia: si tras el latido la pantalla sigue vacía, el problema es el terminal, no el prompt. `CAL2-R16` no vuelve al bloque (§12.4), pero el caso que la tumbó ya no puede repetirse sin que falle una prueba.

### 12.10 El veredicto del bloque ya está determinado (2026-11-13)

**El cálculo.** Con nearest-rank, el p95 de la muestra objetivo es la **38.ª de 40** ordenadas (§2), y la puerta es `p95 ≤ 15 151 ms`. Que la 38.ª no pase de 15 151 equivale a que **como mucho dos** de las 40 decisiones estén por encima. Con las seis muestras del primario ya hay **tres** por encima: 61 246, 65 056 y 19 702 ms.

**La consecuencia.** Ninguna corrida futura puede cambiar el signo: por muchas muestras rápidas que se añadan, la 38.ª seguirá siendo mayor que 15 151, porque el número de valores por encima del umbral no baja. **El bloque cierra en NO CUMPLE con cualquier n entre 6 y 40**, y las 34 muestras que faltan sólo afinan la magnitud del exceso, no el veredicto.

**Lo que no cambia.** No se toca I1–I4, ni el piso de 1 500 ms, ni el tope del 20 %, ni la referencia de 15 151 ms: la determinación es aritmética sobre datos ya registrados, no una relajación. Tampoco se altera el tope de 24 corridas de §2.

**Qué decide el operador ahora.** Dos salidas legítimas, y conviene elegir una explícitamente antes de seguir gastando corridas:

1. **Cerrar con lo que hay.** Se publica el p95 con n=6 y se declara que la precisión es menor que la de 40; el veredicto es el mismo y está demostrado arriba. Es lo que recomienda este documento.
2. **Completar hasta 40 por disciplina de protocolo**, aceptando que el resultado final será el mismo número de puerta. Sirve para publicar un p95 más estable, no para cambiar la casilla.

Lo que no vale es dejarlo implícito: seguir corriendo sin decir que el veredicto está cerrado convierte el gasto de tiempo en una apariencia de rigor.

**Lo que sí queda por explicar.** Que tres de seis decisiones pasen de 15 s no se arregla con más muestras, sino mirando la causa: la misma aprobación `fs.edit` ha medido 61 s, 65 s, 19,7 s, 2,1 s y 4,6 s, una dispersión que no describe lectura humana sino disponibilidad del operador y el panel. Ese es el objeto de un bloque siguiente, con piso por tool y marca de tiempo de la primera tecla no decisoria.

### 12.11 La marca de la primera tecla de lectura (`firstNonDecisionKeyAt`)

`latencyMs` mide desde que se **crea** la aprobación, así que arrastra el tiempo en que nadie miraba el panel: en CAL2 eso mezclaba dos cosas distintas —cuánto tardó el operador en volver y cuánto tardó en leer— en un solo número. Ya está instrumentado el reparto.

**Qué se graba.** `promptApprovalDecision` sigue escribiendo `approval.firstKeyAt` (epoch ms) con el **primer `data` de stdin**, antes de interpretarlo: cuenta igual una flecha, un `?`, una salida o la propia decisión, y sólo marca que había alguien delante. Para medir lectura hay un campo aparte: `approval.firstNonDecisionKeyAt` (epoch ms), que se graba con la primera tecla aceptada que **no** decide —flechas, `j`/`k`, `?`/`¿`/`h` y teclas desconocidas—. Las teclas que resuelven (`a`, `d`, `s`, `1`–`3`, Enter, `q`) no cuentan; Esc y Ctrl+C tampoco, porque cierran sin decidir. Un prompt que caduca, que se aborta o que corre sin TTY no trae lectura que publicar.

**Qué se publica.** En el paso persistido (`SessionStepV2.approval`) y en el evento `approval_result` aparece `decisionMs` = decisión − `firstNonDecisionKeyAt`. Una **decisión directa** (la primera tecla aceptada ya decide) **no genera `decisionMs`**: se marca `directDecision: true` y no se publica 0 ni un valor aproximado, porque no hubo lectura previa. `latencyMs` **se conserva con su significado antiguo** para no invalidar las muestras ya publicadas (§7.5 prohíbe reescribir la métrica a mitad de ciclo): las dos cifras conviven y la TUI imprime `decisionMs` sólo cuando existe.

**La puerta no cambia.** La referencia vigente sigue siendo `p95(latencyMs) ≤ 15 151 ms`; `decisionMs` es una medida de diagnóstico y no se compara con ese umbral salvo que una enmienda E2 lo declare explícitamente.

**Qué falta para que sea la métrica del protocolo.** Un bloque nuevo que declare `decisionMs` como el número de la puerta, decida si `latencyMs` se retira y fije el piso por tool. Hasta entonces, este bloque mide con la referencia de siempre y deja la marca puesta.

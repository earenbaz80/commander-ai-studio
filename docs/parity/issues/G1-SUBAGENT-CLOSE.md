> **Labels:** `g1`, `p1`, `area:agent`, `area:server`, `prompt` · **Estimación:** 0,5 d-persona · **No depende de:** nada abierto
>
> Issue de paridad de G1, sin número en GitHub: no forma parte del backlog F1 y **no** cambia el criterio de T10 ni los enunciados de dogfooding. Es el defecto que deja T10 en **0/3** después de que el aislamiento de los subagentes ya esté medido y bien.

**Estado:** Abierto — contrato de cierre aplicado y con test; transcripción del hijo expuesta en `/subagents` para poder anotar la denegación; falta **volver a medir** T10.

**Por qué.** El criterio de T10 (`runT10` en [`evals/scenarios.ts`](../../../evals/scenarios.ts), copiado en [D4 §4.6](../dogfooding-g1-d4.md#46-evaluar-t10)) pide tres cosas del texto de los hijos: que los dos vuelvan `ok:true` **con respuesta que diga «listo»**, que **algún hijo informe la denegación de `shell.run`**, y que el padre responda «2». El aislamiento se cumple entero —dos hijos, un solo worktree, árbol principal limpio, sin `hijo-*.txt` fuera del worktree—; lo que no llega nunca es el texto: los dos hijos responden, literalmente y en las tres corridas, **«Objetivo completado.»**.

Eso no es un detalle de redacción: el criterio mide si el hijo sabe y cuenta lo que le pasó. Un cierre genérico deja al padre sin información y convierte `spawn_agents` en una caja que devuelve `ok:true` sin decir qué hizo, así que el operador no puede distinguir «escribió el archivo y se le denegó el shell» de «no hizo nada».

## Lo medido

| Corrida | Sesión | Duración | Estado | Respuesta de los dos hijos | Aislamiento | Comprobaciones en rojo |
| --- | --- | ---: | --- | --- | --- | --- |
| `G1-D4-04` | `sess_844bc8ee` | 59 728 ms | `completed` | `«Objetivo completado.»` ×2 | 1 worktree, árbol limpio, 0 `hijo-*.txt`, padre `«2»` | «el hijo informó la denegación de shell» (informe `passed:false`; la ficha lo cuenta 4/6) |
| `G1-D4-05` | `sess_01bb1f7e` | 921 455 ms | `cancelled` (presupuesto) | `«Objetivo completado.»` ×2 | 1 worktree, árbol limpio | «listo», denegación y padre sin respuesta |
| `G1-D4-05R` | `sess_a1be6243` | 42 050 ms | `completed` | `«Objetivo completado.»` ×2 | 1 worktree, árbol limpio, 0 `hijo-*.txt`, padre `«2 children finished.»` | «listo» y denegación (8/10) |

Los dos hijos devolvieron `ok:true` en las tres corridas y con **el mismo texto** aunque sus objetivos eran distintos (uno intentaba `shell.run` y escribía `hijo-a.txt`; el otro sólo escribía `hijo-b.txt`). En `G1-D4-05R` el padre además respondió en inglés, señal de que el cierre lo redacta el modelo y no una plantilla del producto.

## Causa

1. **El hijo no tiene contrato de cierre.** Su instrucción de sistema es la genérica del bucle (`agentSession.ts:356` y la variante JSON en `agentSession.ts:404-433`): «Si el objetivo está cumplido, responde SOLO texto final sin llamar herramientas». No hay ninguna frase que pida contar qué se hizo, qué archivos se tocaron o qué tool se rechazó. El modelo cumple al pie de la letra: cierra con una frase.
2. **La exigencia de informar la denegación no viaja en el encargo.** En `G1-D4-05R` el padre escribió el objetivo del hijo A como *«Attempt shell.run once (should be denied) and then write hijo-a.txt»*: le pide intentar y ser denegado, pero no le pide contarlo. En `G1-D4-05` sí añadió `instructions` («You are not allowed to use shell.run; if you try, it will be denied»), y el hijo respondió igual. Es decir: el requisito del criterio vive sólo en el prompt del dogfooding y en el evaluador, no en el encargo que el hijo recibe.
3. **El dato existe pero nadie lo pide.** La allowlist del hijo (`allowedTools:['fs.read','fs.write']`) no filtra el catálogo que ve el modelo (`toolSchema()` en `agentSession.ts:758` pinta todas las tools registradas), así que `shell.run` está a la vista y su llamada falla cerrada con `Tool deshabilitada por la configuración de permisos: shell.run` (`enforceTool`, `permissions.ts:116`, invocado en `agentSession.ts:1061`). El hijo recibe ese `tool_result` con el texto exacto que el criterio busca… y no lo cuenta porque nada se lo pidió.

## Qué **no** es

- **No** es el aislamiento ni el worktree: `git status --porcelain` vacío, un solo worktree y ningún `hijo-*.txt` en el árbol principal en las tres corridas.
- **No** es `parentSessionId` ni la sesión padre: arreglado en `5b68e2f` y `spawn_agents` devuelve `spawned:2` con dos resultados.
- **No** es el presupuesto de aprobación: en `G1-D4-05R` la aprobación de `spawn_agents` se respondió a los 19 068 ms y la corrida cerró en 42 s; el texto del hijo salió igual.
- **No** es el modelo callándose: los hijos terminan `ok:true` con texto, no con el turno vacío de [`G1-EMPTY-TURN.md`](G1-EMPTY-TURN.md).
- **No** es el evaluador: `runT10` exige lo mismo que el criterio de F0 y esa exigencia no se toca.

## Arreglo aplicado

1. **Contrato de cierre fijo en la sesión hija.** `SUBAGENT_CLOSING_CONTRACT` (`agentSession.ts`) es texto del producto, no del modelo padre, y se pega al prompt de sistema del hijo en los dos caminos del servidor (`callLlmNative` y `callLlmJson`). Exige dos líneas: «Archivos:» con las rutas escritas, y «Denegado:» con la tool rechazada y el motivo tal como lo devolvió el sistema, con «ninguno»/«ninguna» cuando no haya nada que contar.
2. **El encargo no depende de la paráfrasis del padre.** El handler de `spawn_agents` (`agentTools.ts`) añade `SUBAGENT_CLOSING_REMINDER` a las `instructions` de cada hijo con `reinforceClosingContract()`, que no lo duplica si el padre ya lo escribió.
3. **Las instrucciones del padre ahora llegan al hijo.** Al implementarlo apareció un segundo defecto: `executeTask` aceptaba `TaskToolInput.instructions` y las **descartaba** (no se leían en ningún punto). Es la razón de que en `G1-D4-05` el padre escribiera «You are not allowed to use shell.run; if you try, it will be denied» y el hijo actuara como si no hubiera dicho nada. Ahora viajan como bloque `INSTRUCCIONES DEL PADRE:` junto al contrato, para `task` y para `spawn_agents`.

**Test:** `tests/agent/subagentClosingContract.test.ts`, tres casos — el hijo recibe contrato y encargo del padre, el recordatorio llega aunque el padre no escriba instrucciones, y el refuerzo es idempotente.

## Resultado de la primera re-medición (`G1-D5-05`)

Corrida **extra fuera de las 24**, workspace `tests/tmp-g1/d5-t10-01`, mismo modelo y `--max-steps 24`, servidor arrancado con el código del contrato (`:3285`, para no pisar el `:3283` que seguía con el código anterior). Veredicto: **`failed` 8/10**.

| Hijo | `task` que recibió | Respuesta literal |
| --- | --- | --- |
| A (`sess_0017a32b`) | «Attempt to run shell.run once (should be denied due to lack of permission), then write hijo-a.txt using fs.write.» | `«Objetivo completado.»` |
| B (`sess_b338e15a`) | «Write hijo-b.txt using fs.write.» | `«Objective fulfilled: hijo-b.txt has been written using fs.write.»` |

- **El contrato llega** (lo fija el test) y el hijo B cambió: dice qué archivo escribió, aunque fuera del formato pedido.
- **El hijo A sigue cerrando en hueco** y ninguno de los dos dijo «listo», así que las dos comprobaciones de texto del criterio siguen en rojo.
- **El intento de `shell.run` no se pudo comprobar en esta corrida:** las sesiones hijas no se persisten (`persist:false`), `GET /api/agent/sessions/sess_0017a32b` da **404** y el registro de subagentes no guardaba las tools llamadas. Arreglado después: cada fila de `/subagents` lleva ahora `calls` con la tool, su `ok` y el error (incluida la denegación), resumido por `summarizeCalls()` antes de borrar la sesión hija (`tests/unit/subagentTranscript.test.ts`). Esta corrida no se puede reconstruir —el servidor de `:3285` ya está parado—; la siguiente sí.
- **Sin efecto en G1:** las 28 válidas siguen 17/28 y T10 sigue 0/3 (0/4 contando la extra, 0/5 con la segunda); la decisión del recibo no cambia.

Detalle y comandos: [hoja de D5 §4](../dogfooding-g1-d5.md).

## Pendiente

**Re-medir, si se decide:** una corrida extra `G1-D5-05` **fuera de las 24**, guardando el `task` exacto de cada hijo y su respuesta literal vía `GET /api/agent/sessions/:id/subagents`, como pide [plan §3.1](../dogfooding-g1.md). El criterio **no** se relaja: «listo» y la denegación siguen siendo obligatorios. Ojo a un detalle: el contrato pide informar la denegación, pero **no** obliga a la palabra «listo», así que la comprobación `/listo/i` de `runT10` puede seguir en rojo aunque el hijo informe bien; si pasa eso, se decide con la medición delante y no se maquilla el prompt para aprobar un test.

El resultado ya medido no cambia: `G1-D4-04`, `G1-D4-05` y `G1-D4-05R` siguen `failed` y T10 sigue **0/3** hasta que haya corrida nueva.

## Efecto en G1

- **Tasa global:** no la mueve. T10 ya estaba en 0/2 en F0, así que no es regresión; el global sigue en 17/28 (60,7 %).
- **Casilla «Defectos con issue o fix registrado» de [§7.1](../dogfooding-g1.md#71-reglas-de-decisión-criterio-de-puerta):** con este issue, los 7 defectos del dogfooding tienen issue o fix. El defecto sigue **abierto**, pero la regla habla de registro, no de arreglo.
- **Decisión del recibo:** no cambia. G1 sigue **NO CERRADO** por el p95 de aprobación, que es la otra regla en rojo ([recibo §8](../receipts/G1-DOGFOOD-2026-11-12.md)).

## Resultado de la segunda re-medición (`G1-D5-06`)

Corrida extra con el servidor nuevo en `:3285` y `calls` ya expuesto ([hoja de D5 §4.2](../dogfooding-g1-d5.md), `G1-D5-06`): `sess_7c912b83`, 88 416 ms, hijos A `sess_4f9d5629` y B `sess_abac4a02`, ambos `completed`, **2 pasos y `calls:[]` cada uno**, respuesta «Objetivo completado.» y 8/10 en el criterio.

- **La denegación ya se puede anotar, y lo que anota es que no la hubo:** el hijo A **no pidió `shell.run`** (`askedShellRun:false`, sin error que registrar). El campo funciona; lo que falta es que el hijo intente la tool.
- **Nuevo matiz del defecto:** los hijos cerraron en 300–357 ms sin tocar ninguna tool, más perezosos que en `G1-D5-05` (8 y 9 pasos). Para separar «decidió no llamar tools» de «turno vacío» ya se exponen los `stepTitles` del hijo ([`subAgents.ts`](../../../subAgents.ts), `tests/unit/subagentTranscript.test.ts`): esta corrida no se puede reconstruir —sus filas ya no existen—, la siguiente sí.
- **Sin efecto en G1:** 28 válidas y 17 `passed` igual; T10 **0/3** en las 24 y **0/5** con las dos extras; el criterio de T10 sigue intacto.

## Resultado de la tercera re-medición (`G1-D5-07`)

Con `stepTitles` ya en `/subagents` ([hoja de D5 §4.2](../dogfooding-g1-d5.md)): `sess_b540582a`, 56 125 ms, hijos `sess_e421a603` y `sess_57590b94`, **`["Inicio", "Finalizado"]` y `calls:[]`** en los dos, 8/10 en el criterio.

- **La ausencia de intento ya tiene causa:** sin paso `Razonamiento`, el turno del proveedor llegó **vacío** y el hijo cerró con el relleno «Objetivo completado.» (`agentSession.ts:1283`). No es desobediencia del contrato de cierre: no hubo turno. Es [`G1-EMPTY-TURN`](G1-EMPTY-TURN.md) afectando al subagente, y el hijo se anota `ok:true`.
- **Consecuencia para este issue:** mientras el hijo cierre por turno vacío, T10 no puede decir nada sobre el contrato; el arreglo del turno vacío en el camino del hijo va antes de otra medición. **Ya está:** el hijo reintenta una vez y, si sigue vacío, queda `failed` con error ([`G1-EMPTY-TURN`](G1-EMPTY-TURN.md#arreglo-implementado-en-los-puntos-1-2-y-4)); la próxima corrida sí mide el contrato.
- **Sin efecto en G1:** 28 válidas y 17 `passed` igual; T10 **0/3** en las 24 y **0/8** con las cinco extras (`G1-D5-05`…`G1-D5-09`).

## Resultado de la cuarta re-medición (`G1-D5-08`, con el reintento en vivo)

Servidor `:3285` con `HEAD` `989ad17`, sesión `sess_218d4b05`, 650 771 ms hasta que se cortó. El padre lanzó `spawn_agents` **tres veces** (aprobaciones `apr_d0b3200a`, `apr_952defb2`, `apr_d7e31197`) y los seis hijos fallaron igual: `["Inicio", "Turno vacío", "Finalizado sin respuesta"]`, `calls:[]`, `failed` con «El proveedor devolvió turnos vacíos…» ([hoja de D5 §4](../dogfooding-g1-d5.md)).

- **Lo que se buscaba:** que el reintento del turno vacío, en vivo, no disfrazara el cierre. Cumplido: ni un `ok:true`, ni un «Objetivo completado.», ni un intento inventado de `shell.run`.
- **Lo que no se buscaba y salió:** el reintento no basta. 6 de 6 hijos siguieron vacíos, el padre volvió a lanzarlos dos veces y la corrida se detuvo en el cuarto intento sin respuesta; el arreglo de fondo —propagar el `finish_reason` truncado como error y subir el presupuesto de salida de los modelos que razonan— ya está en [`G1-EMPTY-TURN`](G1-EMPTY-TURN.md#arreglo-implementado-en-los-puntos-1-2-y-4). Tampoco hubo «listo» ni denegación que anotar: no existió llamada.
- **El bucle del padre, cerrado después:** aquella corrida lo vio relanzar `spawn_agents` tres veces sin cerrar. Ahora, a la **segunda tanda seguida sin un solo hijo bueno**, la sesión padre se cierra con «No completé la tarea: los subagentes fallaron en dos tandas seguidas. Motivo: …» en vez de repetir (`spawnFailureStreak` en `agentSession.stepNative`). El test fija dos spawns y no tres, y que el motivo de los hijos viaja en la respuesta.
- **La guarda no disparaba en producción, y lo destapó `G1-D5-09`:** el padre lanzó **cuatro** tandas y no cerró. Leía `r.data.results`, pero fuera de proceso el resultado llega envuelto y el paso anotado tiene la forma `{ ok, data: { results } }`, así que la cuenta de hijos era siempre cero y la racha se reiniciaba. Se arregló extrayendo `spawnChildrenFromResults`, que acepta las dos formas, con `tests/agentSpawnStreak.test.ts`; la corrida del padre con 4 spawns queda documentada en [dogfooding §4](../dogfooding-g1-d5.md#43-qué-se-supo-en-cada-paso).
- **Sin efecto en G1:** 28 válidas y 17 `passed` igual; T10 **0/3** en las 24 y **0/8** con las cinco extras (`G1-D5-05`…`G1-D5-09`).

## Los dos caminos por los que el hijo se daba por bueno

1. **Turno vacío del proveedor:** cerraba `ok:true` con «Objetivo completado.» (`G1-D5-07`). Arreglado: se anota como `Turno vacío`, se reintenta una vez y, si persiste, la sesión falla ([`G1-EMPTY-TURN`](G1-EMPTY-TURN.md#arreglo-implementado-en-los-puntos-1-2-y-4)).
2. **`done` sin paso `Finalizado`:** al agotar `maxSteps` o el presupuesto de tools, `executeTask` resolvía `ok:true` con «Subagente completado sin respuesta explícita». Arreglado: sin `Finalizado` con texto, el hijo queda `failed` con «El subagente terminó sin respuesta final».

Los dos los fija `tests/agentTaskIntegration.test.ts`; ninguno toca el criterio de T10, que sigue midiendo «listo» y la denegación informada.

## Evidencia

| Archivo | Qué es |
| --- | --- |
| `.commander/g1/sess_844bc8ee-t10.json` | informe del evaluador de `G1-D4-04`: `children[].answer`, `checks` y `passed` |
| `.commander/g1/sess_01bb1f7e-t10.json` | ídem de `G1-D4-05` (cancelada por presupuesto) |
| `.commander/g1/sess_a1be6243-t10.json` | ídem de `G1-D4-05R`, con el aislamiento en verde y las dos comprobaciones de texto en rojo |
| `.commander/g1/G1-D4-05.json`, `G1-D4-05R.json` | estado del padre: `tool_call`/`tool_result` de `spawn_agents` con los `goal` e `instructions` que recibió cada hijo |
| `.commander/g1/G1-D5-06-subagents.json` | filas de `/subagents` con `calls` por hijo: la prueba de que A no pidió `shell.run` |
| `.commander/g1/G1-D5-06-t10.json` | informe de las 10 casillas con `askedShellRun`, `shellRunError` e `informedDenial` por hijo |
| `.commander/g1/G1-D5-07-subagents.json` | filas con `calls:[]` y `stepTitles:["Inicio","Finalizado"]`: turno vacío, no decisión del modelo |

```bash
# volver a leer las respuestas de los hijos de una corrida
node -e "const r=require('./.commander/g1/sess_a1be6243-t10.json');console.log(r.children,r.checks.filter(c=>c.error))"
```

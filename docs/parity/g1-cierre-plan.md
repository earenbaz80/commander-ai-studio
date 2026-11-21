# G1 — Plan de cierre

> **Fecha:** 2026-11-16 · **Revisado:** 2026-11-21
> **Estado:** listo para ejecutar. El **dogfooding de 5 días ya se ejecutó** (2026-11-12). Lo que falta es el bloque `CAL4H`, **declarar T10** con la evidencia de `G1-T10-12` y el recibo de cierre. El bloque `CAL4H` y el recibo no se ejecutaron todavía.
> **Base:** [recibo del dogfooding](receipts/G1-DOGFOOD-2026-11-12.md) · [hoja de decisión del p95](g1-approval-gate-decision.md) · [protocolo de re-medición](g1-approval-remeasure.md) · [runbook CAL4H](g1-approval-cal4-human-runbook.md) · [plan del dogfooding](dogfooding-g1.md) §3, §5 y §7.
> **Qué es:** el orden concreto para cerrar G1, con los comandos, los checkboxes y las tablas donde se registra cada dato.
> **Qué no es:** no re-mide nada por sí solo, no cambia la referencia de 15 151 ms, no relaja el criterio de T10 y **no cierra G1**: eso lo decide el recibo de cierre con evidencia.
> **Regla de uso:** un checkbox sólo pasa a `[x]` con la ruta del recibo, el estado o la fila que lo respalda anotada al lado. Lo no medido se queda `[ ]`, no se estima.

## 1. Punto de partida

| Elemento | Estado hoy | Qué lo cierra |
| --- | --- | --- |
| 5 días y 24 corridas CLI-first | Cumplido: D1–D5 del 2026-11-12, 24 planificadas medidas y 28 válidas | Nada; no se repite |
| Tasa de éxito ≥ F0 (8/24) | **17/28 (60,7 %)** | Nada |
| 0 escrituras sin aprobación · 0 duplicadas en `--resume` · 0 secretos · artifacts por la vía del runbook · defectos con issue | Verde en las 28 válidas | Nada |
| **p95 de aprobación ≤ 15 151 ms** | **Rojo**: 76 982 ms (n=40, operador automatizado), 65 056 ms (CAL2, n=6), 26 501 ms (CAL4, n=41, no válido como muestra humana) | Bloque `CAL4H` humano con **≤ 2 de 40** por encima |
| T10 subagente | **0/3** en las 24 (`G1-D4-04`, `G1-D4-05` y `G1-D4-05R`) y **0/9** contando las seis extras (`G1-D5-05`…`G1-D5-10`). Los descartados (1 intento `blocked` de `G1-D4-04` y 2 intentos de `G1-D5-05` sin veredicto válido) no suman. Fuera de las 24, la re-medición del 2026-11-21 sobre `199f393` ([recibo `G1-T10-12`](receipts/G1-T10-12-2026-11-21.md)) dio **2/3**: siete checks, 0 timeouts, con T10-2 fallando por cierre hueco | Declarar el issue [`G1-SUBAGENT-CLOSE`](issues/G1-SUBAGENT-CLOSE.md) con esa evidencia; **no es regla de puerta** y no cambia el 0/3 de las 24 |
| Decisión de la puerta | **NO CERRADO**; rige la salida **B** de la [hoja de decisión](g1-approval-gate-decision.md), sin firma | Recibo de cierre `G1-CIERRE-<fecha>` |

**Consecuencia:** F1 y F2 no se marcan cerradas mientras G1 siga abierta. La tasa global ya no es el problema; el cierre depende de una sola casilla y de declarar T10.

## 2. Orden de pasos

| Paso | Qué | Tiempo | Quién | Criterio de salida |
| --- | --- | ---: | --- | --- |
| 0 | Congelar el árbol y el entorno | 30 min | Agente | `HEAD` anotado, árbol limpio, `/api/health` 200 |
| 1 | Preflight de `CAL4H` | 10 min | Agente + operador | Precondiciones del §5 todas en `[x]` |
| 2 | Bloque `CAL4H` (20 corridas, n ≥ 40 decisiones) | 45–60 min | **Operador humano** | 20 corridas cerradas o corte justificado |
| 3 | Resumen y lectura de la puerta | 5 min | Agente | `p95` con su `n` y **≤ 2 de 40** por encima |
| 4 | Declarar T10 con la evidencia existente | 15 min | Agente | Issue `G1-SUBAGENT-CLOSE` decidido con el recibo `G1-T10-12` (2/3, siete checks) |
| 5 | Recibos y actualización de roadmaps | 30 min | Agente | `CAL4H` + `G1-CIERRE` emitidos y puertas alineadas |

Si el paso 3 falla, **se detiene el cierre**: G1 sigue NO CERRADO y el paso siguiente es producto (issue [`G1-APPROVAL-SHELL-TAIL`](issues/G1-APPROVAL-SHELL-TAIL.md)), no otra medición ni un cambio de referencia.

## 3. Paso 0 — congelar el árbol

> **Pin revisado (2026-11-21):** `41358e4` ya no resuelve en este clon (`git cat-file -t 41358e4` → `Not a valid object name`), así que no se podía hacer el checkout del bloque. El pin pasa a **`360f8c2`**, HEAD publicado al revisar; verificar con `git rev-parse --verify 360f8c2` y un worktree detached antes de medir. Los commits posteriores a `360f8c2` que sólo toquen este plan no cambian el código medido.

- [ ] Árbol limpio y commit anotado: el bloque se mide en **`360f8c2`**. `git status --short` vacío; si `predev` regenera `public/avatars/manifest.json`, se restaura (es sólo fin de línea).
- [ ] Worktree medido `tests/tmp-g1/cal4-repo` **detached en `360f8c2`** y limpio. Se movió con `git -C tests/tmp-g1/cal4-repo checkout --detach 360f8c2`; el lockfile es idéntico y no hace falta reinstalar. Si se recrea desde cero, usar `git worktree add --detach tests/tmp-g1/cal4-repo 360f8c2` y `npm ci --ignore-scripts --no-audit --no-fund` antes de sembrar.
- [ ] Servidor vivo en `:3283` con **`npm run dev`**: `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3283/api/health` → `200`. El script fija `PORT=3283`; el `57898` medido el 2026-11-16 vino de un `PORT=0` heredado del shell, que `server.ts` trata como puerto efímero para los tests.
- [ ] Modelo y `maxSteps` congelados: `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b`, `--max-steps 24`.
- [ ] Ninguna otra sesión del CLI usando el puerto.

```bash
cd "G:/Proyectos AI/commander-ai-studio-2.5.1"
git status --short
git rev-parse --short HEAD                          # 360f8c2
git -C tests/tmp-g1/cal4-repo status --short
git -C tests/tmp-g1/cal4-repo rev-parse --short HEAD # 360f8c2
npm run dev                                          # :3283 por defecto, en otra terminal
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3283/api/health
```

## 4. Guion de 5 días y 24 corridas (cumplido, congelado)

Se conserva como procedimiento para un bloque completo futuro. **No se re-ejecuta para cerrar G1**: sus 24 corridas ya están medidas y el recibo existe.

| Día | Corridas | Plan §3 | Ejecutado el 2026-11-12 |
| --- | ---: | --- | --- |
| D1 | 5 | T1 ×3, T2 ×2 | T1 ×3, T2 ×2 |
| D2 | 5 | T3 ×2, T4 ×2, T5 ×1 | T3 ×2, T4 ×2, T5 ×1 |
| D3 | 5 | T5 ×1, T6 ×2, T8 ×2 | ídem + 2 repeticiones de T6 |
| D4 | 5 | T8 ×1, T7 ×3, T9 ×1 | T7 ×1, T9 ×2, T10 ×2 + `G1-D4-03R` y `G1-D4-05R` |
| D5 | 4 | T9 ×2, T10 ×2 | T7 ×2, T8 ×1, T9 ×1 |
| **Total** | **24** | | **24 planificadas medidas; 28 válidas con repeticiones** |

**Configuración no negociable:** modelo `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b`, servidor `:3283`, `--max-steps 24`, modo `build`, **TTY real** (`--json` y los pipes anulan el prompt de aprobación), workspaces bajo `tests/tmp-g1/` (ignorados por git).

**Por corrida:** fijar entorno → sembrar (`npm run g1:seed -- --day N`) → lanzar el CLI en TTY → decidir a mano (`a` una vez, `d` denegar; `s` sólo si la corrida lo pide) → anotar cada `✓ aprobación … · N ms` → capturar estado con `curl -s http://127.0.0.1:3283/api/agent/sessions/<id> > .commander/g1/<runId>.json` → evaluar el criterio con comandos → `git status --porcelain` del workspace → fila de §12.1 en la ficha del día.

**Presupuesto:** 15 min de reloj por corrida; al vencer, `Ctrl+C`, `timeout` como fallo. `invalid` sólo por causa ajena al agente (proveedor, puerto, workspace contaminado, cambio de configuración, tecla equivocada) y se repite con número nuevo sin borrar la anterior. Un fallo del agente, un timeout o un criterio incumplido son `failed` y cuentan.

## 5. Paso 2 — bloque `CAL4H` (operador humano)

Detalle completo en el [runbook CAL4H](g1-approval-cal4-human-runbook.md) y el [plan CAL4H](CAL4H-PLAN-2026-11-17.md). Resumen ejecutable:

**Precondiciones**

- [ ] Entorno preparado: árbol, worktree y servidor en **`360f8c2`**, con `npm run dev` en `:3283` (ver §3).
- [ ] Operador presente, con **60–90 min** reservados y sin otra tarea abierta.
- [ ] Terminal real, no el panel del agente: `tty` responde un dispositivo (por ejemplo `/dev/ttys003`).
- [ ] Sin teclas en cola y sin otra sesión en `:3283`.
- [ ] Store humano aislado y vacío: `tests/tmp-g1/cal4-human/.commander/g1/cal4/samples.jsonl` (hoy lo está). El store inválido `.commander/g1/cal4/samples.jsonl` **no se toca**.
- [ ] Rango `CAL4-R22`…`CAL4-R41` libre; no se reutilizan `R02`–`R21`.
- [ ] Protocolo leído: §4.1 (I1–I4), §5 (invalidación) y §7.1–§7.2 (puerta).

**Ejecución**

```bash
cd "G:/Proyectos AI/commander-ai-studio-2.5.1/tests/tmp-g1/cal4-human"
for n in $(seq 22 41); do
  bash ../cal4-one.sh "$n" || { echo "detenido en CAL4-R$n"; break; }
done
```

> El script imprime `Siguiente: bash ../cal4-one.sh 23`; usá el bucle o ese comando desde `cal4-human`.

**Por corrida**

- [ ] El prompt `⚠ fs.edit espera aprobación` aparece en el panel del operador.
- [ ] El operador lee el diff impreso antes de decidir; no se pulsa `a` «para ver qué pasa».
- [ ] `s` prohibido. `d` sólo si la tool sale del alcance del enunciado; esa muestra va al estrato `deny`, nunca al primario.
- [ ] Antes de justificar: el `fs.edit` muestra `diff impreso` (o `truncado` + hunk), la latencia no es `n/d` y no aparece `sin render`/`no impreso`.
- [ ] Sin evidencia de diff: `Ctrl+C` antes de importar, no se escribe justificación y se repite con otro número.
- [ ] I1 `fs.edit` y I1 `shell.run` escritos con lo realmente revisado; la fila entra como `primario`.
- [ ] Si la fila sale `excluida` por I1/I2/I3, se anota el motivo y se repite con número nuevo; no se edita ni se borra.

**Cierre y puerta**

```bash
cd "G:/Proyectos AI/commander-ai-studio-2.5.1/tests/tmp-g1/cal4-human"
node ../cal4-repo/node_modules/tsx/dist/cli.mjs ../g1-cal4.ts summary
```

- [ ] Las 20 corridas ejecutadas y el primario con **n ≥ 40** decisiones incluidas.
- [ ] Exclusiones por I1–I3 **≤ 20 %**.
- [ ] `p95` nearest-rank publicado con su `n`; piso de `latencyMs` = 1 500 ms, sin trasladarlo a `decisionMs`.
- [ ] **Puerta:** p95 ≤ **15 151 ms**, equivalente a **como mucho 2 de 40** por encima (nearest-rank: el p95 de 40 es la 38.ª).
- [ ] Los `deny` se reportan aparte y no se mezclan con el primario.
- [ ] Store y estados conservados en `tests/tmp-g1/cal4-human/` y `tests/tmp-g1/cal4-repo/.commander/g1/cal4/`; el bloque inválido no se borra.
- [ ] `sampleId` reinicia en `CAL4-01`: al citar, usar siempre el `runId` `CAL4-R22`…`R41` y aclarar que el store es `cal4-human`.

## 6. Paso 4 — re-medición de T10

Corrida **extra, fuera de las 24**, con el criterio de F0 intacto: los dos hijos deben volver `ok:true` con respuesta que diga «listo» y alguno debe informar la denegación de `shell.run`; el padre responde «2». Detalle completo en el [plan de re-medición T10](T10-REMEASURE-PLAN-2026-11-17.md).

- [ ] Servidor con el código que incluye `SUBAGENT_CLOSING_CONTRACT`, `calls`, `stepTitles` e `informedShellDenial` endurecido en `/subagents` (código de `360f8c2`; HEAD documental puede ir por delante).
- [ ] Workspace `tests/tmp-g1/d5-t10-01` re-sembrado; `G1-T10-01` reservado como extra fuera de las 24. `G1-D5-10` queda como extra fallida y no se reutiliza.
- [ ] Guardar el `task` exacto enviado a cada hijo y su respuesta literal: `GET /api/agent/sessions/<padre>/subagents`.
- [ ] Comprobar `askedShellRun`, `shellRunError` e `informedDenial` por hijo, más `calls` y `stepTitles`.
- [ ] Si el hijo cierra por turno vacío, se anota `finish_reason`/`responseTokens` y **no** se cuenta como contrato cumplido.
- [ ] Si falla sólo por la palabra «listo»: se decide con la medición delante; **no** se maquilla el prompt para aprobar el test. Los seis `checks` de `runT10` son el veredicto; los 11 controles de D5 se reportan aparte.
- [ ] Ficha en `dogfooding-g1-d5.md` §4, recibo saneado en `receipts/G1-T10-01-2026-11-17.md` y, si se resuelve, cierre del issue [`G1-SUBAGENT-CLOSE`](issues/G1-SUBAGENT-CLOSE.md).

## 7. Paso 5 — recibos y actualización

- [ ] Completar la [plantilla CAL4H](receipts/G1-APPROVAL-CAL4H-2026-11-17.md) con operador, fecha, commit **`360f8c2`**, `n`, p95, exclusiones, decisiones `deny` y decisión de la casilla. **No** se reutiliza el recibo de CAL4 ni se declara el `6838fa1` del runbook original.
- [ ] `docs/parity/receipts/G1-CIERRE-<fecha>.md`: las ocho reglas de [§7.1](dogfooding-g1.md#71-reglas-de-decisión-criterio-de-puerta) con su evidencia, tasa global, tabla por tarea con delta frente a F0, avisos de regresión de §7.2, seguridad, fallbacks, límites y decisión **CERRADO / NO CERRADO** en ese orden.
- [ ] Si CAL4H cumple: `ROADMAP.md` y `ROADMAP_PARITY.md` pasan G1 a cerrada y recién entonces se marcan los criterios de F1/F2 que dependían de la puerta.
- [ ] Si CAL4H no cumple: los roadmaps siguen como están (G1 abierta) y el recibo declara el siguiente paso de producto.

## 8. Dónde se registra cada dato

| Dato | Dónde | Versionado | Cómo |
| --- | --- | --- | --- |
| Estado crudo por corrida | `.commander/g1/<runId>.json` | No (`.commander/`) | `curl …/sessions/<id>` |
| Fila saneada por corrida | `docs/parity/dogfooding-g1-d<n>.md` | Sí | Tabla §12.1 |
| Agregado del día | misma ficha | Sí | p50/p95 nearest-rank |
| **Tasa de éxito** | ficha → `dogfooding-g1.md` §5.3 → recibo de cierre | Sí | `passed / corridas válidas`, criterio idéntico a `evals/baseline.ts` |
| Comparación F0 | `dogfooding-g1.md` §7 y §9 de este plan | Sí | Delta informativo; la puerta es la tasa global |
| **Latencia de aprobación (dogfooding)** | `.commander/g1/<runId>.json` → ficha | Crudo no / ficha sí | Descriptiva; no decide la puerta |
| **Latencia de aprobación (puerta)** | `.commander/g1/cal2/samples.jsonl` · `tests/tmp-g1/cal4-human/.commander/g1/cal4/samples.jsonl` | No | `npm run g1:cal2 -- add/import/summary` · `node ../cal4-repo/node_modules/tsx/dist/cli.mjs ../g1-cal4.ts summary` |
| Baseline F0 | `evals/baseline-results.jsonl` + `baseline-2026-11.md` §6 | Sí | `npm run baseline` (sólo arnés) |
| Decisión de la casilla | `receipts/G1-APPROVAL-CAL4H-*.md` | Sí | §5 de este plan |
| Decisión de G1 | `receipts/G1-CIERRE-*.md` | Sí | §7 de este plan |

`evals/results.jsonl` y `evals/history.ts` pertenecen al arnés F0: **no** se usan para corridas del CLI.

## 9. Comparación con la baseline F0

F0: 24 corridas, **8/24 (33,3 %)**, 0 timeouts, 0 inválidas, medido el 2026-11-11 con el mismo modelo NVIDIA.

| Tarea | F0 | G1 medido | Delta | Lectura |
| --- | ---: | ---: | ---: | --- |
| T1 | 3/3 | 3/3 | 0 | sin regresión |
| T2 | 0/2 | 0/2 | 0 | igual |
| T3 | 1/2 | 2/2 | +1 | mejor |
| T4 | 0/2 | 1/2 | +1 | mejor |
| T5 | 1/2 | 1/2 | 0 | igual |
| T6 | 0/2 | 2/4 | +2 | 0/2 con el guardia viejo y 2/2 tras el arreglo |
| T7 | 3/3 | 3/3 | 0 | igual |
| T8 | 0/3 | 3/3 | +3 | mejor |
| T9 | 0/3 | 2/4 | +2 | `03R` fue turno vacío del proveedor, no criterio |
| T10 | 0/2 | 0/3 | 0 | defecto abierto |
| **Total** | **8/24** | **17/28 (60,7 %)** | **+9** | cumple la puerta |

**Qué es comparable:** el éxito por tarea, porque el criterio es el mismo en ambas superficies. **Qué no:** duración y pasos (arnés vs CLI), tokens/coste (`n/d`), y paridad de aprobación (F0 no la midió). Un delta negativo por tarea se registra como aviso de §7.2, no como umbral nuevo.

## 10. Reglas del plan

- La referencia de **15 151 ms**, las condiciones I1–I4, el piso de 1 500 ms y el tope de exclusiones del 20 % no se tocan.
- CAL4 **no** se recicla como muestra humana; su store no se mezcla ni se borra.
- `CAL4H` no se corre desde el panel del agente, ni con `process_write`, `expect`, `yes` o un script de teclas.
- Si `CAL4H` vuelve a fallar, se sigue en **B** con producto; la salida A (`decisionMs` con referencia nueva) sólo se vuelve elegible entonces, con enmienda E2 pre-registrada y sin usar 15 151 ms como umbral de `decisionMs`.
- T10 no relaja su criterio para aprobar el test.
- Medir con el árbol sucio no vale: cualquier cambio de código durante el bloque invalida las muestras afectadas.

## 11. Criterio de terminado

G1 se declara **CERRADO** sólo si todas se cumplen:

- [ ] Las 24 corridas planificadas están medidas y el recibo del dogfooding sigue vigente (28 válidas, 17/28).
- [ ] **p95 de aprobación ≤ 15 151 ms** con un bloque `CAL4H` humano válido: n ≥ 40 incluidas, un solo operador con TTY reservado, exclusiones ≤ 20 % y **≤ 2 de 40** por encima.
- [ ] 0 escrituras sin aprobación, 0 tool calls duplicadas en `--resume`, 0 secretos y 0 fallbacks en las corridas válidas.
- [ ] T10 resuelto **o** declarado con issue abierto y su re-medición registrada (no es regla de puerta, pero no se omite).
- [ ] Recibo `G1-CIERRE-<fecha>` emitido con la decisión y la tabla F0 por tarea.
- [ ] `ROADMAP.md` y `ROADMAP_PARITY.md` con G1 cerrada y sin criterios de fase marcados antes de tiempo.

Si cualquiera falla, el resultado es **NO CERRADO** con el paso siguiente escrito; no se declara «paridad parcial» ni se cambia la métrica para que cuadre.

## 12. Tablas de registro

### 12.1 Por corrida (copiar una por `runId`)

| Campo | Valor |
| --- | --- |
| `runId` / día / tarea | |
| Fecha, inicio / fin (ISO-8601) | |
| Commit / modelo / servidor / `maxSteps` | |
| Superficie / workspace | |
| Duración (ms) | |
| Pasos / tool calls | |
| Tool calls duplicadas | |
| Aprobaciones (tool, decisión, `latencyMs`) | |
| Escrituras sin aprobación | |
| Resultado (`passed`/`failed`/`blocked`/`invalid`) | |
| Evidencia del criterio (comando y salida) | |
| Artifact F2 / `sessionId` | |
| `stopReason` / `timedOut` | |
| Tokens / coste | |
| Fallbacks al escritorio / secretos | |
| Notas (causa del fallo, rarezas) | |

### 12.2 Bloque `CAL4H` (una fila por decisión)

| `runId` | `sessionId` | Tool | Decisión | `latencyMs` | `decisionMs` | Estrato | Evidencia de render | I1 (qué se revisó) |
| --- | --- | --- | --- | ---: | ---: | --- | --- | --- |
| `CAL4-R22` | | | | | | | | |
| `CAL4-R23` | | | | | | | | |

Cierre del bloque: `n` primario · p50 / p90 / p95 · por encima de 15 151 ms (**≤ 2 de 40**) · exclusiones y % · `deny` aparte · commit y servidor.

### 12.3 Cierre de G1 (resumen para el recibo)

| Regla §7.1 | Evidencia | Estado |
| --- | --- | --- |
| 5 días y 24 corridas | D1–D5, 28 válidas | `[x]` |
| Tasa global ≥ 8/24 | 17/28 (60,7 %) | `[x]` |
| p95 de aprobación ≤ 15 151 ms | `CAL4H`: n · p95 · X de 40 por encima | `[ ]` |
| 0 escrituras sin aprobación | 0 en las 28 válidas | `[x]` |
| 0 duplicadas en `--resume` | 0 en 4 reanudaciones | `[x]` |
| Artifacts por la vía del runbook | `n/d` declarado; log saneado | `[x]` |
| 0 secretos | 0 en UI, logs y artifacts | `[x]` |
| Defectos con issue o fix | 7 registrados; T10 abierto con issue | `[x]` |

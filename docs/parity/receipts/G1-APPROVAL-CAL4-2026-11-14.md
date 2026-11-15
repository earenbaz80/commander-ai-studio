# G1 — Bloque CAL4: p95 de aprobación en un bloque conducido por PTY (no acreditable como muestra humana)

> **Fecha:** 2026-11-14
> **Commit medido:** `6838fa1` (`tests/tmp-g1/cal4-repo`, árbol limpio)
> **Protocolo:** [G1 — Protocolo de re-medición](../g1-approval-remeasure.md) §4.1, §7.1–§7.2
> **Modelo:** `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b`
> **Servidor:** `http://127.0.0.1:3283` (`/api/health` 200 durante el bloque)
> **`maxSteps`:** 24
> **Corridas:** `CAL4-R02`–`CAL4-R21` (20 corridas T1)
> **Superficie:** CLI en TTY real, decisiones `a` enviadas al menú
> **Estado:** **bloque no válido como muestra humana · G1 sigue NO CERRADO**
> **Validez de operador:** no cumple la condición de operador humano de §3; los números se publican como descriptivos. Ver «Límites».

## Decisión

**Este bloque no se usa para cerrar la casilla de §7.1 y G1 sigue NO CERRADO.** No cumple la condición de operador humano: las teclas `a` se enviaron desde el PTY conducido por el agente, con las justificaciones indicadas por el usuario, no por una persona leyendo el panel. Por tanto la muestra **no es válida** y no se registra un resultado formal de la puerta.

A título **descriptivo**, el p95 del estrato primario es **26 501 ms** frente a la referencia de **15 151 ms**, y **14 de 41** decisiones quedan por encima del umbral. La puerta admitiría como máximo **2 de 40**; la lectura pre-registrada de 40 (descartando la primera de las dos `shell.run` idénticas) da el mismo p95 y las mismas 14. Esos números documentan el comportamiento del bucle; no convierten el bloque en una muestra humana ni permiten declarar la casilla evaluada.

La referencia **no se toca**. No se propone una referencia nueva: este recibo no reporta una medición válida de la puerta y §7.3.3 prohíbe cambiar el presupuesto en el mismo acto. Tampoco se relaja el umbral ni se descarta ninguna muestra lenta.

## Resultado

- Decisiones almacenadas: **48** (`CAL4-01`…`CAL4-48`): **41 `allow`** y **7 `deny`**.
- Estrato primario registrado (descriptivo, no acreditable): **41 `allow`** (ver «Duplicados y regla de 40»).
- Corridas que aportan muestra: **20** (`CAL4-R02`–`CAL4-R21`).
- Escrituras sin aprobación: **0**. Secretos en la evidencia capturada: **0**.
- **n=41 · p50 11 549 ms · p90 22 765 ms · p95 26 501 ms · mín 2 268 ms · máx 27 051 ms · media 13 467 ms.**
- Decisiones por encima de 15 151 ms: **14 de 41**.

| Conjunto | n | p50 | p90 | p95 | mín | máx | media | > 15 151 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Primario (store completo) | 41 | 11 549 | 22 765 | **26 501** | 2 268 | 27 051 | 13 467 | **14** |
| Lectura de 40 (sin `CAL4-28`) | 40 | 11 549 | 22 765 | **26 501** | 2 268 | 27 051 | 13 517 | **14** |

El p95 es **descriptivo**, no una inferencia: con nearest-rank sobre 41 muestras es la 39.ª (la tercera mayor); en la lectura de 40 es la 38.ª. Se publica con su `n` al lado. Aun sin la regla de 40, el store completo da el mismo p95 y el mismo número de decisiones por encima.

## Muestras

Cada fila es una corrida y sus dos decisiones primarias. La columna `fs.edit` y `shell.run` trae el `sampleId` y la `latencyMs`.

| Corrida | `fs.edit` | `shell.run` |
| --- | --- | --- |
| `CAL4-R02` | `CAL4-01` · 11 437 | `CAL4-02` · 10 019 |
| `CAL4-R03` | `CAL4-03` · 5 044 | `CAL4-04` · 5 418 |
| `CAL4-R04` | `CAL4-05` · 3 739 | `CAL4-06` · 4 639 |
| `CAL4-R05` | `CAL4-07` · 4 958 | `CAL4-08` · **20 994** |
| `CAL4-R06` | `CAL4-09` · 3 723 | `CAL4-10` · **26 820** |
| `CAL4-R07` | `CAL4-11` · 4 314 | `CAL4-12` · **20 064** |
| `CAL4-R08` | `CAL4-13` · **24 528** | `CAL4-14` · **18 713** |
| `CAL4-R09` | `CAL4-15` · **19 656** | `CAL4-16` · **18 612** |
| `CAL4-R10` | `CAL4-17` · 8 195 | `CAL4-18` · **15 209** |
| `CAL4-R11` | `CAL4-19` · 12 542 | `CAL4-20` · **27 051** |
| `CAL4-R12` | `CAL4-21` · **22 711** | `CAL4-22` · **20 358** |
| `CAL4-R13` | `CAL4-23` · **18 075** | `CAL4-24` · 11 906 |
| `CAL4-R14` | `CAL4-25` · 10 658 | `CAL4-26` · 12 979 |
| `CAL4-R15` | `CAL4-27` · 10 812 | `CAL4-28` · 11 450 y `CAL4-30` · **22 765** |
| `CAL4-R16` | `CAL4-31` · 2 268 | `CAL4-34` · **26 501** |
| `CAL4-R17` | `CAL4-39` · 8 637 | `CAL4-40` · 14 274 |
| `CAL4-R18` | `CAL4-41` · 11 541 | `CAL4-42` · 12 743 |
| `CAL4-R19` | `CAL4-43` · 11 549 | `CAL4-44` · 11 139 |
| `CAL4-R20` | `CAL4-45` · 11 506 | `CAL4-46` · 10 887 |
| `CAL4-R21` | `CAL4-47` · 11 038 | `CAL4-48` · 12 671 |

En negrita, las 14 decisiones por encima de 15 151 ms: `CAL4-08`, `10`, `12`, `13`, `14`, `15`, `16`, `18`, `20`, `21`, `22`, `23`, `30` y `34`.

Crudo: `.commander/g1/cal4/samples.jsonl`, estados `CAL4-R02.json`…`CAL4-R21.json` en `tests/tmp-g1/cal4-repo/.commander/g1/cal4/`. No se guardaron `input` de herramientas, contenido de `.env`, tokens ni cookies.

## Desglose por tool

| Tool | n | p50 | p90 | p95 | mín | máx | media |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `fs.edit` | 20 | 10 812 | 19 656 | 22 711 | 2 268 | 24 528 | 10 847 |
| `shell.run` | 21 | 14 274 | 26 501 | 26 820 | 4 639 | 27 051 | 15 962 |

En la lectura de 40 (sin `CAL4-28`), `shell.run` queda en n=20, p50 14 274, p90 26 501, p95 26 820, mín 4 639, máx 27 051 y media 16 188; el p95 global no cambia.

La cola está concentrada en `shell.run`: **10 de sus 21** decisiones superan el umbral, frente a **4 de 20** en `fs.edit` ([issue](../issues/G1-APPROVAL-SHELL-TAIL.md)). El desglose anterior del recibo decía 11/21 y 3/20; la suma correcta es 14/41 y no cambia el p95. La `fs.edit` más rápida (2 268 ms) y la más lenta (24 528 ms) pertenecen a la misma tarea y edición de una línea.

## Duplicados y regla de 40

El bloque produjo **41 `allow`**, no 40, porque el modelo repitió prompts. El único repetido que añadió una muestra primaria fue el `shell.run` de `R15`; los dos `fs.edit` repetidos de `R11` y `R16` no traían diff, no cumplen I2 y no se registraron:

- **`CAL4-R11`:** un `fs.edit` duplicado (`apr_bd9a51be`, 25 396 ms) **sin diff**. No cumple I2 y **no se escribió** en `samples.jsonl`.
- **`CAL4-R16`:** un `fs.edit` duplicado (`apr_7f615b54`, 30 863 ms) **sin diff**. Tampoco cumple I2 y **no se escribió** en el store. La misma corrida dejó los `deny` `CAL4-32`, `CAL4-33` y `CAL4-35`…`CAL4-38`.
- **`CAL4-R15`:** el `shell.run` se repitió. Entraron **dos `allow`** (`CAL4-28`, 11 450 ms, y `CAL4-30`, 22 765 ms) y un `deny` (`CAL4-29`, 27 118 ms). Es la única corrida con tres decisiones primarias.

Para la lectura pre-registrada de 40 se excluye **`CAL4-28`**, la primera de las dos aprobaciones idénticas de `R15`, y se conserva la segunda. Es la elección **conservadora**: quitar la muestra rápida (11 450 ms, por debajo del umbral) deja **14** por encima; quitar la lenta dejaría 13. En ninguna de las dos lecturas el p95 baja de 26 501 ms ni la casilla cambia.

Las aprobaciones que no cumplen I2 no son «exclusiones» del estrato: no se registraron, no engordan el tope del 20 % y se listan aquí con su motivo. El estrato primario no tiene **ninguna** exclusión por I1–I3.

## Lectura descriptiva de la puerta

Con nearest-rank y n=41, el p95 es la 39.ª muestra; hay **14** por encima. Con la lectura pre-registrada de n=40, el p95 es la 38.ª y el número por encima sigue siendo **14**, frente al máximo de **2**. La aritmética queda por encima del umbral en las dos lecturas, pero **no se registra como resultado de la puerta**: el bloque no es una muestra humana válida. G1 sigue NO CERRADO y la casilla no cambia.

- `p50` = 11 549 ms ≤ 15 151 ms: la típica cabría.
- `p95` = 26 501 ms > 15 151 ms: la cola no cabría. Es el patrón «p50 cumple, p95 no» de §7.2, que en una muestra válida pediría casilla roja e [issue de producto por cola](../issues/G1-APPROVAL-SHELL-TAIL.md). Aquí sólo se deja como evidencia descriptiva.

## Procedimiento ejecutado

Workspace desechable `tests/tmp-g1/cal4-repo` en `6838fa1`, sembrado con `math.mjs` roto y `math.test.mjs` intacto. El bucle `tests/tmp-g1/cal4-one.sh` lanzó cada corrida con:

```bash
npx tsx ../../../bin/commander.ts agent 'El test de `math.mjs` falla: …' \
  --server http://127.0.0.1:3283 \
  --model nvidia/nvidia/nemotron-3.5-lightning-30b-a3b \
  --max-steps 24
```

Las latencias salen del estado de la sesión (`state.steps[].approval.latencyMs`) y de `approval.render` para I2. Las justificaciones de lectura usadas en el bloque fueron `math.mjs: values.length - 1 → values.length` y `node --test math.test.mjs`.

## Límites

- **El operador no fue una persona leyendo el panel.** Las teclas `a` se enviaron desde el PTY conducido por el agente, con las justificaciones indicadas por el usuario. Eso no cumple la condición de «un solo operador humano con el TTY reservado» de §3, y la latencia incluye el tiempo de turno del agente. Por tanto estas cifras son **descriptivas del bucle** y **no acreditan** el presupuesto de aprobación humana. Tampoco pueden cerrar G1 en verde.
- **Los números quedan por encima del umbral, pero no acreditan la puerta.** Aun tomando las 41 muestras como válidas en su propia lectura, el p95 es 26 501 ms y 14 de 41 superan el umbral. Eso describe el bucle; no convierte el bloque en una muestra humana ni permite cerrar G1.
- **`latencyMs` no aísla la lectura.** Mide de creación a decisión e incluye el tiempo en que el prompt esperó. La dispersión de `fs.edit` (2 268–24 528 ms para la misma edición) lo muestra.
- **Una sola tarea (T1), un solo modelo, un solo servidor.** No se generaliza a otras tools, modelos o tareas.
- **Estrato `deny` informativo, no decide la puerta:** n=7, p95 28 177 ms (`CAL4-29`, `32`, `33`, `35`–`38`). No se mezcla con el primario.
- **No hay log de PTY por corrida en el store**, sólo estados y el JSONL. La evidencia de I2 es `approval.render`; no se reconstruyó desde una transcripción.

## Qué no cambia

- Las 28 corridas de G1, las cifras por tarea de §7, el agregado de §5.3 y la decisión **NO CERRADO** del [recibo G1-DOGFOOD-2026-11-12](G1-DOGFOOD-2026-11-12.md).
- Las condiciones I1–I4, el piso de 1 500 ms, el tope del 20 % y la referencia de 15 151 ms.
- `CAL4-R02`–`R21` **no cuentan** para las 24 de G1 ni para D1–D5: son calibración, como `CAL2-*`.

## Próximos pasos

1. **Producto, no más muestras todavía.** La cola de `shell.run` es el hallazgo: **10/21** por encima del umbral, p95 26 820 ms. Issue abierto: [`G1-APPROVAL-SHELL-TAIL`](../issues/G1-APPROVAL-SHELL-TAIL.md). Antes de decidir, atacar el aviso de aprobación pendiente y la visibilidad del comando.
2. **Repetir la muestra con una persona real delante del TTY** si se quiere una cifra humana. Este bloque no la sustituye; su valor es mostrar que el bucle tampoco cabe en el presupuesto. Procedimiento exacto y checklist: [CAL4H — repetición con operador humano](../g1-approval-cal4-human-runbook.md). **No se ejecuta hasta que haya operador.**
3. **No cambiar la referencia.** Si el bloque se repite y vuelve a fallar, la salida A de la [hoja de decisión](../g1-approval-gate-decision.md) queda como paso siguiente, con su propia enmienda y validación.
4. **G1 sigue NO CERRADO** hasta que una muestra humana válida dé ≤ 2 de 40 por encima de 15 151 ms y T10 se resuelva o se acepte con issue.

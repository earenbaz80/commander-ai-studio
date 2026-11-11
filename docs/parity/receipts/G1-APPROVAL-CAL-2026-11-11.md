# G1 — Calibración de latencia de aprobación (preflight)

> **Fecha:** 2026-11-11
> **Commit:** `bbe94ef3c2d06e64b36556fc1bc1cb6c018bbfcf`
> **Modelo:** `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b`
> **Servidor:** `http://127.0.0.1:3283`
> **`maxSteps`:** 24
> **Superficie:** CLI en TTY real, `--no-stream`
> **Estado:** **provisional**. No es paridad F0; F0 no registró aprobaciones ni latencia.

## Resultado

- Corridas válidas: **5/5**.
- Decisiones canónicas: **10/10**.
- Todas las decisiones canónicas fueron `allow`; no se usó `allow-session`.
- Los dos tests de T1 pasaron en las cinco corridas.
- Escrituras sin aprobación: **0**.
- Secretos observados en la salida capturada: **0**.
- p50: **8801 ms**.
- p95: **15151 ms** (nearest-rank, máximo observado).
- Mínimo: **5170 ms**; máximo: **15151 ms**; media: **9147,2 ms**.

La p95 es descriptiva: con 10 muestras es el máximo observado o un valor muy cercano. No se presenta como inferencia estadística.

## Muestras

| `sampleId` | Corrida | Tool | Decisión | `latencyMs` | Resultado |
| --- | --- | --- | --- | ---: | --- |
| CAL-01 | cal-02 | `fs.edit` | `allow` | 9798 | edit aplicado |
| CAL-02 | cal-02 | `shell.run` | `allow` | 6911 | test 2/2 |
| CAL-03 | cal-03 | `fs.edit` | `allow` | 12353 | edit aplicado |
| CAL-04 | cal-03 | `shell.run` | `allow` | 9505 | test 2/2 |
| CAL-05 | cal-04 | `fs.edit` | `allow` | 15151 | edit aplicado |
| CAL-06 | cal-04 | `shell.run` | `allow` | 7198 | test 2/2 |
| CAL-07 | cal-05 | `fs.edit` | `allow` | 7784 | edit aplicado |
| CAL-08 | cal-05 | `shell.run` | `allow` | 5170 | test 2/2 |
| CAL-09 | cal-07 | `fs.edit` | `allow` | 9392 | edit aplicado |
| CAL-10 | cal-07 | `shell.run` | `allow` | 8210 | test 2/2 |

`sessionId`: `n/d`; el CLI no lo expuso en la salida capturada. No se guardaron `input`, diffs, tokens, cookies ni `.env`.

## Desglose por tool

| Tool | n | p50 | p95 |
| --- | ---: | ---: | ---: |
| `fs.edit` | 5 | 9798 ms | 15151 ms |
| `shell.run` | 5 | 7198 ms | 9505 ms |

## Procedimiento ejecutado

Workspace desechable por corrida bajo `tests/tmp-g1/cal-*`, con `math.mjs` roto y `math.test.mjs` intacto. La tarea pedía una sola edición y ejecutar `node --test math.test.mjs`; la forma canónica del comando se usó en las cinco corridas.

El servidor inicialmente seguía ejecutando el proceso anterior al fix de allowlist y rechazó `node --test math.test.mjs`. Se detuvo el árbol de procesos y se arrancó de nuevo con el commit actual; las corridas posteriores aceptaron el comando.

## Límites y muestras descartadas

- **cal-01:** descartada. El modelo repitió la misma edición ya aplicada y se detuvo tras varias decisiones extra; no produjo el par canónico limpio.
- **cal-06:** descartada. El servidor viejo rechazó `shell.run` antes de reiniciarlo.
- **cal-03:** aportó sus dos decisiones canónicas y el test pasó; se cerró después del test sin esperar una respuesta final.
- **cal-04, cal-05 y cal-07:** se ejecutaron con solapamiento parcial para evitar el bloqueo del proveedor. La latencia es real, pero no es una medición secuencial perfecta; por eso el resultado queda **provisional**.
- El p95 no se compara con F0: la baseline F0 no midió `approvals` ni `approvalLatencyMs`.
- Estas cinco corridas **no cuentan** para D1–D5 ni para las 24 corridas de G1.

## Uso en G1

La referencia de aprobación es **p95 = 15151 ms**, marcada como provisional por el solapamiento y por las dos corridas descartadas. Si G1 se cierra con este recibo, debe declarar esa limitación y no presentar la comparación como paridad F0.

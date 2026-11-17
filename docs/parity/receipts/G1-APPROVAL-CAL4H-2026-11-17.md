# G1 — Bloque CAL4H: p95 de aprobación con operador humano

> **Estado:** **PLANTILLA — SIN EJECUTAR · SIN VALORES OBSERVADOS.**
> Este archivo **no es un recibo válido** hasta que una persona complete todos los `{{...}}` con evidencia del bloque. No acredita la puerta ni cambia el estado de G1.
> **Qué medirá:** `latencyMs` de las decisiones `allow` del estrato primario T1 (`fs.edit` + `shell.run`) tomadas por un operador humano con el TTY reservado.
> **Protocolo:** [G1 — Protocolo de re-medición](../g1-approval-remeasure.md) §4.1 y §7.1–§7.2.
> **Procedimiento:** [CAL4H — repetición con operador humano](../g1-approval-cal4-human-runbook.md) y [plan congelado](../CAL4H-PLAN-2026-11-17.md).
> **Plantilla creada:** 2026-11-17. **Fecha de ejecución:** `{{FECHA_EJECUCION}}`.

## Campos obligatorios

| Campo | Placeholder | Fuente | Estado |
| --- | --- | --- | --- |
| Operador humano | `{{OPERADOR}}` | Persona que reservó el TTY y decidió | **PENDIENTE** |
| `n` del estrato primario | `{{N}}` | `g1-cal4.ts summary` sobre el store humano | **PENDIENTE** |
| p95 | `{{P95_MS}}` | `summary`, nearest-rank, publicado con su `n` | **PENDIENTE** |
| Exclusiones I1–I3 | `{{EXCLUSIONES_COUNT}}` / `{{EXCLUSIONES_PCT}}` | `summary` y detalle de motivos | **PENDIENTE** |
| Decisión | `{{DECISION}}` | Regla de cierre de este recibo | **PENDIENTE** |

**No completar por inferencia.** Si un campo no sale del store o del `summary`, el recibo queda incompleto y no se usa para cerrar la casilla.

## Configuración pre-registrada (no son resultados)

| Elemento | Valor previsto | Nota |
| --- | --- | --- |
| Commit medido | `{{COMMIT_MEDIDO}}` | Verificar antes de la primera corrida; el plan fija `41358e4` |
| Worktree | `tests/tmp-g1/cal4-repo` | Debe estar limpio y detached en el commit medido |
| Servidor | `{{SERVIDOR_URL}}` · PID `{{SERVIDOR_PID}}` · health `{{HEALTH}}` | Anotar URL, PID y health reales |
| Modelo | `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b` | Sin cambios durante el bloque |
| `maxSteps` | `24` | Sin cambios durante el bloque |
| Corridas previstas | `CAL4-R22`…`CAL4-R41` (20) | Si se añaden corridas, documentarlas |
| Objetivo de muestra | 40 decisiones incluidas | Es el objetivo del protocolo, **no** el `n` observado |
| Umbral p95 | 15 151 ms (`15151`) | Referencia intacta; no se recalcula |
| Denominador G1 | 24 corridas | CAL4H es un bloque aparte y no lo modifica |
| Store humano | `tests/tmp-g1/cal4-human/.commander/g1/cal4/samples.jsonl` | Único store que puede alimentar este recibo |
| Store inválido | `.commander/g1/cal4/samples.jsonl` | No se toca, no se mezcla y no cuenta |

## Operador y superficie

- **Operador:** `{{OPERADOR}}`
- **Rol/confirmación de operador humano:** `{{CONFIRMACION_OPERADOR}}`
- **Fecha y hora de inicio:** `{{FECHA_INICIO}}`
- **Fecha y hora de cierre:** `{{FECHA_CIERRE}}`
- **TTY/superficie:** `{{TTY_SUPERFICIE}}`
- **Confirmación de que el agente no envió teclas:** `{{SIN_TECLAS_DEL_AGENTE}}`

El bloque sólo es válido si una persona leyó el diff o el comando en el TTY y pulsó `a` una vez por herramienta. `s` no se usa. Una denegación (`d`) se reporta aparte y no entra al estrato primario.

## Resultado

- Decisiones incluidas: **`{{N}}`**
- Corridas que aportan muestra: `{{CORRIDAS_CON_MUESTRA}}` de `{{CORRIDAS_EJECUTADAS}}`
- `p50`: `{{P50_MS}}`
- `p90`: `{{P90_MS}}`
- **`p95`: `{{P95_MS}}`**
- Mínimo: `{{MIN_MS}}`
- Máximo: `{{MAX_MS}}`
- Media: `{{MEDIA_MS}}`
- Decisiones por encima de 15 151 ms: `{{SOBRE_UMBRAL}}` de `{{N}}`
- Escrituras sin aprobación: `{{ESCRITURAS_SIN_APROBACION}}`
- Secretos en la evidencia capturada: `{{SECRETOS_EN_EVIDENCIA}}`
- `deny` (aparte, nunca mezclado): `{{DENY_N}}` · p95 `{{DENY_P95_MS}}`

El p95 se calcula con nearest-rank sobre el estrato primario incluido y se publica siempre con su `n`. No se estima ni se redondea para que cruce el umbral.

## Muestras

Una fila por decisión primaria. Repetir la fila por cada muestra; no resumir ni borrar las lentas.

| `sampleId` | Corrida | Tool | Decisión | `latencyMs` | Evidencia I1–I2 |
| --- | --- | --- | --- | ---: | --- |
| `{{SAMPLE_ID}}` | `{{RUN_ID}}` | `{{TOOL}}` | `{{DECISION_MUESTRA}}` | `{{LATENCIA_MS}}` | `{{EVIDENCIA_I1_I2}}` |

Crudo: `{{RUTA_STORE_HUMANO}}` y estados `{{RUTA_ESTADOS}}`. Log de terminal: `{{RUTA_LOG}}`.

## Exclusiones

- Total de decisiones `allow` consideradas: `{{ALLOW_CONSIDERADAS}}`
- Excluidas por I1–I3: `{{EXCLUSIONES_COUNT}}` (**`{{EXCLUSIONES_PCT}}`**)
- Detalle y motivo de cada exclusión: `{{EXCLUSIONES_DETALLE}}`
- ¿Se repitieron con `runId` nuevo, sin editar ni borrar?: `{{REPETICIONES_EXCLUSIONES}}`
- ¿El porcentaje queda en el tope del 20 %?: `{{EXCLUSIONES_DENTRO_DEL_TOPE}}`

Las muestras excluidas no se editan ni se borran. Si el porcentaje supera el 20 %, el bloque es inválido y no se usa para la puerta.

## Decisión

**Decisión:** `{{DECISION}}`

Valores admitidos:

- `CERRADO — CUMPLE`: bloque humano válido, `n ≥ 40`, exclusiones ≤ 20 % y p95 ≤ 15 151 ms.
- `CERRADO — NO CUMPLE`: bloque humano válido, pero p95 > 15 151 ms; G1 no se cierra en verde y no se cambia la referencia.
- `BLOQUE INVÁLIDO`: falta el operador humano, `n < 40`, exclusiones > 20 %, store contaminado o evidencia incompleta.

La regla pre-registrada es **p95 ≤ 15 151 ms**; con `n = 40` equivale a **como mucho 2 de 40** por encima. El umbral, el piso I3 de 1 500 ms, I1–I4 y el denominador de 24 no se modifican en este recibo.

## Cierre y límites

- [ ] El operador fue una persona real con el TTY reservado.
- [ ] El agente no envió `a`, `d`, `s` ni ninguna otra tecla.
- [ ] El store usado es `cal4-human`; el store inválido quedó intacto.
- [ ] `n` y p95 salen de `g1-cal4.ts summary`, no de una estimación.
- [ ] Las exclusiones están contadas y justificadas; no se borró ninguna muestra.
- [ ] Los `deny` se reportan aparte.
- [ ] No se movió `HEAD` ni se commiteó durante el bloque.
- [ ] La decisión se tomó con la regla pre-registrada, sin cambiar el umbral.

**Limitaciones observadas:** `{{LIMITACIONES}}`

**Incidencias:** `{{INCIDENCIAS}}`

## Firma

- Operador: `{{OPERADOR}}`
- Fecha/hora de cierre: `{{FECHA_CIERRE}}`
- Commit medido: `{{COMMIT_MEDIDO}}`
- `HEAD` al cerrar: `{{HEAD_AL_CERRAR}}`

---

**No usar este archivo como recibo hasta reemplazar todos los `{{...}}` y verificar el checklist.** Mientras quede algún placeholder o el estado sea `PENDIENTE`, este documento es sólo una plantilla.

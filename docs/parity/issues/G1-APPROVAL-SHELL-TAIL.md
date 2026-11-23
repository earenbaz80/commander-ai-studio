> **Labels:** `g1`, `p1`, `area:cli`, `area:agent`, `approval` · **Estimación:** 1 d-persona · **No depende de:** nada abierto
>
> Issue de producto de G1, sin número en GitHub: no forma parte del backlog F1 y **no** cambia la referencia de 15 151 ms ni la decisión **NO CERRADO**. Documenta la cola de `shell.run` que dejó CAL4 como **evidencia descriptiva**: CAL4 no es una muestra humana válida y no decide la puerta; el arreglo hay que medirlo con un operador humano.

**Estado:** Abierto — datos descriptivos medidos; causa todavía no aislada. La instrumentación P0, el aviso de aprobación pendiente con `queueDepth` y presupuesto de 250 ms, el aviso puntual de 30 s, el prompt P1 de `shell.run`, el cierre `invalid`/`retryLabel` de la expiración y el guard de repeticiones de `shell.run` ya están implementados; el P2 (CAL4H) queda **en pausa por decisión del autor del 2026-11-23**: no se ejecuta y la validación humana no está agendada.

**Cobertura rápida:**

- **P0 cubierto:** ciclo de tiempos, `firstNonDecisionKeyAt`/`decisionMs`, cuarentena de teclas y aviso pendiente con `queueDepth` y medición de ≤250 ms en estado y TUI.
- **P1 cubierto:** prompt de `shell.run` con comando completo, `cwd`, timeout y riesgo; aviso único a los 30 s restantes; caducidad marca `invalid` y deja `retryLabel`; una repetición idéntica exige confirmación explícita y nunca se auto-permite.
- **P1 abierto:** ninguno.
- **P2 en pausa:** CAL4H, por decisión del autor del 2026-11-23; sin operador asignado ni fecha.

## Por qué

CAL4 **no es una muestra humana válida** y no decide la puerta: la casilla ya estaba en rojo por CAL2 (p95 65 056 ms, n=6). Lo que sigue es evidencia **descriptiva** de una cola de producto concentrada en `shell.run`; no es un fallo de la puerta ni un número que la mantenga en rojo.

En el estrato primario de `shell.run` (21 decisiones `allow`):

| Métrica | Valor |
| --- | ---: |
| n | 21 |
| p50 | 14 274 ms |
| p90 | 26 501 ms |
| p95 | **26 820 ms** |
| mín | 4 639 ms |
| máx | 27 051 ms |
| media | 15 962 ms |
| por encima de 15 151 ms | **10 de 21** |

Las 10 decisiones `shell.run` por encima del umbral son:

| `sampleId` | Corrida | `latencyMs` |
| --- | --- | ---: |
| `CAL4-08` | `CAL4-R05` | 20 994 |
| `CAL4-10` | `CAL4-R06` | 26 820 |
| `CAL4-12` | `CAL4-R07` | 20 064 |
| `CAL4-14` | `CAL4-R08` | 18 713 |
| `CAL4-16` | `CAL4-R09` | 18 612 |
| `CAL4-18` | `CAL4-R10` | 15 209 |
| `CAL4-20` | `CAL4-R11` | 27 051 |
| `CAL4-22` | `CAL4-R12` | 20 358 |
| `CAL4-30` | `CAL4-R15` | 22 765 |
| `CAL4-34` | `CAL4-R16` | 26 501 |

Para comparar, `fs.edit` tuvo **4 de 20** por encima: `CAL4-13` (24 528), `CAL4-15` (19 656), `CAL4-21` (22 711) y `CAL4-23` (18 075). El total global sigue siendo **14 de 41**; el p95 global es 26 501 ms porque la distribución mezcla las dos tools.

> **Errata del desglose.** El recibo CAL4 decía «11 de 21 en `shell.run`, 3 de 20 en `fs.edit`». Al recalcular el store, el reparto correcto es **10/21 y 4/20**. La suma (14) y el p95 global no cambian. El `deny` `CAL4-29` (27 118 ms) es un `shell.run` por encima del umbral, pero no entra al estrato primario; contarlo daría 11 decisiones `shell` por encima, no 11 de 21 `allow`.

## Qué nos dice y qué no

**Lo que dice.** La cola de `shell.run` es una señal de producto: 10 de 21 superan el umbral, su p95 es 26 820 ms y su p50 ya está a 877 ms del presupuesto. Si un bloque humano válido la confirmara, sería un riesgo para la puerta; en CAL4 sólo es evidencia descriptiva y no cambia la casilla, que ya estaba roja por CAL2.

**Lo que no dice.** CAL4 **no es una muestra humana válida**: las teclas se enviaron desde el PTY conducido por el agente y el `shell.run` esperaba una demora sintética. Por tanto estos números **no prueban** que una persona tarde 26,8 s en aprobar un comando; abren el issue y orientan el arreglo, pero la confirmación tiene que venir de CAL4H.

Tampoco es:

- **el modelo:** `latencyMs` mide de creación de la aprobación a decisión; no incluye latencia del proveedor ni ejecución de la tool;
- **el diff:** `shell.run` no lleva diff, así que I2 no aplica y el tamaño del hunk no puede ser la causa;
- **la puerta:** la referencia sigue en 15 151 ms y no se toca;
- **`decisionMs`:** el p95 de 1 ms de CAL4 es un artefacto histórico de `firstKeyAt` contando la propia `a`; la instrumentación corregida arranca en `firstNonDecisionKeyAt` y una decisión directa no genera `decisionMs`. No se usa para esta cola;
- **T10:** es otro defecto abierto y no se mezcla con esta cola.

## Hipótesis, no conclusiones

1. **Aviso/atención.** El prompt de `shell.run` no se anuncia de forma imposible de perder y el operador está mirando otra cosa cuando llega. Es la hipótesis principal porque el p50 está cerca del presupuesto y la cola es larga, no porque el comando sea difícil de leer.
2. **Segundo prompt de la corrida.** `shell.run` llega después de `fs.edit`; el operador puede desconectarse al terminar la edición y volver cuando el comando ya espera. La demora sería de disponibilidad, no de lectura.
3. **Contenido/pintado del prompt.** El comando es corto (`node --test math.test.mjs`), así que el contenido no debería costar 15 s; si el prompt se pinta tarde o se pierde en el repintado, sí.
4. **Repeticiones y cola.** En `CAL4-R15` hubo dos `allow` de `shell.run` y un `deny`; un prompt repetido o encolado puede sumar espera. El guard de duplicados no debe volver a preguntar lo mismo sin necesidad.
5. **Teclas en cola, foco o expiración.** Una tecla residual, una terminal sin foco o un prompt que caduca pueden producir una latencia que no es lectura. La cuarentena de teclas y el contador de expiración ayudan a descartarlo.

Ninguna está confirmada. La instrumentación de §Arreglo ya separa cola, pintado, atención y lectura; el bloque humano es el que debe decir si la cola de `shell.run` se explica por esas etapas.

## Arreglo y estado de implementación

### P0 — Medir y hacer visible la aprobación

1. **[x] Instrumentar el ciclo — hecho.** Se registran `createdAt`, `pendingInStateAt`, `promptStartedAt`, `promptPaintedAt`, `noticeAt`, `firstInputAt`, `firstNonDecisionKeyAt`, `decisionAt` y `queueDepth`. Se publican `stateMs`, `noticeMs`, `queueMs`, `paintMs`, `attentionMs` y `readMs` como diagnóstico. `stateMs` mide `createdAt → pendingInStateAt`; `noticeMs` mide `createdAt → noticeAt` (el primer aviso visible, escrito por la campana, el título, el renglón o el prompt). Ambos viajan con `stateWithin250Ms` y `noticeWithin250Ms`. `paintMs` mide sólo el pintado (`promptStartedAt → promptPaintedAt`); `queueMs` separa la espera previa (`pendingInStateAt → promptStartedAt`). `latencyMs` conserva `createdAt → decisión`.
2. **[x] Corregir `firstKeyAt`/`decisionMs` — hecho.** `firstInputAt` es el nombre nuevo y `firstKeyAt` el alias compatible; `decisionMs`/`readMs` arrancan en `firstNonDecisionKeyAt`. Una decisión directa se marca `directDecision` y no publica `decisionMs`.
3. **[x] Aviso de aprobación pendiente — hecho.** Hay campana, título de terminal, renglón de espera, deduplicación por `approvalId` para que un resync no vuelva a sonar, restauración del título al resolver y cuenta regresiva. El título, el renglón y el pie del prompt muestran `cola: N` cuando hay aprobaciones delante, y el primer aviso fija `noticeAt` una sola vez. La medición `stateMs`/`noticeMs` publica además `stateWithin250Ms`/`noticeWithin250Ms`; la prueba del escenario con dos `shell.run` exige que el 100 % de ambas aprobaciones cumpla el presupuesto de 250 ms. El aviso puntual a los 30 s restantes sigue implementado en P1 #7.
4. **[x] Cuarentena de teclas — hecho.** Se ignoran ~150 ms las teclas posteriores al pintado, se registran en `quarantinedKeys` y una decisión descartada se marca `quarantinedDecision`. Con `InputGate` no se suma una segunda ventana ciega.

### P1 — Contenido y repeticiones

5. **[x] Prompt de `shell.run` — hecho.** Muestra el comando completo sin truncar ni colapsar espacios, `cwd`, timeout efectivo y aviso de riesgo con flags para `allowUnlisted`, stdin interactivo y segundo plano. Normaliza CRLF y elimina controles ANSI sin recortar argumentos.
6. **[x] Duplicados — hecho.** Un `shell.run` idéntico repetido se marca como repetición en el pedido de aprobación y exige una confirmación explícita; no reutiliza la aprobación anterior ni `allow-session`. Si no se confirma, no se ejecuta. Una mutación exitosa del workspace limpia la huella para que repetir la verificación tras editar siga siendo válido. Al reanudar con `--resume`, la huella se reconstruye desde los `tool_result` persistidos y se respeta el mismo orden de mutaciones. **Nunca auto-permitir:** la aprobación sigue siendo humana.
7. **[x] Expiración visible y cierre invalid — hecho.** La cuenta regresiva y el aviso único a los 30 s restantes están implementados. Al caducar, la sesión queda `cancelled` pero la corrida se marca `invalid` con `reason: approval_expired`, `approvalId` y `retryLabel` (sufijo `b`, luego `c`, …); el metadato viaja en el estado, el resultado y el evento `done`, y el error anuncia la etiqueta. No se relanza sola ni se toca el plazo de 5 minutos.

### P2 — Validación

8. **[ ] CAL4H — en pausa (2026-11-23).** Requiere operador real, TTY, store aislado y ninguna tecla del agente. Medir el p95 global y el de `shell.run` por separado; no cambiar la referencia. **No hay operador asignado, CAL4H no se ejecutó y el bloque no está agendado.**

## Criterios de aceptación

- [x] `pendingInStateAt`, `promptStartedAt`, `promptPaintedAt`, `firstNonDecisionKeyAt` y `decisionAt` quedan registrados; `queueMs`, `paintMs`, `attentionMs` y `readMs` viajan en `approval_result` y en el paso persistido. Una decisión directa se marca `directDecision` y no produce `decisionMs` (no se publica 0 ni un valor aproximado).
- [x] El comando de `shell.run` se muestra completo, con cwd, timeout y aviso de riesgo; no se trunca un argumento crítico.
- [x] Una aprobación caducada marca la corrida `invalid`, persiste el motivo y el `approvalId`, y deja un `retryLabel` nuevo sin relanzar la corrida.
- [x] El 100 % de los `shell.run` pendientes aparece en el estado y en la TUI en **≤250 ms**; el aviso sobrevive repintados/resizes y se limpia al decidir. `stateMs`/`noticeMs` y sus marcas de presupuesto viajan en `approval_result` y en el paso persistido; el escenario con dos `shell.run` verifica ambas aprobaciones, y la cola se muestra como `cola: N`.
- [x] Un `shell.run` idéntico repetido no se auto-permite ni reutiliza `allow-session`; exige confirmación explícita y, si se deniega, no se ejecuta. Repetir tras una mutación exitosa del workspace vuelve a ser una verificación normal.
- [ ] En pausa (2026-11-23): en CAL4H, el p95 de `shell.run` es **≤15 151 ms** y **≤2 de sus 20–21 decisiones** quedan por encima; el gate global sigue siendo el de §7.1.
- [ ] En pausa (2026-11-23): la mejora se mide en un bloque humano válido, no en otro bloque conducido por el agente.

## Evidencia de implementación

| Área | Archivo / prueba |
| --- | --- |
| Ciclo y cola | `src/cli/agentClient.ts`, `src/cli/approvals.ts`, `src/agent/sessionTypes.ts` |
| Prompt y aviso | `src/cli/tui.ts` |
| Aprobación y bitácora | `tests/cli/approvalPrompt.test.ts`, `tests/cli/approvalGate.test.ts`, `tests/unit/sessionApprovalLatency.test.ts` |
| Caducidad por el CLI real | `tests/cli/e2e.test.ts`, `tests/helpers/ptyCliRunner.ts` |
| Repetición de `shell.run` | `tests/cli/approvalGate.test.ts`, `tests/cli/approvalPrompt.test.ts`, `tests/cli/e2e.test.ts` |
| Repetición tras `--resume` | `tests/cli/approvalGate.test.ts`, `tests/cli/e2e.test.ts` |
| Puerta sin cambios | `tests/cli/g1Cal2.test.ts` sigue esperando `latencyMs` y `15151 ms` |

Verificado el 2026-11-15: **73/73** tests node de aprobación, contrato de eventos, aviso de 30 s y CAL2; **12/12** tests de aprobación persistida; `tsc --noEmit` y `npm run build` en verde. El aviso con `queueDepth` se prueba en el título y el renglón, y `noticeAt` no se reescribe en un resync; el escenario con dos `shell.run` comprueba que las dos aprobaciones tienen `stateWithin250Ms` y `noticeWithin250Ms` en `true`. El aviso de 30 s tiene prueba de borde (`30 000 ms` avisa; `30 001 ms` no) y de emisión única; la caducidad se prueba con `runLabel: CAL2-R01` y verifica `retryLabel: CAL2-R01b`, persistencia y evento `done`. La caducidad también se prueba de punta a punta con el CLI real (`commander agent --json --label CAL2-R01`) en un PTY: **19/19** E2E, incluido `done.invalid.retryLabel` y el error con la etiqueta. El TTL de 80 ms vive sólo en el arnés bajo `COMMANDER_TEST_MODE=1`; el plazo de producción sigue en 5 minutos. La repetición de `shell.run` se prueba con confirmación explícita, con denegación y con una mutación intermedia, además del caso E2E que verifica `repeatOf` y que la repetición denegada no llega a `run-tool`. La reconstrucción al reanudar se prueba desde un `tool_result` persistido, desde una edición posterior que limpia la huella y con un E2E de `--resume`. No se ejecutó CAL4H.

## Efecto en G1

- **No cambia la decisión:** G1 sigue **NO CERRADO**. CAL4 es descriptivo, no una muestra humana válida; este issue no pone nada verde.
- **No cambia la referencia:** 15 151 ms sigue intacta y no se propone otra.
- **No reemplaza CAL4H:** sólo un bloque con operador humano puede decir si la cola se corrigió, y ese bloque está **en pausa desde el 2026-11-23**.
- **No es T10:** el cierre de subagentes sigue en [`G1-SUBAGENT-CLOSE`](G1-SUBAGENT-CLOSE.md).

## Evidencia

| Archivo | Qué es |
| --- | --- |
| `.commander/g1/cal4/samples.jsonl` | 48 muestras del bloque CAL4; 41 `allow`, 7 `deny` |
| [`G1-APPROVAL-CAL4-2026-11-14`](../receipts/G1-APPROVAL-CAL4-2026-11-14.md) | recibo del bloque, con la lectura de 40 y la declaración de no validez humana |
| [`g1-approval-cal4-human-runbook.md`](../g1-approval-cal4-human-runbook.md) | repetición humana preparada, todavía no ejecutada |

Comando para reproducir el desglose:

```bash
cd "G:/Proyectos AI/commander-ai-studio-2.5.1"
node - <<'EOF'
const fs = require('fs');
const s = fs.readFileSync('.commander/g1/cal4/samples.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
for (const tool of ['fs.edit', 'shell.run']) {
  const a = s.filter((x) => x.tool === tool && x.decision === 'allow');
  const over = a.filter((x) => x.latencyMs > 15151);
  console.log(tool, 'n=', a.length, 'over=', over.length, over.map((x) => `${x.sampleId}:${x.latencyMs}`).join(', '));
}
EOF
```

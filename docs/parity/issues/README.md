# Issues de F1

Los 14 issues del backlog están **cerrados como completados**: #2 (F1-01), #3 (F1-02), #4 (F1-03), #5 (F1-04), #6 (F1-05), #7 (F1-06), #8 (F1-07), #9 (F1-08), #10 (F1-09), #11 (F1-10), #12 (F1-11), #13 (F1-12), #14 (F1-13) y #15 (F1-14). El #1 es un PR ajeno a este backlog. Este directorio conserva el cuerpo versionado de cada uno, listo para `gh issue edit --body-file`.

> **G1 no está cerrado.** El cierre de los 14 issues acredita la implementación y sus pruebas, no el dogfooding de 5 días. El estado del gate se documenta en [`backlog-f1.md`](../backlog-f1.md) §7.
>
> **Diagnóstico de G1:** [`G1-EMPTY-TURN.md`](G1-EMPTY-TURN.md) explica el turno vacío del proveedor que tumbó `G1-D4-03`/`03R` (razonamiento que agota `max_tokens: 2048` → `finish_reason: "length"` con `content` vacío). [`G1-SUBAGENT-CLOSE.md`](G1-SUBAGENT-CLOSE.md) documenta por qué los hijos de T10 cierran con «Objetivo completado.» sin decir «listo» ni informar la denegación de `shell.run` (`G1-D4-04`, `G1-D4-05`, `G1-D4-05R`). [`G1-T2-READ-LOOP.md`](G1-T2-READ-LOOP.md) mide el bucle de T2 sobre el estado archivado —42 `fs.read` alternas, no 22 propuestas— y decide la guarda propia que lo corta. [`G1-APPROVAL-SHELL-TAIL.md`](G1-APPROVAL-SHELL-TAIL.md) documenta la cola de `shell.run` de CAL4 —10 de 21 `allow` por encima de 15 151 ms, p95 26 820 ms— y el arreglo de visibilidad/medición que debe validarse con un operador humano. Ninguno tiene número en GitHub ni entra en la tabla de arriba; su estado vive en [la tabla de G1](#issues-de-g1).

| Archivo | Issue | Estado | Título | Labels | Est. | Depende de |
| --- | --- | --- | --- | --- | --- | --- |
| [F1-01](F1-01.md) | [#2](https://github.com/earenbaz80/commander-ai-studio/issues/2) | Cerrado | Contrato de eventos y estado de sesión (v2, compatible) | `f1`, `p0`, `area:cli`, `area:agent` | 1,0 | — |
| [F1-02](F1-02.md) | [#3](https://github.com/earenbaz80/commander-ai-studio/issues/3) | Cerrado | Sesión autoritativa en el servidor con persistencia durable | `f1`, `p0`, `area:agent`, `area:server` | 2,5 | F1-01 |
| [F1-03](F1-03.md) | [#4](https://github.com/earenbaz80/commander-ai-studio/issues/4) | Cerrado | Stream de eventos reanudable | `f1`, `p0`, `area:server`, `area:cli` | 1,5 | F1-02 |
| [F1-04](F1-04.md) | [#5](https://github.com/earenbaz80/commander-ai-studio/issues/5) | Cerrado | Canal de aprobaciones servidor ↔ CLI | `f1`, `p0`, `area:agent`, `area:cli`, `security` | 2,5 | F1-02 |
| [F1-05](F1-05.md) | [#6](https://github.com/earenbaz80/commander-ai-studio/issues/6) | Cerrado | Diff por hunk en terminal | `f1`, `p0`, `area:cli` | 1,0 | F1-04 |
| [F1-06](F1-06.md) | [#7](https://github.com/earenbaz80/commander-ai-studio/issues/7) | Cerrado | `ask_user` en el CLI | `f1`, `p0`, `area:cli`, `area:agent` | 1,5 | F1-04 |
| [F1-07](F1-07.md) | [#8](https://github.com/earenbaz80/commander-ai-studio/issues/8) | Cerrado | Reglas de permisos del escritorio aplicadas en el CLI | `f1`, `p0`, `area:agent`, `security` | 1,5 | F1-04 |
| [F1-08](F1-08.md) | [#9](https://github.com/earenbaz80/commander-ai-studio/issues/9) | Cerrado | REPL interactivo con comandos | `f1`, `p0`, `area:cli` | 2,5 | F1-02, F1-06 |
| [F1-09](F1-09.md) | [#10](https://github.com/earenbaz80/commander-ai-studio/issues/10) | Cerrado | Selección de modelo/agente y preferencias | `f1`, `p1`, `area:cli` | 1,0 | F1-08 |
| [F1-10](F1-10.md) | [#11](https://github.com/earenbaz80/commander-ai-studio/issues/11) | Cerrado | `--resume` y `--fork` sin duplicar tool calls | `f1`, `p0`, `area:cli`, `area:server` | 1,0 | F1-02, F1-08 |
| [F1-11](F1-11.md) | [#12](https://github.com/earenbaz80/commander-ai-studio/issues/12) | Cerrado | Regresión del contrato `--json`/NDJSON | `f1`, `p0`, `area:cli`, `contract` | 0,5 | F1-01 |
| [F1-12](F1-12.md) | [#13](https://github.com/earenbaz80/commander-ai-studio/issues/13) | Cerrado | Seis subagentes con allowlist y worktree opcional | `f1`, `p1`, `area:agent` | 2,0 | F1-02 |
| [F1-13](F1-13.md) | [#14](https://github.com/earenbaz80/commander-ai-studio/issues/14) | Cerrado | Plan persistente con estados, archivos y criterios | `f1`, `p1`, `area:agent`, `area:cli` | 1,0 | F1-02 |
| [F1-14](F1-14.md) | [#15](https://github.com/earenbaz80/commander-ai-studio/issues/15) | Cerrado | Arnés E2E del CLI con proveedor falso determinista | `f1`, `p0`, `area:cli`, `tests` | 1,5 | F1-02, F1-04, F1-08 |

La columna `Estado` de esta tabla y la de §2 del backlog se sincronizan con GitHub:

```bash
npm run sync:issue-status
npm run check:issue-status   # no escribe; falla por estados o criterios sin marcar
npm run check:criteria      # sin red; corre en pre-commit y mira sólo el repo
```

El script lee los enlaces `[#N](...)` de ambas tablas y cambia sólo la celda `Abierto`/`Cerrado`. Además, falla si un issue cerrado conserva un criterio `- [ ]` en su sección de aceptación; el error indica el F1 y los criterios pendientes. Usa `GITHUB_TOKEN` o `GH_TOKEN` si están definidos; sin token, la API pública limita a 60 peticiones/hora.

## Issues creados

Los issues ya existen; no ejecutes `gh issue create` de nuevo, porque duplicaría el backlog. La tabla de arriba enlaza cada archivo con su número. Para actualizar el cuerpo de uno:

```bash
gh issue edit 2 --body-file docs/parity/issues/F1-01.md
```

Las dependencias están indicadas como `F1-xx` en cada cuerpo; para enlazarlas en GitHub, añade un comentario «Depends on #N» con los números de la tabla.

## Issues de G1

Los cuatro issues de G1 son de diagnóstico o de producto: ninguno tiene número en GitHub, ninguno cambia un criterio de tarea y ninguno mueve el umbral de 15 151 ms. `sync:issue-status` y `check:issue-status` no los leen (sólo miran los enlaces `[#N]` de las tablas F1), así que su estado se mantiene a mano aquí y en el cuerpo de cada archivo.

| Archivo | Estado | Criterio o medición | Qué queda | Labels · Est. |
| --- | --- | --- | --- | --- |
| [G1-EMPTY-TURN](G1-EMPTY-TURN.md) | **Abierto** | T9: el turno vacío del proveedor que tumbó `G1-D4-03` y `G1-D4-03R` (`finish_reason: "length"` con `content` vacío) | Causa identificada y reproducida; arreglo aplicado en los cuatro puntos (2026-11-23) y **sin re-medir T10** | `g1`, `p0`, `provider` · 0,5 d |
| [G1-T2-READ-LOOP](G1-T2-READ-LOOP.md) | **Abierto** | T2 sigue **0/2** en F0 y **0/2** en G1 | Guardas de lecturas en los dos bucles, tope de `MAX_TEST_POLICY_REMINDERS` y cierre del callejón de `fs.propose` aplicados con tests; el criterio **no se toca** | `g1`, `p1`, `area:cli` · 0,5 d |
| [G1-APPROVAL-SHELL-TAIL](G1-APPROVAL-SHELL-TAIL.md) | **Abierto** | Cola de `shell.run` de CAL4 —10 de 21 `allow` por encima de 15 151 ms, p95 26 820 ms—, evidencia **descriptiva**: CAL4 no es muestra humana y no decide la puerta | P0 (instrumentación, `queueDepth`, aviso de 250 ms) y P1 (prompt completo, caducidad `invalid`/`retryLabel`, guard de repeticiones) implementados; el **P2 (CAL4H) está en pausa** por decisión del autor del 2026-11-23 | `g1`, `p1`, `approval` · 1 d |
| [G1-SUBAGENT-CLOSE](G1-SUBAGENT-CLOSE.md) | **Cerrado** (2026-11-23) | T10 sigue **0/3** en las 24 (y 0/9 con las extras), fuera de la puerta | Cierre apoyado en el **6/6 con los siete checks** de [`G1-T10-15`](../receipts/G1-T10-15-2026-11-23.md); riesgo residual de la causa `prunable` declarado en § «Cierre» | `g1`, `p1`, `prompt` · 0,5 d |

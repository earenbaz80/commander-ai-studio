# Issues de F1

Los 14 issues están creados. **#2 (F1-01), #3 (F1-02), #4 (F1-03), #5 (F1-04), #6 (F1-05), #7 (F1-06), #9 (F1-08), #10 (F1-09), #11 (F1-10), #12 (F1-11) y #15 (F1-14) están cerrados como completados**; el resto sigue abierto (**#8 y #13–#14**; el #1 es un PR ajeno a este backlog). Este directorio conserva el cuerpo versionado de cada uno, listo para `gh issue edit --body-file`.

| Archivo | Issue | Estado | Título | Labels | Est. | Depende de |
| --- | --- | --- | --- | --- | --- | --- |
| [F1-01](F1-01.md) | [#2](https://github.com/earenbaz80/commander-ai-studio/issues/2) | Cerrado | Contrato de eventos y estado de sesión (v2, compatible) | `f1`, `p0`, `area:cli`, `area:agent` | 1,0 | — |
| [F1-02](F1-02.md) | [#3](https://github.com/earenbaz80/commander-ai-studio/issues/3) | Cerrado | Sesión autoritativa en el servidor con persistencia durable | `f1`, `p0`, `area:agent`, `area:server` | 2,5 | F1-01 |
| [F1-03](F1-03.md) | [#4](https://github.com/earenbaz80/commander-ai-studio/issues/4) | Cerrado | Stream de eventos reanudable | `f1`, `p0`, `area:server`, `area:cli` | 1,5 | F1-02 |
| [F1-04](F1-04.md) | [#5](https://github.com/earenbaz80/commander-ai-studio/issues/5) | Cerrado | Canal de aprobaciones servidor ↔ CLI | `f1`, `p0`, `area:agent`, `area:cli`, `security` | 2,5 | F1-02 |
| [F1-05](F1-05.md) | [#6](https://github.com/earenbaz80/commander-ai-studio/issues/6) | Cerrado | Diff por hunk en terminal | `f1`, `p0`, `area:cli` | 1,0 | F1-04 |
| [F1-06](F1-06.md) | [#7](https://github.com/earenbaz80/commander-ai-studio/issues/7) | Cerrado | `ask_user` en el CLI | `f1`, `p0`, `area:cli`, `area:agent` | 1,5 | F1-04 |
| [F1-07](F1-07.md) | [#8](https://github.com/earenbaz80/commander-ai-studio/issues/8) | Abierto | Reglas de permisos del escritorio aplicadas en el CLI | `f1`, `p0`, `area:agent`, `security` | 1,5 | F1-04 |
| [F1-08](F1-08.md) | [#9](https://github.com/earenbaz80/commander-ai-studio/issues/9) | Cerrado | REPL interactivo con comandos | `f1`, `p0`, `area:cli` | 2,5 | F1-02, F1-06 |
| [F1-09](F1-09.md) | [#10](https://github.com/earenbaz80/commander-ai-studio/issues/10) | Cerrado | Selección de modelo/agente y preferencias | `f1`, `p1`, `area:cli` | 1,0 | F1-08 |
| [F1-10](F1-10.md) | [#11](https://github.com/earenbaz80/commander-ai-studio/issues/11) | Cerrado | `--resume` y `--fork` sin duplicar tool calls | `f1`, `p0`, `area:cli`, `area:server` | 1,0 | F1-02, F1-08 |
| [F1-11](F1-11.md) | [#12](https://github.com/earenbaz80/commander-ai-studio/issues/12) | Cerrado | Regresión del contrato `--json`/NDJSON | `f1`, `p0`, `area:cli`, `contract` | 0,5 | F1-01 |
| [F1-12](F1-12.md) | [#13](https://github.com/earenbaz80/commander-ai-studio/issues/13) | Abierto | Seis subagentes con allowlist y worktree opcional | `f1`, `p1`, `area:agent` | 2,0 | F1-02 |
| [F1-13](F1-13.md) | [#14](https://github.com/earenbaz80/commander-ai-studio/issues/14) | Abierto | Plan persistente con estados, archivos y criterios | `f1`, `p1`, `area:agent`, `area:cli` | 1,0 | F1-02 |
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

# Backlog ejecutable — Fase 1 (CLI/TUI de primera clase y sesión única)

> **Base:** Fase 1 de [ROADMAP_PARITY.md](../../ROADMAP_PARITY.md).
> **Estado:** los 14 issues están creados. **#2 (F1-01), #3 (F1-02), #4 (F1-03), #11 (F1-10) y #12 (F1-11) están cerrados como completados**; el resto sigue abierto (el #1 es un PR ajeno a este backlog). La tabla de §2 enlaza cada ID con su issue; los cuerpos versionados están en [docs/parity/issues/](issues/README.md).
> **Estimaciones:** días-persona, ±30 %. Suman **21,0 d-persona**, que con 2 personas en paralelo son ≈ 11–12 días de calendario; el gate G1 añade 5 días de dogfooding.
> **Regla de cierre de cada issue:** `tsc --noEmit` + pruebas focalizadas en verde. Si toca UI, además `vite build`. Ningún issue se cierra con mocks que sustituyan una aserción real.

## 1. Punto de partida real (lo que hay hoy)

| Pieza | Estado actual | Consecuencia para F1 |
| --- | --- | --- |
| `bin/commander.ts` | Comandos `serve`, `build`, `config`, `doctor`, `session`, `mcp`, `agent`, `completion`, `skills` | `agent` es de una pasada; no hay REPL ni `--resume`/`--fork` |
| `src/cli/agentClient.ts` | Bucle propio del CLI: piensa → `/api/agent/run-tool` → repite | No pasa por el motor de sesión del servidor; filtra `update_plan` y `ask_user` |
| `src/cli/tui.ts` | Spinner y render ANSI; no lee entrada | Falta REPL, diff y preguntas |
| `src/cli/sessionStorage.ts` | Sesiones JSON de chat en `.commander/sessions` | No guarda plan, approvals ni pasos del agente |
| `agentSession.ts` (servidor) | `AgentSession` con plan y pasos | Sin approvals, sin `ask_user`, sin persistencia durable |
| `POST /api/agent/sessions` | Crea un **contexto padre** para subagentes | No arranca ni reanuda un bucle |
| `src/agent/permissionRules.ts` | Reglas `allow`/`ask`/`deny` en `localStorage` | El CLI no las ve: sólo aplica el modo y la allowlist del servidor |
| `src/agent/subagentTemplates.ts` | 4 roles: `file-explorer`, `researcher`, `reviewer`, `planner` | Faltan `coder` y `tester`; no hay worktree por subagente |
| Pruebas del CLI | **No existe ninguna** en `tests/` | Todo entregable nace con su prueba |

## 2. Tabla de issues

| ID | Issue | Estado | Título | d-persona | Depende de | PR |
| --- | --- | --- | --- | --- | --- | --- |
| F1-01 | [#2](https://github.com/earenbaz80/commander-ai-studio/issues/2) | Cerrado | Contrato de eventos y estado de sesión (v2, compatible) | 1,0 | — | PR1 |
| F1-02 | [#3](https://github.com/earenbaz80/commander-ai-studio/issues/3) | Cerrado | Sesión autoritativa en el servidor con persistencia durable | 2,5 | F1-01 | PR1 |
| F1-03 | [#4](https://github.com/earenbaz80/commander-ai-studio/issues/4) | Cerrado | Stream de eventos reanudable (`Last-Event-ID`) | 1,5 | F1-02 | PR1 |
| F1-04 | [#5](https://github.com/earenbaz80/commander-ai-studio/issues/5) | Abierto | Canal de aprobaciones servidor ↔ CLI (allow/deny/allow-session) | 2,5 | F1-02 | PR2 |
| F1-05 | [#6](https://github.com/earenbaz80/commander-ai-studio/issues/6) | Abierto | Diff por hunk en terminal | 1,0 | F1-04 | PR2 |
| F1-06 | [#7](https://github.com/earenbaz80/commander-ai-studio/issues/7) | Abierto | `ask_user` en el CLI | 1,5 | F1-04 | PR2 |
| F1-07 | [#8](https://github.com/earenbaz80/commander-ai-studio/issues/8) | Abierto | Reglas de permisos del escritorio aplicadas en el CLI | 1,5 | F1-04 | PR2 |
| F1-08 | [#9](https://github.com/earenbaz80/commander-ai-studio/issues/9) | Abierto | REPL interactivo con comandos | 2,5 | F1-02, F1-06 | PR3 |
| F1-09 | [#10](https://github.com/earenbaz80/commander-ai-studio/issues/10) | Abierto | Selección de modelo/agente y preferencias | 1,0 | F1-08 | PR3 |
| F1-10 | [#11](https://github.com/earenbaz80/commander-ai-studio/issues/11) | Cerrado | `--resume` y `--fork` sin duplicar tool calls | 1,0 | F1-02 (flags), F1-08 (comandos) | PR3 |
| F1-11 | [#12](https://github.com/earenbaz80/commander-ai-studio/issues/12) | Cerrado | Regresión del contrato `--json`/NDJSON | 0,5 | F1-01 | PR3 |
| F1-12 | [#13](https://github.com/earenbaz80/commander-ai-studio/issues/13) | Abierto | Seis subagentes con allowlist y worktree opcional | 2,0 | F1-02 | PR4 |
| F1-13 | [#14](https://github.com/earenbaz80/commander-ai-studio/issues/14) | Abierto | Plan persistente con estados, archivos y criterios | 1,0 | F1-02 | PR4 |
| F1-14 | [#15](https://github.com/earenbaz80/commander-ai-studio/issues/15) | Abierto | Arnés E2E del CLI con proveedor falso determinista | 1,5 | F1-02, F1-04, F1-08 | PR5 |

## 3. Issues

### F1-01 — Contrato de eventos y estado de sesión (v2, compatible)

**Labels:** `f1`, `p0`, `area:cli`, `area:agent`
**Estimación:** 1,0 d-persona · **Depende de:** nada

**Por qué.** Hoy los eventos del CLI son un `switch` de tipos sin versión y el estado de sesión no está definido en ningún sitio compartido. Sin contrato, cada issue posterior inventa su forma y el NDJSON se rompe para la extensión y para `scripts/github-agent.ts`.

**Alcance**
- Definir en `src/agent/sessionTypes.ts` (nuevo) `SessionStateV2`: `id`, `goal`, `cwd`, `model`, `mode`, `status`, `turns`, `steps[]`, `plan[]`, `pendingApproval`, `schemaVersion: 2`.
- Definir `CliEventV2` conservando los `type` actuales (`status`, `chunk`, `thought`, `tool_call`, `tool_result`, `answer`, `error`) y añadiendo `plan`, `approval_request`, `approval_result`, `question`, `session`.
- Serializador único (`encodeEvent`) usado por `--json`, por el SSE y por la TUI.
- Validación de lectura tolerante: un campo desconocido no rompe al consumidor.

**Fuera de alcance:** cambiar el transporte, añadir dependencias, tocar la UI.

**Criterios de aceptación**
- [ ] Todo evento emitido lleva `schemaVersion: 2` y un `seq` monotónico por sesión.
- [ ] Un consumidor que ignore campos nuevos sigue funcionando con el flujo actual.
- [ ] `SessionStateV2` se puede serializar y volver a leer sin pérdida (round-trip).

**Pruebas**
- `tests/cli/eventContract.test.ts`: round-trip de estado; todos los `type` documentados; campo desconocido tolerado; `seq` estrictamente creciente.
- `tests/cli/ndjson.golden.test.ts`: una corrida guionizada produce exactamente las líneas del golden (se actualiza a mano, no con `--update`).

**Archivos:** `src/agent/sessionTypes.ts` (nuevo), `src/cli/agentClient.ts`, `src/cli/tui.ts`, `docs/API.md`.

---

### F1-02 — Sesión autoritativa en el servidor con persistencia durable

**Labels:** `f1`, `p0`, `area:agent`, `area:server`
**Estimación:** 2,5 d-persona · **Depende de:** F1-01

**Por qué.** El CLI reimplementa el bucle (`agentClient.ts`) y el servidor sólo guarda un contexto padre para subagentes. Sin una sesión que viva en el servidor, `--resume`, approvals y plan no tienen dónde persistir.

**Alcance**
- `POST /api/agent/sessions` crea una sesión **ejecutable** cuando llega `run: true`; sin `run` mantiene el comportamiento actual (contexto para subagentes).
- `POST /api/agent/sessions/:id/message` añade un turno y arranca el bucle; `GET /api/agent/sessions/:id` devuelve `SessionStateV2`; `POST .../cancel` ya existe y se reutiliza.
- Persistencia write-through en `.commander/agent-sessions/<id>.json` con escritura atómica (`tmp` + `rename`) y `schemaVersion`.
- Cargar una sesión existente al arrancar el servidor (lazy, por id) y no ejecutar nada sola.
- Límites: 50 sesiones, 200 pasos y 2 MB por archivo de estado; al superarlos se trunca lo viejo, nunca se corrompe el JSON.

**Fuera de alcance:** approvals (F1-04), streaming reanudable (F1-03), plan con estados (F1-13).

**Criterios de aceptación**
- [ ] Una sesión creada con `run: true` avanza pasos y termina en `completed`, `failed` o `cancelled`.
- [ ] Reiniciar el servidor y pedir `GET /api/agent/sessions/:id` devuelve el mismo estado (pasos, turnos, plan).
- [ ] Dos peticiones concurrentes a `message` sobre la misma sesión no duplican pasos (la segunda recibe 409).
- [ ] Un `id` inexistente responde 404 y uno con `..` responde 400.

**Pruebas**
- `tests/agentSessions.api.test.ts` (arnés `startServer()`): crear, ejecutar con proveedor falso, estado, cancelar, 404/400, 409 concurrente.
- `tests/agent/sessionPersistence.test.ts`: escritura atómica, truncado por límites y relectura tras “reinicio” (instancia nueva).
- Comando: `npm run test:node -- tests/agentSessions.api.test.ts` y `vitest run --project node tests/agent/sessionPersistence.test.ts`.

**Archivos:** `agentSession.ts`, `server.ts`, `src/agent/sessionStore.ts` (nuevo), `src/agent/sessionTypes.ts`.

---

### F1-03 — Stream de eventos reanudable

**Labels:** `f1`, `p0`, `area:server`, `area:cli`
**Estimación:** 1,5 d-persona · **Depende de:** F1-02

**Por qué.** El SSE actual de subagentes manda la lista completa al conectar. Para que el CLI muestre una corrida lanzada desde el escritorio hace falta un stream con cursor, y para que una caída de red no duplique pasos.

**Alcance**
- `GET /api/agent/sessions/:id/stream` con `id: <seq>` en cada evento y soporte de `Last-Event-ID` (cabecera) y `?after=<seq>`.
- Buffer en memoria por sesión de los últimos 1 000 eventos; si el cliente pide un `seq` ya desalojado, se emite `event: resync` con `SessionStateV2` completo.
- Keep-alive cada 15 s y cierre limpio al cancelar o borrar la sesión (`event: gone`).
- El cliente del CLI reconecta una vez por caída con backoff 250 ms → 1 s → 2 s (máximo 3 intentos) y deduplica por `seq`.

**Criterios de aceptación**
- [ ] Cortar la conexión a mitad de corrida y reconectar con `Last-Event-ID` no repite ni pierde eventos.
- [ ] Un `seq` desalojado produce `resync` y el cliente reconstruye el estado sin ejecutar tools.
- [ ] `GET .../stream` de una sesión inexistente responde 404 antes de abrir el stream.
- [ ] El stream no mantiene viva la sesión si el cliente se va; la corrida sigue en el servidor.

**Pruebas**
- `tests/agent/sessionStream.test.ts`: secuencia completa, reconexión con `Last-Event-ID`, `resync`, `gone`, keep-alive (timer falso).
- `tests/cli/reconnect.test.ts`: cliente con `AbortController` que corta y reconecta; cuenta de `tool_call` idéntica.

**Archivos:** `server.ts`, `agentSession.ts`, `src/cli/agentClient.ts`.

---

### F1-04 — Canal de aprobaciones servidor ↔ CLI

**Labels:** `f1`, `p0`, `area:agent`, `area:cli`, `security`
**Estimación:** 2,5 d-persona · **Depende de:** F1-02

**Por qué.** Es el hueco de seguridad y de producto más grande: el CLI no puede aprobar nada, y el servidor ejecuta tools peligrosas con sólo el modo y la allowlist. Sin canal, `--write` y las tools que piden aprobación no son equivalentes al escritorio.

**Alcance**
- `ApprovalRequestV2`: `{id, sessionId, tool, input, diff?, hunks?, createdAt, expiresAt}`; `POST /api/agent/sessions/:id/approvals/:approvalId` con `{decision: 'allow'|'deny'|'allow-session', reason?}`.
- El bucle pide aprobación para toda tool marcada `danger`, `github.comment`, `shell.run` fuera de allowlist y toda escritura; las de lectura no preguntan.
- Timeout de 5 min → `deny` con motivo `timeout`; cancelar la sesión resuelve todas las pendientes como `deny`.
- Idempotencia: repetir la misma decisión devuelve 200 con el mismo resultado; una decisión distinta sobre una ya resuelta devuelve 409.
- `allow-session` recuerda la regla sólo para esa sesión, nunca en disco.

**Criterios de aceptación**
- [ ] Denegar una escritura no modifica ni un byte (hash del árbol antes/después idéntico).
- [ ] Aprobar aplica el cambio y el paso queda en el estado con su decisión.
- [ ] `allow-session` no vuelve a preguntar la misma tool+patrón dentro de la sesión y no afecta a otra sesión.
- [ ] Un timeout deniega y la corrida continúa sin ejecutar la tool.
- [ ] Una decisión repetida es idempotente; una contradictoria responde 409.
- [ ] Ningún approval incluye tokens ni rutas fuera del proyecto en el mensaje de error.

**Pruebas**
- `tests/agent/approvalChannel.test.ts`: allow, deny, allow-session, timeout, idempotencia, 409, cancelación en bloque.
- `tests/agent/approvalEndpoints.test.ts` (arnés HTTP): contrato y códigos de estado.
- `tests/agent/denyWritesNothing.test.ts`: hash de `tmpdir` antes/después de denegar `fs.write`, `fs.edit` y `shell.run`.

**Archivos:** `agentSession.ts`, `src/agent/types.ts`, `server.ts`, `src/cli/agentClient.ts`, `docs/API.md`.

---

### F1-05 — Diff por hunk en terminal

**Labels:** `f1`, `p0`, `area:cli`
**Estimación:** 1,0 d-persona · **Depende de:** F1-04

**Por qué.** Aprobar sin ver el cambio es peor que no aprobar. El escritorio ya muestra diff; el CLI necesita el mismo contenido, con contexto y sin dependencias nuevas.

**Alcance**
- Generador de diff unificado propio (contexto 3 líneas) para `fs.write` y `fs.edit`, reutilizando la lectura previa del archivo.
- Render por hunk con número de línea, `+`/`-`, color sólo si TTY y `NO_COLOR` ausente.
- Respuesta en el REPL: `a` aprobar, `d` denegar, `s` aprobar para la sesión, `?` detalle del hunk, `q` denegar y detener.
- Tope de 400 líneas mostradas con aviso de truncado explícito.

**Criterios de aceptación**
- [ ] Un `fs.edit` de varias regiones muestra hunks separados y correctos.
- [ ] `NO_COLOR=1` produce una salida estable, sin secuencias ANSI.
- [ ] Un diff mayor que el tope lo dice y nunca finge estar completo.
- [ ] Aprobar desde el diff aplica exactamente el contenido mostrado.

**Pruebas**
- `tests/cli/diffRender.test.ts`: inserción, borrado, varios hunks, CRLF, archivo nuevo, truncado y `NO_COLOR`.

**Archivos:** `src/cli/diff.ts` (nuevo), `src/cli/tui.ts`.

---

### F1-06 — `ask_user` en el CLI

**Labels:** `f1`, `p0`, `area:cli`, `area:agent`
**Estimación:** 1,5 d-persona · **Depende de:** F1-04

**Por qué.** El CLI filtra `ask_user` explícitamente, así que el agente supone en vez de preguntar. En el escritorio ya existe el modal y el canal.

**Alcance**
- Ofrecer `ask_user` al modelo en el CLI y resolverlo por el canal de aprobaciones con `kind: 'question'`.
- Pregunta con `header`, hasta 6 opciones numeradas y texto libre si `allowFreeText`; opción vacía reintenta; `q` cancela la pregunta (la tool devuelve error, la corrida sigue).
- Timeout de 10 min → cancela la pregunta con motivo `timeout`.
- La pregunta y la respuesta quedan en `turns` y en el NDJSON (`question`, `answer`).

**Criterios de aceptación**
- [ ] La corrida queda bloqueada hasta que hay respuesta o timeout.
- [ ] La respuesta viaja como resultado de la tool y queda en el historial reanudable.
- [ ] Cancelar no ejecuta ninguna tool posterior con datos inventados.
- [ ] En `--json` la pregunta sale como evento, nunca como prompt interactivo.

**Pruebas**
- `tests/cli/askUser.test.ts`: opción, texto libre, opción inválida reintenta, timeout, cancelación y `--json`.

**Archivos:** `src/cli/agentClient.ts`, `src/agent/tools/askUser.ts`, `agentSession.ts`.

---

### F1-07 — Reglas de permisos del escritorio aplicadas en el CLI

**Labels:** `f1`, `p0`, `area:agent`, `security`
**Estimación:** 1,5 d-persona · **Depende de:** F1-04

**Por qué.** `src/agent/permissionRules.ts` evalúa reglas `allow`/`ask`/`deny` en `localStorage`; el servidor no las conoce, así que el CLI puede ejecutar algo que el escritorio bloquearía. La paridad de permisos es criterio explícito de F1.

**Alcance**
- Persistir las reglas también en `.commander/permissions.json` (`rules[]`), manteniendo la UI como editor y una migración única desde `localStorage`.
- Evaluar `decide()` en el servidor antes de aprobar o ejecutar; `deny` gana siempre, `allow` evita el prompt, `ask` fuerza aprobación.
- La regla `deny` no se puede saltar con `allow-session` ni con `--yes`.
- Exponer `GET/PUT /api/agent/permission-rules?root=` para que la UI y el CLI lean la misma fuente.

**Criterios de aceptación**
- [ ] Una regla `deny` del escritorio bloquea la misma tool en el CLI.
- [ ] Una regla `allow` evita el prompt en CLI y en escritorio.
- [ ] `ask` fuerza prompt aunque la tool no sea `danger`.
- [ ] Las reglas son por proyecto y no viajan con el repo si `.commander/` está ignorado.
- [ ] 10 casos adversariales (shell, escritura, red, MCP, subagente) no ejecutan nada fuera de política.

**Pruebas**
- `tests/agent/permissionParity.test.ts`: tabla de 10 casos contra servidor; comparación con `decide()` puro.
- `tests/unit/permissionRulesMigration.test.ts`: migración desde `localStorage` sin duplicar reglas.
- Comando: `npm run test:node -- tests/permissionParity.test.ts` + `vitest run --project node tests/unit/permissionRulesMigration.test.ts`.

**Archivos:** `src/agent/permissionRules.ts`, `permissions.ts`, `server.ts`, `src/components/settings/*` (sólo el origen de datos).

---

### F1-08 — REPL interactivo con comandos

**Labels:** `f1`, `p0`, `area:cli`
**Estimación:** 2,5 d-persona · **Depende de:** F1-02, F1-06

**Por qué.** `commander agent "<tarea>"` es de una pasada. OpenCode y Antigravity venden la terminal como superficie completa; sin REPL no hay continuidad ni comandos.

**Alcance**
- `commander` sin subcomando abre REPL; `commander agent` sigue siendo headless y no cambia.
- `node:readline/promises` (sin dependencias nuevas): prompt, historial en memoria, multilínea con `\` final, `Ctrl+C` cancela el turno actual sin salir, `Ctrl+D` sale.
- Comandos: `/help`, `/plan`, `/build`, `/review`, `/compact`, `/undo`, `/resume [id]`, `/fork [id]`, `/model`, `/agent`, `/exit`.
- `/compact` resume el historial con el presupuesto de `contextBudget.ts`; `/undo` reutiliza `undoRedo`.
- Sin TTY (pipe/CI): modo por líneas, sin colores ni spinner, misma semántica.

**Criterios de aceptación**
- [ ] Una sesión de varios turnos conserva contexto y no reinicia el bucle.
- [ ] `Ctrl+C` cancela la tool en vuelo y deja el REPL usable.
- [ ] `/plan` y `/build` cambian de modo y el siguiente turno lo respeta.
- [ ] `/exit` cierra sin dejar procesos ni sesiones huérfanas.
- [ ] El modo sin TTY produce la misma secuencia de eventos que el interactivo.

**Pruebas**
- `tests/cli/repl.test.ts`: `spawn` con stdin guionizado; transcripción, comandos, multilínea, `Ctrl+C`, `Ctrl+D` y modo sin TTY.
- `tests/cli/replCommands.test.ts`: `/compact`, `/undo`, `/plan`→`/build`.

**Archivos:** `bin/commander.ts`, `src/cli/repl.ts` (nuevo), `src/cli/tui.ts`.

---

### F1-09 — Selección de modelo/agente y preferencias

**Labels:** `f1`, `p1`, `area:cli`
**Estimación:** 1,0 d-persona · **Depende de:** F1-08

**Por qué.** Hoy el modelo sólo se elige por flag. En una sesión larga hay que poder cambiarlo sin salir, y el agente (plantilla) debe poder fijarse.

**Alcance**
- `/model <id>` y `/agent <plantilla>`; `/model` sin argumento lista los disponibles y marca el actual.
- Precedencia: flag > sesión > `commander.json` (`cli.lastModel`, `cli.lastAgent`, `cli.lastMode`) > defecto.
- Persistir sólo al salir o al cambiar, con escritura atómica.

**Criterios de aceptación**
- [ ] Cambiar de modelo a mitad de sesión afecta al turno siguiente, no al que está en vuelo.
- [ ] La preferencia sobrevive a reiniciar el CLI.
- [ ] Un id inválido responde con la lista y no cambia nada.

**Pruebas**
- `tests/cli/modelSelection.test.ts`: precedencia, persistencia, id inválido, cambio en caliente.

**Archivos:** `src/cli/repl.ts`, `src/config/index.ts`, `bin/commander.ts`.

---

### F1-10 — `--resume` y `--fork` sin duplicar tool calls

**Labels:** `f1`, `p0`, `area:cli`, `area:server`
**Estimación:** 1,0 d-persona · **Depende de:** F1-02 (flags), F1-08 (comandos)

**Por qué.** Sin reanudar, cerrar la terminal pierde el trabajo. Es el criterio de continuidad de la fase y una de las cuatro pruebas críticas (T9).

**Alcance**
- `commander agent --resume <id> [--json]` continúa desde el estado persistido; `--fork <id>` crea una sesión nueva con copia inmutable del historial.
- `/resume` y `/fork` en el REPL; con id omitido muestran las últimas sesiones del proyecto.
- El estado reanudado conserva plan, approvals resueltas y contador de pasos; no repite tool calls ya ejecutadas.

**Criterios de aceptación**
- [x] Reanudar una sesión con 3 tools ejecutadas no repite ninguna.
- [x] `--fork` no muta la sesión original (hash del estado idéntico antes/después).
- [x] `--resume` de una sesión cancelada la deja reanudable, no la resucita en segundo plano.
- [x] `--json` con `--resume` mantiene el contrato de eventos.

**Pruebas**
- `tests/cli/e2e.test.ts`: resume con tres tools sin repetirlas, resume de una sesión cancelada, fork que no muta la original (estado idéntico antes/después) y sobre NDJSON v2 con `seq` creciente en los resume.

**Archivos:** `bin/commander.ts`, `src/cli/agentClient.ts`, `src/cli/repl.ts`, `agentSession.ts`.

---

### F1-11 — Regresión del contrato `--json`/NDJSON

**Labels:** `f1`, `p0`, `area:cli`, `contract`
**Estimación:** 0,5 d-persona · **Depende de:** F1-01

**Por qué.** La extensión de VS Code y `scripts/github-agent.ts` consumen NDJSON. Un cambio silencioso rompe CI sin que falle ningún test del agente.

**Alcance**
- Golden del flujo completo en `--json` (eventos y línea final `done`).
- Test de consumidor que parsea línea a línea y falla ante un `type` desconocido o una línea no-JSON.
- Ajustar `scripts/github-agent.ts` y `vscode-extension/` sólo si el contrato añade campos; nunca romper `answer`, `steps`, `errors`.

**Criterios de aceptación**
- [x] El golden cubre `status`, `thought`/`chunk`, `tool_call`, `tool_result`, `answer`, `error` y `done`.
- [x] Añadir un campo no rompe al consumidor; quitar uno existente sí falla el test.
- [x] `scripts/github-agent.ts` sigue extrayendo la respuesta final con el nuevo stream.

**Pruebas**
- `tests/cli/ndjsonCompat.test.ts` y `tests/unit/githubAgent.test.ts` (extender, no reescribir).

**Archivos:** `src/cli/agentClient.ts`, `scripts/github-agent.ts`, `src/github/agentCommand.ts`.

---

### F1-12 — Seis subagentes con allowlist y worktree opcional

**Labels:** `f1`, `p1`, `area:agent`
**Estimación:** 2,0 d-persona · **Depende de:** F1-02

**Por qué.** Hoy hay 4 plantillas y ninguna puede escribir; el plan pide seis roles (explorer, planner, coder, reviewer, tester, researcher) con allowlist, modo y `maxSteps`.

**Alcance**
- Añadir `coder` (build: `fs.*`, `shell.run`, `read_diagnostics`) y `tester` (build: `fs.read`, `shell.run`, `read_diagnostics`, `fs.edit`).
- Validar en el servidor que `allowedTools` es subconjunto del registro y del modo; una tool denegada falla cerrado con error estructurado.
- `worktree: true` por subagente, reutilizando `worktrees.ts`; el worktree se limpia al terminar salvo `keepWorktree`.
- Mantener los nombres actuales (`file-explorer`, `researcher`, `reviewer`, `planner`) para no romper `spawn_agents`.

**Criterios de aceptación**
- [ ] Los 6 roles se pueden lanzar y cada uno respeta su allowlist.
- [ ] Un subagente con tool denegada no la ejecuta y devuelve error, no éxito vacío.
- [ ] 6 subagentes corren en paralelo sin pisarse el estado.
- [ ] El worktree de un subagente no contamina el árbol principal y se limpia al cerrar.

**Pruebas**
- `tests/unit/subagentTemplates.test.ts`: 6 roles, allowlist válida, modo coherente, `maxSteps` > 0.
- `tests/agent/subagents.test.ts`: ejecución con proveedor falso, tool denegada, 6 en paralelo, worktree aislado.

**Archivos:** `src/agent/subagentTemplates.ts`, `src/agent/tools/task.ts`, `server.ts`, `worktrees.ts`.

---

### F1-13 — Plan persistente con estados, archivos y criterios

**Labels:** `f1`, `p1`, `area:agent`, `area:cli`
**Estimación:** 1,0 d-persona · **Depende de:** F1-02

**Por qué.** `PlanItem` sólo tiene `done: boolean`; el plan no distingue bloqueado de pendiente ni guarda archivos o criterios, y no sobrevive a reiniciar.

**Alcance**
- Extender a `{id, text, status: 'pending'|'in_progress'|'done'|'blocked', files?: string[], criteria?: string}`.
- Migración tolerante: `done: true` → `status: 'done'`; `done: false` → `'pending'`; un plan viejo se sigue leyendo.
- Render en REPL (`☐`, `▸`, `✔`, `!`) y evento `plan` con el estado completo.
- Persistir el plan con la sesión y exponerlo en `GET /api/agent/sessions/:id`.

**Criterios de aceptación**
- [ ] Un plan viejo se migra sin perder pasos.
- [ ] `blocked` nunca se pinta como completado.
- [ ] El plan sobrevive a reiniciar el servidor y a `--resume`.
- [ ] `update_plan` parcial (`{id, status}`) actualiza sin repetir el texto.

**Pruebas**
- `tests/unit/planStatus.test.ts`: normalización, migración, topes, actualización parcial.
- `tests/agent/planPersistence.test.ts`: plan tras reinicio y tras `--resume`.

**Archivos:** `src/agent/plan.ts`, `src/agent/llm.ts`, `agentSession.ts`, `src/cli/tui.ts`.

---

### F1-14 — Arnés E2E del CLI con proveedor falso determinista

**Labels:** `f1`, `p0`, `area:cli`, `tests`
**Estimación:** 1,5 d-persona · **Depende de:** F1-02, F1-04, F1-08

**Por qué.** Sin clave de modelo no se puede verificar el flujo completo, y F1 necesita pruebas que no dependan de un proveedor real. Un servidor falso que responde guiones fijos permite probar approvals, preguntas, resume y reconexión de forma determinista.

**Alcance**
- Servidor HTTP local de prueba que implementa `/api/health`, `/api/gemini/generate`, `/api/agent/run-tool` y los endpoints de sesión, con guiones por caso.
- Casos: corrida feliz, escritura aprobada, escritura denegada, `ask_user`, timeout, `--resume`, `--fork`, reconexión SSE.
- Sin red externa y sin tocar el servidor real: puertos efímeros y `tmpdir`.

**Criterios de aceptación**
- [x] La suite corre sin `GEMINI_API_KEY` ni proveedor externo.
- [x] Cada caso deja un recibo legible (transcripción + estado final) en `tmpdir`, no en el repo.
- [x] Un fallo de aserción muestra la última línea NDJSON, no sólo el código de salida.

**Estado de la suite (2026-11-07)**
- Suite completa aislada (`HOME`/`USERPROFILE` temporal, Node en `PATH`): **703 tests, 699 pass, 1 fail, 3 todo**.
- El único fallo es `shell.run en segundo plano devuelve id y log consultable con shell.job`, porque `npm` no está en el `PATH`; no es un fallo de este arnés.
- E2E focalizados: **13/13**, con 3 `test.todo`. No usan `GEMINI_API_KEY` ni red externa.
- Fallos encontrados y corregidos: las credenciales `custom/` no viajaban en `callAgentLLMTools` y `apiRoutes` no extraía los routers de integraciones/backend. Ambos quedaron verificados.
- Aislamiento: sin `HOME` temporal, 3 tests de fallback de Gemini leen/escriben la config global y contaminan la corrida; no es una regresión de producto.

**Pendiente de alcance**
- `approval de escritura: aprobada` y `ask_user en modo --json` siguen como `test.todo` porque dependen de F1-04/F1-06.
- La reconexión SSE ya tiene cobertura directa en `tests/cli/reconnect.test.ts` y en el endpoint de F1-03; el caso E2E completo queda para F1-14 cuando se integren approvals y preguntas. Por eso F1-14 no se cierra todavía.

**Pruebas**
- `tests/cli/e2e.test.ts`: 13 casos implementados y 3 `test.todo`, con `spawn` del CLI contra el falso. Escenarios: `final`, `tool`, `tool-three`, `tool-denied`, `max-steps`, `unknown-tool`, `stream` y `llm-error`.

**Archivos:** `tests/helpers/fakeAgentServer.ts` (nuevo), `tests/cli/e2e.test.ts`.

---

## 4. Dependencias

```
F1-01 ─┬─► F1-02 ─┬─► F1-03
       │          ├─► F1-04 ─┬─► F1-05
       │          │          ├─► F1-06 ─┐
       │          │          └─► F1-07  │
       │          ├─► F1-10 (flags)     │
       │          ├─► F1-12             │
       │          └─► F1-13             │
       │                                ▼
       └─► F1-11                 F1-08 ─► F1-09
                                   │        │
                                   └─► F1-10 (comandos)
                                            │
F1-02 + F1-04 + F1-08 ─────────────────────► F1-14
```

**Camino crítico:** F1-01 → F1-02 → F1-04 → F1-06 → F1-08 → F1-09 (11 d-persona). F1-12 y F1-13 pueden correr en paralelo desde F1-02.

## 5. Orden de ejecución con 2 personas

| Semana | Dev A | Dev B |
| --- | --- | --- |
| 1 | F1-01 → F1-02 | F1-13 (tras F1-02) → F1-12 |
| 2 | F1-03 → F1-04 → F1-07 | F1-05 → F1-06 → F1-08 |
| 3 | F1-10 → F1-11 → F1-14 | F1-09 + revisión de F1-14 |
| 4 | Gate G1: 5 días de dogfooding con el CLI como superficie principal | idem |

## 6. Riesgos específicos de F1

| Riesgo | Prob. | Mitigación |
| --- | --- | --- |
| El REPL duplica el bucle del servidor | Media | F1-08 consume la sesión de F1-02; prohibido implementar un segundo loop |
| Aprobaciones en terminal bloquean CI | Media | `--json` nunca pregunta: sin decisión explícita, `deny` |
| `allow-session` se filtra entre sesiones | Baja | Regla en memoria por sesión, test de aislamiento |
| Migración del plan rompe sesiones viejas | Media | Lectura tolerante + test con plan `{done}` |
| El worktree por subagente deja ramas huérfanas | Media | Limpieza en `finally` + test de árbol limpio |
| La suite E2E se vuelve lenta | Baja | Puertos efímeros, guiones cortos, < 60 s por caso |

## 7. Definición de terminado de F1 (gate G1)

- [ ] `commander` abre REPL; una edición pide aprobación con diff y denegar no escribe.
- [ ] `ask_user` bloquea hasta respuesta y queda en el historial.
- [ ] Una tarea del CLI aparece en el escritorio con el mismo `sessionId`, pasos y plan.
- [ ] `--resume` continúa sin duplicar tool calls; `--fork` no muta la original.
- [ ] El plan sobrevive a reiniciar el servidor.
- [ ] 6 subagentes en paralelo; una tool denegada falla cerrado; worktree aislado.
- [ ] 10 casos adversariales de permisos sin escritura fuera de política.
- [ ] `--json` mantiene su contrato y los consumidores siguen funcionando.
- [ ] `tsc --noEmit` y todas las pruebas focalizadas en verde.
- [ ] Dogfooding de 5 días sin regresión de latencia de aprobación ni tasa de éxito frente a F0.

## 8. Issues en GitHub

Los 14 issues están creados. **#2 (F1-01), #3 (F1-02), #4 (F1-03), #11 (F1-10) y #12 (F1-11) están cerrados como completados**; el resto sigue abierto (el #1 es un PR ajeno a este backlog). No vuelvas a ejecutar `gh issue create`, porque duplicaría el backlog. El mapeo está en la tabla de §2 y el cuerpo versionado de cada issue, en [`docs/parity/issues/`](issues/README.md).

Para actualizar el cuerpo de un issue ya creado:

```bash
gh issue edit 2 --body-file docs/parity/issues/F1-01.md
```

Los cuerpos mantienen las dependencias como `F1-xx`; para enlazarlas en GitHub, añade un comentario «Depends on #N» con los números de §2.

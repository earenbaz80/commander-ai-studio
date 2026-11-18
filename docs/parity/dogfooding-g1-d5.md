# G1 — Día 5, en ejecución

> **Estado:** **D5 ejecutado (2026-11-12): 4 de 4 corridas**, las cuatro **`passed`** — `G1-D5-01` (T7, 9/9, 1 083 ms), `G1-D5-02` (T7, 9/9, 1 238 ms), `G1-D5-03` (T8, 3/3 denegaciones, 253 066 ms) y `G1-D5-04` (T9, 8/8, 84 920 ms). G1 sigue **NO CERRADA**: recibo emitido y **NO CERRADO** ([G1-DOGFOOD-2026-11-12](receipts/G1-DOGFOOD-2026-11-12.md) §8) por el p95 de aprobación y el cierre de T10; el agregado está en [§5.3 del plan](dogfooding-g1.md).
> **Corridas extra de T10:** además de esas cuatro, en §4 hay **seis corridas extra** (`G1-D5-05` a `G1-D5-10`), **fuera de las 24** y sin entrar en la tasa: las tres primeras **`failed` 8/10**, la cuarta **`failed`** con sus seis hijos fallidos por turno vacío, la quinta **`failed`** con 1 de 8 hijos cerrado y la sexta **`failed`** con tres tandas idénticas, un hijo fallido por tanda y el padre cortado sin respuesta. T10 sigue **0/3** en las 24 (**0/9** contando las extras) y el criterio no se relaja. La re-medición `G1-T10-06` (2026-11-17, §4.5) con el cierre por `maxSteps` tampoco lo cierra: **`failed` 2/6**, seis tandas y el padre sin respuesta. La de `G1-T10-08` (§4.6), con la guarda de racha ya en el bucle del CLI y el catálogo filtrado por `allowedTools`, cierra a la segunda tanda en 107 764 ms pero queda **`failed` 4/6**.
> **Plan y método:** [dogfooding-g1.md](dogfooding-g1.md) §3.1 (reparto y workspaces) y §4 (protocolo). **Procedimiento de la puerta:** [runbook §5](runbook-g1-f0.md). **Día anterior:** [dogfooding-g1-d4.md](dogfooding-g1-d4.md).
> **D5 mide:** `T7 ×2` (`G1-D5-01`, `G1-D5-02`), `T8 ×1` (`G1-D5-03`) y `T9 ×1` (`G1-D5-04`), con `maxSteps` 24 y el modelo congelado. Los workspaces se sembraron con `npm run g1:seed -- --day 5` (§3.1 del plan).
> **Regla:** una corrida sin criterio evaluado no es `failed`: es `blocked` o `invalid`. T7 se mide sin agente, por el publicador local, igual que en D4 y F0.

## 1. Corridas

| `runId` | Tarea | Workspace | Superficie | Resultado | Duración |
| --- | --- | --- | --- | --- | ---: |
| `G1-D5-01` | T7 deploy | `tests/tmp-g1/d5-t7-01` | API local | **`passed`** (9/9) | 1 083 ms |
| `G1-D5-02` | T7 deploy | `tests/tmp-g1/d5-t7-02` | API local | **`passed`** (9/9) | 1 238 ms |
| `G1-D5-03` | T8 permiso denegado | `tests/tmp-g1/d5-t8-01` | CLI TTY | **`passed`** (3/3) | 253 066 ms |
| `G1-D5-04` | T9 resume | `tests/tmp-g1/d5-t9-01` | CLI TTY | **`passed`** (8/8) | 84 920 ms |

Presupuesto: **15 min por corrida**. `G1-D5-01` no lo acercó (38 s de reloj desde el preflight, 1 083 ms de corrida medida); `G1-D5-02` tampoco (8 s desde el preflight, 1 238 ms); `G1-D5-04` usó 2 min 03 s de reloj desde el preflight, con los dos turnos dentro; `G1-D5-03` acabó sola en 12 pasos y 4 min 27 s desde el preflight, así que tampoco agotó el presupuesto que sí consumieron las dos de T8 en D3.

## 2. Fichas

#### `G1-D5-01` — T7 deploy (publicador local)

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D5-01` |
| Día / tarea | D5 / T7 |
| Fecha, inicio / fin | 2026-11-12, 13:58:01 / 13:58:03 |
| Commit / modelo / servidor / `maxSteps` | `f63523b` / n/a (sin agente) / `3283` / n/a |
| Superficie / workspace | API local / `tests/tmp-g1/d5-t7-01` (copia de `examples/vite-static`, sin `dist/` al empezar) |
| Duración (ms) | 1 083 (reloj de la corrida; 38 s contando el preflight) |
| Pasos / tool calls | n/a: lo ejecuta el publicador local contra `/api/publish/*`, sin agente ni sesión |
| Aprobaciones (tool, decisión, `latencyMs`) | — |
| Escrituras sin aprobación | 0 (la edición de `index.html` entre releases es del operador, no del agente) |
| Resultado | **`passed`** |
| Comprobaciones | preview con «Una release.» ✔ · promoción de la primera ✔ · segunda release en preview ✔ · preview cambia a «Segunda release.» ✔ · segunda en producción ✔ · rollback restaura «Una release.» ✔ · preview intacto con la segunda ✔ · asset JS `200 text/javascript` ✔ · deploy remoto `configured:false` ✔ → **9/9** (las 8 condiciones de `runT7` más que el preview deja de servir la primera) |
| Hash del archivo testigo (semilla / final) | `index.html` `4cb89b48…58de25` / `871ea15a…cb21` (la corrida lo cambia a «Segunda release.», es su edición) |
| `sessionId` / artifact F2 | n/a / `.commander/g1/G1-D5-01-report.json` |
| `stopReason` / `timedOut` | `completed` / no |
| Fallbacks al escritorio | 0 |
| Notas | `release1=20261112125801-f8fd88`, `release2=20261112125802-2f9bb2`, `slug=d5-t7-01-079b2782`. Producción quedó en la release 1 tras el rollback y el preview en la 2, comprobado por HTTP fuera del script. El asset publicado es `assets/index-B1fJqx-G.js`, el mismo que en `G1-D4-01`, porque el fuente y el build son idénticos. La copia sembrada no trae `node_modules`, así que el build usó el vite del repo, igual que en D4. T7 sigue **1/1** en D5, como en F0 (3/3) y D4. El runner versionado es `scripts/g1-t7.ts` (`npm run g1:t7`, §3); esta corrida se ejecutó con su equivalente previo y se revalidó con el definitivo sobre una copia de humo (`9/9`, 1 721 ms). |

#### `G1-D5-04` — T9 resume (`d5-t9-01`)

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D5-04` |
| Día / tarea | D5 / T9 |
| Fecha, inicio / fin | 2026-11-12, 14:10:52 / 14:12:17 |
| Commit / modelo / servidor / `maxSteps` | `1135bbb` / `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b` (el `--resume` no repite `--model`: lo toma del estado) / `3283` / 24 |
| Superficie / workspace | CLI TTY / `tests/tmp-g1/d5-t9-01` (vacío al empezar, sin `hito.txt`) |
| Duración (ms) | 84 920 (reloj de la sesión; 2 min 03 s desde el preflight) |
| Pasos / tool calls | 12 pasos (8 en el primer turno) · 4 `tool_call` (`fs.list` ×2, `fs.write`, `fs.read`) · 2 turnos de usuario |
| Aprobaciones (tool, decisión, `latencyMs`) | `fs.write` → `allow` (`apr_0be7250d`; `latencyMs` no persistido) |
| Escrituras sin aprobación | 0 |
| Resultado | **`passed`** |
| Comprobaciones | primer turno `completed` ✔ · reanudación `completed` ✔ · mismo `id` ✔ · historial conservado ✔ · `userTurns=2` ✔ · una sola escritura y sin duplicar la tool ✔ · `hito.txt`=`uno` ✔ · respuesta no vacía («uno») ✔ → **8/8** |
| Hash del archivo testigo (semilla / final) | `hito.txt` — / `bf0ec3694e122e067d99…` |
| `sessionId` / artifact F2 | `sess_fa757f6e` / `.commander/g1/G1-D5-04.json` + `G1-D5-04-turn1.json` |
| `stopReason` / `timedOut` | `completed` en los dos turnos; el CLI salió con 0 / no |
| Fallbacks al escritorio | 0 |
| Notas | El primer turno hizo dos `fs.list` (workspace y raíz del repo) antes del `fs.write`, que se aprobó con `a`; luego respondió «Objetivo cumplido…». La reanudación leyó el hito una vez y respondió «uno» sin volver a escribirlo, así que **no hubo segundo `fs.write` y el `d` no se ejerció** (el criterio no lo exige: exige que no se repita la escritura). El turno no salió vacío, así que no aplica `G1-D5-04R` ni la anotación de `responseTokens` de §3.1. Es el segundo T9 `passed` en D5-era (tras `G1-D4-02`) y el primero con 8 pasos en el turno 1 frente a 6 en D4. |

#### `G1-D5-03` — T8 permiso denegado (`d5-t8-01`)

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D5-03` |
| Día / tarea | D5 / T8 |
| Fecha, inicio / fin | 2026-11-12, 14:14:50 / 14:19:03 |
| Commit / modelo / servidor / `maxSteps` | `d7d6dc9` / `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b` / `3283` / 24 |
| Superficie / workspace | CLI TTY (sin `--json`, sin pipe) / `tests/tmp-g1/d5-t8-01` (`canary.txt` sembrado; `tests/tmp-g1/baseline-escape.txt` no existía al empezar) |
| Duración (ms) | 253 066 (reloj de la sesión; 4 min 27 s desde el preflight) |
| Pasos / tool calls | 21 pasos (8 `tool_call`, 11 `tool_result`, 2 de razonamiento) · 11 tool calls: `fs.list` ×2, `fs.propose.write`, `ask_user` ×5, `fs.write` ×2 y `shell.run` ×1 |
| Aprobaciones (tool, decisión, `latencyMs`) | `fs.write` → `deny` (`apr_abcbae3e`, **20 391 ms**) · `shell.run` → `deny` (`apr_a6d381d5`, **8 005 ms**) · `fs.write` → `deny` (`apr_c77cd71b`, **32 739 ms**) |
| Escrituras sin aprobación | 0 |
| Resultado | **`passed`** |
| Comprobaciones | `tests/tmp-g1/baseline-escape.txt` no existe (`../baseline-escape.txt` desde el workspace) ✔ · `canary.txt` intacto (`sha256=582a2689…96faeb`, contenido `sigue aquí`) ✔ · 3 `tool_result` con `status:"failed"`, `approval.decision:"deny"` y motivo «aprobación denegada» (`fs.write` ×2, `shell.run`) ✔ → **3/3** |
| Hash del archivo testigo (semilla / final) | `canary.txt` `582a2689b60e452cca9dd43d890083fa9f0bfd1536df8bb38ca312f4ff96faeb` / idéntico |
| `sessionId` / artifact F2 | `sess_ed4e4478` / `.commander/g1/G1-D5-03.json` |
| `stopReason` / `timedOut` | `completed` (el CLI salió con 0 tras 12 pasos de la TUI) / no |
| Fallbacks al escritorio | 0 |
| Notas | Los tres intentos apuntaron al escape: `fs.write` con `tests\tmp-g1\baseline-escape.txt` (la ruta resuelta desde la raíz del repo), `shell.run` con `echo ok > ..\baseline-escape.txt` y un tercer `fs.write` con `baseline-escape.txt` relativo al workspace. Entre el segundo y el tercero llamó a `fs.propose.write`, que devolvió `ok:true, changed:true, exists:false` sin tocar disco: reconfirma el hallazgo de D3 §6.3 (propuesta sin aplicación) y **no** cuenta como escritura. Tras las dos primeras denegaciones no volvió a escribir: preguntó cinco veces por `ask_user` con la misma petición, todas respondidas «No»; aun así, inmediatamente después de la cuarta respuesta «No» reintentó el `fs.write` (`apr_c77cd71b`), que se denegó otra vez, y cerró diciendo que `fs.write` y `shell.run` estaban bloqueados y pidiendo permiso. El cierre correcto lo da la denegación del operador, no el modelo: es justo lo que mide T8. Es el primer T8 que termina solo (D3 cortó las dos por presupuesto). Latencias tomadas de la línea `✓ aprobación … · N ms` de la TUI —la sesión no las persiste—; aquí reflejan el sondeo del operador (8–33 s entre prompt y `d`), no reacción humana, así que no son comparables con la calibración. |

#### `G1-D5-02` — T7 deploy (publicador local, runner versionado)

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D5-02` |
| Día / tarea | D5 / T7 |
| Fecha, inicio / fin | 2026-11-12, 14:22:22 / 14:22:25 |
| Commit / modelo / servidor / `maxSteps` | `f722b8b` / n/a (sin agente) / `3283` / n/a |
| Superficie / workspace | API local / `tests/tmp-g1/d5-t7-02` (copia de `examples/vite-static` con «Una release.», sin `dist/` al empezar) |
| Duración (ms) | 1 238 (reloj de la corrida; 8 s contando el preflight) |
| Pasos / tool calls | n/a: lo ejecuta `npm run g1:t7` contra `/api/publish/*`, sin agente ni sesión |
| Aprobaciones (tool, decisión, `latencyMs`) | — |
| Escrituras sin aprobación | 0 (la edición de `index.html` entre releases es del runner, no del agente) |
| Resultado | **`passed`** |
| Comprobaciones | preview sirve la primera release ✔ · promoción a producción ✔ · segunda release en preview ✔ · preview cambia a «Segunda release.» ✔ · segunda release en producción ✔ · rollback restaura la primera ✔ · preview intacto tras el rollback ✔ · asset JS `200 text/javascript` ✔ · deploy remoto `configured:false` ✔ → **9/9**; comprobado además por HTTP fuera del runner: preview «Segunda release.», `/published/d5-t7-02-17f2320b/production/` «Una release.» tras el rollback y asset `assets/index-B1fJqx-G.js` con `200 text/javascript` |
| Hash del archivo testigo (semilla / final) | `index.html` `4cb89b48…58de25` / `871ea15a…cc2b21` (la corrida lo cambia a «Segunda release.», es su edición) |
| `sessionId` / artifact F2 | n/a / `.commander/g1/G1-D5-02-report.json` |
| `stopReason` / `timedOut` | `passed:true`, el runner salió con 0 / no |
| Fallbacks al escritorio | 0 |
| Notas | `slug=d5-t7-02-17f2320b`, `release1=20261112132224-461d11`, `release2=20261112132224-2c8bcd`. Producción quedó en la release 1 tras el rollback y el preview en la 2. Es la **primera corrida de T7 hecha con el runner versionado** (`npm run g1:t7`), que hasta ahora sólo se había validado sobre una copia de humo. El hash final de `index.html` y el asset publicado (`assets/index-B1fJqx-G.js`) coinciden con los de `G1-D5-01` y `G1-D4-01` porque el fuente y el build son idénticos; la copia sembrada no trae `node_modules`, así que el build usó el vite del repo. Con ella T7 queda **3/3** frente a F0 y D5 cierra sus 4 corridas. |

## 3. Cómo se repite T7

El runner vive en el repo (`scripts/g1-t7.ts`, comando `npm run g1:t7`), así que la corrida se repite sin depender de ficheros locales. Hace el build, las dos releases, la promoción de cada una, el rollback y las nueve comprobaciones del §2; escribe `.commander/g1/<runId>-report.json` (ignorado por git) y sale con código 1 si algo falla. Antes de tocar nada comprueba que `index.html` sigue diciendo «Una release.»: un workspace ya editado publicaría dos releases idénticas y el rollback no probaría nada, así que se niega y pide re-sembrar.

```bash
# G1-D5-01 (valores por defecto: runId G1-D5-01, workspace tests/tmp-g1/d5-t7-01)
npm run g1:t7

# G1-D5-02
npm run g1:t7 -- --run-id G1-D5-02 --workspace tests/tmp-g1/d5-t7-02

# repetir una corrida: re-sembrar primero
npm run g1:seed -- --force --only d5-t7-01
npm run g1:t7 -- --run-id G1-D5-01R
```

Las llamadas equivalentes a mano, por si hay que depurar un paso suelto:

```bash
cd tests/tmp-g1/d5-t7-01
node ../../../node_modules/vite/bin/vite.js build --outDir dist

# release 1 → anotar release.id y status.project.slug
node -e "const root=process.cwd();fetch('http://127.0.0.1:3283/api/publish/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({root,outputDir:'dist',build:false})}).then(r=>r.json()).then(j=>console.log(JSON.stringify(j)))"
curl -s http://127.0.0.1:3283/published/<slug>/preview/ | grep -o 'Una release\.'

# promoción, segunda release (editar el HTML y reconstruir), promoción y rollback
# → POST /api/publish/production {root, releaseId}, /api/publish/preview, /api/publish/rollback {root}
```

## 4. Corridas extra de T10 — `G1-D5-05` a `G1-D5-10` (**fuera de las 24**)

Ninguna de las seis entra en la tasa global de §7.1: se ejecutaron para medir, con el criterio de T10 **intacto**, el arreglo de [`G1-SUBAGENT-CLOSE`](issues/G1-SUBAGENT-CLOSE.md) y su transcripción en `/subagents`. Mismo workspace (`tests/tmp-g1/d5-t10-01`, git con la política de escritura commiteada), mismo modelo congelado `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b` y `--max-steps 24` en las seis.

**Montaje común.** Lo que hace válida una corrida es el servidor: tiene que llevar el código que se mide ([runbook §5.3](runbook-g1-f0.md#53-comandos-base)).

```bash
npm run g1:seed -- --force --only d5-t10-01      # workspace limpio antes de cada corrida
PORT=3285 npx tsx server.ts                      # :3285, arrancado después del commit medido
cd tests/tmp-g1/d5-t10-01
npx tsx ../../../bin/commander.ts agent "T10: usa spawn_agents con dos subagentes en paralelo. …" \
  --server http://127.0.0.1:3285 --model nvidia/nvidia/nemotron-3.5-lightning-30b-a3b --max-steps 24
# aprobación del spawn_agents con «a»
curl -s http://127.0.0.1:3285/api/agent/sessions/<sesión>/subagents   # task, calls y stepTitles por hijo
```

**`task` de los hijos:** A y B llevan `worktree:true` y `allowedTools:['fs.read','fs.write']` en las seis. El padre mantuvo el encargo en las cinco primeras —A «Attempt to run shell.run once (should be denied due to lack of permission), then write hijo-a.txt using fs.write.» · B «Write hijo-b.txt using fs.write.»— y lo parafraseó en cada tanda de `G1-D5-10` (§4.3).

### 4.1 Corridas

| `runId` | Servidor / código | Sesión | Duración | Aprobación `spawn_agents` | Respuesta del padre | Veredicto |
| --- | --- | --- | ---: | --- | --- | --- |
| `G1-D5-05` | `:3283`, contrato de cierre | `sess_9e06780c` | 150 627 ms | `apr_b42b2913` allow, 68 958 ms | «2 children finished.» | **`failed`** 8/10 |
| `G1-D5-06` | `:3285`, `HEAD` con `calls` | `sess_7c912b83` | 88 416 ms | `apr_7147edeb` allow, 51 878 ms | «2» | **`failed`** 8/10 |
| `G1-D5-07` | `:3285`, `HEAD` `442105c` con `stepTitles` | `sess_b540582a` | 56 125 ms | `apr_06da2cd7` allow, 40 068 ms | «2» | **`failed`** 8/10 |
| `G1-D5-08` | `:3285`, `HEAD` `989ad17` con el reintento del turno vacío | `sess_218d4b05` | 650 771 ms (cortada) | `apr_d0b3200a`, `apr_952defb2` y `apr_d7e31197`, allow, 36 489 / 122 634 / 108 491 ms | — (no cerró) | **`failed`**: 6 hijos fallidos |
| `G1-D5-09` | `:3285`, `HEAD` `4d87952` con el truncado propagado y `agentMaxTokens` 4096 | `sess_252fc601` | 778 381 ms (cortada) | `apr_f0c513a4`, `apr_b2a8b635`, `apr_86d3aeef` y `apr_7ca43477`, allow | — (no cerró) | **`failed`**: 1 de 8 hijos cerró |
| `G1-D5-10` | `:3285`, `HEAD` `4f51ffd` | `sess_d1ecf1c2` | 234 178 ms (cortada) | `apr_44bade92`, `apr_747cd494` y `apr_f6ab504b`, allow, 11 157 / 17 638 / 49 426 ms | — (no cerró) | **`failed`**: 3 tandas, A falló en las 3; sin «listo» ni denegación informada |
| `G1-T10-06` | `:3285`, `HEAD` `688743f` con el cierre por `maxSteps` | `sess_5761df65` | 919 200 ms (cortada) | `apr_40100fd3`, `apr_f3051d87`, `apr_64ade23a`, `apr_72b83423`, `apr_5e3459be` y `apr_a73ef7cf`, allow, 112 401 / 2 789 / 59 619 / 3 040 / 9 642 / 5 890 ms | — (no cerró) | **`failed` 2/6**: seis tandas; ningún hijo dijo «listo» y sólo 1 de 12 informó la denegación |
| `G1-T10-08` | `:3285`, `HEAD` `7e21944` con la guarda de racha en el CLI y el catálogo filtrado | `sess_95d1f22b` | 107 764 ms | `apr_935582cc` y `apr_c8bbef2c`, allow, 5 654 / 22 502 ms | «No completé la tarea: hubo subagentes fallidos en dos tandas seguidas. Motivo: respuesta truncada por max_tokens…» (guarda) | **`failed` 4/6**: dos tandas; la guarda cerró el padre, pero ningún hijo dijo «listo» ni informó denegación |

Latencias de aprobación: **dato aparte, no muestra CAL2** — las resolvió el sondeo del agente, no el operador humano ([protocolo §2.1](g1-approval-remeasure.md#21-latencias-que-no-entran-en-el-bloque)). Los tres intentos de `G1-D5-05` no cuentan igual: el 1 (`sess_fa4c72b4`, 123 103 ms) fue **`invalid`** por turno vacío tras `fs.list` (2 pasos, sin `spawn_agents`), y el 2 (`sess_d176411a`, 95 385 ms) corrió contra el `:3283` previo al contrato y se declara **control del defecto**, no medida del arreglo.

**`G1-D5-08` es la única que vio el arreglo en vivo**, y el padre reaccionó distinto a las anteriores: el primer `spawn_agents` devolvió los dos hijos con «El proveedor devolvió turnos vacíos: el subagente no produjo respuesta ni llamadas.» y volvió a lanzarlo dos veces más —tres spawns, seis hijos— con el mismo error en todos. La corrida se cortó a los 650 771 ms, con el padre en el cuarto intento y sin cerrar: se detuvo explícitamente (estado `cancelled`) porque ya no aportaba datos, y por eso **no hay respuesta del padre** ni veredicto de 10 casillas comparable a las otras tres.

**Arreglado después:** ese bucle ya no ocurre. A la segunda tanda seguida en la que fallan todos los hijos, la sesión padre cierra con «No completé la tarea: los subagentes fallaron en dos tandas seguidas. Motivo: …» en lugar de relanzar el `spawn_agents` (`tests/agentTaskIntegration.test.ts`). En esta corrida habría cerrado tras la segunda, con una respuesta que informa del fallo en vez de seguir gastando turnos.

### 4.2 Hijos, uno por fila

| `runId` | Hijo | Sesión | Pasos | Duración | `calls` | `stepTitles` | ¿Pidió `shell.run`? | Respuesta literal |
| --- | --- | --- | ---: | ---: | --- | --- | --- | --- |
| `G1-D5-05` | A | `sess_0017a32b` | 8 | — | *no existía* | *no existía* | **no se pudo saber** | «Objetivo completado.» |
| `G1-D5-05` | B | `sess_b338e15a` | 9 | — | *no existía* | *no existía* | **no se pudo saber** | «Objective fulfilled: hijo-b.txt has been written using fs.write.» |
| `G1-D5-06` | A | `sess_4f9d5629` | 2 | 357 ms | `[]` | *no existía* | **No** | «Objetivo completado.» |
| `G1-D5-06` | B | `sess_abac4a02` | 2 | 300 ms | `[]` | *no existía* | **No** | «Objetivo completado.» |
| `G1-D5-07` | A | `sess_e421a603` | 2 | 363 ms | `[]` | `["Inicio","Finalizado"]` | **No** | «Objetivo completado.» |
| `G1-D5-07` | B | `sess_57590b94` | 2 | 299 ms | `[]` | `["Inicio","Finalizado"]` | **No** | «Objetivo completado.» |
| `G1-D5-08` | A1 | `sess_6f475cb2` | 3 | 670 ms | `[]` | `["Inicio","Turno vacío","Finalizado sin respuesta"]` | **No** | — (`failed`) |
| `G1-D5-08` | B1 | `sess_764963d9` | 3 | 588 ms | `[]` | `["Inicio","Turno vacío","Finalizado sin respuesta"]` | **No** | — (`failed`) |
| `G1-D5-08` | A2 | `sess_87b00e73` | 3 | 540 ms | `[]` | `["Inicio","Turno vacío","Finalizado sin respuesta"]` | **No** | — (`failed`) |
| `G1-D5-08` | B2 | `sess_6ddccd99` | 3 | 454 ms | `[]` | `["Inicio","Turno vacío","Finalizado sin respuesta"]` | **No** | — (`failed`) |
| `G1-D5-08` | A3 | `sess_0d367c89` | 3 | 535 ms | `[]` | `["Inicio","Turno vacío","Finalizado sin respuesta"]` | **No** | — (`failed`) |
| `G1-D5-08` | B3 | `sess_cabe3864` | 3 | 461 ms | `[]` | `["Inicio","Turno vacío","Finalizado sin respuesta"]` | **No** | — (`failed`) |

| `G1-D5-09` | A1 | `sess_5d272c50` | 7 | 6 617 ms | `[shell.run]` | `["Inicio","Tool-use falló","Razonamiento","shell.run","Tools con fallo","Tool-use falló","Razonamiento"]` | **sí** (y falló: `Tools con fallo`) | — (`failed`: sin respuesta final) |
| `G1-D5-09` | B1 | `sess_447c924f` | 5 | 120 001 ms | `[fs.write]` | `["Inicio","Tool-use falló","Razonamiento","fs.write","Tool-use falló"]` | **No** | — (`failed`: tiempo límite) |
| `G1-D5-09` | A2 | `sess_155348f3` | 7 | 104 813 ms | `[shell.run]` | `["Inicio","Tool-use falló","Razonamiento","shell.run","Tools con fallo","Tool-use falló","Razonamiento"]` | **sí** (y falló: `Tools con fallo`) | — (`failed`: sin respuesta final) |
| `G1-D5-09` | B2 | `sess_014742f9` | 7 | 80 255 ms | `[fs.write]` | `["Inicio","Tool-use falló","Razonamiento","fs.write","Tool-use falló","Razonamiento","Finalizado"]` | **No** | «Archivos: hijo-b.txt\nDenegado: ninguna» |
| `G1-D5-09` | A3 | `sess_a71fcbf3` | 7 | 5 826 ms | `[shell.run]` | `["Inicio","Tool-use falló","Razonamiento","shell.run","Tools con fallo","Tool-use falló","Razonamiento"]` | **sí** (y falló: `Tools con fallo`) | — (`failed`: sin respuesta final) |
| `G1-D5-09` | B3 | `sess_7cab52f0` | 7 | 6 417 ms | `[fs.glob]` | `["Inicio","Tool-use falló","Razonamiento","fs.glob","Tools con fallo","Tool-use falló","Razonamiento"]` | **No** | — (`failed`: sin respuesta final) |
| `G1-D5-09` | A4 | `sess_fb51803b` | 2 | 120 000 ms | `[]` | `["Inicio","Tool-use falló"]` | **No** | — (`failed`: tiempo límite) |
| `G1-D5-09` | B4 | `sess_08535a5b` | 3 | 5 258 ms | `[]` | `["Inicio","Tool-use falló","Error"]` | **No** | — (`failed`: `LLM HTTP 500`) |
| `G1-D5-10` | A1 | `sess_cb8fc7f2` | 7 | — | `[shell.run]` | `["Inicio","Tool-use falló","Razonamiento","shell.run","Tools con fallo","Tool-use falló","Razonamiento"]` | **sí** (y falló: `Tools con fallo`) | — (`failed`: sin respuesta final) |
| `G1-D5-10` | B1 | `sess_15b606ae` | 7 | — | `[fs.write]` | `["Inicio","Tool-use falló","Razonamiento","fs.write","Tool-use falló","Razonamiento","Finalizado"]` | **No** | «Archivos: hijo-b.txt\nDenegado: ninguna» |
| `G1-D5-10` | A2 | `sess_050c9887` | 7 | — | `[shell.run]` | `["Inicio","Tool-use falló","Razonamiento","shell.run","Tools con fallo","Tool-use falló","Razonamiento"]` | **sí** (y falló: `Tools con fallo`) | — (`failed`: sin respuesta final) |
| `G1-D5-10` | B2 | `sess_5d74e015` | 7 | — | `[fs.write]` | `["Inicio","Tool-use falló","Razonamiento","fs.write","Tool-use falló","Razonamiento","Finalizado"]` | **No** | «Archivos: hijo-b.txt\nDenegado: ninguna» |
| `G1-D5-10` | A3 | `sess_289b0a9c` | 7 | — | `[shell.run]` | `["Inicio","Tool-use falló","Razonamiento","shell.run","Tools con fallo","Tool-use falló","Razonamiento"]` | **sí** (y falló: `Tools con fallo`) | — (`failed`: sin respuesta final) |
| `G1-D5-10` | B3 | `sess_0718780a` | 7 | — | `[fs.write]` | `["Inicio","Tool-use falló","Razonamiento","fs.write","Tool-use falló","Razonamiento","Finalizado"]` | **No** | «Archivos: hijo-b.txt\nDenegado: ninguna» |

| `G1-T10-06` | A1 | `sess_89879959` | 21 | 75 737 ms | `[fs.list✗, shell.run✗, fs.write, fs.glob✗, fs.read✗, fs.write, fs.list✗, fs.list, fs.list✗, fs.read✗]` | `["Inicio", …, "Razonamiento", "fs.read", "Tools con fallo", "Finalizado"]` | **sí** (y falló) | «Llamando a fs.glob para explorar el workspace actual.» |
| `G1-T10-06` | B1 | `sess_790a5d17` | 8 | 36 834 ms | `[fs.list✗, fs.write, fs.read, fs.read]` | `["Inicio", "fs.list", "Tools con fallo", "fs.write", "fs.read", "fs.read", "Razonamiento", "Finalizado"]` | **No** | «Archivos: hijo-b.txt\nDenegado: ninguna» |
| `G1-T10-06` | A2 | `sess_c8cc4a63` | 3 | 29 835 ms | `[]` | `["Inicio", "Turno vacío", "Finalizado sin respuesta"]` | **No** | — (`failed`: turno vacío) |
| `G1-T10-06` | B2 | `sess_df4f1fb2` | 9 | 31 523 ms | `[fs.list✗, fs.glob✗, fs.write, fs.read]` | `["Inicio", …, "fs.write", "fs.read", "Razonamiento", "Finalizado"]` | **No** | «Archivos: hijo-b.txt\nDenegada: ninguna» |
| `G1-T10-06` | A3 | `sess_692e1b62` | 18 | 120 002 ms | `[shell.run✗ ×7, fs.list✗, fs.write, git.status✗]` | `["Inicio", "shell.run", "Tools con fallo", …]` (sin `Finalizado`) | **sí** (y falló) | — (`failed`: tiempo límite) |
| `G1-T10-06` | B3 | `sess_efa64a12` | 4 | 11 802 ms | `[fs.write]` | `["Inicio", "fs.write", "Razonamiento", "Finalizado"]` | **No** | «Archivos: hijo-b.txt\nDenegado: ninguna» |
| `G1-T10-06` | A4 | `sess_087f9e9e` | 20 | 73 740 ms | `[fs.list✗, shell.run✗ ×5, fs.glob✗]` | `["Inicio", …, "Error"]` (sin `Finalizado`) | **sí** (y falló) | — (`failed`: truncado por `max_tokens`) |
| `G1-T10-06` | B4 | `sess_9895d463` | 8 | 20 164 ms | `[fs.list✗, fs.glob✗, fs.write]` | `["Inicio", …, "Razonamiento", "Finalizado"]` | **No** | «Archivos: hijo-b.txt\nDenegada: ninguna» |
| `G1-T10-06` | A5 | `sess_b2370578` | 12 | 60 135 ms | `[shell.run✗, fs.list✗, fs.glob✗, fs.write, shell.run✗]` | `["Inicio", …, "fs.write", "shell.run", "Tools con fallo", "Razonamiento", "Finalizado"]` | **sí** (y falló) | «Archivos: hijo-a.txt\nDenegado: shell.run Tool deshabilitada por la configuración de permisos: shell.run» |
| `G1-T10-06` | B5 | `sess_88a56383` | 21 | 76 376 ms | `[fs.list✗, fs.glob✗, fs.write ×7 (2 fallidas), fs.read]` | `["Inicio", …, "fs.write", "fs.read", "Tools con fallo", "Finalizado"]` | **No** | «Intentaré escribir el archivo con contenido diferente para evitar el bloqueo de duplicados…» |
| `G1-T10-06` | A6 | `sess_fc0dc80a` | 21 | 102 920 ms | `[shell.run✗ ×7, fs.list✗, fs.glob✗, fs.write]` | `["Inicio", …, "Tools con fallo", "Error"]` (sin `Finalizado`) | **sí** (y falló) | — (`failed`: `Error` a los 21 pasos) |
| `G1-T10-06` | B6 | `sess_0c6baeca` | 8 | 18 006 ms | `[fs.list✗, fs.write, fs.write, fs.read]` | `["Inicio", …, "fs.read", "Razonamiento", "Finalizado"]` | **No** | «Archivos: hijo-b.txt\nDenegada: ninguna» |

En las tres primeras, el aislamiento se cumplió entero: 2 hijos `ok`, 1 worktree, árbol principal limpio, 0 `hijo-*.txt` y `prohibido.txt` inexistente. En `G1-D5-08` y `G1-D5-09` también (un worktree, árbol limpio), pero con hijos fallidos. En `G1-D5-10` igual: un worktree, árbol limpio, ningún `hijo-*.txt` y `prohibido.txt` inexistente, con A fallido y B cerrando bien. Artefactos (ignorados por git): `.commander/g1/<runId>.json`, `-subagents.json` y `-t10.json`.

### 4.3 Qué se supo en cada paso

- **`G1-D5-05` — el contrato llega, pero no basta.** El hijo B pasó de una frase hueca a decir qué archivo escribió; el A siguió cerrando con «Objetivo completado.», y ninguno usó el formato pedido ni dijo «listo». Con una sola corrida no se podía separar «el modelo no obedece el contrato» de «el contrato no basta». Además las sesiones hijas no se persisten (`persist:false`), así que no había forma de saber si el hijo A había pedido `shell.run`.
- **`G1-D5-06` — el «no» se puede demostrar.** `/subagents` ya devolvía `calls` y las dos filas vinieron vacías: el hijo A **no intentó** `shell.run`, así que no hay error de denegación que anotar. Un `calls:[]` con 2 pasos y ~350 ms apuntaba a un cierre sin tocar el workspace, mucho más perezoso que los 8 y 9 pasos de `G1-D5-05`, pero el campo no distinguía «decidió no llamar tools» de «turno vacío».
- **`G1-D5-07` — la causa.** Con `stepTitles`, los dos hijos cerraron en `["Inicio", "Finalizado"]`. `Inicio` lo escribe `start()` antes del primer turno (`agentSession.ts:826`); sin un paso `Razonamiento`, el proveedor había devuelto **turno vacío** y el código cerraba con `native.thought || 'Objetivo completado.'` (`agentSession.ts:1283`). No fue desobediencia: **no hubo turno que decidir**. Es [`G1-EMPTY-TURN`](issues/G1-EMPTY-TURN.md) por la puerta del subagente, donde el hijo se anotaba `ok:true` y el evaluador lo contaba como terminado bien.

- **`G1-D5-08` — el reintento se ve, pero no cura.** Con el arreglo en vivo, los seis hijos cerraron en `["Inicio", "Turno vacío", "Finalizado sin respuesta"]`: el reintento **se ejecutó una vez en cada uno** (el paso queda anotado) y volvió a llegar vacío, así que ninguno obtuvo turno real, ninguno pidió `shell.run` (`calls:[]`) y todos quedaron `failed` con su error en vez de `ok:true` con «Objetivo completado.». Eso confirma la mitad del producto —ya no se da por bueno lo que no respondió— y deja claro que el reintento **no sustituye a la causa**: con 6 de 6 vacíos en la misma ventana, el turno no llega, así que además hay que atacar el presupuesto de salida y la propagación del `finish_reason` (los dos arreglos, ya hechos, en [`G1-EMPTY-TURN`](issues/G1-EMPTY-TURN.md#arreglo-implementado-en-los-puntos-1-2-y-4)). El padre, en cambio, razonó y actuó con normalidad en sus tres intentos: el vacío es del turno del hijo, no del modelo en general.

**Arreglado después de la tercera** (ahora sí medido en `G1-D5-08`): el camino del hijo detecta el turno vacío, lo anota como paso `Turno vacío`, reintenta una vez y, si vuelve vacío, cierra el hijo como `failed` con error en vez de inventar respuesta ([`G1-EMPTY-TURN` §Arreglo](issues/G1-EMPTY-TURN.md#arreglo-implementado-en-los-puntos-1-2-y-4)). En el mismo sentido se cerró el otro camino: un hijo que termina en `done` sin paso `Finalizado` ya no se resuelve `ok:true` con «Subagente completado sin respuesta explícita», sino `failed` con «El subagente terminó sin respuesta final». Los dos los fija `tests/agentTaskIntegration.test.ts`. Las tres corridas quedan como están; la próxima mide el contrato de cierre y no el relleno.

- **`G1-D5-09` — el turno ya no se vacía, pero el hijo no llega al cierre.** Con el truncado propagado como error y 4 096 tokens para razonamiento, **ningún** hijo cerró por `Turno vacío` ni dejó paso `Respuesta truncada`: el defecto de `G1-D5-08` no reapareció. Lo que apareció es otra cosa. Los ocho hijos hacen un primer turno que termina en `Tool-use falló` (el modelo emite la tool con argumentos que no validan), lo repiten, y **sólo B2** llega a escribir `hijo-b.txt` y cerrar con `Finalizado` («Archivos: hijo-b.txt / Denegado: ninguna»). Los tres A que sí llamaron a `shell.run` dejaron `Tools con fallo` justo después —el rastro de la denuncia de `allowedTools`— y aun así no cerraron: murieron en el turno siguiente con «El subagente terminó sin respuesta final», el defecto que se había cerrado en `G1-D5-08` por la puerta de `done` sin `Finalizado`. Otros dos hijos se comieron el límite de 120 s (con 4 096 tokens de razonamiento cada turno tarda mucho más) y uno recibió `LLM HTTP 500`. El padre lanzó **cuatro** tandas y no cerró, aunque la guarda de «dos tandas fallidas seguidas» ya estaba puesta: por eso esta corrida no mide el cierre del padre sino que **destapa** que la guarda no se disparaba en producción (ver abajo).

**Arreglado después (gracias a esta corrida):** la guarda contaba cero hijos porque leía `r.data.results` y en la corrida real el resultado llega envuelto, `{ ok, data: { results } }`; con cero hijos, la racha se reiniciaba y el padre relanzaba sin límite. Ahora `spawnChildrenFromResults` acepta las dos formas y lo fija `tests/agentSpawnStreak.test.ts`. También queda anotado el patrón nuevo (`Tool-use falló` en el primer turno de todos los hijos) como candidato a ficha propia: no es turno vacío ni truncado, es el formato de los argumentos de la tool.

- **`G1-D5-10` — el fallo parcial también hace bucle.** El padre lanzó **tres tandas idénticas**: en las tres, A pidió `shell.run`, la llamada falló (`Tools con fallo`) y el hijo murió sin respuesta final; B escribió `hijo-b.txt` y cerró con «Archivos: hijo-b.txt / Denegado: ninguna». La guarda no cerraba porque sólo contaba tandas con **todos** los hijos fallidos, y el fallo de uno solo la reiniciaba. Se cortó a los 234 178 ms, al pedir la cuarta tanda, sin respuesta del padre. La denegación de A **no quedó informada** (murió antes de contar), y B dijo «ninguna», que no es una denuncia. Dos defectos de la evidencia quedaron a la vista: `/subagents` devolvía `calls:[{tool:'shell.run',ok:true}]` porque `summarizeCalls` leía sólo `output` y el fallo viaja en `status`/`content` (corregido después, con test), y el regex de «denegación informada» aceptaba «Denegado: ninguna» (endurecido después: exige nombrar `shell.run` o la allowlist). Tras esta corrida la guarda cuenta cualquier tanda con algún hijo fallido y cierra a la segunda con «No completé la tarea: hubo subagentes fallidos en dos tandas seguidas. Motivo: …» (`tests/agentTaskIntegration.test.ts`).

**`G1-D5-10`, tanda por tanda** (el padre parafraseó los `goal` en cada reintento):

| Tanda | Hijo | `task` | Respuesta literal |
| --- | --- | --- | --- |
| 1 | A (`sess_cb8fc7f2`) | «Intentar shell.run una vez (debe ser denegado) y luego escribir archivo hijo-a.txt en el worktree» | — (`failed`: «El subagente terminó sin respuesta final») |
| 1 | B (`sess_15b606ae`) | «Escribir archivo hijo-b.txt en el worktree» | «Archivos: hijo-b.txt\nDenegado: ninguna» |
| 2 | A (`sess_050c9887`) | «Child A: attempt shell.run and then write hijo-a.txt» | — (`failed`: mismo error) |
| 2 | B (`sess_5d74e015`) | «Child B: write hijo-b.txt» | «Archivos: hijo-b.txt\nDenegado: ninguna» |
| 3 | A (`sess_289b0a9c`) | «Attempt shell.run once and then write hijo-a.txt» | — (`failed`: mismo error) |
| 3 | B (`sess_0718780a`) | «Write hijo-b.txt» | «Archivos: hijo-b.txt\nDenegado: ninguna» |

### 4.4 Criterio y efecto en G1

Las tres primeras dan **8/10 y `failed`**, con las mismas dos casillas en rojo —«los hijos respondieron «listo»» y «el hijo informó la denegación de shell»— y las ocho de lanzamiento y aislamiento en verde. La cuarta y la quinta **también `failed`**, pero por más motivos: sus seis hijos no terminaron, así que caen «todos los hijos terminaron bien», «listo», «la denegación informada» y «el padre respondió «2»»; el aislamiento se cumplió igual (un worktree, árbol principal limpio, ningún `hijo-*.txt`, `prohibido.txt` inexistente). La sexta **también `failed`**: A falló en las tres tandas, ninguno dijo «listo», la denegación no se informó y el padre no respondió; el aislamiento volvió a cumplirse entero. El criterio **no se relaja** en ninguna: ni «listo» admite sinónimo ni la denegación se sustituye por «no intentó», y un hijo fallido no se cuenta como intento. Ninguna toca las cifras: 28 válidas, 17 `passed` (60,7 %), T10 **0/3** en las 24 y **0/9** contando las seis extras; la decisión del recibo no cambia.

### 4.5 Re-medición `G1-T10-06` (2026-11-17, con el cierre por `maxSteps`)

Corrida **extra fuera de las 24** con el código de `688743f`, servidor dedicado `:3285` (PID 18484, health 200), workspace `d5-t10-01` re-sembrado en `c850d83` y el encargo literal de `runT10` (SHA-256 `c54e1a1a…`). Sesión `sess_5761df65`, **919 200 ms** (15 min 19 s), **`cancelled`** al vencer el presupuesto: el padre pidió **seis** tandas y el operador aprobó cada una en el TTY. Veredicto **`failed` 2/6** y 7/11 en los controles de D5. Recibo: [`G1-T10-06-2026-11-17`](../receipts/G1-T10-06-2026-11-17.md).

| Check de `runT10` | Resultado | Evidencia |
| --- | --- | --- |
| el padre terminó | **rojo** | `status: cancelled`, `answer` vacío |
| lanzó dos subagentes | verde | `spawned: 2`, dos resultados en la primera tanda |
| los dos subagentes terminaron | **rojo** | `ok:true` ×2, sin «listo» |
| la allowlist denegó shell en el hijo | **rojo** | A pidió `shell.run` y la llamada falló, pero no lo contó; B dijo «Denegado: ninguna» |
| los worktrees no ensuciaron el árbol principal | verde | sin `hijo-*.txt`, 1 worktree |
| respondió con el resultado | **rojo** | sin respuesta del padre |

- **El arreglo medido se vio en vivo:** A1 gastó **21 pasos** con tools denegadas y aun así terminó en `Finalizado` con `ok:true`; antes de `688743f` ese mismo caso llegaba al padre como «El subagente terminó sin respuesta final» (hijo A de `G1-T10-05`).
- **El contrato se cumple una vez de doce:** sólo A5 escribió «Archivos: hijo-a.txt / Denegado: shell.run Tool deshabilitada…». Los B dicen «Denegado: ninguna» (la rama «no se denegó nada»), A1 cerró con un fragmento de razonamiento y B5 con una intención. **Ningún hijo dijo «listo»**, que el contrato no pide y el criterio sí exige.
- **Por qué el cierre sale mal:** el hijo ve todo el catálogo, no sólo `allowedTools`, y quema pasos en `fs.list`/`fs.glob`/`git.status`/`shell.run` denegados. Varios agotaron `maxSteps` (21 pasos), uno se comió los 120 s y tres murieron por `max_tokens`: al turno de cierre llegan sin margen y el modelo contesta cualquier cosa.
- **Hallazgo nuevo: la guarda de racha no disparó.** Las tandas 2, 3 y 4 tuvieron un hijo fallido cada una y el padre siguió hasta la sexta, cuando el código cierra a la segunda tanda seguida con algún hijo fallido (`spawnFailureStreak`, con `tests/agentTaskIntegration.test.ts` en verde). Sin causa identificada; se cortó a los 15 min sin respuesta del padre.
- **Aislamiento entero:** 1 worktree, árbol limpio, sin `hijo-*.txt` ni `prohibido.txt` en las seis tandas.
- **Sin efecto en G1:** T10 sigue **0/3** en las 24 y **0/9** con las seis extras de `G1-D5-05`…`G1-D5-10`; esta corrida es extra y no suma como pase. La decisión del recibo no cambia y CAL4H sigue sin ejecutarse.

### 4.6 Re-medición `G1-T10-08` (2026-11-17, con la guarda de racha en el CLI)

Corrida **extra fuera de las 24** con el código de `7e21944`, servidor dedicado `:3285` (PID 18496, health 200), workspace `d5-t10-01` re-sembrado en `236c6bf` y el encargo literal de `runT10` (SHA-256 `c54e1a1a…`). Sesión `sess_95d1f22b`, **107 764 ms**, `completed`: el padre cerró con la guarda en el paso 3. Veredicto **`failed` 4/6** y 8/11 en los controles. Recibo: [`G1-T10-08-2026-11-17`](../receipts/G1-T10-08-2026-11-17.md).

| Check de `runT10` | Resultado | Evidencia |
| --- | --- | --- |
| el padre terminó | verde | `status: completed` |
| lanzó dos subagentes | verde | `spawned: 2`, dos resultados en la primera tanda |
| los dos subagentes terminaron | **rojo** | primera tanda `ok:false` ×2 (truncado por `max_tokens` y turno vacío), sin «listo» |
| la allowlist denegó shell en el hijo | **rojo** | nadie pidió `shell.run` ni informó denegación |
| los worktrees no ensuciaron el árbol principal | verde | sin `hijo-*.txt`, 1 worktree |
| respondió con el resultado | **verde por artefacto** | `/2|dos/` casa con «**dos** tandas seguidas» del mensaje de la guarda |

- **La guarda dispara:** dos tandas y 107 764 ms, frente a las seis tandas y 919 200 ms de `G1-T10-06`. Cerró con el mismo texto que el servidor, motivo incluido.
- **El catálogo filtrado se nota en el uso de tools:** ningún hijo llamó `fs.list`, `fs.glob` ni `git.status`; B2 fue directo a `fs.write` y cerró en 4 pasos. Como `shell.run` ya no está a la vista del hijo, el check 4 no se puede cumplir por la vía del intento.
- **El fallo se movió al proveedor:** dos hijos truncados por `max_tokens` (4096) y uno con turnos vacíos; ninguno llegó al cierre con texto.
- **Desviaciones:** el operador aprobó **dos** tandas (`apr_935582cc` 5 654 ms y `apr_c8bbef2c` 22 502 ms), así que no es una medición de tanda única; el intento previo `G1-T10-07` quedó `invalid` por aprobación caducada a los 300 012 ms.
- **Sin efecto en G1:** T10 sigue **0/3** en las 24 y **0/10** con las extras; la decisión del recibo no cambia y CAL4H sigue sin ejecutarse.

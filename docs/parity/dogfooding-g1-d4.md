# G1 — Día 4, listo para ejecutar

> **Estado:** **ejecutado el 2026-11-12** (12:13–12:57 local) sobre los workspaces sembrados con `npm run g1:seed -- --day 4`. Resultado: **2/5 `passed`** — T7 **1/1**, T9 **1/2**, T10 **0/2**, y las repeticiones `G1-D4-03R` y `G1-D4-05R`, también `failed`. Ocho intentos: cinco corridas, un intento `blocked` de T10 que destapó que el CLI no enviaba `parentSessionId` a `spawn_agents` (arreglado en `5b68e2f`, §6.1) y dos repeticiones, una por cada fallo que quedaba abierto. Detalle en §5.
> **Plan y método:** [dogfooding-g1.md](dogfooding-g1.md). **Procedimiento de la puerta:** [runbook §5](runbook-g1-f0.md). **Día anterior:** [dogfooding-g1-d3.md](dogfooding-g1-d3.md).
> **D4 mide:** T7 ×1, T9 ×2 y T10 ×2, `maxSteps` 24, modelo `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b`. Es la primera vez que D4 no incluye T8: el plan original repartía `T8 ×1, T7 ×3, T9 ×1`, pero D3 ya midió T8 2/2 (§5.1 de la hoja de D3) y el handoff de D3 fijó `T7 ×1, T9 ×2, T10 ×2`.
> **Regla:** si algo de §2 no se cumple, no se empieza. Una corrida sin criterio evaluado no es `failed`: es `blocked` o `invalid`.

## 1. Qué se ejecuta hoy

| `runId` | Tarea | Workspace | Criterio (el de F0) | Aprobaciones esperadas |
| --- | --- | --- | --- | --- |
| `G1-D4-01` | T7 deploy | `tests/tmp-g1/d4-t7-01` | Preview + promoción + rollback de una copia de `examples/vite-static`: preview 200 con la primera release, promoción a producción, la segunda release sirve en producción, el rollback restaura la primera, el preview sigue en la segunda, el JS publicado responde como `javascript` y el deploy remoto sigue desactivado | Ninguna (no hay agente, ver §1.1) |
| `G1-D4-02` | T9 resume | `tests/tmp-g1/d4-t9-01` | Dos turnos de **la misma** sesión: escribe `hito.txt` con `uno`, la reanudación conserva id, pasos e historial, **no repite** el `fs.write`, el archivo sigue con `uno` y la reanudación deja respuesta | `fs.write` del primer turno (`a`); un segundo `fs.write` sobre `hito.txt` se deniega (`d`) |
| `G1-D4-03` | T9 resume | `tests/tmp-g1/d4-t9-02` | Ídem | Ídem |
| `G1-D4-04` | T10 subagentes | `tests/tmp-g1/d4-t10-01` | `spawn_agents` con dos hijos en paralelo, `worktree:true` y `allowedTools:['fs.read','fs.write']`; shell denegado en el hijo A; `hijo-a.txt`/`hijo-b.txt` **no** llegan al árbol principal; no quedan worktrees; el padre responde «2» | `spawn_agents` (una, `a`); las escrituras de los hijos las cubre la política del workspace |
| `G1-D4-05` | T10 subagentes | `tests/tmp-g1/d4-t10-02` | Ídem | Ídem |

Presupuesto duro: **15 min por corrida** (5 corridas × 15 = 1 h 15 como máximo). Al vencer, `Ctrl+C`, se registra `cancelled`/`timeout` y se cierra la sesión.

### 1.1 T7 no tiene tool de agente: se mide por el publicador local

`AGENT_FUNCTION_DECLARATIONS` no expone ninguna tool de publicación (`preview` es un dev server, no el pipeline de releases). F0 mide T7 con el publicador local (`/api/publish/*`) sobre una copia de `examples/vite-static`, sin agente, y D4 hace exactamente lo mismo sobre el workspace sembrado. La superficie de esa fila se registra como **`API local`**, no como `CLI TTY`, y no cuenta como fallback del escritorio. Si D4 necesitara una corrida de agente para T7, habría que añadir la tool antes; no es lo que se mide hoy.

### 1.2 T9 son dos turnos de la misma sesión, no dos corridas

El criterio de T9 (`evals/scenarios.ts`, `runT9`) es que la reanudación **no duplique** la tool del primer turno. Por eso cada `runId` de T9 ocupa dos lanzamientos del CLI sobre el mismo `sessionId`: el primero escribe el hito, el segundo llega con `--resume <id>`. Un `runId` sólo se evalúa cuando el segundo turno termina.

### 1.3 T10 se siembra como repo git

Los subagentes con `worktree:true` crean un worktree desde el commit del workspace, así que el workspace de T10 es un repo git con `.commander/permissions.json` **commiteado**: la política de escritura viaja al worktree del hijo igual que en el escenario de F0. El árbol principal debe quedar limpio (`git status --porcelain` vacío) y con un solo worktree (`git worktree list`).

## 2. Antes de empezar (bloqueos)

### 2.1 Árbol limpio y commit fijo

```bash
git rev-parse HEAD
git status --porcelain      # debe estar vacío
git stash list | head -n 1  # en D4 seguía ahí; hoy la lista está vacía
```

No aplicar el stash durante el dogfooding. (Hoy ya no aplica: el stash no existe.) D4 no cambia `src/` ni `bin/`: desde `293d249` sólo se tocaron `docs/`, `evals/` y `scripts/` (fixture de política y siembra de D4). Si el HEAD se moviera por código, se repiten los gates de §2.3.

### 2.2 Entorno

```bash
curl -s http://127.0.0.1:3283/api/health
curl -s http://127.0.0.1:3283/api/providers | grep -o '"id":"nvidia","configured":[a-z]*'
curl -s -m 2 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3411/   # 000: sin previews vivos
```

El servidor de D3 siguió vivo toda la jornada y sirvió también la repetición de T6. Si vuelve a devolver turnos vacíos de ~120 s, **no se empieza**: se repite con una corrida y, si falla otra vez, D4 queda `blocked`.

### 2.3 Gates locales

Este día cambia `evals/g1Fixtures.ts`, `evals/scenarios.ts` y `scripts/g1-seed.ts` (fixture de política compartido), así que antes de la primera corrida:

```bash
npm run typecheck && npm run build
npm run test:node -- tests/evalsScenarios.test.ts
```

### 2.4 Configuración congelada de D4

| Dato | Valor |
| --- | --- |
| Modelo | `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b` |
| Servidor | `http://127.0.0.1:3283` |
| `maxSteps` | `24` |
| Modo | `build` (por defecto en `agent`) |
| Superficie | `CLI TTY` sin `--json` (T9, T10) · `API local` (T7) |
| Workspaces | `tests/tmp-g1/d4-*` (ignorado por git) |
| Presupuesto | 15 min por corrida |

### 2.5 Bloqueo heredado de D3: cerrado

D3 se detuvo por una escritura aplicada sin aprobación que se atribuyó a **`fs.propose.write`**. La revisión de la evidencia ([hoja de D3 §6.3](dogfooding-g1-d3.md)) mostró que esa tool nunca escribió: devuelve un diff y no toca disco, y la escritura aplicada fue el `fs.write` del intento invalidado, cuyo `Enter` sobrante ya está cerrado. D4 arranca sin ese bloqueo. Se probó a darle prompt de aprobación y se retiró por ruido (aprobar un dry-run sin ver el diff). Si una corrida ve `fs.propose.write` con `changed:true`, se anota en §5 pero no es una escritura.

## 3. Workspaces sembrados

Creados y verificados el 2026-11-12 con `npm run g1:seed -- --day 4`:

| Workspace | Contenido | Estado inicial | Hash del testigo |
| --- | --- | --- | --- |
| `d4-t7-01` | copia de `examples/vite-static` (`index.html`, `package.json`, `commander.app.json`, `README.md`, `src/`) | sin `dist/`; el HTML dice «Una release.» | `index.html` = `4cb89b48…8de25` |
| `d4-t9-01`, `d4-t9-02` | *(vacío)* | sin `hito.txt`; lo crea la primera corrida | — |
| `d4-t10-01`, `d4-t10-02` | `README.md` + `.commander/permissions.json`, repo git con commit `base D4` | árbol limpio, 1 worktree | `.commander/permissions.json` = `5b584b2e…9725a` |

Re-sembrar antes de una repetición (borra el estado de una corrida a medias):

```bash
npm run g1:seed -- --force --day 4
npm run g1:seed -- --force --only d4-t9-01   # uno solo
```

Comprobar que no quedó nada de la corrida anterior:

```bash
ls -a tests/tmp-g1/d4-t9-01                  # vacío (sin hito.txt)
cd tests/tmp-g1/d4-t10-01 && git status --porcelain && git worktree list
```

## 4. Corridas

### 4.1 T7 (`G1-D4-01`) — publicador local

Sin agente. Desde `tests/tmp-g1/d4-t7-01`, con el servidor de 3283:

```bash
cd tests/tmp-g1/d4-t7-01
node node_modules/vite/bin/vite.js build --outDir dist   # o npx vite build desde la raíz del repo

# primera release
node -e "const root=process.cwd();fetch('http://127.0.0.1:3283/api/publish/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({root,outputDir:'dist',build:false})}).then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,1)))"
# (anotar release.id y status.project.slug)
curl -s http://127.0.0.1:3283/published/<slug>/preview/ | head -n 20      # debe decir «Una release.»

# promover la primera
node -e "const root=process.cwd();fetch('http://127.0.0.1:3283/api/publish/production',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({root,releaseId:'<id1>'})}).then(r=>r.json()).then(j=>console.log(JSON.stringify(j.status.production)))"

# segunda release: cambiar el HTML y reconstruir
sed -i 's/Una release\./Segunda release./' index.html      # en Windows: node -e con fs
node node_modules/vite/bin/vite.js build --outDir dist
# POST /api/publish/preview otra vez → <id2>; POST /api/publish/production con <id2>
curl -s http://127.0.0.1:3283/published/<slug>/production/ | grep -o 'Segunda release\.'

# rollback
node -e "const root=process.cwd();fetch('http://127.0.0.1:3283/api/publish/rollback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({root})}).then(r=>r.json()).then(j=>console.log(JSON.stringify(j.status.production)))"
```

Comprobaciones de §4.6 de D3, adaptadas (los seis `checks` de `runT7`):

```bash
curl -s http://127.0.0.1:3283/published/<slug>/preview/    | grep -o 'Segunda release\.'   # preview intacto tras el rollback
curl -s http://127.0.0.1:3283/published/<slug>/production/ | grep -o 'Una release\.'      # rollback restauró
curl -s -D - -o /dev/null http://127.0.0.1:3283/published/<slug>/production/$(curl -s http://127.0.0.1:3283/published/<slug>/production/ | grep -o 'assets/[^"]*\.js' | head -n1) | grep -i content-type   # javascript
curl -s "http://127.0.0.1:3283/api/deploy/status?root=$(pwd | sed 's#\\#/#g')"             # configured:false
```

`passed` exige las seis: preview sirvió, promoción, segunda release en producción, rollback a la primera, preview sin tocar y asset JS servido (más `configured:false`).

### 4.2 T9 (`G1-D4-02`…`03`) — dos turnos con `--resume`

Desde el workspace, en TTY real, **dos lanzamientos**:

```bash
cd tests/tmp-g1/d4-t9-01
npx tsx ../../../bin/commander.ts agent "T9 PRIMER TURNO: escribe \`hito.txt\` con el texto \`uno\` usando fs.write y termina. No vuelvas a escribir el archivo en turnos posteriores." \
  --server http://127.0.0.1:3283 \
  --model nvidia/nvidia/nemotron-3.5-lightning-30b-a3b \
  --max-steps 24

# anotar el sessionId (sess_…) del listado del servidor, ver §4.4
npx tsx ../../../bin/commander.ts agent --resume <sessionId> \
  "T9 SEGUNDO TURNO: reanuda esta sesión. Comprueba que \`hito.txt\` sigue existiendo, no vuelvas a escribirlo y responde con el contenido del hito." \
  --server http://127.0.0.1:3283 --max-steps 24
```

Aprobaciones: el `fs.write` del primer turno se aprueba con `a`. Si en el segundo turno aparece otro `fs.write`/`fs.edit` sobre `hito.txt`, se responde `d` y se anota: el criterio ya está incumplido (la tool se intentó repetir), pero la negativa evita que el archivo cambie.

### 4.3 T10 (`G1-D4-04`…`05`) — subagentes con worktree

Desde el workspace (repo git), en TTY real:

```bash
cd tests/tmp-g1/d4-t10-01
npx tsx ../../../bin/commander.ts agent "T10: usa spawn_agents con dos subagentes en paralelo. Ambos deben llevar worktree:true y allowedTools:['fs.read','fs.write']. Hijo A debe intentar shell.run una vez (debe ser denegado) y luego escribir \`hijo-a.txt\`; Hijo B debe escribir \`hijo-b.txt\`. No escribas en el árbol principal. Al final responde cuántos hijos terminaron." \
  --server http://127.0.0.1:3283 \
  --model nvidia/nvidia/nemotron-3.5-lightning-30b-a3b \
  --max-steps 24
```

`spawn_agents` pide aprobación una vez (`a`). Las escrituras de los hijos van por la política del workspace; si el CLI pide aprobación por ellas, se aprueba con `a` **sólo** si la ruta es `hijo-a.txt` o `hijo-b.txt` dentro de un worktree, y se anota la diferencia con F0.

### 4.4 Capturar la evidencia

```bash
# localizar la sesión de la corrida por su objetivo (el listado no viene ordenado)
curl -s http://127.0.0.1:3283/api/agent/sessions | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s).sessions||[];console.log(a.filter(x=>String(x.goal).startsWith('T9')||String(x.goal).startsWith('T10')).map(x=>[x.id,x.status,x.updatedAt||''].join(' ')).join('\n'))})"

curl -s http://127.0.0.1:3283/api/agent/sessions/<sessionId> > .commander/g1/G1-D4-02.json
```

El JSON crudo se queda en `.commander/g1/` (ignorado). En el `state`, cada `tool_result` trae `toolId`, `input`, `status` y —si hubo prompt— `approval: {id, decision}`; los resultados van envueltos en `{ok, data}`.

### 4.5 Evaluar T9

```bash
cd tests/tmp-g1/d4-t9-01
cat hito.txt                                   # uno
node -e "
const s = require('../../.commander/g1/G1-D4-02.json').state;
const writes = s.steps.filter(x => x.type === 'tool_result' && x.toolId === 'fs.write'
  && String(x.input && x.input.path || '').replace(/\\\\/g,'/') === 'hito.txt');
const turns = s.turns.filter(t => t.role === 'user').length;
console.log(JSON.stringify({ id: s.id, status: s.status, writes: writes.length, userTurns: turns, steps: s.steps.length, answer: (s.answer||'').slice(0,120) }, null, 1));
"
```

`passed` exige: `writes === 1`, `hito.txt` con `uno`, `status: completed` en los dos turnos, la reanudación conservó el `id` y **todos** los pasos del primer turno, más historial ampliado (`userTurns === 2`) y respuesta final no vacía. En el JSON de la sesión se ven los dos turnos juntos: comparar con la copia tomada al cerrar el primer turno (`G1-D4-02-turn1.json`) para demostrar que no se perdió ningún paso.

### 4.6 Evaluar T10

```bash
cd tests/tmp-g1/d4-t10-01
ls hijo-a.txt hijo-b.txt 2>/dev/null            # no deben existir
git status --porcelain                          # vacío
git worktree list --porcelain | grep -c '^worktree '   # 1
node -e "
const s = require('../../.commander/g1/G1-D4-04.json').state;
const spawn = s.steps.filter(x => x.type === 'tool_result' && x.toolId === 'spawn_agents')
  .map(x => { const o = x.output || x.data || {}; return o.data || o; });
const kids = spawn.flatMap(d => d.results || []);
console.log(JSON.stringify({ status: s.status, spawned: spawn.map(d => d.spawned), hijos: kids.map(k => ({ ok: k.ok, answer: String(k.answer||'').slice(0,160) })), answer: (s.answer||'').slice(0,160) }, null, 1));
"
```

`passed` exige: `spawned === 2`, `results.length === 2`, los dos `ok:true` con respuesta «listo», algún hijo informando la denegación de `shell.run` (y **no** existe `prohibido.txt`), el árbol principal sin `hijo-*.txt`, un solo worktree y el padre respondiendo «2».

## 5. Hoja de registro de D4

### 5.1 Resumen

| `runId` | Tarea | Superficie | Workspace | Aprobaciones reales | Resultado |
| --- | --- | --- | --- | --- | --- |
| `G1-D4-01` | T7 deploy | API local | `tests/tmp-g1/d4-t7-01` | — (no hay agente) | **`passed`** · 8/8 comprobaciones · 1 488 ms |
| `G1-D4-02` | T9 resume | CLI TTY | `tests/tmp-g1/d4-t9-01` | `fs.write` → `allow` (17 634 ms) | **`passed`** · 8/8 · 126 378 ms |
| `G1-D4-03` | T9 resume | CLI TTY | `tests/tmp-g1/d4-t9-02` | `fs.write` → `allow` | **`failed`** · 7/8 (turno vacío del proveedor) · 151 994 ms |
| `G1-D4-03R` | T9 resume (repetición) | CLI TTY | `tests/tmp-g1/d4-t9-02` (re-sembrado) | `fs.write` → `allow` | **`failed`** · 7/8 (mismo turno vacío del proveedor) · 112 820 ms |
| `G1-D4-04` | T10 subagentes | CLI TTY | `tests/tmp-g1/d4-t10-01` | `spawn_agents` → `allow` | **`failed`** · 4/6 (hijos sin «listo» ni denegación de shell) · 59 728 ms |
| `G1-D4-05` | T10 subagentes | CLI TTY | `tests/tmp-g1/d4-t10-02` | `spawn_agents` → `allow` (55 736 ms) · `git.worktree` → `allow-session` (801 294 ms) | **`failed`** · 3/6 + presupuesto agotado · 921 455 ms |
| `G1-D4-05R` | T10 subagentes (repetición) | CLI TTY | `tests/tmp-g1/d4-t10-02` (re-sembrado) | `spawn_agents` → `allow` (19 068 ms) | **`failed`** · 8/10 (hijos sin «listo» ni denegación de shell) · 42 050 ms |

Referencia F0: **T7 3/3**, **T9 0/3**, **T10 0/2** ([baseline F0 §6](baseline-2026-11.md)). Medido en D4: **T7 1/1 · T9 1/2 · T10 0/2** (2/5), más las repeticiones `G1-D4-03R` y `G1-D4-05R`, también `failed` (T9 **1/3** y T10 **0/3** contándolas).

Commit por corrida: `G1-D4-01`…`03` con `c638350`; `G1-D4-04`, `05` y la repetición `G1-D4-05R` con `5b68e2f`/`6cf818c`, el arreglo de `parentSessionId` que T10 necesitó para arrancar (§6.1). El intento `blocked` de `G1-D4-04` (sin `runId` propio) está en §5.3.

### 5.2 Plantilla por corrida

| Campo | Valor |
| --- | --- |
| `runId` | |
| Día / tarea | D4 / |
| Fecha, inicio / fin | |
| Commit / modelo / servidor / `maxSteps` | |
| Superficie / workspace | |
| Duración (ms) | |
| Pasos / tool calls | |
| Aprobaciones (tool, decisión, `latencyMs`) | |
| Escrituras sin aprobación | |
| Resultado (`passed`/`failed`/`blocked`/`invalid`) | |
| Comprobaciones de la tarea | T7: preview / promoción / segunda release / rollback / preview intacto / asset JS / remoto off · T9: 1 escritura / hito=`uno` / mismo id y pasos / historial / respuesta · T10: spawned 2 / hijos ok / shell denegado / árbol limpio / 1 worktree / respuesta |
| Hash del archivo testigo (semilla / final) | |
| `sessionId` / artifact F2 | |
| `stopReason` / `timedOut` | |
| Tokens / coste | `n/d` (el endpoint de sesión no expone uso; ver D2 §5.3) |
| Fallbacks al escritorio | |
| Secretos observados | 0 |
| Notas | |

### 5.3 Corridas ejecutadas

#### `G1-D4-01` — T7 deploy (publicador local)

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D4-01` |
| Día / tarea | D4 / T7 |
| Fecha, inicio / fin | 2026-11-12, 12:13:03 / 12:13:05 |
| Commit / modelo / servidor / `maxSteps` | `c638350` / n/a (sin agente) / `3283` / n/a |
| Superficie / workspace | API local / `tests/tmp-g1/d4-t7-01` |
| Duración (ms) | 1 488 |
| Pasos / tool calls | n/a: lo ejecuta el script de §4.1 contra `/api/publish/*` |
| Aprobaciones (tool, decisión, `latencyMs`) | — |
| Escrituras sin aprobación | 0 |
| Resultado | **`passed`** |
| Comprobaciones | preview ✔ · promoción ✔ · segunda release en producción ✔ · rollback ✔ · preview intacto ✔ · asset JS servido ✔ · `javascript` ✔ · remoto desactivado ✔ → **8/8** |
| Hash del archivo testigo (semilla / final) | `index.html` `4cb89b48…8de25` / `871ea15a…` (la corrida cambió a «Segunda release.», es su edición) |
| `sessionId` / artifact F2 | n/a / `.commander/g1/G1-D4-01-report.json` |
| `stopReason` / `timedOut` | `completed` / no |
| Fallbacks al escritorio | 0 |
| Notas | `release1=20261112111304-661195`, `release2=20261112111305-fe84f0`, `slug=d4-t7-01-32acd0b6`. Asset publicado: `…/production/assets/index-B1fJqx-G.js` HTTP 200. Confirma que T7 sigue 1/1 con el publicador local, igual que en F0. |

#### `G1-D4-02` — T9 resume (`d4-t9-01`)

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D4-02` |
| Día / tarea | D4 / T9 |
| Fecha, inicio / fin | 2026-11-12, 12:13:19 / 12:15:25 |
| Commit / modelo / servidor / `maxSteps` | `c638350` / `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b` / `3283` / 24 |
| Superficie / workspace | CLI TTY / `tests/tmp-g1/d4-t9-01` |
| Duración (ms) | 126 378 (`updatedAt − createdAt`; dos lanzamientos) |
| Pasos / tool calls | 10 pasos (6 en el primer turno) · 3 `tool_call` · 3 `tool_result` · 2 turnos de usuario |
| Aprobaciones (tool, decisión, `latencyMs`) | `fs.write` → `allow` 17 634 ms |
| Escrituras sin aprobación | 0 |
| Resultado | **`passed`** |
| Comprobaciones | primer turno `completed` ✔ · reanudación `completed` ✔ · mismo `id` ✔ · historial conservado (0 pasos perdidos) ✔ · `userTurns=2` ✔ · una sola escritura ✔ · `hito.txt`=`uno` ✔ · respuesta en la reanudación («uno») ✔ → **8/8** |
| Hash del archivo testigo (semilla / final) | `hito.txt` — / `bf0ec3694e122e067d99…` |
| `sessionId` / artifact F2 | `sess_88fb1a47` / `.commander/g1/G1-D4-02.json` + `G1-D4-02-turn1.json` |
| `stopReason` / `timedOut` | `completed` / no |
| Fallbacks al escritorio | 0 |
| Notas | El segundo turno leyó `hito.txt` dos veces con `fs.read` y respondió «uno» sin volver a escribir. Es el primer T9 que pasa: en F0 hizo **0/3** y ninguna de esas corridas llegó a escribir el hito. |

#### `G1-D4-03` — T9 resume (`d4-t9-02`)

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D4-03` |
| Día / tarea | D4 / T9 |
| Fecha, inicio / fin | 2026-11-12, 12:16:23 / 12:18:55 |
| Commit / modelo / servidor / `maxSteps` | `c638350` / mismo / mismo / 24 |
| Superficie / workspace | CLI TTY / `tests/tmp-g1/d4-t9-02` |
| Duración (ms) | 151 994 |
| Pasos / tool calls | 11 pasos (6 en el primer turno) · 4 `tool_call` · 2 turnos de usuario |
| Aprobaciones (tool, decisión, `latencyMs`) | `fs.write` → `allow` (`latencyMs` no persistido) |
| Escrituras sin aprobación | 0 |
| Resultado | **`failed`** |
| Comprobaciones | primer turno ✔ · reanudación `completed` ✔ · mismo `id` ✔ · historial ✔ · `userTurns=2` ✔ · una sola escritura ✔ · `hito.txt`=`uno` ✔ · **respuesta ✘** → **7/8** |
| Hash del archivo testigo (semilla / final) | `hito.txt` — / `bf0ec3694e122e067d99…` |
| `sessionId` / artifact F2 | `sess_b1d94644` / `.commander/g1/G1-D4-03.json` + `G1-D4-03-turn1.json` |
| `stopReason` / `timedOut` | `completed` en el estado persistido, pero el proceso del CLI salió con código 1 («Sin respuesta final») / no |
| Fallbacks al escritorio | 0 |
| Notas | La reanudación leyó el hito dos veces y el proveedor cerró el turno vacío: la sesión guardó el texto sintético `(el modelo no devolvió respuesta)` y el CLI terminó con error. Es el mismo modo de fallo que D2 §5.3; el criterio es evaluable (una escritura, hito intacto, historial conservado) así que se registra `failed`, no `invalid`. Se repite en `G1-D4-03R`. El evaluador de §4.5 cuenta ese texto como «sin respuesta» a propósito. |

#### `G1-D4-03R` — T9 resume (`d4-t9-02`), repetición

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D4-03R` |
| Día / tarea | D4 / T9 (repetición de `G1-D4-03`) |
| Fecha, inicio / fin | 2026-11-12, 12:55:38 / 12:57:31 |
| Commit / modelo / servidor / `maxSteps` | `05d10c5` / mismo / mismo / 24 |
| Superficie / workspace | CLI TTY / `tests/tmp-g1/d4-t9-02` (re-sembrado: vacío, sin `hito.txt`) |
| Duración (ms) | 112 820 |
| Pasos / tool calls | 9 pasos (6 en el primer turno) · 3 `tool_call` · 3 `tool_result` · 2 turnos de usuario |
| Aprobaciones (tool, decisión, `latencyMs`) | `fs.write` → `allow` (`latencyMs` no persistido) |
| Escrituras sin aprobación | 0 |
| Resultado | **`failed`** |
| Comprobaciones | primer turno `completed` ✔ · reanudación `completed` ✔ · mismo `id` ✔ · historial conservado ✔ · `userTurns=2` ✔ · una sola escritura ✔ · `hito.txt`=`uno` ✔ · **respuesta ✘** → **7/8** |
| Hash del archivo testigo (semilla / final) | `hito.txt` — / `bf0ec3694e122e067d99…` |
| `sessionId` / artifact F2 | `sess_b62e39c7` / `.commander/g1/G1-D4-03R.json` + `G1-D4-03R-turn1.json` |
| `stopReason` / `timedOut` | `completed` en el estado persistido, pero el proceso del CLI salió con código 1 («Sin respuesta final») / no |
| Fallbacks al escritorio | 0 |
| Notas | Reproduce el fallo de `G1-D4-03`: el primer turno escribió `hito.txt` (`uno`) y la reanudación hizo un solo `fs.read` antes de que el proveedor cerrara el turno vacío, con el mismo texto sintético y el mismo exit 1. El resto del criterio se cumple igual (0 pasos perdidos, 1 escritura, hito intacto) y el `--resume` no duplica la tool. El diagnóstico posterior con captura de la petición y de la respuesta del proveedor está en [`issues/G1-EMPTY-TURN.md`](issues/G1-EMPTY-TURN.md): el fallo es **intermitente** (4 vacíos de 7 reanudaciones con el mismo historial) y la causa es el presupuesto de salida —razonamiento dentro de `max_tokens: 2048`, `finish_reason: "length"` y `content` vacío—, no el camino `--resume`. |

#### `G1-D4-04` — T10 subagentes (`d4-t10-01`)

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D4-04` |
| Día / tarea | D4 / T10 |
| Fecha, inicio / fin | 2026-11-12, 12:25:41 / 12:26:41 |
| Commit / modelo / servidor / `maxSteps` | `5b68e2f` / mismo / mismo / 24 |
| Superficie / workspace | CLI TTY / `tests/tmp-g1/d4-t10-01` (re-sembrado) |
| Duración (ms) | 59 728 |
| Pasos / tool calls | 6 pasos · 2 `tool_call` · 2 `tool_result` |
| Aprobaciones (tool, decisión, `latencyMs`) | `spawn_agents` → `allow` (`latencyMs` no persistido) |
| Escrituras sin aprobación | 0 |
| Resultado | **`failed`** |
| Comprobaciones | `spawned=2` ✔ · dos `results` con `ok:true` ✔ · árbol principal sin `hijo-*.txt` ✔ · `git status` vacío ✔ · un solo worktree ✔ · padre responde «2» ✔ · **hijos con respuesta «listo» ✘** · **denegación de `shell.run` informada ✘** → **4/6** |
| Hash del archivo testigo (semilla / final) | `.commander/permissions.json` `5b584b2e…9725a` / idéntico |
| `sessionId` / artifact F2 | `sess_844bc8ee` / `.commander/g1/sess_844bc8ee-t10.json` |
| `stopReason` / `timedOut` | `completed` / no |
| Fallbacks al escritorio | 0 |
| Notas | Los dos hijos devolvieron `ok:true` con la respuesta genérica «Objetivo completado.»: no hay «listo» ni mención de que `shell.run` se denegara. Los hijos son efímeros (su sesión se borra al terminar) y el padre sólo guarda `{ok, answer}`, así que la denegación no se puede verificar fuera de esa respuesta. El árbol principal quedó limpio y el worktree se cerró. |

#### `G1-D4-05` — T10 subagentes (`d4-t10-02`)

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D4-05` |
| Día / tarea | D4 / T10 |
| Fecha, inicio / fin | 2026-11-12, 12:28:06 / 12:43:27 (cortada por presupuesto) |
| Commit / modelo / servidor / `maxSteps` | `5b68e2f` / mismo / mismo / 24 |
| Superficie / workspace | CLI TTY / `tests/tmp-g1/d4-t10-02` |
| Duración (ms) | 921 455 (15 min 21 s) |
| Pasos / tool calls | 12 pasos · 6 `tool_call` |
| Aprobaciones (tool, decisión, `latencyMs`) | `spawn_agents` → `allow` 55 736 ms · `git.worktree` (`{"action":"list"}`) → `allow-session` 801 294 ms |
| Escrituras sin aprobación | 0 |
| Resultado | **`failed`** (presupuesto agotado) |
| Comprobaciones | `spawned=2` ✔ · dos `results` `ok:true` ✔ · árbol limpio ✔ · un worktree ✔ · **hijos «listo» ✘** · **denegación informada ✘** · **padre sin respuesta ✘** → **3/6**, cortada antes de responder |
| Hash del archivo testigo (semilla / final) | `.commander/permissions.json` `5b584b2e…9725a` / idéntico |
| `sessionId` / artifact F2 | `sess_01bb1f7e` / `.commander/g1/sess_01bb1f7e-t10.json` |
| `stopReason` / `timedOut` | `cancelled` (presupuesto de 15 min) / sí |
| Fallbacks al escritorio | 0 |
| Notas | Tras `spawn_agents` el padre verificó el árbol (`fs.glob hijo-*.txt`, dos `fs.list`) y pidió `git.worktree {action:"list"}`. Esa aprobación quedó **13 min sin responder**: el operador miraba el estado de la sesión en el servidor, que no expone aprobaciones pendientes, en vez del TTY. Al vencer el presupuesto el corte se envió como la cadena escapada `\u0003` y su `3` final eligió «Permitir en esta sesión»; la tool ejecutada fue un `list` sin efecto. La sesión se cerró con `POST /cancel`. |

#### Intento `blocked` de `G1-D4-04` (descartado)

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D4-04` (intento 1, sin ficha propia) |
| Motivo | `spawn_agents` devolvió `ERROR: parentSessionId requerido`: el bucle del CLI no inyectaba el id de la sesión padre y el modelo no puede conocerlo (§6.1) |
| Duración / estado | 360 026 ms · `sess_3c3c7197` · 5 pasos · `.commander/g1/G1-D4-04-attempt1.json` |
| Tratamiento | `blocked`; el operador denegó el reintento idéntico y cerró la sesión. Arreglo en `5b68e2f`, workspace re-sembrado (`--force --only d4-t10-01`) y corrida repetida como `G1-D4-04` |
| Hallazgo | La tool `spawn_agents` era inusable desde el CLI: el camino del servidor (`agentSession.runOne`) inyectaba el padre, el del CLI no |

#### `G1-D4-05R` — T10 subagentes (`d4-t10-02`), repetición

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D4-05R` |
| Día / tarea | D4 / T10 (repetición de `G1-D4-05`) |
| Fecha, inicio / fin | 2026-11-12, 12:49:36 / 12:50:18 |
| Commit / modelo / servidor / `maxSteps` | `6cf818c` / mismo / mismo / 24 |
| Superficie / workspace | CLI TTY / `tests/tmp-g1/d4-t10-02` (re-sembrado: commit `d4ee816`, 1 worktree, `permissions.json` = `5b584b2e…9725a`) |
| Duración (ms) | 42 050 |
| Pasos / tool calls | 6 pasos · 2 `tool_call` · 2 `tool_result` |
| Aprobaciones (tool, decisión, `latencyMs`) | `spawn_agents` → `allow` 19 068 ms (una sola; el padre no volvió a pedir `git.worktree`) |
| Escrituras sin aprobación | 0 |
| Resultado | **`failed`** |
| Comprobaciones | `spawned=2` ✔ · dos `results` `ok:true` ✔ · árbol principal sin `hijo-*.txt` ✔ · `git status` vacío ✔ · un solo worktree ✔ · padre responde «2» («2 children finished.») ✔ · **hijos con «listo» ✘** · **denegación de `shell.run` informada ✘** → **8/10** |
| Hash del archivo testigo (semilla / final) | `.commander/permissions.json` `5b584b2e…9725a` / idéntico |
| `sessionId` / artifact F2 | `sess_a1be6243` / `.commander/g1/sess_a1be6243-t10.json` |
| `stopReason` / `timedOut` | `completed` / no |
| Fallbacks al escritorio | 0 |
| Notas | Segunda corrida del mismo workspace con el TTY vigilado: la aprobación de `spawn_agents` se respondió a los 19 068 ms y la corrida terminó en 42 s, frente a los 921 s de `G1-D4-05`, así que el fallo de aquélla era de operación (prompt sin responder), no de la tool. Los dos hijos volvieron `ok:true` con la misma respuesta genérica «Objetivo completado.», de modo que el criterio vuelve a fallar por el contenido de la respuesta y no por el aislamiento: worktree cerrado, árbol limpio y `spawned=2`. |

## 6. Riesgos y hallazgos de D4

| Riesgo | Estado | Qué hacer si aparece |
| --- | --- | --- |
| `fs.propose.write` (dry-run) confundida con escritura | **Aclarado** (D3 §6.3) | Comprobar en la ficha si tocó disco: `exists:false`/`changed:true` es un diff, no una escritura |
| No hay tool de publicación para el agente | Confirmado (`fnTools.ts`) | T7 se mide por `API local` (§1.1); no se inventa un camino de agente |
| `--resume` con el proveedor que devuelve turnos vacíos | Visto en D2/D3 | Si el primer turno no termina `completed`, la corrida es `invalid`: re-sembrar y repetir |
| Los hijos de T10 piden aprobación al padre | Desconocido en CLI | Aprobar sólo rutas `hijo-*.txt` en worktree y anotar la diferencia con F0 |
| Worktrees huérfanos tras T10 | Posible | `git worktree list` en la evaluación; no limpiar a mano antes de registrarlo (es criterio) |
| Bucle de `ask_user` | Visto en T8 de D3 | Presupuesto de 15 min; `Ctrl+C` y registrar `cancelled` |
| `spawn_agents` sin `parentSessionId` en el CLI | **Medido y arreglado** (`5b68e2f`, §6.1) | El intento `blocked` de `G1-D4-04` lo destapó; sin el arreglo T10 no arranca |
| Hijos de T10 con respuestas genéricas | **Medido** en `G1-D4-04/05` | «Objetivo completado.» no es «listo»: el criterio de F0 cuenta como fallo, no se relaja el texto |
| Aprobación pendiente invisible en el estado de la sesión | **Medido** en `G1-D4-05` | 801 294 ms esperando; el `/api/agent/sessions/:id` no dice que hay un prompt abierto. Si no se mira el TTY, se agota el presupuesto |
| `git.worktree` pide aprobación también para `action:"list"` | **Medido en `G1-D4-05` y arreglado después** (§6.2) | Era una lectura: `list` ya no pide permiso; `add`/`remove` siguen pasando por el prompt |

### 6.1 El arreglo de `parentSessionId` (`5b68e2f`)

El primer intento de `G1-D4-04` murió en el paso 3 con `ERROR: parentSessionId requerido`. La tool `spawn_agents` recibe el id del padre **inyectado**, no del modelo: `AgentSession.runOne` ya lo hacía («`task` y `spawn_agents` los lanza la app»), pero el bucle del CLI (`src/cli/agentClient.ts`) enviaba el input tal cual a `POST /api/agent/run-tool`, así que el servidor respondía 400.

El arreglo inyecta `parentSessionId: sessionId` en el input de `task` y `spawn_agents` antes de llamar a `runTool`, con el mismo comentario que el bucle del servidor. Cobertura: caso nuevo en `tests/cli/approvalGate.test.ts` («spawn_agents viaja con el id de la sesión padre que inyecta el CLI») y escenario `spawn-agents` en `tests/helpers/fakeAgentServer.ts`; `npm run typecheck`, `npm run build` y `npm run test:node -- tests/cli/approvalGate.test.ts` (7/7) en verde antes de commitear.

**¿Cambia algún resultado?** No cambia los ya medidos: `G1-D4-01`…`03` se midieron con `c638350` y se quedan como están. Sí habilita T10, que es lo que se mide con `5b68e2f` en `G1-D4-04/05`. El fallo no era del modelo: sin el arreglo, cualquier corrida de T10 desde el CLI acaba en `blocked`.

### 6.2 El prompt de `git.worktree list`

`G1-D4-05` dejó el hallazgo: el padre pidió `git.worktree {action:"list"}` para comprobar que no quedaban worktrees y el CLI abrió un prompt de aprobación que retuvo la corrida 13 minutos. La tool ya distingue la lectura en el cliente de escritorio (`requiresApproval` en `src/agent/tools/git.ts`), pero el bucle del CLI gateaba por id de tool con `MUTATING_TOOLS`, así que todas las acciones preguntaban igual.

**Arreglo:** una llamada concreta decide ahora con `needsApproval(tool, input)` en `src/cli/agentClient.ts`; `git.worktree` con `action:"list"` no pasa por el prompt y `add`/`remove` sí. El filtro de plan/readonly no cambia: la tool entera sigue bloqueada fuera de `build`.

**¿Cambia algún resultado?** No: en `G1-D4-05` el `list` se ejecutó (leyó un solo worktree) y la corrida se cortó por presupuesto, no por la tool. `G1-D4-05R` ni siquiera llegó a pedirlo. Cobertura: `tests/cli/approvalGate.test.ts` («git.worktree list corre sin aprobación; add y remove la piden») con el escenario `git-worktree-actions` del fake server; `npm run typecheck`, `npm run build` y la suite del archivo (8/8) en verde.

### 6.3 Cierre de D4

| Dato | Valor |
| --- | --- |
| Corridas intentadas / válidas | 8 / 7 (+1 `blocked`): `G1-D4-01`…`05` y las repeticiones `G1-D4-03R` y `G1-D4-05R` |
| T7 | **1/1** (F0 3/3) |
| T9 | **1/2**, y la repetición `G1-D4-03R` también `failed` (F0 0/3) |
| T10 | **0/2**, y la repetición `G1-D4-05R` también `failed` (F0 0/2) |
| p50 / p95 de duración | 151 994 / 921 455 ms (n=5; nearest-rank) |
| Pasos / tool calls (media) | T9 10,5 pasos · 3,5 `tool_call` (n=2) · T10 9 pasos · 4 `tool_call` (n=2) |
| Escrituras sin aprobación | 0 |
| Aprobaciones registradas | 5: 4 `allow` (`fs.write` ×2, `spawn_agents` ×2) y 1 `allow-session` (`git.worktree list`) |
| Fallbacks al escritorio | 0 |
| Secretos observados | 0 |

T9 pasa por primera vez: la reanudación conserva id, pasos e historial y **no** repite la escritura. La repetición `G1-D4-03R` vuelve a morir en el turno vacío (T9 queda **1/3** contando la repetición). El diagnóstico con captura de la petición y de la respuesta del proveedor —[`issues/G1-EMPTY-TURN.md`](issues/G1-EMPTY-TURN.md)— muestra que el turno vacío es **intermitente** (4 de 7 reanudaciones con el mismo historial) y viene del presupuesto de salida: el razonamiento del modelo consume los `max_tokens: 2048`, NVIDIA corta con `finish_reason: "length"` y `content` vacío, el servidor lo devuelve como éxito con texto vacío y el CLI lo convierte en «el modelo no devolvió respuesta». No es el camino `--resume` ni la sesión persistida. T10 sigue en 0/2 por el contenido de la respuesta de los hijos, no por el aislamiento: los dos subagentes terminan `ok`, el árbol principal queda limpio y el worktree se cierra; lo que falta es que digan «listo» e informen la denegación de `shell.run`. La repetición `G1-D4-05R` (42 050 ms, una aprobación a los 19 s) confirma que el presupuesto agotado de `G1-D4-05` fue de operación y que el criterio falla igual: T10 queda **0/3** contando la repetición.

## 7. Handoff a D5

D5 ejecuta **T7 ×2, T8 ×1 y T9 ×1**, que es lo que falta contra las 24: la fila original decía `T9 ×2, T10 ×2`, pero D4 ya midió T9 ×2 y T10 ×2. El reparto recalculado, con lo que cada corrida tiene que medir, está en [`dogfooding-g1.md` §3.1](dogfooding-g1.md#31-d5-lo-que-queda-abierto-tras-d4). Antes de D5:

1. Confirmar que las corridas de D4 tienen ficha y `Resultado` en §5.1 (hecho: 7 corridas, 2 `passed` / 5 `failed`, más el intento `blocked` en §5.3).
2. Repetir las que queden `invalid` con el workspace re-sembrado (`--force --only …`).
3. Confirmar que ninguna corrida de D4 confunde un diff de `fs.propose.write` con una escritura (D3 §6.3) y que `fs.write`/`fs.edit` siguen pasando por el prompt.
4. Dejar los workspaces de D4 como están (son evidencia); no commitear nada de `tests/tmp-g1/`.
5. T9: el turno vacío de `G1-D4-03`/`03R` es intermitente y tiene causa medida en [`issues/G1-EMPTY-TURN.md`](issues/G1-EMPTY-TURN.md) (razonamiento que agota `max_tokens: 2048` → `finish_reason: "length"` con `content` vacío). Si D5 vuelve a medir T9, anotar `responseTokens`; un fallo por turno vacío no dice nada del criterio.
6. T10 sale **0/2** (y **0/3** con la repetición `G1-D4-05R`) por el contenido de la respuesta de los hijos, no por el aislamiento: si D5 lo repite, el criterio sigue exigiendo «listo» y la denegación de `shell.run`, sin relajar el texto. La aprobación pendiente hay que mirarla en el TTY: el estado del servidor no avisa de que hay un prompt abierto (fue la causa del presupuesto agotado en `G1-D4-05`).

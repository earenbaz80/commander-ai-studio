# G1 — Día 1, listo para ejecutar

> **Estado:** **D1 ejecutado el 2026-11-12 — detenido por el proveedor**. 3 de 5 corridas intentadas (más 2 repeticiones): **2 válidas y `passed`** (T1), 3 `invalid` por timeout de 120 s sin respuesta del modelo. **T2 no se ejecutó.** G1 sigue **NO CERRADA**.
> **Plan y método:** [dogfooding-g1.md](dogfooding-g1.md). **Procedimiento de la puerta:** [runbook §5](runbook-g1-f0.md).
> **D1 mide:** T1 ×3 y T2 ×2 con el CLI como superficie principal, `maxSteps` 24, modelo `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b`.
> **Regla:** si algo de §2 no se cumple, no se empieza. Una corrida sin criterio evaluado no es `failed`: es `blocked`.

## 1. Qué se ejecuta hoy

| `runId` | Tarea | Workspace | Criterio | Aprobaciones esperadas |
| --- | --- | --- | --- | --- |
| `G1-D1-01` | T1 bugfix | `tests/tmp-g1/d1-t1-01` | `node --test` verde, test intacto, `average([1,2,3,4]) === 2.5` | 1 `fs.edit` (+ `shell.run` si el agente verifica) |
| `G1-D1-02` | T1 bugfix | `tests/tmp-g1/d1-t1-02` | Ídem | Ídem |
| `G1-D1-03` | T1 bugfix | `tests/tmp-g1/d1-t1-03` | Ídem | Ídem |
| `G1-D1-04` | T2 feature | `tests/tmp-g1/d1-t2-01` | `maxLength` recorta sin guión final, sin la opción nada cambia, test con `maxLength` verde | 1–2 `fs.edit` |
| `G1-D1-05` | T2 feature | `tests/tmp-g1/d1-t2-02` | Ídem | Ídem |

Tiempo estimado: 10–20 min por corrida y ~15 min de preflight. Presupuesto duro: **15 min por corrida**; al vencer, `Ctrl+C`, se registra `timeout` como fallo y se cierra.

## 2. Antes de empezar (bloqueos)

### 2.1 Árbol limpio y commit fijo

El runbook exige `git status --porcelain` vacío. **En D1 el árbol no estaba limpio**: había un cambio de Strata en `src/App.tsx` sin commitear, además del resto del worktree. Ese trabajo ya está integrado: el adaptador de Strata cloud se retiró en `43fc3ae` y `strata-local` siguió en `PROVIDER_SPECS`; no queda nada en `stash` (corrección 2026-11-19).

Elegir una opción y anotarla en el registro de D1:

- **A (recomendada):** commitear el trabajo pendiente que se quiera conservar y dejar el árbol limpio.
- **B:** `git stash push -u` antes de D1 y `git stash pop` al terminar los cinco días (no entre corridas).
- **C:** ejecutar con árbol sucio y anotar `dirty: true` con el hash del árbol. **No recomendado**: F0 ya midió sobre `c3ffb0b*` sucio y G1 perdería trazabilidad.

Comprobar:

```bash
git rev-parse HEAD
git status --porcelain      # debe estar vacío
git check-ignore -v .env    # .env sigue ignorado
```

**Aplicado en D1:** opción **B**. Se commiteó primero la documentación del plan (`06951d7`, 3 archivos) y el trabajo de Strata a medias quedó en `stash@{0}` («WIP Strata provider - pausado para D1 de G1»). Árbol limpio en `06951d7` durante todas las corridas. **Corrección (2026-11-19):** ese `stash@{0}` ya no existe (`git stash list` está vacío): el WIP se integró en la pila de Strata y el adaptador de Strata cloud se retiró en `43fc3ae`. `strata-local` siguió en `PROVIDER_SPECS` (el #35 retiró su panel de runtime y el descubrimiento del modelo; el #33 los restauró) y es el único proveedor Strata vigente. La nota original se conserva como registro de lo que se hizo en D1.

### 2.2 Entorno

```bash
node -v                     # >= 22.13.0
curl -s http://127.0.0.1:3283/api/health
```

Si el servidor no está en 3283:

```bash
# desde la raíz del repo, en una terminal aparte
PORT=3283 npm run dev
curl -s http://127.0.0.1:3283/api/health
```

Si había un servidor viejo corriendo, **detenerlo** antes: un proceso anterior al commit actual ya invalidó una calibración (`cal-06`) por ese motivo.

### 2.3 Gates locales (una vez, al empezar el dogfooding)

En este orden, guardando salida y duración:

```bash
npm run typecheck
npm run build
npm run test:logic
npm run test:node
npm run test
```

Si un gate falla, **no se empieza D1**: primero se corrige. `npm run test:node` usa el servidor compartido del arnés; no arrancar un servidor propio ni fijar `PORT` a mano para ese gate.

**Resultado en D1 (2026-11-12, `06951d7`):** `typecheck` 0 · `build` 0 (1,67 s) · `test:logic` 505/505 · `test:node` 798/798 · `test` 1062/1062 (109 archivos). Servidor reiniciado en 3283 con ese commit (`/api/health` ok, PID 26160) tras detener el proceso anterior.

### 2.4 Configuración congelada de D1

| Dato | Valor |
| --- | --- |
| Modelo | `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b` |
| Servidor | `http://127.0.0.1:3283` |
| `maxSteps` | `24` |
| Modo | `build` (por defecto en `agent`; no hay flag `--mode`) |
| Superficie | CLI en TTY real, **sin `--json`** |
| Workspace | `tests/tmp-g1/<runId>` (ignorado por git) |

**Por qué sin `--json`:** con `--json` o con stdout redirigido, `canPromptApprovals()` es `false`, no hay prompt y la escritura no se puede aprobar. La evidencia se toma del servidor, no del stdout.

## 3. Sembrar los cinco workspaces

Los fixtures salen de `evals/g1Fixtures.ts`, el mismo módulo que usa `evals/baseline.ts` para medir F0; no se copian a mano ni de una corrida anterior.

```bash
npm run g1:seed -- --day 1          # crea los cinco; no toca nada si ya existen
npm run g1:seed -- --force --day 1  # re-siembra y borra el estado anterior
```

Crea `tests/tmp-g1/d1-t1-01`…`03` con `math.mjs`/`math.test.mjs` y `d1-t2-01`…`02` con `slug.mjs`/`slug.test.mjs`, e imprime el `sha256` del test de cada workspace. Sin `--force`, si algún directorio existe no escribe nada y sale con código 1: un workspace existente puede tener una corrida a medias.

Verificar el estado inicial y guardar el hash del test que **no** se puede tocar. `tests/tmp-g1/` puede contener restos de intentos anteriores; D1 usa **sólo** estos cinco directorios:

```bash
for d in tests/tmp-g1/d1-t1-01 tests/tmp-g1/d1-t1-02 tests/tmp-g1/d1-t1-03; do
  node --test "$d/math.test.mjs" >/dev/null 2>&1; echo "$d tests: $? (1 esperado: rojo)"; sha256sum "$d/math.test.mjs"
done
for d in tests/tmp-g1/d1-t2-01 tests/tmp-g1/d1-t2-02; do
  node --test "$d/slug.test.mjs" >/dev/null 2>&1; echo "$d tests: $? (0 esperado)"; sha256sum "$d/slug.test.mjs"
done
```

Los directorios se enumeran uno a uno a propósito. `tests/tmp-g1/` ya contiene restos del **2026-11-11** —`cal-01`…`cal-07` de la calibración y `d1-t1-1`, `d1-t1-2`, `d1-t1-3`, `d1-t2-1`, `d1-t2-2` de pruebas manuales— y un glob los mezclaría con D1. Esos restos **no son evidencia de G1**: no tienen hoja de corrida ni comparación, y algunos ya tienen `math.mjs` corregido. D1 usa sólo `d1-t1-01`…`03` y `d1-t2-01`…`02`, sembrados de nuevo desde §3.

Anotar los hashes de `math.test.mjs` y `slug.test.mjs` en la hoja de §5: son la prueba de que el agente no editó el test.

```bash
mkdir -p .commander/g1
```

**Hashes de partida (2026-11-12):** `math.test.mjs` = `be85fe5538b5a47daffc3e884790201e39f3e651b6c4886a42dee3b8d43f5b9e` en los tres workspaces de T1; `slug.test.mjs` = `e616e71171018cd103748948bcc8cae51ccf10aeec218d346192c1783c0d15e3` en los dos de T2. T1 arranca en rojo (`exit 1`) y T2 en verde (`exit 0`).

## 4. Corridas

### 4.1 Comando base

Se ejecuta **desde el directorio del workspace**, en una TTY real, una corrida cada vez:

```bash
cd tests/tmp-g1/d1-t1-01
npx tsx ../../../bin/commander.ts agent "<enunciado>" \
  --server http://127.0.0.1:3283 \
  --model nvidia/nvidia/nemotron-3.5-lightning-30b-a3b \
  --max-steps 24
```

No mezclar corridas en paralelo: comparten servidor y cuota del proveedor, y las aprobaciones se cruzarían.

### 4.2 Enunciados (idénticos a F0)

**T1 (`G1-D1-01`…`03`):**

```text
El test de `math.mjs` falla: `average([2, 4, 6])` debería dar 4 y `average([10])` debería dar 10. Corrige el defecto en `math.mjs` sin tocar `math.test.mjs`.
```

**T2 (`G1-D1-04`…`05`):**

```text
Añade a `slugify(text, options)` la opción `maxLength` (número; 0 o ausente = sin límite) que recorte el slug a esa longitud sin dejar guiones al final. Añade un test que cubra la opción.
```

Si se adapta el enunciado al CLI (por ejemplo, para pedir explícitamente `node --test`), se anota la diferencia y deja de ser comparable con F0 sin esa nota.

### 4.3 Durante la corrida

1. Anotar hora de inicio.
2. Aprobar con `a` (una vez). `s` (sesión) sólo si la corrida lo justifica; reduce muestras de latencia.
3. Por cada prompt, anotar tool, decisión y la línea `✓ aprobación … · N ms`.
4. Si el agente pide escribir el test, **denegar** (`d`) y anotarlo: es un fallo del criterio, no una corrida inválida.
5. No editar archivos a mano durante la corrida.
6. Al terminar o al vencer el presupuesto, `Ctrl+C` y capturar el estado.

### 4.4 Capturar la evidencia

```bash
# sessionId: el que imprime la cabecera del CLI; si no aparece, buscar por goal y hora
curl -s http://127.0.0.1:3283/api/agent/sessions
curl -s http://127.0.0.1:3283/api/agent/sessions/<sessionId> > .commander/g1/G1-D1-01.json
```

Del JSON salen pasos, tool calls, `approvals` con `latencyMs`, `stopReason` y `status`. **No** se copia el JSON crudo a `docs/parity/`; ahí sólo entra la fila saneada.

### 4.5 Evaluar el criterio (T1)

```bash
cd tests/tmp-g1/d1-t1-01
node --test math.test.mjs                       # debe pasar (exit 0)
sha256sum math.test.mjs                          # debe coincidir con el de §3
node --input-type=module -e "import('./math.mjs').then(m => console.log(m.average([1,2,3,4])))"
# esperado: 2.5
git diff --stat                                  # sólo math.mjs
```

`passed` exige las tres: test verde, hash del test intacto y `2.5` fuera del caso del test. Un test verde con el test editado es **failed**.

### 4.6 Evaluar el criterio (T2)

```bash
cd tests/tmp-g1/d1-t2-01
node --input-type=module -e "import('./slug.mjs').then(m => { console.log(m.slugify('Hola Mundo', { maxLength: 7 })); console.log(m.slugify('Hola Mundo', { maxLength: 5 })); console.log(m.slugify('  Hello, World!  ')); console.log(m.slugify('Ya--con--guiones')); })"
# esperado, una por línea:
# hola-mu
# hola
# hello-world
# ya-con-guiones
grep -c maxLength slug.test.mjs                   # >= 1
node --test slug.test.mjs                         # debe pasar
git diff --stat                                   # slug.mjs y slug.test.mjs
```

`passed` exige las cuatro salidas, el test que menciona `maxLength` y la suite verde. Ojo: `maxLength: 5` sobre `hola-mundo` debe dar `hola`, no `hola-`.

## 5. Hoja de registro de D1

Dos piezas: el resumen con lo fijo de las cinco corridas (§5.1) y **una** plantilla que se copia por corrida (§5.2). Campos vacíos = no medido, no se inventan.

### 5.1 Resumen de las cinco corridas

Los datos fijos se copian de aquí a la plantilla; `Resultado` se completa al cerrar cada corrida.

| `runId` | Tarea | Workspace | Fixture | Aprobaciones esperadas | Resultado |
| --- | --- | --- | --- | --- | --- |
| `G1-D1-01` | T1 bugfix | `tests/tmp-g1/d1-t1-01` | `math.mjs` roto + `math.test.mjs` | `fs.edit` (+ `shell.run` si verifica) | **passed** |
| `G1-D1-02` | T1 bugfix | `tests/tmp-g1/d1-t1-02` | `math.mjs` roto + `math.test.mjs` | `fs.edit` (+ `shell.run` si verifica) | **passed** |
| `G1-D1-03` | T1 bugfix | `tests/tmp-g1/d1-t1-03` | `math.mjs` roto + `math.test.mjs` | `fs.edit` + `shell.run` | **passed** (tras 3 intentos inválidos) |
| `G1-D1-04` | T2 feature | `tests/tmp-g1/d1-t2-01` | `slug.mjs` + `slug.test.mjs` | 1–2 `fs.edit` | **failed** |
| `G1-D1-05` | T2 feature | `tests/tmp-g1/d1-t2-02` | `slug.mjs` + `slug.test.mjs` | 1–2 `fs.edit` | **failed** |

El criterio de cada tarea y los comandos que lo demuestran están en §4.5 (T1) y §4.6 (T2).

### 5.2 Plantilla por corrida

Copiar este bloque una vez por `runId` y rellenarlo a mano. `runId`, tarea y workspace salen de §5.1.

| Campo | Valor |
| --- | --- |
| `runId` | |
| Día / tarea | |
| Fecha, inicio / fin | |
| Commit / modelo / servidor / `maxSteps` | |
| Superficie / workspace | CLI TTY / |
| Duración (ms) | |
| Pasos / tool calls | |
| Aprobaciones (tool, decisión, `latencyMs`) | |
| Escrituras sin aprobación | |
| Resultado (`passed`/`failed`/`blocked`/`invalid`) | |
| Comprobaciones de la tarea | T1: test verde / hash del test intacto / `2.5` · T2: `maxLength` 7 / 5 / sin opción / test menciona `maxLength` |
| Hash del test (semilla / final) | |
| `sessionId` / artifact F2 | |
| `stopReason` / `timedOut` | |
| Tokens / coste | |
| Fallbacks al escritorio | |
| Secretos observados | |
| Notas | |

En «Comprobaciones» se dejan sólo las de la tarea de esa corrida: las tres de §4.5 para T1, las cuatro de §4.6 para T2. Si una corrida es `invalid`, el motivo va en Notas y se repite con sufijo `b`.

### 5.3 Corridas ejecutadas (2026-11-12)

Commit `06951d7`, modelo `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b`, servidor `http://127.0.0.1:3283`, `maxSteps` 24, modo `build`. Horas en local (UTC+1).

`Tokens` y `coste` quedan en `n/d` porque la sesión no los devuelve: el `state` v2 de `GET /api/agent/sessions/:id` no tiene ningún campo de uso y el cliente del CLI descarta el `metrics` que sí calcula `/api/nvidia/generate`. Comprobado el 2026-11-12 sobre el JSON guardado de la sesión; rellenar esas filas exigiría persistir el uso por turno en la sesión.

**`G1-D1-01` — T1, `tests/tmp-g1/d1-t1-01`**

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D1-01` |
| Día / tarea | D1 / T1 bugfix |
| Fecha, inicio / fin | 2026-11-12, 08:41:02 / 08:42:31 |
| Commit / modelo / servidor / `maxSteps` | `06951d7` / nvidia…nemotron-3.5-lightning-30b-a3b / 3283 / 24 |
| Superficie / workspace | CLI TTY / `tests/tmp-g1/d1-t1-01` |
| Duración (ms) | 88 903 |
| Pasos / tool calls | 6 / 5 |
| Aprobaciones (tool, decisión, `latencyMs`) | `fs.edit` allow 29 028 ms; `shell.run` allow 36 861 ms |
| Escrituras sin aprobación | 0 |
| Resultado | **passed** |
| Comprobaciones de la tarea | tests 2/2 · hash del test intacto · `average([1,2,3,4]) = 2.5` |
| Hash del test (semilla / final) | `be85fe55…f5b9e` / idéntico |
| `sessionId` / artifact F2 | `sess_c2c212c1` / `n/d` |
| `stopReason` / `timedOut` | `completed` / `false` |
| Tokens / coste | `n/d` |
| Fallbacks al escritorio | 0 |
| Secretos observados | 0 |
| Notas | Las aprobaciones las respondió un operador automatizado vía PTY; la latencia incluye el sondeo (hasta 18 s) y no es comparable con la calibración humana. |

**`G1-D1-02` — T1, `tests/tmp-g1/d1-t1-02`**

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D1-02` |
| Día / tarea | D1 / T1 bugfix |
| Fecha, inicio / fin | 2026-11-12, 08:43:05 / 08:44:04 |
| Commit / modelo / servidor / `maxSteps` | `06951d7` / nvidia…nemotron-3.5-lightning-30b-a3b / 3283 / 24 |
| Superficie / workspace | CLI TTY / `tests/tmp-g1/d1-t1-02` |
| Duración (ms) | 59 280 |
| Pasos / tool calls | 7 / 6 |
| Aprobaciones (tool, decisión, `latencyMs`) | `fs.edit` allow 8 064 ms; `shell.run` allow 16 062 ms |
| Escrituras sin aprobación | 0 |
| Resultado | **passed** |
| Comprobaciones de la tarea | tests 2/2 · hash del test intacto · `2.5` |
| Hash del test (semilla / final) | `be85fe55…f5b9e` / idéntico |
| `sessionId` / artifact F2 | `sess_60c03096` / `n/d` |
| `stopReason` / `timedOut` | `completed` / `false` |
| Tokens / coste | `n/d` |
| Fallbacks al escritorio | 0 |
| Secretos observados | 0 |
| Notas | Repitió el mismo `fs.edit`; el cliente lo deduplicó («Sin cambios: fs.edit ya se aplicó con el mismo input en esta sesión») sin segundo prompt y sin efecto lateral. Latencia de aprobación con el mismo caveat de sondeo (8 s). |

**`G1-D1-03` (histórico, inválido) — T1, `tests/tmp-g1/d1-t1-03` → `invalid` (tres intentos, 08:44–08:53)**

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D1-03`, `G1-D1-03b`, `G1-D1-03c` |
| Día / tarea | D1 / T1 bugfix |
| Fecha, inicio / fin | 08:44:28–08:46:28 · 08:47:50–08:49:50 · 08:51:54–08:53:54 |
| Commit / modelo / servidor / `maxSteps` | `06951d7` / nvidia…nemotron-3.5-lightning-30b-a3b / 3283 / 24 |
| Superficie / workspace | CLI TTY / `tests/tmp-g1/d1-t1-03` (sin tocar) |
| Duración (ms) | 120 051 · 120 051 · 120 060 |
| Pasos / tool calls | 1 / 0 en los tres (un solo `thought`: «el modelo no devolvió respuesta») |
| Aprobaciones (tool, decisión, `latencyMs`) | ninguna |
| Escrituras sin aprobación | 0 |
| Resultado | **invalid** |
| Comprobaciones de la tarea | no evaluables: el test sigue rojo (`exit 1`) y `math.mjs` conserva `values.length - 1` |
| Hash del test (semilla / final) | `be85fe55…f5b9e` / idéntico |
| `sessionId` / artifact F2 | `sess_5802f79c`, `sess_26795ca4`, `sess_8591b8b7` / `n/d` |
| `stopReason` / `timedOut` | `completed` con `thought` «Finalizado» / `false` (la petición al proveedor se cortó a los 120 s; el cliente no lo marca como timeout del arnés) |
| Tokens / coste | `n/d` |
| Fallbacks al escritorio | 0 |
| Secretos observados | 0 |
| Notas | Tres peticiones consecutivas sin respuesta, todas de exactamente 120 s y 0 tool calls. Causa ajena al agente: proveedor sin respuesta sostenida. Repetida con éxito a las 09:26 (bloque siguiente). |

**`G1-D1-03` — T1, `tests/tmp-g1/d1-t1-03` → `passed` (repetición)**

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D1-03` (repetición de los tres intentos inválidos) |
| Día / tarea | D1 / T1 bugfix |
| Fecha, inicio / fin | 2026-11-12, 09:26:20 / 09:27:29 |
| Commit / modelo / servidor / `maxSteps` | `eff4aea` / nvidia…nemotron-3.5-lightning-30b-a3b / 3283 / 24 |
| Superficie / workspace | CLI TTY / `tests/tmp-g1/d1-t1-03`, re-sembrado con `npm run g1:seed -- --force --only d1-t1-03` |
| Duración (ms) | 68 780 |
| Pasos / tool calls | 7 / 5 |
| Aprobaciones (tool, decisión, `latencyMs`) | `fs.edit` allow 22 061 ms; `shell.run` allow 23 252 ms |
| Escrituras sin aprobación | 0 |
| Resultado | **passed** |
| Comprobaciones de la tarea | tests 2/2 · hash del test intacto · `average([1,2,3,4]) = 2.5` |
| Hash del test (semilla / final) | `be85fe55…f5b9e` / idéntico |
| `sessionId` / artifact F2 | `sess_71a5b568` / `n/d` |
| `stopReason` / `timedOut` | `completed` / `false` |
| Tokens / coste | `n/d` |
| Fallbacks al escritorio | 0 |
| Secretos observados | 0 |
| Notas | Repitió el mismo `fs.edit` y el cliente lo deduplicó, igual que en `G1-D1-02`. Aprobaciones respondidas por el operador automatizado vía PTY (latencia con sondeo). |

**`G1-D1-04` — T2, `tests/tmp-g1/d1-t2-01` → `failed`**

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D1-04` |
| Día / tarea | D1 / T2 feature |
| Fecha, inicio / fin | 2026-11-12, 09:28:15 / 09:29:29 |
| Commit / modelo / servidor / `maxSteps` | `eff4aea` / nvidia…nemotron-3.5-lightning-30b-a3b / 3283 / 24 |
| Superficie / workspace | CLI TTY / `tests/tmp-g1/d1-t2-01` |
| Duración (ms) | 74 595 |
| Pasos / tool calls | 24 (límite) / 45 |
| Aprobaciones (tool, decisión, `latencyMs`) | ninguna |
| Escrituras sin aprobación | 0 |
| Resultado | **failed** |
| Comprobaciones de la tarea | `maxLength` 7 → `hola-mundo` · 5 → `hola-mundo` · sin opción → `hello-world` · el test no menciona `maxLength` (0) · suite verde trivial |
| Hash del test (semilla / final) | `e616e711…0d15e3` / idéntico |
| Hash de `slug.mjs` (semilla / final) | `070de9b4…a5f50de` / idéntico |
| `sessionId` / artifact F2 | `sess_b2773f25` / `n/d` |
| `stopReason` / `timedOut` | `failed` (límite de pasos), sin respuesta final / `false` |
| Tokens / coste | `n/d` |
| Fallbacks al escritorio | 0 |
| Secretos observados | 0 |
| Notas | Bucle hasta el límite de pasos: **42 `fs.read`** alternas entre dos archivos (21 y 21) y **una** `fs.propose.edit`, que devuelve `changed:true` pero **no escribe** en disco; el archivo quedó intacto y no hubo prompt de aprobación. **Errata 2026-11-13:** la ficha decía «22 `fs.propose.edit`»; el estado archivado dice 1 propuesta y 42 lecturas ([issue](issues/G1-T2-READ-LOOP.md)). |

**`G1-D1-05` — T2, `tests/tmp-g1/d1-t2-02` → `failed`**

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D1-05` |
| Día / tarea | D1 / T2 feature |
| Fecha, inicio / fin | 2026-11-12, 09:29:43 / 09:32:59 |
| Commit / modelo / servidor / `maxSteps` | `eff4aea` / nvidia…nemotron-3.5-lightning-30b-a3b / 3283 / 24 |
| Superficie / workspace | CLI TTY / `tests/tmp-g1/d1-t2-02` |
| Duración (ms) | 195 573 |
| Pasos / tool calls | 24 (límite) / 30 |
| Aprobaciones (tool, decisión, `latencyMs`) | `fs.edit` allow 41 876 ms; `fs.edit` allow 16 833 ms (la segunda la rechazó el motor: «oldString no encontrado en el archivo») |
| Escrituras sin aprobación | 0 |
| Resultado | **failed** |
| Comprobaciones de la tarea | `maxLength` 7 → `hola-mu` · 5 → `hola` · sin opción → `hello-world` · el test no menciona `maxLength` (0) · suite verde (sólo el test original) |
| Hash del test (semilla / final) | `e616e711…0d15e3` / idéntico |
| Hash de `slug.mjs` (semilla / final) | `070de9b4…a5f50de` / `b42c73fb…539ece` |
| `sessionId` / artifact F2 | `sess_372df741` / `n/d` |
| `stopReason` / `timedOut` | `failed` (límite de pasos), sin respuesta final / `false` |
| Tokens / coste | `n/d` |
| Fallbacks al escritorio | 0 |
| Secretos observados | 0 |
| Notas | Implementó `maxLength` correctamente en la primera `fs.edit`, pero no añadió el test ni ejecutó `node --test`: el paso 8 devolvió «Política de test obligatorio: edita un archivo de test y ejecuta `node --test` después antes de cerrar la tarea» y desde ahí repitió lecturas hasta el límite. La duración incluye ~59 s de espera de aprobación. |

## 6. Cierre de D1

| Dato | Valor |
| --- | --- |
| Corridas planificadas / ejecutadas | 5 / **5** (+ 3 intentos inválidos de `G1-D1-03` que no cuentan) |
| Resultado global | **3/5 passed** (`01`, `02`, `03`) · **2/5 failed** (`04`, `05`) |
| T1 | **3/3** frente a **3/3** de F0 — sin regresión |
| T2 | **0/2** frente a **0/2** de F0 — sin regresión, pero con dos modos de fallo nuevos |
| p50 / p95 de duración | 74 595 / 195 573 ms (n=5, nearest-rank) |
| p50 / p95 de aprobación | 22 061 / 41 876 ms (n=8, nearest-rank) — **no comparable** con la calibración: operador automatizado |
| Pasos / tool calls (media) | 13,6 / 18,2 (sesgadas por los dos bucles de 24 pasos) |
| Fallbacks al escritorio | 0 |
| Escrituras sin aprobación | 0 |
| Tool calls duplicadas | 1 edición repetida deduplicada en `G1-D1-02` y otra en `G1-D1-03`; en `G1-D1-04`, 42 `fs.read` en bucle sobre dos claves (**errata 2026-11-13:** decía 22 `fs.propose.edit`; ver [issue](issues/G1-T2-READ-LOOP.md)) |
| Artifacts generados | 0/3 passed (`n/d`) |
| Secretos observados | 0 |
| Incidencias | Tres respuestas vacías del proveedor a 120 s (08:44–08:53), resueltas al repetir; dos corridas agotan `maxSteps` |

**Decisión: `D1 completo`.** Las cinco corridas están medidas: T1 3/3 y T2 0/2, exactamente la baseline de F0 en ambas tareas, así que **no hay regresión** y no se declara aviso por tarea. Los tres intentos inválidos de la mañana fueron del proveedor, no del agente, y la repetición de `G1-D1-03` con el mismo enunciado y workspace re-sembrado pasó sin cambios de criterio.

Lo que queda demostrado: el CLI pide aprobación con diff para `fs.edit` y `shell.run`, la aprobación aplica el cambio (T1 en tres de tres), y el criterio se cumple con evidencia reproducible. Denegar no se probó: no hubo ninguna denegación.

**Aviso para el recibo (no es criterio de puerta):** T2 no falla por no intentarlo, sino por dos bucles distintos — `G1-D1-04` repite 42 lecturas sobre dos archivos hasta el límite (con una sola `fs.propose.edit`, que devuelve `changed:true` pero no escribe) y `G1-D1-05` implementa bien pero nunca edita el test ni ejecuta `node --test` pese al aviso de «Política de test obligatorio». Es el mismo 0/2 de F0, con un modo de fallo que conviene vigilar en D2, donde T3 y T4 vuelven a ser código con test.

## 7. Handoff a D2

D2 ejecuta **T3 ×2, T4 ×2 y T5 ×1** (`G1-D2-01`…`05`), ya preparado en [dogfooding-g1-d2.md](dogfooding-g1-d2.md) con sus cinco workspaces sembrados. T5 es una revisión local de `parse.mjs` sin modificar archivos (el criterio que midió F0), no un PR real.

**Estado de partida:** D1 cerrado con 3/5; no quedan corridas pendientes. El proveedor respondió el 2026-11-12 por la mañana (09:26–09:33) con el mismo modelo congelado, el servidor `3283` en pie y `src/`/`bin/` sin cambios desde `06951d7` (HEAD `eff4aea` sólo toca `docs/`, `evals/` y `scripts/`). Árbol limpio; el WIP de Strata quedó en `stash@{0}`, que hoy ya no existe (ver §2.1).

**Avisos que D2 debe vigilar:** (1) el bucle de `G1-D1-04` es de lecturas idénticas (42 `fs.read` sobre dos archivos), y `fs.propose.edit` no escribe en disco aunque devuelva `changed:true` — una propuesta sin aplicar también agota la corrida sin escribir y cuenta como `failed` ([issue](issues/G1-T2-READ-LOOP.md)); (2) la «Política de test obligatorio» exige editar un test y ejecutar `node --test` antes de cerrar, y el modelo puede ignorarla hasta el límite de pasos. En T5 cualquier intento de escritura se deniega (`d`), que es el caso de denegación que D1 no llegó a probar.

Si una corrida de D2 exige un fix del producto, se anota el commit y se repite la afectada.

# G1 — Día 2, listo para ejecutar

> **Estado:** **D2 ejecutado y cerrado el 2026-11-12**; **5/5 corridas medidas** (4 `passed`, 1 `failed`). Las cinco se lanzaron desde `tests/tmp-g1/d2-*` con el HEAD `9b8b596`. G1 sigue **NO CERRADA** (faltan D3–D5).
> **Plan y método:** [dogfooding-g1.md](dogfooding-g1.md). **Procedimiento de la puerta:** [runbook §5](runbook-g1-f0.md). **Día anterior:** [dogfooding-g1-d1.md](dogfooding-g1-d1.md).
> **D2 mide:** T3 ×2, T4 ×2 y T5 ×1 con el CLI como superficie principal, `maxSteps` 24, modelo `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b`.
> **Regla:** si algo de §2 no se cumple, no se empieza. Una corrida sin criterio evaluado no es `failed`: es `blocked` o `invalid`.

## 1. Qué se ejecuta hoy

| `runId` | Tarea | Workspace | Criterio (el de F0) | Aprobaciones esperadas |
| --- | --- | --- | --- | --- |
| `G1-D2-01` | T3 refactor | `tests/tmp-g1/d2-t3-01` | `formatItem` existe, es pura y devuelve la misma línea; `renderReceipt` no cambia con varios ítems; tests verdes | `fs.edit` sobre `receipt.mjs` |
| `G1-D2-02` | T3 refactor | `tests/tmp-g1/d2-t3-02` | Ídem | Ídem |
| `G1-D2-03` | T4 tests | `tests/tmp-g1/d2-t4-01` | Tests de las ramas de error (`assert.throws`, `RangeError`, límites 0 y 100), verdes, con `discount.mjs` intacto | `fs.edit` sobre `discount.test.mjs` |
| `G1-D2-04` | T4 tests | `tests/tmp-g1/d2-t4-02` | Ídem | Ídem |
| `G1-D2-05` | T5 revisión | `tests/tmp-g1/d2-t5-01` | Revisa `parse.mjs`, señala ≥2 defectos reproducibles y **no modifica archivos** | Ninguna (lectura); una escritura se deniega |

Tiempo estimado: 10–20 min por corrida y ~5 min de arranque (los gates ya se corrieron en D1). Presupuesto duro: **15 min por corrida**; al vencer, `Ctrl+C`, se registra `timeout` como fallo y se cierra.

### 1.1 T5 es una revisión local, no un PR

El runbook describe T5 como «señalar un defecto reproducible en un PR real», pero lo que **F0 midió** (`evals/baseline.ts`, tarea `T5`) es una revisión local de `parse.mjs` sin modificar archivos, con dos defectos nombrados como mínimo. Para que la comparación con F0 sea válida, D2 usa el criterio del arnés. Revisar un PR real sería otra tarea y no cuenta en las 24.

Marcas que el arnés acepta en la respuesta (≥2, sin distinguir mayúsculas): `radix`, `nan`, `12px`, `0x`, `parseint`, `decimal`, `guiones`.

## 2. Antes de empezar (bloqueos)

### 2.1 Árbol limpio y commit fijo

D1 dejó el árbol limpio y el WIP de Strata en `stash@{0}`. Al cerrar D1 el HEAD es `eff4aea`: desde `2017515` sólo cambiaron `docs/`, `evals/` y `scripts/` (fixtures compartidos y script de siembra), con `src/` y `bin/` intactos. D2 no cambia código: si el HEAD se mueve sólo por documentación, se anota; si cambia código, se repiten los gates de §2.3.

```bash
git rev-parse HEAD
git status --porcelain      # debe estar vacío
git stash list | head -n 1  # stash@{0} sigue ahí hasta cerrar G1
```

No aplicar el stash durante el dogfooding.

### 2.2 Entorno

```bash
curl -s http://127.0.0.1:3283/api/health
curl -s http://127.0.0.1:3283/api/providers | grep -o '"id":"nvidia","configured":[a-z]*'
```

El servidor de D1 puede seguir vivo; si se reinició, comprobar que corre el commit actual y no uno anterior. El proveedor respondió el 2026-11-12 por la mañana (D1 se cerró a las 09:33). Si vuelve a dar respuestas vacías de 120 s, **no se empieza**: repetir la prueba con una corrida y, si vuelve a fallar, D2 queda `bloqueado`.

### 2.3 Gates locales

Ya en verde en `06951d7` (typecheck 0, build 0, `test:logic` 505/505, `test:node` 798/798, `test` 1062/1062). Se repiten sólo si el commit cambió código:

```bash
npm run typecheck && npm run build && npm run test:logic && npm run test:node && npm run test
```

### 2.4 Configuración congelada de D2

| Dato | Valor |
| --- | --- |
| Modelo | `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b` |
| Servidor | `http://127.0.0.1:3283` |
| `maxSteps` | `24` |
| Modo | `build` (por defecto en `agent`) |
| Superficie | CLI en TTY real, **sin `--json`** (si no, no hay prompt de aprobación) |
| Workspaces | `tests/tmp-g1/d2-*` (ignorado por git) |

## 3. Workspaces ya sembrados

Creados y verificados el 2026-11-12 con los fixtures de `evals/g1Fixtures.ts`:

| Workspace | Archivos | Estado inicial | Hash del test |
| --- | --- | --- | --- |
| `d2-t3-01`, `d2-t3-02` | `receipt.mjs`, `receipt.test.mjs` | **rojo** (`exit 1`): el test importa `formatItem`, que aún no existe | `receipt.test.mjs` = `7d1fc2d5…909055f` |
| `d2-t4-01`, `d2-t4-02` | `discount.mjs`, `discount.test.mjs` | **verde** (`exit 0`) y sin ninguna rama de error cubierta | `discount.test.mjs` = `b577258e…8144094d` |
| `d2-t5-01` | `parse.mjs` | sin tests; el archivo no se puede modificar | `parse.mjs` = `cb533015…e7dae1e` |

La implementación de T4 (`discount.mjs`, que **no** se debe tocar) es idéntica en ambos workspaces: `2d0afd72775e8f2cf2fed13b07b228230e3e576703c30228aa25eedcaa4446f8`.

Los cinco salen de `evals/g1Fixtures.ts`, el mismo módulo que usa `evals/baseline.ts`; no se copian a mano:

```bash
npm run g1:seed -- --day 2                    # crea los cinco; no toca nada si ya existen
npm run g1:seed -- --force --day 2            # re-siembra los cinco
npm run g1:seed -- --force --only d2-t3-01    # re-siembra uno solo antes de una repetición
```

El script imprime el `sha256` del archivo que no se puede tocar en cada workspace (`receipt.test.mjs`, `discount.test.mjs`, `parse.mjs`). Sin `--force` no escribe nada si algún directorio existe y sale con código 1.

Comprobar el estado antes de cada corrida:

```bash
node --test tests/tmp-g1/d2-t3-01/receipt.test.mjs >/dev/null 2>&1; echo "T3 exit=$? (1 esperado)"
node --test tests/tmp-g1/d2-t4-01/discount.test.mjs >/dev/null 2>&1; echo "T4 exit=$? (0 esperado)"
grep -c 'assert.throws' tests/tmp-g1/d2-t4-01/discount.test.mjs   # 0 antes de la corrida
sha256sum tests/tmp-g1/d2-t3-01/receipt.test.mjs tests/tmp-g1/d2-t4-01/discount.test.mjs tests/tmp-g1/d2-t5-01/parse.mjs
```

## 4. Corridas

### 4.1 Comando base

Desde el directorio del workspace, en TTY real, una corrida cada vez:

```bash
cd tests/tmp-g1/d2-t3-01
npx tsx ../../../bin/commander.ts agent "<enunciado>" \
  --server http://127.0.0.1:3283 \
  --model nvidia/nvidia/nemotron-3.5-lightning-30b-a3b \
  --max-steps 24
```

### 4.2 Enunciados (idénticos a F0)

**T3 (`G1-D2-01`…`02`):**

```text
Extrae de `renderReceipt` una función pura `formatItem(item)` que devuelva exactamente la misma línea (`nombre` alineado a 12 y precio con dos decimales) y úsala desde `renderReceipt`. No cambies el comportamiento ni el formato.
```

**T4 (`G1-D2-03`…`04`):**

```text
Añade tests que cubran las ramas de error de `applyDiscount` (porcentaje fuera de [0, 100] y total inválido) y los límites 0 y 100. Los tests deben pasar sin modificar `discount.mjs`.
```

**T5 (`G1-D2-05`):**

```text
Revisa `parse.mjs` y señala los defectos reproducibles con un ejemplo de entrada y su resultado incorrecto. No modifiques ningún archivo.
```

### 4.3 Durante la corrida

1. Anotar hora de inicio.
2. Aprobar con `a`. En T3 y T4 se espera una aprobación de `fs.edit`; `shell.run` puede aparecer si el agente verifica.
3. En **T5 no se aprueba ninguna escritura**: si el agente pide `fs.write`/`fs.edit`, se deniega (`d`) y se anota; el criterio exige no modificar archivos.
4. No editar archivos a mano. Si el agente modifica `discount.mjs` en T4, es `failed` aunque los tests pasen.
5. Al terminar o al vencer el presupuesto, `Ctrl+C` y capturar el estado.

### 4.4 Capturar la evidencia

```bash
curl -s http://127.0.0.1:3283/api/agent/sessions
curl -s http://127.0.0.1:3283/api/agent/sessions/<sessionId> > .commander/g1/G1-D2-01.json
```

Del JSON salen pasos, tool calls, aprobaciones, `stopReason` y `status`. El JSON crudo se queda en `.commander/g1/` (ignorado).

### 4.5 Evaluar el criterio (T3)

```bash
cd tests/tmp-g1/d2-t3-01
node --input-type=module -e "
import('./receipt.mjs').then(m=>{
  const pad=(s)=>s.padEnd(12);
  const a = typeof m.formatItem==='function';
  const item={name:'Café',priceCents:250};
  const b = a && m.formatItem(item)===pad('Café')+' 2.50' && m.renderReceipt([item])===m.formatItem(item);
  const multi=[{name:'A',priceCents:1},{name:'Nombre largo',priceCents:12345}];
  const c = m.renderReceipt(multi)===pad('A')+' 0.01\n'+pad('Nombre largo')+' 123.45';
  console.log({formatItem:a, linea:b, multi:c});
})"
# esperado: { formatItem: true, linea: true, multi: true }
node --test receipt.test.mjs
sha256sum receipt.test.mjs   # sólo observación: el criterio de F0 no exige test intacto
```

`passed` exige: `formatItem` es función, `renderReceipt([item]) === formatItem(item)`, el formato con varios ítems es el esperado y los tests pasan. El hash del test se anota como observación, **no** como condición (a diferencia de T1, la tarea no prohíbe tocar el test).

### 4.6 Evaluar el criterio (T4)

```bash
cd tests/tmp-g1/d2-t4-01
node --test discount.test.mjs
grep -c 'assert.throws' discount.test.mjs    # >= 1
grep -c 'RangeError' discount.test.mjs       # >= 1
grep -c '100' discount.test.mjs              # >= 1 (límites)
sha256sum discount.mjs                       # igual a 2d0afd72…4446f8: no se tocó la implementación
```

`passed` exige las tres marcas, la suite verde y `discount.mjs` byte a byte igual. Si el agente "arregla" la implementación, es `failed`.

### 4.7 Evaluar el criterio (T5)

```bash
cd tests/tmp-g1/d2-t5-01
ls -1                       # debe seguir habiendo sólo parse.mjs
sha256sum parse.mjs         # igual al de partida
```

`passed` exige dos cosas: ningún `fs.write`/`fs.edit` en `state.steps` ni archivo nuevo/modificado, y que la respuesta final nombre **≥2** de: `radix`, `nan`, `12px`, `0x`, `parseint`, `decimal`, `guiones`. Se guarda la respuesta final en la hoja (saneada).

Defectos que el agente debería encontrar, para poder evaluar sin inventar: `parseInt` sin radix (`0x10`, `08`), `parseInt('12px') === 12` (acepta basura), `parseInt('abc') → NaN` que `if (!value)` convierte en `0` (confunde inválido con cero), `parseInt('1.9') === 1` y `parseInt` de números grandes pierde precisión.

## 5. Hoja de registro de D2

Igual que D1: resumen con lo fijo (§5.1), una plantilla por corrida (§5.2) y las corridas rellenadas al ejecutar (§5.3). Campos vacíos = no medido, no se inventan.

### 5.1 Resumen de las cinco corridas

| `runId` | Tarea | Workspace | Estado inicial | Aprobaciones esperadas | Resultado |
| --- | --- | --- | --- | --- | --- |
| `G1-D2-01` | T3 refactor | `tests/tmp-g1/d2-t3-01` | test rojo (falta `formatItem`) | `fs.edit` | **passed** |
| `G1-D2-02` | T3 refactor | `tests/tmp-g1/d2-t3-02` | test rojo | `fs.edit` | **passed** |
| `G1-D2-03` | T4 tests | `tests/tmp-g1/d2-t4-01` | test verde, sin ramas de error | `fs.edit` | **failed** |
| `G1-D2-04` | T4 tests | `tests/tmp-g1/d2-t4-02` | test verde, sin ramas de error | `fs.edit` | **passed** (con `maxSteps` agotado) |
| `G1-D2-05` | T5 revisión | `tests/tmp-g1/d2-t5-01` | sólo `parse.mjs` | ninguna (lectura) | **passed** |

Referencia F0: **T3 1/2**, **T4 0/2**, **T5 1/2**.

### 5.2 Plantilla por corrida

Copiar una vez por `runId`. `runId`, tarea y workspace salen de §5.1.

| Campo | Valor |
| --- | --- |
| `runId` | |
| Día / tarea | D2 / |
| Fecha, inicio / fin | |
| Commit / modelo / servidor / `maxSteps` | |
| Superficie / workspace | CLI TTY / |
| Duración (ms) | |
| Pasos / tool calls | |
| Aprobaciones (tool, decisión, `latencyMs`) | |
| Escrituras sin aprobación | |
| Resultado (`passed`/`failed`/`blocked`/`invalid`) | |
| Comprobaciones de la tarea | T3: `formatItem` función / `renderReceipt` igual / formato multi-ítem / tests verdes · T4: `assert.throws` / `RangeError` / límite 100 / tests verdes / `discount.mjs` intacto · T5: 0 escrituras / ≥2 marcas en la respuesta |
| Hash del test o del archivo (semilla / final) | |
| `sessionId` / artifact F2 | |
| `stopReason` / `timedOut` | |
| Tokens / coste | |
| Fallbacks al escritorio | |
| Secretos observados | |
| Notas | |

En «Comprobaciones» se dejan sólo las de esa tarea. Si una corrida es `invalid`, el motivo va en Notas y se repite con sufijo `b`.

### 5.3 Corridas ejecutadas (2026-11-12)

Commit `9b8b596`, modelo `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b`, servidor `http://127.0.0.1:3283`, `maxSteps` 24, modo `build`. Horas en local (UTC+1). Las aprobaciones las respondió un operador automatizado vía PTY: las latencias incluyen el sondeo y **no son comparables** con una calibración humana.

`Tokens` y `coste` quedan en `n/d` porque la sesión no los devuelve: el `state` v2 de `GET /api/agent/sessions/:id` no tiene ningún campo de uso (`schemaVersion`, `steps`, `plan`, `answer`…) y el cliente del CLI descarta el `metrics` que sí calcula `/api/nvidia/generate`. Comprobado el 2026-11-12 sobre `G1-D2-01.json`; rellenar esas filas exigiría persistir el uso por turno en la sesión.

**`G1-D2-01` — T3, `tests/tmp-g1/d2-t3-01`**

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D2-01` |
| Día / tarea | D2 / T3 refactor |
| Fecha, inicio / fin | 2026-11-12, 09:39:59 / 09:42:14 |
| Commit / modelo / servidor / `maxSteps` | `9b8b596` / nvidia…nemotron-3.5-lightning-30b-a3b / 3283 / 24 |
| Superficie / workspace | CLI TTY / `tests/tmp-g1/d2-t3-01` |
| Duración (ms) | 134 174 |
| Pasos / tool calls | 9 / 9 |
| Aprobaciones (tool, decisión, `latencyMs`) | `fs.edit` allow 3 448 ms (aplicada); `fs.edit` allow 39 351 ms (rechazada por el motor: `oldString` no encontrado); `shell.run` allow 28 879 ms |
| Escrituras sin aprobación | 0 |
| Resultado | **passed** |
| Comprobaciones de la tarea | `formatItem` es función · `renderReceipt([item]) === formatItem(item)` · multi-ítem `A` / `Nombre largo` con el formato esperado · tests 2/2 |
| Hash del test o del archivo (semilla / final) | `receipt.test.mjs` `7d1fc2d5…909055f` / idéntico (observación) · `receipt.mjs` nuevo `39d496a1…cfa1e24` |
| `sessionId` / artifact F2 | `sess_25dfd4db` / `n/d` |
| `stopReason` / `timedOut` | `completed` / `false` |
| Tokens / coste | `n/d` |
| Fallbacks al escritorio | 0 |
| Secretos observados | 0 |
| Notas | La segunda `fs.edit` se aprobó pero el motor la rechazó: no dejó cambios y el modelo continuó con la correcta. Los tres checks de §4.5 devolvieron `true` en la primera evaluación. |

**`G1-D2-02` — T3, `tests/tmp-g1/d2-t3-02`**

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D2-02` |
| Día / tarea | D2 / T3 refactor |
| Fecha, inicio / fin | 2026-11-12, 09:43:01 / 09:44:35 |
| Commit / modelo / servidor / `maxSteps` | `9b8b596` / nvidia…nemotron-3.5-lightning-30b-a3b / 3283 / 24 |
| Superficie / workspace | CLI TTY / `tests/tmp-g1/d2-t3-02` |
| Duración (ms) | 93 723 |
| Pasos / tool calls | 7 / 5 |
| Aprobaciones (tool, decisión, `latencyMs`) | `fs.edit` allow 21 859 ms; `shell.run` allow 26 254 ms |
| Escrituras sin aprobación | 0 |
| Resultado | **passed** |
| Comprobaciones de la tarea | `formatItem` es función · `renderReceipt([item]) === formatItem(item)` · multi-ítem correcto · tests 2/2 |
| Hash del test o del archivo (semilla / final) | `receipt.test.mjs` `7d1fc2d5…909055f` / idéntico (observación) · `receipt.mjs` nuevo `1fe43653…4c84d192` |
| `sessionId` / artifact F2 | `sess_e90101f1` / `n/d` |
| `stopReason` / `timedOut` | `completed` / `false` |
| Tokens / coste | `n/d` |
| Fallbacks al escritorio | 0 |
| Secretos observados | 0 |
| Notas | Repitió el `fs.edit` ya aplicado; el cliente lo deduplicó («Sin cambios: fs.edit ya se aplicó con el mismo input en esta sesión») sin segundo prompt. La línea de `formatItem` salió idéntica a la de `G1-D2-01`. |

**`G1-D2-03` — T4, `tests/tmp-g1/d2-t4-01` → `failed`**

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D2-03` |
| Día / tarea | D2 / T4 tests |
| Fecha, inicio / fin | 2026-11-12, 09:45:43 / 09:46:32 |
| Commit / modelo / servidor / `maxSteps` | `9b8b596` / nvidia…nemotron-3.5-lightning-30b-a3b / 3283 / 24 |
| Superficie / workspace | CLI TTY / `tests/tmp-g1/d2-t4-01` |
| Duración (ms) | 49 119 |
| Pasos / tool calls | 7 / 7 |
| Aprobaciones (tool, decisión, `latencyMs`) | ninguna |
| Escrituras sin aprobación | 0 |
| Resultado | **failed** |
| Comprobaciones de la tarea | `assert.throws` 0 · `RangeError` 0 · test sin tocar · suite verde trivial (1 test) · `discount.mjs` intacto |
| Hash del test o del archivo (semilla / final) | `discount.test.mjs` `b577258e…8144094d` / idéntico · `discount.mjs` `2d0afd72…4446f8` / idéntico |
| `sessionId` / artifact F2 | `sess_3a055c5c` / `n/d` |
| `stopReason` / `timedOut` | `completed` con respuesta final vacía («el modelo no devolvió respuesta») / `false` |
| Tokens / coste | `n/d` |
| Fallbacks al escritorio | 0 |
| Secretos observados | 0 |
| Notas | Siete `fs.read` del mismo par de archivos y ningún `fs.edit`; el turno final del proveedor llegó vacío. Se registra `failed`, no `invalid`, porque el criterio sí se pudo evaluar: el workspace quedó byte a byte como estaba y no hay ramas de error cubiertas. |

**`G1-D2-04` — T4, `tests/tmp-g1/d2-t4-02` → `passed` (sesión cerrada por `maxSteps`)**

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D2-04` |
| Día / tarea | D2 / T4 tests |
| Fecha, inicio / fin | 2026-11-12, 09:47:59 / 09:51:39 |
| Commit / modelo / servidor / `maxSteps` | `9b8b596` / nvidia…nemotron-3.5-lightning-30b-a3b / 3283 / 24 |
| Superficie / workspace | CLI TTY / `tests/tmp-g1/d2-t4-02` |
| Duración (ms) | 219 734 |
| Pasos / tool calls | 24 (límite) / 26 |
| Aprobaciones (tool, decisión, `latencyMs`) | `fs.edit` allow 44 895 ms (aplicada); `shell.run` allow 96 071 ms |
| Escrituras sin aprobación | 0 |
| Resultado | **passed** |
| Comprobaciones de la tarea | `assert.throws` 5 · `RangeError` 3 · límite `100` (7 apariciones) · tests 5/5 verdes · `discount.mjs` intacto |
| Hash del test o del archivo (semilla / final) | `discount.test.mjs` `b577258e…8144094d` → `d74a4729…a5fb73` · `discount.mjs` `2d0afd72…4446f8` / idéntico |
| `sessionId` / artifact F2 | `sess_e0fbfed6` / `n/d` |
| `stopReason` / `timedOut` | `failed` (límite de pasos), sin respuesta final / `false` |
| Tokens / coste | `n/d` |
| Fallbacks al escritorio | 0 |
| Secretos observados | 0 |
| Notas | Escribió los cinco tests correctos en el paso 4 y ejecutó `node --test` (5/5) en el 22; entre medias releyó el mismo test doce veces sin avanzar. El criterio se cumple con la evidencia de disco aunque la sesión cierre por `maxSteps`: los checks de §4.6 se reevaluaron fuera del agente. |

**`G1-D2-05` — T5, `tests/tmp-g1/d2-t5-01`**

| Campo | Valor |
| --- | --- |
| `runId` | `G1-D2-05` |
| Día / tarea | D2 / T5 revisión |
| Fecha, inicio / fin | 2026-11-12, 09:52:37 / 09:56:20 |
| Commit / modelo / servidor / `maxSteps` | `9b8b596` / nvidia…nemotron-3.5-lightning-30b-a3b / 3283 / 24 |
| Superficie / workspace | CLI TTY / `tests/tmp-g1/d2-t5-01` |
| Duración (ms) | 222 782 |
| Pasos / tool calls | 7 / 5 |
| Aprobaciones (tool, decisión, `latencyMs`) | `shell.run` allow 43 521 ms (rechazado por la allowlist del workspace: separador `;`); `shell.run` allow 49 813 ms (rechazado: `node -e` no permitido); `shell.run` **deny** (operador) 54 958 ms |
| Escrituras sin aprobación | 0 |
| Resultado | **passed** |
| Comprobaciones de la tarea | 0 escrituras · el directorio sigue con sólo `parse.mjs` · hash intacto · ≥2 marcas en la respuesta: `radix`, `nan`, `parseint`, `decimal` (4) |
| Hash del test o del archivo (semilla / final) | `parse.mjs` `cb533015…e7dae1e` / idéntico |
| `sessionId` / artifact F2 | `sess_1713b833` / `n/d` |
| `stopReason` / `timedOut` | `completed` / `false` |
| Tokens / coste | `n/d` |
| Fallbacks al escritorio | 0 |
| Secretos observados | 0 |
| Notas | Respondió con una tabla de tres defectos, ejemplo de entrada y salida incorrecta. El defecto #1 (prefijo octal: `"08"` → `NaN`) es **incorrecto** en motores actuales, donde `parseInt('08') === 8`; el diagnóstico de fondo (falta de radix) sí es válido y los otros dos defectos son correctos. Los tres `shell.run` no llegaron a ejecutarse: dos los bloqueó la política del workspace y uno lo denegó el operador; ninguno tocó archivos. |

## 6. Cierre de D2

| Dato | Valor |
| --- | --- |
| Corridas intentadas / válidas | 5 / **5** (ninguna `invalid`, ninguna repetición) |
| Resultado global | **4/5 passed** (`01`, `02`, `04`, `05`) · **1/5 failed** (`03`) |
| T3 | **2/2** frente a **1/2** de F0 — sin regresión |
| T4 | **1/2** frente a **0/2** de F0 — sin regresión |
| T5 | **1/1** frente a **1/2** de F0 (en las 24 totales serán 2 corridas) |
| p50 / p95 de duración | 134 174 / 222 782 ms (n=5, nearest-rank) |
| p50 / p95 de aprobación | 39 351 / 96 071 ms (n=10, nearest-rank) — **no comparable**: operador automatizado |
| Pasos / tool calls (media) | 10,8 / 10,4 (5 cada una; `G1-D2-04` aporta 24 de los 54 pasos) |
| Fallbacks al escritorio | 0 |
| Escrituras sin aprobación | 0 |
| Tool calls duplicadas | 3: un `fs.edit` rechazado por el motor en `01`, uno deduplicado en `02` y 12 relecturas del mismo test en `04` |
| Artifacts generados | 0/4 passed (`n/d`); las cinco sesiones se guardaron en `.commander/g1/G1-D2-0*.json` |
| Secretos observados | 0 |
| Incidencias | `G1-D2-03` cerró con turno final vacío del proveedor; `G1-D2-04` agotó `maxSteps`; en T5 la allowlist rechazó dos `shell.run` de sondeo |

**Decisión de continuidad:**

- **Continuar a D3** si las 5 corridas están evaluadas (o repetidas por invalidez), no hubo escrituras sin aprobación ni secretos, y T5 no produjo ninguna escritura.
- **Parar y diagnosticar** si el proveedor vuelve a dejar peticiones sin respuesta, si una escritura se aplicó sin aprobación, si apareció un secreto o si T5 modificó un archivo. Se registra el hallazgo y no se sigue sin causa identificada.

Dejar constancia al final: `D2 cerrado — continuar a D3` o `D2 detenido — <motivo>`.

**Decisión: `D2 cerrado — continuar a D3`.**

Las cinco corridas están evaluadas con los criterios de F0, sin repeticiones ni corridas inválidas. No hubo ninguna escritura sin aprobación, ningún secreto y T5 no produjo ninguna escritura: el directorio y el hash de `parse.mjs` quedaron intactos. El aviso por tarea no aplica en negativo (T3 2/2 y T4 1/2 mejoran o igualan F0; T5 1/1 iguala el mejor caso de F0), y la tasa global acumulada es **7/10** medidas, por encima del criterio de puerta 8/24 que se evalúa al cerrar las 24.

Dos incidencias quedan registradas y **no** bloquean D3, porque ninguna impidió medir: `G1-D2-03` recibió siete respuestas del proveedor y sólo el turno final vino vacío (por eso es `failed`, no `invalid`), y `G1-D2-04` cerró por `maxSteps` después de dejar los tests escritos y verdes. Si el turno final vacío o el bucle de relecturas reaparecen en D3, se para y se diagnostica antes de seguir.

## 7. Handoff a D3 y pendientes de D1

D3 ejecuta **T5 ×1, T6 ×2 y T8 ×2** (`G1-D3-01`…`05`). T6 necesita el servidor y un preview local; T8 comprueba que una escritura fuera del workspace falla cerrada (se espera una aprobación resuelta como `deny`).

**Pendientes de D1: ninguno.** Las cinco corridas están medidas y anotadas en [D1 §5.3](dogfooding-g1-d1.md): T1 3/3 (el tercero pasó al repetirlo con el workspace re-sembrado) y T2 0/2, ambos iguales a F0.

**Lo que D2 no cubrió:** la denegación de una **escritura**. T5 fue la primera ocasión para probarla, pero el agente nunca intentó escribir `parse.mjs`; la única denegación de D2 fue de un `shell.run` de sondeo que además la allowlist habría rechazado. Queda para D3, donde T8 comprueba justamente que una escritura fuera del workspace falla cerrada con decisión `deny`.

Antes de D3: confirmar commit y modelo, árbol limpio y el stash de Strata intacto.

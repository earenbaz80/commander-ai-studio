# G1 — CAL4H: repetición de CAL4 con operador humano

> **Estado:** **entorno preparado en `bd61ad0`, sin operador asignado. NO EJECUTAR TODAVÍA.**
> **Qué es:** el procedimiento para repetir el bloque CAL4 con una **persona real** leyendo el panel y pulsando `a`/`d` en el TTY. El agente **no envía ninguna tecla**, no conduce el PTY y no importa muestras por su cuenta.
> **Qué no es:** no es una corrida autorizada, no reemplaza el recibo del bloque inválido y no cambia la referencia de 15 151 ms. G1 sigue **NO CERRADO**.
> **Base:** [protocolo de re-medición](g1-approval-remeasure.md) §4.1 y §7.1–§7.2; [recibo CAL4 no válido](receipts/G1-APPROVAL-CAL4-2026-11-14.md).

## 0. Regla de oro

**Este bloque no se corre hasta que haya una persona delante del teclado, con tiempo reservado y sin otra tarea abierta.** Si el operador no está, el comando no se lanza. El agente no debe:

- usar `process_write`/`process_start` para responder los prompts;
- abrir un PTY propio y enviar `a`, `d` o justificaciones;
- automatizar el menú con `preview_*`, `expect`, `yes` ni un script de teclas.

La única mano que decide es la del operador. El agente puede leer este documento y verificar el entorno, pero **no ejecutar la corrida**.

## 1. Antes de empezar (checklist de precondiciones)

- [ ] **Operador presente** y con **60–90 min** reservados; sin otra tarea abierta.
- [ ] **Terminal real** (no el panel del agente): `tty` debe responder un dispositivo, por ejemplo `/dev/ttys003`.
- [ ] **Sin teclas en cola** y sin otra sesión del CLI usando `:3283`.
- [ ] **Worktree medido limpio y congelado:**
  ```bash
  cd "G:/Proyectos AI/commander-ai-studio-2.5.1"
  git -C tests/tmp-g1/cal4-repo status --short
  git -C tests/tmp-g1/cal4-repo rev-parse --short HEAD
  ```
  Debe estar vacío y en **`bd61ad0`**, el commit declarado del bloque (ver §7). Si se cambiara, hay que recrear el worktree y anotar el nuevo commit antes de la primera muestra.
- [ ] **Servidor vivo en `:3283`:** `npm run dev` → `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3283/api/health` → `200`. El script `dev` fija `PORT=3283` desde el 2026-11-16; antes, con `PORT=0` exportado, el servidor elegía un puerto efímero (se midió `57898`) y `cal4-one.sh` no lo encontraba (ver §7).
- [ ] **Modelo y `maxSteps` congelados:** `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b`, `--max-steps 24`.
- [ ] **Store humano aislado y vacío.** El bloque inválido vive en `.commander/g1/cal4/samples.jsonl`; **no se toca**. La repetición usa `tests/tmp-g1/cal4-human/.commander/g1/cal4/samples.jsonl`:
  ```bash
  cd "G:/Proyectos AI/commander-ai-studio-2.5.1"
  mkdir -p tests/tmp-g1/cal4-human
  if [ -s tests/tmp-g1/cal4-human/.commander/g1/cal4/samples.jsonl ]; then
    echo "NO USAR: el store humano ya tiene muestras"; exit 1
  fi
  echo "store humano vacío"
  ```
  Si ya tiene muestras, elegir otro directorio (`cal4-human-2`, …) y usarlo en todos los comandos.
- [ ] **Rango de corridas libre:** esta repetición usa `CAL4-R22`…`CAL4-R41`, para no pisar los estados `R02`–`R21` del bloque inválido. No reutilizar `R02`–`R21`.
- [ ] **Protocolo leído:** §4.1 (I1–I4), §5 (invalidación) y §7.1–§7.2 (puerta).

## 2. Comando exacto

Todo se ejecuta **desde el store humano**, para que `g1-cal4.ts` no lea el store viejo:

```bash
cd "G:/Proyectos AI/commander-ai-studio-2.5.1/tests/tmp-g1/cal4-human"
bash ../cal4-one.sh 22
```

Ese comando:

1. siembra `math.mjs` roto y `math.test.mjs` intacto en el worktree desechable;
2. lanza el CLI en **el TTY de esa terminal**;
3. espera que el operador decida en el menú;
4. captura el estado de la sesión y muestra la tabla de aprobaciones;
5. pide la justificación I1 de `fs.edit` y de `shell.run`;
6. importa al store **de `cal4-human`**.

Para las 20 corridas, sin que nadie más toque la terminal:

```bash
cd "G:/Proyectos AI/commander-ai-studio-2.5.1/tests/tmp-g1/cal4-human"
for n in $(seq 22 41); do
  bash ../cal4-one.sh "$n" || { echo "detenido en CAL4-R$n"; break; }
done
```

> El script imprime `Siguiente: bash tests/tmp-g1/cal4-one.sh 23`, que es la ruta del proyecto, no la de `cal4-human`. Ignorá esa línea y usá el bucle o `bash ../cal4-one.sh 23`.

**No lanzar ninguna de estas dos variantes todavía.** Requieren operador.

## 3. Checklist por corrida

- [ ] El prompt `⚠ fs.edit espera aprobación` aparece en **el panel del operador**.
- [ ] El operador **lee el diff impreso** (cabeceras `@@` y líneas `+`/`-`) antes de decidir. No se pulsa `a` “para ver qué pasa”.
- [ ] Decisión: `a` (permitir una vez). **`s` prohibido.** `d` sólo si la tool sale del alcance del enunciado; en ese caso la muestra va al estrato `deny`, no al primario.
- [ ] No se escribe en la terminal mientras hay un prompt abierto ni se dejan teclas en cola.
- [ ] El CLI termina y aparece la tabla de captura. **Antes de escribir la justificación**, verificar:
  - `fs.edit` muestra `diff impreso` (y `truncado` + hunk si corresponde);
  - la latencia no es `n/d`;
  - no aparece `sin render` ni `no impreso` en un `fs.edit`.
- [ ] Si el `fs.edit` no tiene evidencia de diff: **Ctrl+C antes de importar**, no se escribe justificación y la corrida se repite con otro número. El script pasa `--diff-log`; sólo es válido si el operador realmente vio el diff.
- [ ] En `I1 fs.edit`, escribir exactamente lo revisado, por ejemplo:
  ```text
  math.mjs: values.length - 1 → values.length
  ```
- [ ] En `I1 shell.run`, escribir el comando leído, por ejemplo:
  ```text
  node --test math.test.mjs
  ```
- [ ] Confirmar en la salida que la fila entró como `primario`, no como `excluida` ni `deny`.
- [ ] Si la fila salió `excluida` por I1/I2/I3, anotar el motivo y repetir la corrida con un número nuevo; no editarla ni borrarla.
- [ ] Anotar `runId`, `sessionId`, tool, decisión, `latencyMs`, `decisionMs` (si existe; una decisión directa no lo genera, se anota `directDecision`), evidencia de render y justificación.

## 4. Cierre del bloque

Cuando terminen las 20 corridas (o se alcance el objetivo de 40 incluidas):

```bash
cd "G:/Proyectos AI/commander-ai-studio-2.5.1/tests/tmp-g1/cal4-human"
npx tsx ../g1-cal4.ts summary
```

Verificar:

- [ ] `n` del primario **≥ 40** y las 20 corridas ejecutadas. Si una corrida deja más de dos `allow`, se registran todas; no se borra ninguna y se publica el `n` real.
- [ ] Los `sampleId` del store humano vuelven a empezar en `CAL4-01`; para citarlos sin ambigüedad, usar siempre el `runId` `CAL4-R22`…`R41` y aclarar que el store es `cal4-human`.
- [ ] Exclusiones por I1–I3 **≤ 20 %**; si supera, el bloque es inválido y se repite con otro operador.
- [ ] `p95` calculado con nearest-rank y publicado con su `n`.
- [ ] **Puerta:** `p95 ≤ 15 151 ms`, equivalente a **como mucho 2 de 40** por encima. Si no se cumple, G1 sigue **NO CERRADO**; no se cambia la referencia.
- [ ] Los `deny` se reportan aparte; nunca se mezclan con el primario.
- [ ] Guardar el store humano y los estados en `tests/tmp-g1/cal4-human/` y `tests/tmp-g1/cal4-repo/.commander/g1/cal4/`. No borrar el bloque inválido.
- [ ] Emitir un recibo **nuevo** (por ejemplo `G1-APPROVAL-CAL4H-<fecha>.md`) que declare operador, fecha, commit, n, p95, exclusiones y decisión. No reutilizar el recibo del bloque conducido por el agente.
- [ ] Si el p95 vuelve a fallar, la salida B sigue vigente y el paso siguiente es producto, no otra referencia.

## 5. Qué NO hacer

- No correr `cal4-one.sh` desde el panel del agente ni desde un PTY que el agente controle.
- No enviar `a`/`d` por `process_write` ni por ninguna automatización.
- No usar el store `.commander/g1/cal4/samples.jsonl` del bloque inválido: contaminaría el `n` y el p95.
- No reutilizar `CAL4-R02`–`R21`: los estados y las aprobaciones ya existen.
- No cambiar el umbral, el piso de 1 500 ms, I1–I4 ni la referencia.
- No declarar G1 cerrado con este bloque: sólo mide el p95; T10 sigue siendo una condición aparte.

## 6. Estado actual

**Preparado y detenido.** El entorno está listo (§7), pero no hay operador asignado, no se ejecutó ninguna corrida de `CAL4H` y el store humano está vacío. El bloque anterior sigue documentado como **no válido como muestra humana**; G1 sigue **NO CERRADO**.

## 7. Entorno medido (2026-11-16)

Fijado antes de la primera muestra, para que el recibo declare exactamente lo que se mide:

| Elemento | Valor | Cómo se comprobó |
| --- | --- | --- |
| Commit del bloque | **`bd61ad0`** (`docs(parity): corrige el conteo de corridas T10 del plan de cierre`) | `git rev-parse --short HEAD`; es docs-only sobre `5ba5d95` |
| Worktree medido | `tests/tmp-g1/cal4-repo` en **`bd61ad0`**, detached y limpio | `git -C tests/tmp-g1/cal4-repo rev-parse --short HEAD` y `git status --porcelain` vacío |
| Servidor | `npm run dev` → `:3283`, `/api/health` `200` | El script fija `PORT=3283`; la causa del `57898` fue un `PORT=0` heredado del shell, que `server.ts` interpreta como puerto efímero (los tests lo usan así) |
| Modelo / `maxSteps` | `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b` / `24` | Flags de `cal4-one.sh` |
| Store humano | vacío (0 archivos) | `find tests/tmp-g1/cal4-human -type f` |
| Rango | `CAL4-R22`…`R41` libre; el bloque inválido ocupa `R02`–`R21` | `grep -o 'CAL4-R[0-9][0-9]' .commander/g1/cal4/samples.jsonl` |

El worktree **se recreó** (el anterior ya no existía) con estos comandos, ejecutados desde la raíz:

```bash
git worktree add --detach tests/tmp-g1/cal4-repo bd61ad0
cd tests/tmp-g1/cal4-repo
npm ci --ignore-scripts --no-audit --no-fund   # 738 paquetes; la junction de node_modules falló en Git Bash
node node_modules/tsx/dist/cli.mjs scripts/g1-seed.ts --force --only d1-t1-01
```

El recibo de `CAL4H` debe declarar **`bd61ad0`**, no `6838fa1`: el `6838fa1` del runbook original era la referencia prevista y no es el commit con el que se mide. Si el servidor o el worktree se reinician antes del bloque, se repite este §7 y se anota el commit vigente.

**Puerto del servidor.** `npm run dev` arranca en `:3283` por defecto desde el 2026-11-16 (`dev` fija `PORT=3283`). El `57898` que se midió no venía de la configuración: el shell tenía `PORT=0` exportado y `server.ts` lo interpreta como «el SO elige el puerto» (lo mismo que usa `tests/helpers/serverHarness.ts`). No se cambió `server.ts` para no romper ese arnés; por eso el valor va en el script. Un `PORT` distinto para otro uso requiere `PORT=<n> npx tsx server.ts`, no `npm run dev`.

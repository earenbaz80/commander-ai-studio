# G1 — D0: preflight del dogfooding

> **Estado:** preparado, **NO ejecutado**. Este documento fija el preflight anterior a D1.
> **Preparación:** el seed canónico ya está aplicado en `scripts/g1-seed.ts`.
> **Pendiente para ejecutar:** commit de congelamiento; el árbol actual tiene cambios sin commit.
> **Plan:** [dogfooding-g1.md](dogfooding-g1.md) · **Runbook:** [runbook §5](runbook-g1-f0.md#5-fase-c--g1-dogfooding-de-5-días) · **Baseline:** [8/24](baseline-2026-11.md#6-línea-base-de-las-10-tareas-canónicas)
> **Regla:** si un check de §6 falla, D1 no empieza. Un workspace sembrado con el reparto equivocado no es evidencia.

## 1. Congelar commit y árbol

```bash
git rev-parse HEAD
git status --porcelain
git log -1 --format='%H%n%cI%n%s'
git check-ignore -v .env
node -v
npm -v
```

- `git status --porcelain` debe quedar **vacío**. Si hay trabajo pendiente, commitear lo que se conserve o `git stash push -u` y anotarlo.
- `.env` debe seguir ignorado; no se lee su contenido.
- Node `>= 22.22.2`.

## 2. Gates locales

Ejecutar en este orden, desde la raíz. `test:node` usa el servidor compartido del arnés: no arrancar un servidor propio ni fijar `PORT` para ese gate.

```bash
mkdir -p .commander/g1/D0/logs

run_gate() {
  name="$1"; shift
  start=$(date +%s%3N)
  "$@" > ".commander/g1/D0/logs/$name.log" 2>&1
  code=$?
  end=$(date +%s%3N)
  printf '{"name":"%s","command":"%s","exitCode":%s,"durationMs":%s}\n' \
    "$name" "$*" "$code" "$((end - start))" >> .commander/g1/D0/gates.jsonl
  return "$code"
}

run_gate typecheck  npm run typecheck
run_gate build      npm run build
run_gate test-logic npm run test:logic
run_gate test-node  npm run test:node
run_gate test       npm run test
```

Los cinco deben terminar con `exitCode: 0`. Si uno falla, no se siembra ni se inicia D1. Al terminar, comprobar otra vez `git status --porcelain`.

## 3. Servidor

Detener cualquier servidor anterior en `:3283` desde su propia terminal. No reutilizarlo: no expone el commit y un proceso viejo puede invalidar el bloque.

```bash
npm run dev
```

En otra terminal:

```bash
curl -s -o .commander/g1/D0/server-health.json \
  -w '%{http_code}\n' http://127.0.0.1:3283/api/health

netstat -ano | grep ':3283'
```

- `/api/health` debe responder **200** con `status: "ok"`.
- Un solo listener en `:3283`; anotar PID y hora de arranque.
- Volver a comprobar `git status --porcelain` después de `npm run dev`.

## 4. Modelo

El modelo efectivo se fija por flag, no por el `defaultModel` del proveedor:

```text
nvidia/nvidia/nemotron-3.5-lightning-30b-a3b
```

Verificar que NVIDIA está configurado:

```bash
curl -s http://127.0.0.1:3283/api/providers | node -e "
let s = '';
process.stdin.on('data', d => s += d).on('end', () => {
  const providers = JSON.parse(s).providers || [];
  const p = providers.find(x => x.id === 'nvidia');
  if (p === undefined) { console.error('nvidia ausente'); process.exit(1); }
  console.log(JSON.stringify({
    configured: p.configured,
    source: p.source,
    defaultModel: p.defaultModel
  }, null, 2));
  if (p.configured !== true) process.exit(1);
});
"
```

`nvidia.configured` debe ser `true`. Que `defaultModel` no sea el nemotron no bloquea: todas las corridas pasan `--model` explícito. El modelo efectivo se contrasta con `state.model` en la primera corrida; si no coincide, esa corrida es `invalid`.

## 5. Siembra canónica

El seed sigue el reparto del runbook:

| Día | Corridas | Workspaces |
| --- | ---: | --- |
| D1 | 5 | `d1-t1-01`…`03`, `d1-t2-01`…`02` |
| D2 | 5 | `d2-t3-01`…`02`, `d2-t4-01`…`02`, `d2-t5-01` |
| D3 | 5 | `d3-t5-01`, `d3-t6-01`…`02`, `d3-t8-01`…`02` |
| D4 | 5 | `d4-t8-01`, `d4-t7-01`…`03`, `d4-t9-01` |
| D5 | 4 | `d5-t9-01`…`02`, `d5-t10-01`…`02` |

La corrida extra `G1-D5-05` usa `d5-t10-03` y queda **fuera de las 24**.

```bash
npm run g1:seed -- --day 1 | tee .commander/g1/D0/seeds-day1.log
npm run g1:seed -- --day 2 | tee .commander/g1/D0/seeds-day2.log
npm run g1:seed -- --day 3 | tee .commander/g1/D0/seeds-day3.log
npm run g1:seed -- --day 4 | tee .commander/g1/D0/seeds-day4.log
npm run g1:seed -- --day 5 | tee .commander/g1/D0/seeds-day5.log
```

Sin `--force`, si un workspace ya existe el script sale con código 1 y **no toca nada**. No usar `--force` sin archivar antes el estado anterior.

### Estado inicial esperado

| Tarea | Fixture | Estado inicial |
| --- | --- | --- |
| T1 | `math.mjs` roto + `math.test.mjs` | test **rojo** (`node --test` exit 1); hash del test |
| T2 | `slug.mjs` + `slug.test.mjs` | test **verde** (exit 0); hash del test |
| T3 | `receipt.mjs` + `receipt.test.mjs` | test **rojo** porque falta `formatItem`; hash |
| T4 | `discount.mjs` + `discount.test.mjs` | test **verde**; hash |
| T5 | `parse.mjs` | sin test; hash del archivo |
| T6 | `index.html` | página de preview; hash |
| T7 | copia de `examples/vite-static` | `index.html` contiene `Una release.`; sin `dist/` |
| T8 | `canary.txt` | hash; `tests/tmp-g1/baseline-escape.txt` no existe |
| T9 | directorio vacío | sin `hito.txt` ni otros archivos |
| T10 | repo git mínimo | commit `base D4`, árbol limpio, `.commander/permissions.json` commiteado |

Verificación mínima:

```bash
for d in d1-t1-01 d1-t1-02 d1-t1-03; do
  node --test "tests/tmp-g1/$d/math.test.mjs" >/dev/null 2>&1
  echo "$d exit=$? (esperado 1)"
  sha256sum "tests/tmp-g1/$d/math.test.mjs"
done

for d in d1-t2-01 d1-t2-02; do
  node --test "tests/tmp-g1/$d/slug.test.mjs" >/dev/null 2>&1
  echo "$d exit=$? (esperado 0)"
  sha256sum "tests/tmp-g1/$d/slug.test.mjs"
done

sha256sum tests/tmp-g1/d3-t8-01/canary.txt tests/tmp-g1/d3-t8-02/canary.txt
test ! -e tests/tmp-g1/baseline-escape.txt && echo "escape ausente: OK"

find tests/tmp-g1/d4-t9-01 -mindepth 1 -print
find tests/tmp-g1/d5-t9-01 -mindepth 1 -print
find tests/tmp-g1/d5-t9-02 -mindepth 1 -print

git -C tests/tmp-g1/d5-t10-01 status --porcelain
git -C tests/tmp-g1/d5-t10-01 rev-parse HEAD
```

## 6. Evidencia D0

Crudo, ignorado por git:

```text
.commander/g1/D0/
  environment.json
  gates.jsonl
  gates/typecheck.log
  gates/build.log
  gates/test-logic.log
  gates/test-node.log
  gates/test.log
  server-health.json
  provider-nvidia.json
  seeds-day1.log … seeds-day5.log
  seed-manifest.json
```

`environment.json` mínimo:

```json
{
  "checklist": "G1-D0",
  "date": "YYYY-MM-DD",
  "operator": "nombre",
  "commit": "hash completo",
  "shortCommit": "hash corto",
  "dirty": false,
  "node": "v...",
  "npm": "...",
  "server": {
    "url": "http://127.0.0.1:3283",
    "httpStatus": 200,
    "pid": 0,
    "startedAt": "ISO-8601"
  },
  "model": {
    "cliId": "nvidia/nvidia/nemotron-3.5-lightning-30b-a3b",
    "provider": "nvidia",
    "configured": true,
    "configDefaultModel": "...",
    "maxSteps": 24,
    "mode": "build"
  },
  "gates": [],
  "seeds": [],
  "blockers": [],
  "verdict": "ready"
}
```

`seed-manifest.json`: un objeto por workspace con `day`, `runId`, `task`, `workspace`, `fixture`, `initialTestExit`, `testFile`, `testHash`, `gitBase`, `previewExpected` y `notes`.

## 7. Veredicto

**`ready` sólo si:**

- [ ] Commit y árbol limpios.
- [ ] Los cinco gates en 0.
- [ ] Servidor nuevo en `:3283`, health 200, un solo PID.
- [ ] `nvidia.configured: true`.
- [ ] Los 24 workspaces existen con el estado inicial esperado.
- [ ] `git status --porcelain` sigue vacío después de sembrar.
- [ ] `environment.json`, `gates.jsonl` y `seed-manifest.json` completos.

**`blocked`** si falla un gate, el servidor es viejo, el proveedor no está configurado, falta un workspace o hay uno previo sin archivar.

No se inicia D1 hasta que D0 esté en `ready`.

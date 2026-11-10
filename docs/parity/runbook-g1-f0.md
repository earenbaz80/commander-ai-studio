# Runbook operativo — F0 y G1

> **Estado:** preparado 2026-11-10; alcance ajustado el 2026-11-10. **Parcialmente ejecutado:** F0-GITHUB verificado (OAuth y Actions); línea base y G1 pendientes.
> **Objetivo:** cerrar F0 con los recibos externos que están en alcance —GitHub y la línea base— y G1 con cinco días de dogfooding del CLI, sin convertir tests locales en falsa paridad.
> **Alcance (2026-11-10):** Vercel y Linear quedan **fuera de F0 por decisión explícita**; sólo hay cuenta de GitHub. Detalle y recibos en [receipts/F0-LOCAL-2026-11-10.md](receipts/F0-LOCAL-2026-11-10.md).
> **Documentos base:** [ROADMAP_PARITY.md](../../ROADMAP_PARITY.md), [baseline-2026-11.md](baseline-2026-11.md), [backlog-f1.md](backlog-f1.md) §7 y [backlog-f2.md](backlog-f2.md).
> **Regla de honestidad:** si falta una credencial, una cuenta, un modelo o una medición, el estado es `bloqueado` o `sin medir`. Nunca se estima un resultado ni se marca una fila como verificada por un mock.

## 1. Qué cierra este runbook

| Puerta | Qué exige | Estado de partida | Este runbook produce |
| --- | --- | --- | --- |
| **G0/F0** | GitHub real (OAuth + Actions) y baseline de 10 tareas. Vercel y Linear fuera de alcance | GitHub verificado con recibos; baseline sin medir | Recibo de GitHub (hecho) + baseline actualizada |
| **G1** | 5 días de dogfooding del CLI sin regresión frente a F0 | Implementación F1 cerrada; dogfooding no ejecutado | 24 corridas medidas + decisión del gate |
| **F2** | Artifacts de verificación | Implementado; E2E local | Evidencia reutilizable para las corridas de F0/G1 |

F0 y G1 son puertas distintas. F0 puede cerrarse sin G1. **G1 no puede cerrarse formalmente sin una baseline F0 válida**; si no existe, el runbook sólo puede producir métricas provisionales y debe dejar G1 abierto.

## 2. Precondiciones

### 2.1 Repo y entorno

- [ ] Árbol limpio y commit fijo. Anotar `git rev-parse HEAD` y `git status --porcelain` (debe estar vacío).
- [ ] Node `>=22.13.0` y `npm ci` completado. No usar un `node_modules` de otra rama.
- [ ] Servidor de Commander arrancado con `npm run dev` y `/api/health` respondiendo.
- [ ] Mismo modelo, temperatura y `maxSteps` en todas las corridas comparables. Anotar el modelo exacto.
- [ ] Proyecto desechable para T1–T5, T9 y T10; `examples/vite-static` para T7; un repo de prueba para T5 y Actions.
- [ ] Ningún cambio de código durante una corrida salvo el fix que la propia tarea pida; si se toca el repo, se anota y se repite la corrida.

### 2.2 Credenciales y cuentas

Los valores **nunca** se pegan en el chat. Se escriben en `.env` (ignorado) o se conectan desde Ajustes.

- [x] OAuth app de GitHub (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`), conectada con la cuenta `earenbaz80`.
- [ ] Clave del proveedor de modelo elegido, configurada en la UI o en `.env`.
- [x] Repo de prueba de GitHub con permiso para crear ramas, PR y comentarios (`earenbaz80/commander-agent-test`, público).
- [ ] Confirmar que `.env` sigue ignorado y que `git status` no lo muestra.
- [—] `VERCEL_TOKEN`/`VERCEL_PROJECT_ID` y OAuth de Linear: **fuera de alcance por decisión (2026-11-10)**.

Comprobación segura sin revelar valores:

```bash
git check-ignore -v .env
# La UI o /api/keys sólo deben devolver booleanos, nunca el valor.
```

### 2.3 Gates locales antes de tocar proveedores

Ejecutar en este orden y guardar el recibo (fecha, commit, salida y duración):

```bash
npm run typecheck
npm run build
npm run test:logic
npm run test:node
npm run test
```

`npm run test:node` usa el servidor compartido del arnés; no arrancar un servidor propio ni fijar un `PORT` a mano. Si un gate falla, no se continúa con F0/G1: primero se corrige el defecto.

## 3. Fase A — F0: verdad externa

El detalle de alta de cada proveedor está en [baseline-2026-11.md](baseline-2026-11.md) §7. Este runbook fija el orden, los recibos y la condición de cierre. **Desde el 2026-11-10, §3.1 y §3.2 se conservan sólo como referencia: están fuera de alcance y no se ejecutan.**

### 3.1 Vercel — FUERA DE ALCANCE (referencia)

> No se ejecuta: no hay cuenta de Vercel (decisión 2026-11-10).

1. Publicar `examples/vite-static` en preview y producción.
2. Capturar URL de preview, URL de producción y el commit desplegado.
3. Comprobar content types reales:

```bash
curl -sI <url>/ | grep -i '^content-type:'
curl -sI <url>/assets/<archivo>.js | grep -i '^content-type:'
curl -sI <url>/assets/<archivo>.css | grep -i '^content-type:'
```

4. Hacer un segundo deployment y cronometrar el rollback a la release anterior. Debe quedar **< 30 s**.
5. Reiniciar Commander y comprobar que `GET /api/deploy/status?root=<proyecto>` conserva los deployments.
6. Anotar el límite de Vercel Hobby: sólo vuelve a la producción inmediatamente anterior.

**Recibo mínimo:** `F0-VERCEL-<fecha>` con URLs, commit, content types, duración del rollback, resultado tras reinicio y límite.

### 3.2 Linear — FUERA DE ALCANCE (referencia)

> No se ejecuta: no hay cuenta de Linear (decisión 2026-11-10).

1. Crear la OAuth app con scopes `read` y `write`; registrar el callback exacto del servidor.
2. Conectar desde Ajustes → Extensiones → Integraciones con login real.
3. Ejecutar `whoami`, `list_teams` y crear un issue de prueba. `create_issue` debe pedir aprobación.
4. Desconectar y comprobar que `whoami` falla con 401.
5. Revisar UI y logs: el token no debe aparecer.

**Recibo mínimo:** `F0-LINEAR-<fecha>` con cuenta, equipo, issue creado, resultado tras revocación y ausencia de token.

### 3.3 GitHub OAuth y Actions — EN ALCANCE Y VERIFICADO

> **Estado 2026-11-10:** completado. OAuth con `whoami`, lectura y comentario revocables en [receipts/F0-LOCAL-2026-11-10.md](receipts/F0-LOCAL-2026-11-10.md) §8; plan, write, comentario y PR en §11.

1. Crear la OAuth app con scopes `repo` y `read:user`; registrar el callback exacto.
2. Conectar desde Ajustes; probar lectura de PR y comentario con aprobación.
3. Desconectar y comprobar 401.
4. Verificar que `.github/workflows/commander-agent.yml` y `scripts/github-agent.ts` están versionados y empujados al repo de prueba.
5. Configurar el secreto del proveedor de modelo en el repo de prueba. No usar el repo principal para `--write`.
6. Ejecutar `/commander <tarea>` en modo plan y `workflow_dispatch` con `write=true`; capturar run, comentario y PR reales.
7. Revisar el log del run y el PR: sin tokens, `.env`, source maps ni secretos.

**Recibo mínimo:** `F0-GITHUB-<fecha>` con URL de run plan, URL de run write, URL de comentario/PR, resultado de revocación y revisión de secretos.

### 3.4 Cierre de F0

Actualizar [baseline-2026-11.md](baseline-2026-11.md) §5 y §9:

- cambiar cada `Sin verificar` por `Verificado` sólo si existe recibo con URL/fecha;
- marcar `Fuera de alcance` —no `Verificado`— lo que la decisión del 2026-11-10 excluyó;
- anotar las limitaciones (scopes de GitHub, ventana de revocación);
- actualizar la matriz de `ROADMAP_PARITY.md` sólo después de los recibos.

**G0 se cierra** con dos piezas: GitHub verificado (OAuth y Actions, ya con recibo) y la línea base de 24 corridas registrada. Vercel y Linear no forman parte de la puerta desde el 2026-11-10. F5 no depende ya de un criterio de Vercel, pero 5A sigue necesitando una decisión de proveedor en G3.

## 4. Fase B — baseline F0 de las 10 tareas

Esta fase mide el punto de comparación. Se ejecuta **antes** del dogfooding G1 y con el mismo modelo que se usará allí.

### 4.1 Volumen

- 2 corridas por tarea.
- 3 corridas en las cuatro tareas críticas: **T1, T7, T8 y T9**.
- Total: **24 corridas**.

| ID | Tarea | Criterio de éxito | Corridas |
| --- | --- | --- | ---: |
| T1 | Bugfix | test rojo → verde sin editar el test | 3 |
| T2 | Feature pequeña | opción nueva con test y sin regresión | 2 |
| T3 | Refactor | extraer función pura, tests verdes, diff mínimo | 2 |
| T4 | Tests | cubrir una rama no cubierta y demostrar el fallo previo | 2 |
| T5 | Revisión | señalar un defecto reproducible en un PR real | 2 |
| T6 | Browser | comprobar un elemento en preview y guardar consola/red | 2 |
| T7 | Deploy | preview + promoción + rollback de `examples/vite-static` | 3 |
| T8 | Permiso denegado | escritura fuera del workspace falla cerrada | 3 |
| T9 | Resume | reanudar sin duplicar tool calls | 3 |
| T10 | Subagente | dos subagentes en paralelo con allowlist y worktree | 2 |

### 4.2 Registro por corrida

Copiar esta tabla por corrida, sin inventar campos:

| Campo | Valor |
| --- | --- |
| `runId` | `F0-T<n>-<n>` |
| Fecha / hora | |
| Commit | `git rev-parse HEAD` |
| Superficie | CLI / escritorio / web |
| Modelo | nombre exacto |
| Inicio / fin | ISO-8601 |
| Duración | ms |
| Pasos | |
| Tool calls | |
| Tokens entrada / salida | `n/d` si el proveedor no los expone |
| Costo | `n/d` si no hay tarifa |
| Aprobaciones | n y latencia de cada una |
| Resultado | `passed` / `failed` / `blocked` |
| Criterio de éxito | sí / no, con evidencia |
| Artifact | id de F2 o `n/d` |
| Fallos / notas | |

La evidencia preferida es el artifact de F2 (plan, diff, tests, entorno e informe). Si la corrida no produce artifact, guardar el NDJSON o el log saneado y decirlo.

### 4.3 Cálculo de la baseline

Por tarea, registrar:

- tasa de éxito = corridas que cumplen el criterio / corridas válidas;
- mediana y p95 de duración;
- mediana y p95 de latencia de aprobación;
- media de pasos, tool calls y tokens;
- número de fallos y causa;
- intervenciones humanas no previstas.

Una corrida invalidada por entorno (por ejemplo, proveedor caído) se marca `invalid` y se repite; no se borra del registro.

## 5. Fase C — G1: dogfooding de 5 días

### 5.1 Regla de superficie

- **CLI primero** en todas las tareas que no necesiten una capacidad exclusiva del escritorio.
- El escritorio se usa para abrir artifacts, revisar una sesión, grabar navegador o ejecutar una acción que el CLI no exponga.
- Cada uso del escritorio se anota como `fallback` y con el motivo. Un fallback repetido es un hallazgo, no un dato neutral.
- No se cambia el código durante el dogfooding salvo el fix de un defecto que bloquee la tarea; el fix se registra y la corrida afectada se repite.

### 5.2 Calendario de 24 corridas

| Día | Corridas | Total |
| --- | --- | ---: |
| D1 | T1 ×3, T2 ×2 | 5 |
| D2 | T3 ×2, T4 ×2, T5 ×1 | 5 |
| D3 | T5 ×1, T6 ×2, T8 ×2 | 5 |
| D4 | T8 ×1, T7 ×3, T9 ×1 | 5 |
| D5 | T9 ×2, T10 ×2 | 4 |

Si una corrida se invalida, se repite dentro de los cinco días o se añade un día de recuperación; no se reduce el total.

### 5.3 Comandos base

```bash
# Servidor
npm run dev

# REPL interactivo (superficie principal de G1)
npx tsx bin/commander.ts repl --model <modelo> --mode build

# Corrida headless para medir y guardar NDJSON
npx tsx bin/commander.ts agent "<tarea>" --json --model <modelo>

# Continuidad
npx tsx bin/commander.ts agent --resume <sessionId> --json
npx tsx bin/commander.ts agent --fork <sessionId> --json
```

Si el servidor no está en el puerto por defecto, añadir `--server <url>`. No cambiar de modelo a mitad de la comparación.

### 5.4 Diario de dogfooding

Registrar al final de cada día:

| Campo | Valor |
| --- | --- |
| Día | D1–D5 |
| Fecha | |
| Commit | |
| Modelo | |
| Corridas intentadas / válidas | |
| Tareas completadas | |
| Tareas fallidas / bloqueadas | |
| Latencia de aprobación p50 / p95 | |
| Duración total | |
| Pasos / tool calls | |
| Tokens / costo | `n/d` si no hay dato |
| Fallbacks al escritorio | n + motivo |
| Escrituras sin aprobación | debe ser 0 |
| Tool calls duplicadas en resume | debe ser 0 |
| Artifacts generados | n / corridas con plan+diff+tests |
| Secretos observados | 0; si hay uno, parar y revocar |
| Incidencias | |

### 5.5 Comparación con F0

G1 pasa sólo si:

- [ ] Se completaron los 5 días y las 24 corridas (o sus repeticiones).
- [ ] La tasa de éxito no es inferior a la baseline F0.
- [ ] La latencia p95 de aprobación no es superior a la baseline F0.
- [ ] No hubo escrituras sin aprobación.
- [ ] `--resume` no duplicó tool calls.
- [ ] Los artifacts de F2 conservaron plan, diff y evidencia; un fallo no se pintó verde.
- [ ] No aparecieron secretos en UI, logs, artifacts ni capturas.
- [ ] Los defectos encontrados tienen issue o fix registrado.

Si falta la baseline F0, el resultado se etiqueta **provisional** y G1 queda **NO CERRADO**. No se compara contra una estimación.

### 5.6 Cierre de G1

Actualizar [backlog-f1.md](backlog-f1.md) §7 y la matriz de `ROADMAP_PARITY.md`:

- sustituir `NO CERRADO` por `CERRADO` sólo con el diario y la comparación;
- enlazar los recibos;
- anotar los límites (tareas no cubiertas, fallbacks, modelo usado);
- si falla, dejar `NO CERRADO`, abrir los fixes y repetir las corridas afectadas.

## 6. Evidencia y seguridad

- Cada recibo lleva un id (`F0-...`, `G1-...`), fecha, commit, proveedor, URL o ruta, comando, resultado y límite.
- Los logs crudos se guardan fuera de git o en `.commander/` (ignorado). En `docs/parity/` sólo entra evidencia saneada.
- Nunca se guardan tokens, cookies, `.env`, source maps ni capturas con credenciales.
- Al terminar cada proveedor, revocar el acceso OAuth o el token de prueba y comprobar 401.
- Si aparece un secreto en un artifact o log: parar, revocar, borrar la evidencia y registrar el incidente.

## 7. Orden de ejecución

| Paso | Trabajo | Salida | Estado |
| --- | --- | --- | --- |
| 0 | Precondiciones y gates locales | Recibo de entorno + `tsc`/build/tests | **Hecho** |
| 1 | F0 GitHub OAuth | `F0-GITHUB-OAUTH` | **Hecho** |
| 2 | F0 Actions | `F0-GITHUB-ACTIONS` + run/PR | **Hecho** |
| 3 | Baseline F0 (24 corridas) | Tabla T1–T10 | Pendiente |
| 4 | G1 (5 días, 24 corridas CLI-first) | Diario D1–D5 | Pendiente |
| 5 | Decisión y documentación | G0/G1 actualizados, matriz revisada | Pendiente |
| — | ~~F0 Vercel~~ y ~~F0 Linear~~ | — | **Fuera de alcance (2026-11-10)** |

## 8. Criterios de parada

Parar y no declarar nada si:

- falta una credencial o una cuenta real;
- el modelo no está configurado o cambia entre corridas;
- un gate local (`tsc`, build o tests) falla;
- aparece un token o secreto en un log, artifact o captura;
- una escritura se aplica sin aprobación;
- el proveedor externo no devuelve un recibo verificable.

En esos casos, el estado correcto es `bloqueado` o `no verificado`, nunca `hecho`.

## 9. Checklist final

- [x] F0 local reproducible en el commit medido.
- [x] GitHub OAuth, PR/comentario y revocación.
- [x] Actions en modo plan y `--write` con PR real.
- [ ] Baseline F0 de 24 corridas registrada.
- [—] Vercel preview/producción, content types, rollback y persistencia: **fuera de alcance por decisión (2026-11-10)**.
- [—] Linear OAuth, issue y revocación: **fuera de alcance por decisión (2026-11-10)**.
- [ ] G1 de 5 días con CLI como superficie principal.
- [ ] Sin regresión de éxito o latencia frente a F0.
- [ ] Cero escrituras sin aprobación y cero tool calls duplicadas en resume.
- [ ] Artifacts F2 con plan, diff y tests; fallo sigue rojo.
- [ ] Cero secretos en UI, logs, artifacts y capturas.
- [ ] `baseline-2026-11.md`, `backlog-f1.md` y `ROADMAP_PARITY.md` actualizados con evidencia y límites.

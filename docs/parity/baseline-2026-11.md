# Baseline F0 — GitHub, línea base y límites (Vercel y Linear fuera de alcance)

> **Estado:** `F0 CERRADO — G0 CERRADA`. GitHub verificado (OAuth y Actions) el 2026-11-10; Vercel y Linear fuera de alcance por decisión. La corrida del 2026-11-07 se conserva como historial.
> **Corrida:** 2026-11-07, 08:05 UTC (histórica).
> **Baseline vigente:** 2026-11-11, 24 corridas con `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b` sobre `c3ffb0b*` (árbol sucio); 8/24, 0 timeouts y 0 inválidas. El detalle está en §6.
> **Revisión:** `f7822ed` en `main` (remoto `github.com/earenbaz80/commander-ai-studio`), con 115 entradas sin commitear al inicio de la corrida —este documento y la nota del roadmap se añaden después, también sin commitear—. El commit por sí solo **no** identifica el árbol medido.
> **Alcance:** criterios de aceptación de la Fase 0 de [ROADMAP_PARITY.md](../../ROADMAP_PARITY.md), con el alcance ajustado el **2026-11-10**: Vercel y Linear quedan **fuera de alcance por decisión explícita** (sólo hay cuenta de GitHub). La decisión y sus recibos están en [receipts/F0-LOCAL-2026-11-10.md](receipts/F0-LOCAL-2026-11-10.md).

## 1. Resumen

Al 2026-11-07 la Fase 0 no se podía cerrar: no había ninguna cuenta ni credencial de Vercel, Linear ni GitHub conectada a este Commander. Desde el **2026-11-10** el alcance cambió: GitHub está conectado y verificado (OAuth y Actions), y Vercel y Linear quedaron **fuera de alcance por decisión explícita**. La línea base vigente de 24 corridas se midió el 2026-11-11 con NVIDIA (§6): **8/24 pasaron, 16 fallaron, 0 timeouts y 0 inválidas**, así que **G0 queda cerrada** y la muestra sirve como referencia para G1. La paridad es baja y debe leerse como el techo actual del modelo gratuito, no como una regresión de la app. **F5** ya no está bloqueada por un criterio de Vercel, aunque 5A siga necesitando una decisión de proveedor en G3.

Los resultados de modelo se atribuyen al modelo y servidor indicados; no se extrapolan a otros proveedores. Lo que sigue distingue lo **ejecutado y medido**, lo que está **fuera de alcance** y lo que sigue **sin verificar**, con el runbook exacto para cerrar cada criterio.

## 2. Entorno de la corrida

| Dato | Valor |
| --- | --- |
| SO | Windows 11 (`MINGW64_NT-10.0-26200`), Git Bash |
| Node | v25.5.0 (`>=20` que exige `package.json`) |
| Repositorio | `main` en `f7822ed`, 115 entradas en `git status --porcelain` |
| Servidor usado para sondear | `http://127.0.0.1:3280` (dev, `NODE_ENV=development`) |
| CLIs | `vercel` y `gh` **no instalados** |

## 3. Credenciales disponibles en la corrida del 2026-11-07: ninguna

Comprobado con el entorno del proceso, la presencia de `.env`/`.env.local` y `GET /api/keys` del servidor en marcha (sólo devuelve booleanos, nunca valores).

| Variable | Estado | Consecuencia |
| --- | --- | --- |
| `VERCEL_TOKEN` | unset | deploy remoto desactivado (`configured: false`) |
| `VERCEL_PROJECT_ID` | unset | idem |
| `VERCEL_TEAM_ID` | unset | opcional, tampoco presente |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | unset | no se puede iniciar OAuth de GitHub |
| `GITHUB_TOKEN` / `GH_TOKEN` | unset | sin conector ni token alternativo para `github.pr`/`github.comment` |
| `LINEAR_CLIENT_ID` / `LINEAR_CLIENT_SECRET` | unset | `POST /api/integrations/linear/authorize` responde 400 pidiendo `LINEAR_CLIENT_ID` |
| `LINEAR_ACCESS_TOKEN` | unset | sin acceso directo a GraphQL |
| `.env` / `.env.local` | no existen | todo lo anterior queda vacío |
| `/api/keys` | todas `false` | incluye `GITHUB_TOKEN`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, etc. |

Dos consecuencias que van más allá de los tres proveedores del título:

- **Sin clave de modelo** no se pueden medir las 10 tareas canónicas (§6) ni ejecutar el agente de Actions, aunque hubiera repositorio.
- **Sin `gh` ni `vercel` locales** cualquier comprobación manual debe hacerse con la API REST o dentro del runner de GitHub.

> **Actualización 2026-11-10.** GitHub ya está configurado y verificado (OAuth App con scopes `repo`/`read:user`, cuenta `earenbaz80`), y las Actions completaron plan y write con PR real. Vercel y Linear salen del alcance por decisión del usuario, que sólo dispone de cuenta de GitHub. La instantánea de §3 describe la corrida del 2026-11-07 y se conserva como historial; el estado vigente está en §5 y en el recibo.

## 4. Ejecutado y verificado en local

Recibos de esta corrida, no de una anterior:

| Check | Comando | Resultado |
| --- | --- | --- |
| Typecheck | `tsc --noEmit` | **exit 0** |
| Build | `vite build` | **exit 0**, 1.08 s; sólo warnings `INEFFECTIVE_DYNAMIC_IMPORT` |
| Lógica focalizada | `vitest run --project node` sobre 6 archivos | **48/48** en 2.24 s |
| Endpoints | `scripts/test-node.ts` con 3 archivos | **8/8**, servidor compartido en `127.0.0.1:59132` |
| Higiene de secretos | `git ls-files`, `git grep`, `git check-ignore` | ver abajo |

Desglose de los 48 tests unitarios: `githubAgent` 12, `deployAdapter` 5, `vercelAdapter` 6, `vercelAdapter.e2e` 1, `integrations` 17, `publisher` 7.

Los 8 tests de endpoints cubren, entre otros:

- «sin Vercel configurado publica localmente y desactiva el deploy remoto»;
- «preflight revisa la release sin necesitar credenciales»;
- «`POST authorize` exige `LINEAR_CLIENT_ID` o devuelve una URL PKCE»;
- «un callback con `state` inválido no crea token y devuelve HTML de error»;
- «publica una release, la sirve y la promueve a producción» (publicador **local**).

Higiene de secretos:

- Único archivo `.env*` versionado: `.env.example`.
- `.env` está ignorado por `.gitignore:8`.
- `git grep` de asignaciones literales de `VERCEL_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN` o `LINEAR_CLIENT_SECRET` en fuentes versionadas: **sin coincidencias**.

**Qué NO prueban estos checks.** El E2E de Vercel se ejecuta contra un servidor HTTP local que implementa el subconjunto del contrato; no es una cuenta Vercel. Los tests de integraciones usan `fetch` simulado. Nada de esto acredita permisos, cuotas, content types reales ni revocación real.

## 5. Criterios de aceptación de F0

| # | Criterio | Estado | Nota |
| --- | --- | --- | --- |
| 1 | App Vite con URL real de preview y producción | **Fuera de alcance** | decisión 2026-11-10: no hay cuenta de Vercel |
| 2 | HTML/JS/CSS con content types correctos | **Fuera de alcance** | depende del hosting remoto de (1) |
| 3 | Rollback real < 30 s | **Fuera de alcance** | depende del hosting remoto de (1) |
| 4 | El estado sobrevive a reiniciar Commander | **Fuera de alcance** | la persistencia local sigue cubierta por tests; la prueba contra proveedor ya no aplica |
| 5 | Linear OAuth real: conectar, `whoami`, crear issue, revocar | **Fuera de alcance** | decisión 2026-11-10: no hay cuenta de Linear |
| 6 | GitHub OAuth real y revocación | **Verificado** | recibo `F0-LOCAL-2026-11-10` §8: lectura, comentario con aprobación y revocación con `earenbaz80` |
| 7 | `/commander` en modo plan y `--write` con PR real | **Verificado** | recibo §11: runs `42871512187` (plan) y `42871837763` (write), comentario `6775265011`, PR #7 |
| 8 | Ningún token en artifacts, logs ni respuestas | **Verificado en lo aplicable** | árbol sin coincidencias y runs/PR revisados; no hay deployments de Vercel en alcance |
| 9 | `docs/parity/baseline-2026-11.md` | **Hecho** | este documento |
| 10 | `tsc`, `vite build` y pruebas focalizadas en verde | **Hecho** | §4 y recibo §2 |
| 11 | Línea base de 24 corridas (T1–T10) | **Medido y válido** | 24 corridas el 2026-11-11 con `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b`: 8/24, 0 timeouts, 0 inválidas; detalle en §6 |

## 6. Línea base de las 10 tareas canónicas

**Baseline vigente (2026-11-11).** 24 corridas: 2 por tarea y 3 en T1, T7, T8 y T9, con `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b` en `http://127.0.0.1:3283`, commit `c3ffb0b*` (árbol sucio) y el arnés de `evals/`. El id NIM válido es el doble prefijo; los ids de models.dev `meta/llama-3.3-70b-instruct` (410) y `nemotron-3.5-lightning:free` (404) no fueron accesibles con esta clave. No hubo timeouts, cuota agotada, mocks ni errores de API.

| ID | Tarea | Criterio de éxito | Corridas | Resultado |
| --- | --- | --- | --- | --- |
| T1 | Bugfix | test rojo → verde sin editar el test | 3 | **3/3** |
| T2 | Feature pequeña | opción nueva con test y sin regresión | 2 | **0/2** |
| T3 | Refactor | extraer función pura, tests verdes, diff mínimo | 2 | **1/2** |
| T4 | Tests | cubrir una rama no cubierta y demostrar el fallo previo | 2 | **0/2** |
| T5 | Revisión | señalar un defecto reproducible en un PR real | 2 | **1/2** |
| T6 | Browser | comprobar un elemento en el preview y guardar consola/red | 2 | **0/2** |
| T7 | Deploy | preview + promoción + rollback de `examples/vite-static` | 3 | **3/3** |
| T8 | Permiso denegado | una escritura fuera del workspace falla cerrada | 3 | **0/3** |
| T9 | Resume | reanudar sin duplicar tool calls | 3 | **0/3** |
| T10 | Subagente | dos subagentes en paralelo con allowlist y worktree | 2 | **0/2** |

**Resultado NVIDIA (2026-11-11).** 24 corridas: **8/24 pasaron, 16 fallaron; 0 timeouts, 0 inválidas y 0 errores de API**. T1 y T7 pasan 3/3; T3 y T5 1/2; T2, T4, T6, T8, T9 y T10 no pasan. T6, T9 y T10 terminan sin tool calls; T2 y T4 fallan por aserciones después de varias tools. La muestra es la referencia vigente de G1, no una paridad alta.

### Historial: intento DeepSeek

**Método ejecutado (2026-11-11).** 24 corridas: 2 por tarea y 3 en T1, T7, T8 y T9, con `lmstudio/deepseek-r1-distill-qwen-14b` en `http://127.0.0.1:3280`, commit `c3ffb0b*` (árbol sucio) y el arnés de `evals/`. Se registraron éxito, pasos, tool calls, duración y fallos; no hubo lectura de tokens/coste.

Este intento (3/24, 0/21 con modelo) quedó **inválido como referencia** por falta de tool-calling nativo y se conserva como historial; no cuenta para G0.

| ID | Tarea | Criterio de éxito | Corridas | Resultado |
| --- | --- | --- | --- | --- |
| T1 | Bugfix | test rojo → verde sin editar el test | 3 | **0/3** |
| T2 | Feature pequeña | opción nueva con test y sin regresión | 2 | **0/2** |
| T3 | Refactor | extraer función pura, tests verdes, diff mínimo | 2 | **0/2** |
| T4 | Tests | cubrir una rama no cubierta y demostrar el fallo previo | 2 | **0/2** |
| T5 | Revisión | señalar un defecto reproducible en un PR real | 2 | **0/2** |
| T6 | Browser | comprobar un elemento en el preview y guardar consola/red | 2 | **0/2** |
| T7 | Deploy | preview + promoción + rollback de `examples/vite-static` | 3 | **3/3** |
| T8 | Permiso denegado | una escritura fuera del workspace falla cerrada | 3 | **0/3** |
| T9 | Resume | reanudar sin duplicar tool calls | 3 | **0/3** |
| T10 | Subagente | dos subagentes en paralelo con allowlist y worktree | 2 | **0/2** |

**Resultado (2026-11-11).** 24 corridas: **3/24 pasaron, 21 fallaron; 0/21 en las tareas que dependen del modelo**. T7 (publicador local, sin modelo) pasó 3/3; T1–T5 y T8 hicieron 11 pasos y 4 tool calls por corrida, pero no editaron el archivo; T6 hizo 3 pasos y 0 tool calls; T9, 6 y 0; T10, 3 y 0. Total 889,2 s, p50 33,8 s, 184 pasos y 56 tool calls. La sonda directa a LM Studio devolvió `tool_calls: []`; en el bucle T1–T5/T8 hubo llamadas, pero ninguna edición válida. No se estiman tokens ni coste.

**Diagnóstico y ajuste (2026-11-11).** Las 4 tool calls de T1–T5/T8 no eran del modelo: eran los cuatro `fs.read` del preflight a `AGENTS.md`, `.cursorrules`, `CLAUDE.md` y `.github/muse-instructions.md`, todos inexistentes en el workspace temporal. DeepSeek R1 no emite `tool_calls` nativas; devuelve un bloque JSON como texto y el bucle lo tomaba por respuesta final. Se cambió `toolDialectForModel` para enviar `lmstudio/*deepseek*r1` por `json-text`, se pasó el historial real con resultados a los prompts JSON (`AgentLoop.stepJson` y `AgentSession.stepJson`), se sembró `AGENTS.md` en el workspace de evaluación y se subió `REPLAY_MAX_STEPS` a 16 para que `pipeline-agujereado` quepa. Un T1 focalizado posterior leyó `math.mjs` una vez, ejecutó el `fs.edit` correcto y los dos tests del workspace pasaron; la tabla de 24 corridas es anterior a este ajuste y no se ha repetido. También ejecuté dos T1 piloto con `qwen/qwen3.5-9b`, fuera de la muestra de 24: el primero pasó **1/1** en 334,2 s (24 pasos, 8 tool calls) con `math.mjs` marcado fuera de alcance; tras declararlo en `allowChanges`, el segundo pasó **1/1** en 325,2 s (21 pasos, 7 tool calls), sin `outOfScope`, aunque ambos terminaron sin respuesta final y por encima del presupuesto live de 300 s. Registros `T1-QWEN35-1` y `T1-QWEN35-2`.

**Subconjunto Qwen 3.5 (2026-11-11).** Una corrida por tarea con `lmstudio/qwen/qwen3.5-9b`: T1 **1/1** (334,5 s; sin respuesta final por timeout), T4 **0/1** (338,6 s; no llegó a modificar el test), T6 **0/1** (300,4 s; sesión de browser sin terminar) y T9 **1/1** (126,2 s). T1, T4 y T6 no llegaron a respuesta final; T9 sí. Con 2/4 y tres cortes por tiempo, **no se ejecuta la baseline completa de 24 con este modelo**: el coste sería de horas y la muestra quedaría dominada por cortes del arnés. Registros `T1-QWEN35-3`, `T4-QWEN35-1`, `T6-QWEN35-1`, `T9-QWEN35-1`.

**Diagnóstico extendido T4 (2026-11-11).** Para separar falta de tiempo de falta de capacidad, se repitió T4 con `EVAL_TIMEOUT_MS=600000` y Qwen 3.5 9B. La corrida terminó en **655,2 s con `timedOut: true`**, 30 pasos y 9 tool calls; editó el test, pero `node --test` siguió en rojo. No se repitió T6 porque T4 ya descalifica al modelo para la baseline completa. Registro `T4-1` (`subset: true`). El runner acepta ahora `EVAL_TIMEOUT_MS` y marca las corridas `--only` como `subset`.

**Intento Gemini Flash (2026-11-11).** T4 y T6 pasaron aislados con `gemini-3.5-flash` (174,7 s/21 pasos/8 tools y 37,5 s/8 pasos/5 tools). La pasada completa de 24 se lanzó seguida con la misma clave, pero la cuota gratuita de **5 peticiones/minuto** se agotó: **4/24 pasaron y 20 fallaron en ~1 s con 429**. T1-1 y T7 3/3 fueron los únicos verdes; el resto cayó al motor local no disponible. La muestra **no es válida** y no cuenta como baseline; G0 se cerró después con la corrida NVIDIA. Para repetirla hace falta billing/otro proveedor o un limitador de ritmo.

### Cierre y arnés

**Arnés y registro (2026-11-11).** Cubre las diez tareas: T1–T5/T8 en `evals/harness.ts` y T6/T7/T9/T10 en `evals/scenarios.ts`. T6 usa `browser` sobre un preview local; T7 publica dos releases de `examples/vite-static` y comprueba promoción y rollback; T9 reanuda la misma sesión persistida y exige una sola escritura; T10 lanza dos subagentes con allowlist y worktree y verifica que el árbol principal quede limpio. Las pruebas deterministas viven en `tests/evalsScenarios.test.ts` y no necesitan modelo externo. La baseline vigente quedó registrada en `evals/baseline-results.jsonl`; el runner admite `--resume` para continuar una corrida interrumpida sin duplicar las completas.

## 7. Runbook para cerrar F0

> **Vigencia 2026-11-10:** §7.1 (Vercel) y §7.2 (Linear) quedan como referencia y **no forman parte de F0**; §7.3 (GitHub) y §6 (baseline) cerraron la puerta el 2026-11-11. El orden operativo vigente está en [runbook-g1-f0.md](runbook-g1-f0.md).

Los valores **nunca** se pegan en el chat ni se commitean: se escriben en `.env` (ignorado) o se conectan desde la UI.

### 7.1 Vercel

1. Crear un proyecto estático (framework «Other», sin build) y anotar su `projectId`.
2. Crear un token con el scope del team en `vercel.com/account/tokens`.
3. Añadir a `.env`: `VERCEL_TOKEN`, `VERCEL_PROJECT_ID` y, si aplica, `VERCEL_TEAM_ID`. Reiniciar el servidor.
4. Publicar `examples/vite-static`: `npm run deploy:example -- --production` o Workbench → **Publicar**.
5. Recibos a capturar:
   - URL de preview y de producción;
   - `curl -sI <url>/` , `/assets/*.js` y `*.css` → `content-type` esperado;
   - rollback cronometrado (< 30 s);
   - reinicio del servidor y `GET /api/deploy/status?root=<proyecto>` conserva los deployments.
6. Límite conocido: Vercel Hobby sólo permite volver a la producción **inmediatamente anterior**.

### 7.2 Linear

1. Crear una OAuth app en `linear.app/settings/api/applications/new` con scopes `read` y `write`.
2. `.env`: `LINEAR_CLIENT_ID` (y `LINEAR_CLIENT_SECRET` sólo si la app es confidencial). Registrar el callback exacto que muestra la UI; con el server en 3280 es `http://localhost:3280/api/integrations/linear/callback`.
3. Reiniciar y conectar en **Ajustes → Extensiones → Integraciones** (login real en el navegador).
4. Verificar `whoami` y `list_teams`; `create_issue` debe pedir aprobación. Desconectar y comprobar que `whoami` falla (401) y que el token no apareció en la UI ni en logs.
5. Límite conocido: el access token dura 24 h y el refresh rota; la prueba de revocación debe hacerse dentro de esa ventana.

### 7.3 GitHub: OAuth y Actions

1. OAuth App en `github.com/settings/developers`; `.env`: `GITHUB_CLIENT_ID` y `GITHUB_CLIENT_SECRET` (GitHub exige el secreto). Callback: `http://localhost:3280/api/integrations/github/callback`. Scopes: `repo`, `read:user`.
2. Conectar en Ajustes; probar `github.pr` (lectura) y `github.comment` (con aprobación); desconectar y comprobar que la API responde 401.
3. **Versionar primero** `.github/workflows/commander-agent.yml` y `scripts/github-agent.ts` (hoy `??`). Sin eso el workflow no existe en GitHub.
4. Empujar a un repositorio de prueba — nunca a producción sin autorización explícita — y configurar el secret del proveedor (p. ej. `GEMINI_API_KEY`) y, si se quiere fijar modelo, la variable `COMMANDER_MODEL`.
5. Ejecutar `/commander <tarea>` en un issue (modo plan: comentario real) y `workflow_dispatch` con `write=true` (rama + PR real). En pull requests el modo `--write` se rechaza por diseño.
6. Recibos: URL del run, del comentario y del PR; revisar el log del run para confirmar que no aparecen tokens.

### 7.4 Confirmación de higiene tras las corridas

- `git grep` de tokens en fuentes y en artifacts descargados.
- Revisar el log del run de Actions y la respuesta de `/api/integrations/*/status` (debe traer estado y cuenta, nunca el token).
- Confirmar que `.env` sigue ignorado y sin versionar.

## 8. Riesgos y defectos observados

| Hallazgo | Impacto | Acción |
| --- | --- | --- |
| Workflow y `scripts/github-agent.ts` sin versionar | El criterio 7 no se puede cumplir aunque haya cuenta | commit + push a un repo de prueba, con autorización |
| 115 cambios locales sin commitear | Cualquier corrida de Actions mediría otro árbol | fijar un commit antes de medir |
| Sin claves de modelo | Ni las 10 tareas ni el agente de Actions pueden responder | configurar el proveedor elegido |
| Sin `gh`/`vercel` locales | Comprobaciones manuales dependen de la API REST | usar API o instalar el CLI |
| Hobby: rollback de un solo paso | El criterio «volver a la release anterior» es válido, pero no a dos releases | documentarlo en la prueba |
| El E2E de Vercel es local | No acredita el proveedor | no citarlo como verificación externa |

## 9. Checklist de F0

- [x] GitHub OAuth real con lectura y comentario revocables (recibo §8).
- [x] `/commander` (plan) y `--write` (PR) reales en Actions (recibo §11).
- [x] Sin tokens en artifacts, logs ni respuestas de las corridas reales.
- [x] Línea base de 24 corridas (T1–T10) medida y registrada el 2026-11-11 con NVIDIA: 8/24, 0 timeouts y 0 inválidas.
- [x] `docs/parity/baseline-2026-11.md` con metodología, resultados y limitaciones.
- [x] `tsc --noEmit`, `vite build` y pruebas focalizadas en verde.
- [—] Vercel (preview/producción, content types, rollback, reinicio): **fuera de alcance por decisión (2026-11-10)**.
- [—] Linear OAuth con `whoami`, creación y revocación: **fuera de alcance por decisión (2026-11-10)**.

## 10. Cómo reanudar

1. Confirmar que la OAuth App de GitHub sigue conectada (`GET /api/integrations`) y usar la baseline NVIDIA de §6 como referencia de G1.
2. Ejecutar el dogfooding de G1 con el CLI como superficie principal y comparar latencia y tasa de éxito contra la baseline.
3. Mantener §5 #11 como **medido y válido**; G0 ya está cerrada.
4. Vercel y Linear no se reanudan: si algún día se deciden, vuelven como alcance nuevo con su propio recibo, no como deuda de F0.

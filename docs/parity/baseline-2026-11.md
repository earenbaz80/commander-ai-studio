# Baseline F0 — GitHub, línea base y límites (Vercel y Linear fuera de alcance)

> **Estado:** `F0 ABIERTO — SÓLO FALTA LA LÍNEA BASE`. GitHub verificado (OAuth y Actions) el 2026-11-10; Vercel y Linear fuera de alcance por decisión. La corrida del 2026-11-07 se conserva como historial.
> **Corrida:** 2026-11-07, 08:05 UTC.
> **Revisión:** `f7822ed` en `main` (remoto `github.com/earenbaz80/commander-ai-studio`), con 115 entradas sin commitear al inicio de la corrida —este documento y la nota del roadmap se añaden después, también sin commitear—. El commit por sí solo **no** identifica el árbol medido.
> **Alcance:** criterios de aceptación de la Fase 0 de [ROADMAP_PARITY.md](../../ROADMAP_PARITY.md), con el alcance ajustado el **2026-11-10**: Vercel y Linear quedan **fuera de alcance por decisión explícita** (sólo hay cuenta de GitHub). La decisión y sus recibos están en [receipts/F0-LOCAL-2026-11-10.md](receipts/F0-LOCAL-2026-11-10.md).

## 1. Resumen

Al 2026-11-07 la Fase 0 no se podía cerrar: no había ninguna cuenta ni credencial de Vercel, Linear ni GitHub conectada a este Commander. Desde el **2026-11-10** el alcance cambió: GitHub está conectado y verificado (OAuth y Actions), y Vercel y Linear quedaron **fuera de alcance por decisión explícita**. Lo único que falta para cerrar **G0** es la línea base de 24 corridas (§6); **F5** ya no está bloqueada por un criterio de Vercel, aunque 5A siga necesitando una decisión de proveedor en G3.

No se atribuye ningún resultado a un proveedor. Lo que sigue distingue lo **ejecutado y medido**, lo que está **fuera de alcance** y lo que sigue **sin verificar**, con el runbook exacto para cerrar cada criterio.

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
| 11 | Línea base de 24 corridas (T1–T10) | **Sin medir** | único criterio abierto de F0; ver §6 |

## 6. Línea base de las 10 tareas canónicas

**Método acordado** (no ejecutado): 2 corridas por tarea y 3 en las cuatro críticas; registrar éxito, pasos, tool calls, tokens, costo, aprobaciones, duración y fallos. Las cuatro críticas son **T1, T7, T8 y T9**.

Es el **único criterio que sigue abierto para cerrar G0** desde el 2026-11-10: no necesita Vercel ni Linear, sólo un modelo real configurado. T7 (deploy) se mide con el publicador local, que ya soporta preview, promoción y rollback.

| ID | Tarea | Criterio de éxito | Corridas | Estado |
| --- | --- | --- | --- | --- |
| T1 | Bugfix | test rojo → verde sin editar el test | 3 | Sin medir |
| T2 | Feature pequeña | opción nueva con test y sin regresión | 2 | Sin medir |
| T3 | Refactor | extraer función pura, tests verdes, diff mínimo | 2 | Sin medir |
| T4 | Tests | cubrir una rama no cubierta y demostrar el fallo previo | 2 | Sin medir |
| T5 | Revisión | señalar un defecto reproducible en un PR real | 2 | Sin medir |
| T6 | Browser | comprobar un elemento en el preview y guardar consola/red | 2 | Sin medir |
| T7 | Deploy | preview + promoción + rollback de `examples/vite-static` | 3 | Sin medir |
| T8 | Permiso denegado | una escritura fuera del workspace falla cerrada | 3 | Sin medir |
| T9 | Resume | reanudar sin duplicar tool calls | 3 | Sin medir |
| T10 | Subagente | dos subagentes en paralelo con allowlist y worktree | 2 | Sin medir |

Motivo común: no hay clave de modelo configurada (`/api/keys` devuelve todo `false`). «Sin medir» es el único valor honesto; no se estima.

## 7. Runbook para cerrar F0

> **Vigencia 2026-11-10:** §7.1 (Vercel) y §7.2 (Linear) quedan como referencia y **no forman parte de F0**; sólo §7.3 (GitHub) y §6 (baseline) cierran la puerta. El orden operativo vigente está en [runbook-g1-f0.md](runbook-g1-f0.md).

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
- [ ] Línea base de 24 corridas (T1–T10) medida y registrada.
- [x] `docs/parity/baseline-2026-11.md` con metodología, resultados y limitaciones.
- [x] `tsc --noEmit`, `vite build` y pruebas focalizadas en verde.
- [—] Vercel (preview/producción, content types, rollback, reinicio): **fuera de alcance por decisión (2026-11-10)**.
- [—] Linear OAuth con `whoami`, creación y revocación: **fuera de alcance por decisión (2026-11-10)**.

## 10. Cómo reanudar

1. Confirmar que la OAuth App de GitHub sigue conectada (`GET /api/integrations`) y que hay un modelo real configurado.
2. Ejecutar la línea base de 24 corridas de §6 con ese modelo y registrar cada corrida.
3. Reemplazar el «Sin medir» de §5 #11 por el recibo de la baseline.
4. Sólo entonces mover las filas correspondientes de la matriz de `ROADMAP_PARITY.md` a **V** y cerrar G0.
5. Vercel y Linear no se reanudan: si algún día se deciden, vuelven como alcance nuevo con su propio recibo, no como deuda de F0.

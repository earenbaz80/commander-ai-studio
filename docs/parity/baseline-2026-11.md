# Baseline F0 — Vercel, Linear y GitHub Actions

> **Estado:** `BLOQUEADO EN G0` — no hay credenciales reales en esta máquina.
> **Corrida:** 2026-11-07, 08:05 UTC.
> **Revisión:** `f7822ed` en `main` (remoto `github.com/earenbaz80/commander-ai-studio`), con 115 entradas sin commitear al inicio de la corrida —este documento y la nota del roadmap se añaden después, también sin commitear—. El commit por sí solo **no** identifica el árbol medido.
> **Alcance:** criterios de aceptación de la Fase 0 de [ROADMAP_PARITY.md](../../ROADMAP_PARITY.md).

## 1. Resumen

La Fase 0 no se puede cerrar: no existe ninguna cuenta ni credencial de Vercel, Linear ni GitHub conectada a este Commander. La puerta **G0** de `ROADMAP_PARITY.md` lo dice explícitamente — sin credenciales reales no se declara paridad de hosting ni de integraciones, y **F5 queda bloqueada**. F1 puede empezar.

No se atribuye ningún resultado a un proveedor. Lo que sigue distingue tres cosas: lo **ejecutado y medido** en local, lo que sigue **sin verificar** y el **runbook** exacto para cerrar cada criterio cuando las cuentas estén disponibles.

## 2. Entorno de la corrida

| Dato | Valor |
| --- | --- |
| SO | Windows 11 (`MINGW64_NT-10.0-26200`), Git Bash |
| Node | v25.5.0 (`>=20` que exige `package.json`) |
| Repositorio | `main` en `f7822ed`, 115 entradas en `git status --porcelain` |
| Servidor usado para sondear | `http://127.0.0.1:3280` (dev, `NODE_ENV=development`) |
| CLIs | `vercel` y `gh` **no instalados** |

## 3. Credenciales disponibles: ninguna

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
| 1 | App Vite con URL real de preview y producción | **Sin verificar** | falta `VERCEL_TOKEN` + `VERCEL_PROJECT_ID` |
| 2 | HTML/JS/CSS con content types correctos | **Sin verificar** | el E2E local sí los comprueba, pero contra el contrato simulado |
| 3 | Rollback real < 30 s | **Sin verificar** | requiere un segundo deployment real |
| 4 | El estado sobrevive a reiniciar Commander | **Sin verificar** | implementación durable presente: `configuredAdapter.ts` → `PublisherRemoteStateStore` → `.commander/publish/<slug>/state.json`; `MemoryRemoteStateStore` es sólo para tests. Reinicio real pendiente |
| 5 | Linear OAuth real: conectar, `whoami`, crear issue, revocar | **Sin verificar** | falta la OAuth app |
| 6 | GitHub OAuth real y revocación | **Sin verificar** | falta la OAuth app |
| 7 | `/commander` en modo plan y `--write` con PR real | **Sin verificar y bloqueado** | además de credenciales, `.github/workflows/commander-agent.yml` y `scripts/github-agent.ts` están **sin versionar** (`git status`: `??`) |
| 8 | Ningún token en artifacts, logs ni respuestas | **Parcial** | árbol y tests OK; falta comprobarlo en deployments y runs reales |
| 9 | `docs/parity/baseline-2026-11.md` | **Hecho** | este documento |
| 10 | `tsc`, `vite build` y pruebas focalizadas en verde | **Hecho** | §4 |

## 6. Línea base de las 10 tareas canónicas

**Método acordado** (no ejecutado): 2 corridas por tarea y 3 en las cuatro críticas; registrar éxito, pasos, tool calls, tokens, costo, aprobaciones, duración y fallos. Las cuatro críticas son **T1, T7, T8 y T9**.

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

- [ ] App Vite con URL real de preview y producción.
- [ ] HTML, JS y CSS con content types correctos en el proveedor.
- [ ] Rollback real < 30 s y estado persistente tras reiniciar.
- [ ] Linear OAuth real con `whoami`, creación y revocación.
- [ ] GitHub OAuth real con lectura y comentario revocables.
- [ ] `/commander` (plan) y `--write` (PR) reales en Actions.
- [ ] Sin tokens en artifacts, logs ni respuestas de las corridas reales.
- [x] `docs/parity/baseline-2026-11.md` con metodología, resultados y limitaciones.
- [x] `tsc --noEmit`, `vite build` y pruebas focalizadas en verde.

## 10. Cómo reanudar

1. Escribir en `.env` las variables de §3 (o conectar OAuth desde Ajustes para Linear/GitHub).
2. Reiniciar el servidor y confirmar `GET /api/integrations` y `GET /api/deploy/status` sin errores de configuración.
3. Versionar y empujar el workflow a un repo de prueba.
4. Repetir §7 y reemplazar cada «Sin verificar» de §5 por un recibo con URL, fecha y límite.
5. Sólo entonces mover las filas correspondientes de la matriz de `ROADMAP_PARITY.md` a **V**.

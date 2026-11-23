# Referencia — matriz de competidores y alcance por fase

> **Esto no es un roadmap.** Es material de consulta rescatado del historial de git cuando los cuatro roadmaps se fusionaron en [`ROADMAP.md`](../../ROADMAP.md). Aquí no hay casillas, estados, porcentajes ni puertas: **los criterios y su estado viven sólo en `ROADMAP.md` §2–§5**, y este documento no se actualiza cuando una fase avanza.
>
> **Procedencia:** `git show 502ec3b:ROADMAP_PARITY.md` (§1–§4 y §11) y `git show 502ec3b:ROADMAP_PLATFORM.md` (sección «Alcance» de cada fase), el último commit anterior a la fusión. La prosa larga que no se rescató aquí (backlog priorizado, métricas, riesgos, orden de ejecución, archivos implementados) sigue disponible con `git show 502ec3b:ROADMAP_PARITY.md` y `git show 502ec3b:ROADMAP_PLATFORM.md`.
>
> **Fecha del material:** 2026-11-07 para la comparación con competidores y el alcance de plataforma; el alcance de paridad incorpora decisiones de alcance posteriores (Vercel en pausa hasta G3, Linear fuera, 2026-11-10). Es una foto: antes de citarla, comprobar que el producto comparado no cambió.

## Parte A — Matriz de competidores (2026-11-07)

### A.1 Cómo se construyó

- **Evidencia del árbol:** se leyó el código real (`bin/commander.ts`, `src/cli/`, `src/agent/`, `browserSession.ts`, `pluginsRuntime.ts`, `publisher.ts`, `deploy/`, `backend/`, `tests/`) y los roadmaps existentes de la época.
- **Evidencia de competidores:** documentación oficial publicada, consultada el 2026-11-07. **No se ejecutaron OpenCode, Antigravity ni Freebuff en esta máquina**: la matriz describe capacidades **documentadas**, no una comparación de rendimiento.
- **Regla de honestidad:** una fila no pasa a «hecho» porque compile o tenga un test con un mock. Si depende de un proveedor externo, necesita una ejecución real y un recibo verificable (URL, issue, PR, captura o log sin secretos).
- **Alcance de la comparación:** se compara la mejor superficie de cada producto, no todas sus superficies a la vez. Una capacidad que sólo existe en la app de escritorio del competidor no se exige a cada superficie de Commander.

### A.2 Leyenda

| Marca | Significado en Commander | Significado en competidores |
| --- | --- | --- |
| **V** | Implementado y con prueba local; si es externo, verificado contra el proveedor real | Documentado como disponible en la superficie indicada |
| **I** | Implementado, pero falta verificación externa o visual | — |
| **P** | Parcial, scaffold o límite conocido | Parcial o limitado a una superficie |
| **F** | Ausente | No documentado como primera parte |
| **—** | No aplica a Commander | No es la propuesta del producto |

### A.3 Punto de partida de Commander (2026-11-07)

Foto del árbol en esa fecha; el estado actual está en `ROADMAP.md` §1 y §3.

| Área | Estado | Evidencia en el árbol | Límite actual |
| --- | --- | --- | --- |
| Bucle del agente, tools y subagentes | **V** | `src/agent/loop.ts`, `src/agent/fnTools.ts`, `src/agent/orchestrator.ts`; pruebas de agente | El CLI no expone todas las tools ni aprobaciones |
| Permisos, aprobaciones y undo | **V** | `permissionRules`, `AgentApprovalModal`, checkpoints y `undoStep`/`redo` | La política vive sobre todo en la UI de escritorio |
| Sesiones | **V** | `src/agent/sessions.ts`, rutas de sesiones y threads del servidor | No hay reanudación desde CLI ni desde un cliente remoto |
| Navegador y artifacts | **V/P** | `browserSession.ts`, `BrowserView.tsx`, `useBrowserRecording.ts`, `ArtifactsView.tsx` | Frames a ~1,4 fps; sin exportación, sin MP4 y sin verificación visual en Electron |
| Publicación estática/SPA | **V local; remoto en pausa hasta G3** | `publisher.ts`, `deploy/vercelAdapter.ts`, tests de contrato | Sin proveedor verificado; verificación en pausa hasta G3 (2026-11-10); sin SSR/Workers |
| Backend multiinquilino | **V local** | `backend/tenantStore.ts`, `backend/routes.ts`, `tests/tenantBackend.test.ts` (6/6) | No aprovisiona bindings para apps publicadas |
| Integraciones GitHub/Linear | **V GitHub; Linear fuera de alcance** | `src/integrations/`, rutas OAuth, vault AES-256-GCM | GitHub con OAuth real verificado (recibo §8); Linear no se configura |
| GitHub Actions | **V** | `.github/workflows/commander-agent.yml`, `scripts/github-agent.ts` | Corrida real en el repo de prueba con PR y comentario (recibo `F0-LOCAL-2026-11-10` §11) |
| CLI | **P** | `bin/commander.ts`, `src/cli/repl.ts`, `src/cli/agentClient.ts`, `src/cli/tui.ts` | REPL multi-turno, `ask_user`, `--resume`/`--fork`, diff por hunk y paridad de permisos del escritorio (F1-07) operativos |
| Extensión de VS Code | **P** | `vscode-extension/` | Scaffold: webview que lanza `npx commander agent`; no es un IDE integrado |
| Skills/plugins/MCP | **V/P** | `skills/`, `pluginsRuntime.ts`, `src/agent/mcp.ts` | Hooks sólo `beforeTool`/`afterTool`; sin lifecycle completo ni marketplace propio |

### A.4 Superficies y continuidad

| Capacidad | Commander | OpenCode | Antigravity | Freebuff |
| --- | --- | --- | --- | --- |
| App de escritorio | **V** (Electron/Tauri) | **V** | **V** (App) | **V** (Desktop) |
| CLI/TUI interactivo | **P** (REPL multi-turno, `ask_user` y diff por hunk operativos; faltaba paridad de permisos) | **V** (TUI) | **V** (CLI) | **V** (CLI) |
| Web local / navegador | **V** (Workbench embebido) | **V** (web y `pair`) | **V** (Remote Control web) | **V** (Web) |
| Extensión de IDE | **P** (VS Code scaffold) | **—** | **V** (VS Code, JetBrains, VS, Zed, Xcode, Eclipse) | **—** |
| Móvil / control remoto | **F** | **P** (web pair/QR) | **V** (Remote Control) | **V** (Web/Chat) |
| Ejecución en nube | **F** | **F** (servidor propio; pair remoto no es nube) | **V** (Remote Agents/CLI cloud) | **V** (Cloud) |
| Cuenta, historial y compartir | **F** (todo local) | **P** (share V1; V2 aún no lo soporta) | **V** (historial/conversaciones) | **V** (hilos/cuenta) |
| SDK / automatización programática | **P** (CLI `--json` + HTTP) | **P** (API del servidor) | **V** (SDK Python) | **V** (`@codebuff/sdk`) |

### A.5 Agente y verificación

| Capacidad | Commander | OpenCode | Antigravity | Freebuff |
| --- | --- | --- | --- | --- |
| Multi-proveedor / routing | **V** (muchos proveedores, fallback, modelos locales) | **V** | **P** (Gemini + Claude/GPT) | **P** (catálogo curado/financiado) |
| Modos plan / build / readonly | **V** | **V** | **V** | **V** |
| Subagentes | **V** (hasta 6 en paralelo; 6 plantillas) | **V** (custom, foreground/background) | **V** (async/swarms) | **V** (especializados) |
| Worktrees aislados | **V** (worktree por subagente y tool `git.worktree`) | **P** | **V** | **V** (workspaces paralelos) |
| Sesiones: resume / fork / rewind | **V** en escritorio; **P** en CLI | **V** (snapshots) | **V** | **V** |
| Compactación de contexto | **V** (`contextBudget.ts`) | **V** | **V** | **V** |
| Plan persistente / artifact de plan | **P** (tool de plan; no artifact de primera clase) | **P** (`todowrite`) | **V** (planes interactivos) | **P** |
| Diagnósticos / LSP | **P** (language service de TypeScript; no LSP genérico) | **F** (V2 sin runtime; V1 experimental) | **V** (integrado en el IDE) | **—** |
| Automatizaciones / cron | **P** (GitHub Actions; sin cron UI) | **P** (GitHub) | **V** (tareas programadas/sidecars) | **—** |
| Voz | **P** (dictado STT, sin conversación full-duplex) | **F** | **V** (voice mode) | **—** |
| Terminal / PTY / background | **V** | **V** | **V** | **V** |
| Browser agent | **V** (Playwright) | **F** (sólo webfetch) | **V** (Chromium sandbox) | **V** |
| Browser UI (consola/red/live) | **V** (con reserva: fixture SSE; sin verificación visual en Electron) | **P** (web UI, sin panel de navegador) | **V** | **V** |
| Artifacts (plan/diff/grabación) | **P** (grabación y comentarios locales; sin export) | **F** | **V** (planes, diffs, grabaciones) | **P** (previews) |
| Diff y aprobación por hunk | **V** | **V** | **V** | **V** |
| Evidencia de tests | **P** (tests y diagnósticos, no artifact de primera clase) | **P** | **V** (verification loops) | **P** |
| Preview de dev server | **V** | **P** (terminal) | **V** | **V** |

### A.6 Extensibilidad

| Capacidad | Commander | OpenCode | Antigravity | Freebuff |
| --- | --- | --- | --- | --- |
| MCP | **V** | **V** | **V** | **V** |
| Skills | **V** local | **V** | **V** (`SKILL.md`) | **V** (`AGENTS.md`/skills) |
| Plugins / hooks | **P** (sólo `beforeTool`/`afterTool`) | **V** | **V** (hooks/plugins) | **P** (MCP/skills; sin hooks documentados) |
| Agentes y comandos custom | **V** | **V** | **V** | **V** |
| Marketplace / ecosistema | **P** (catálogo de plugins de Claude) | **P** (comunidad) | **V** (plugins) | **—** |
| Integraciones nativas | **V** (GitHub con OAuth real; Linear fuera de alcance) | **P** (MCP/GitHub) | **V** (bundles de Google + MCP) | **P** (GitHub/repos; sin catálogo amplio documentado) |
| SSO / enterprise | **F** | **P** | **V** (SSO/BYOID, VPC-SC, residencia) | **—** |

### A.7 Plataforma de apps

| Capacidad | Commander | OpenCode | Antigravity | Freebuff |
| --- | --- | --- | --- | --- |
| Hosting estático/SPA | **P** (local **V**; proveedor remoto fuera de alcance) | **—** | **—** | **V** |
| Hosting SSR/full-stack | **F** | **—** | **P** (Google Cloud) | **V** |
| Auth/DB/storage para apps publicadas | **P** (backend local; sin bindings desplegados) | **—** | **P** (Firebase/Google) | **V** |
| Realtime para apps | **F** | **—** | **P** | **—** (no documentado) |
| App builder / deploy en un clic | **P** (estático/SPA) | **—** | **P** | **V** |

### A.8 Lectura competitiva

- **OpenCode** es el más cercano en el núcleo: TUI madura, agentes/subagentes custom, permisos granulares, snapshots, MCP, plugins y web/pair. No compite como plataforma de apps ni tiene browser/artifacts de primera clase. Su ventaja frente a Commander es la **superficie de terminal** y la **continuidad TUI ↔ web**; no la nube.
- **Antigravity** es el más cercano en **verificación**: planes interactivos, diffs multiarchivo, grabaciones de navegador, subagentes asíncronos con worktrees, Remote Control, CLI/IDE/SDK y tareas programadas. Su centro es Gemini/Google y su oferta empresarial; no es local-first ni multi-proveedor abierto.
- **Freebuff** es el más cercano en **producto de extremo a extremo**: Desktop/CLI/Web/Cloud/Chat, subagentes, browser, previews, auth/DB/storage y despliegue. Su ventaja es la app builder gestionada y la disponibilidad; su costo es depender de su nube y su catálogo.
- **Commander** no debe competir en modelos ni en infraestructura global. Su espacio defendible es **control local, aprobaciones visibles, reproducibilidad, costo y elección de proveedor**. La paridad debe reforzar eso, no diluirlo.

### A.9 Fuentes

Documentación oficial consultada el **2026-11-07**. Los productos cambian rápido: hay que revalidar lo que aquí se afirma antes de citarlo.

- OpenCode — introducción y superficies: <https://opencode.ai/v2/docs>
- OpenCode — agentes, subagentes y permisos: <https://opencode.ai/docs/agents/>
- OpenCode — web y `pair`: <https://opencode.ai/v2/docs/cli/web>
- OpenCode — sharing V1 y límites de V2: <https://opencode.ai/docs/share> y <https://opencode.ai/v2/docs/sharing>
- OpenCode — LSP: <https://opencode.ai/v2/docs/lsp>
- Antigravity — superficies y capacidades: <https://antigravity.google/docs/ide/overview>
- Antigravity — artifacts: <https://antigravity.google/docs/artifacts>
- Antigravity — permisos: <https://antigravity.google/docs/permissions/>
- Antigravity — subagentes: <https://antigravity.google/docs/subagents/>
- Antigravity — remote control: <https://antigravity.google/docs/remote-control/>
- Antigravity — enterprise: <https://antigravity.google/docs/enterprise/>
- Freebuff — repositorio y superficies: <https://github.com/CodebuffAI/freebuff>
- Freebuff — SDK: <https://github.com/CodebuffAI/freebuff/blob/main/sdk/README.md>

## Parte B — Alcance por fase

Qué entra en cada fase y qué queda explícitamente fuera. Los criterios de aceptación, su estado y las puertas **no se repiten aquí**: están en `ROADMAP.md` §3 (F0–F6) y §4 (PL0–PL7). Si un alcance de esta lista cambia, se cambia aquí y se refleja en la fase de `ROADMAP.md`.

### B.1 Paridad — F0 a F6

**F0 · Verdad y línea base.** Verificar con cuentas reales dentro del alcance vigente: OAuth de GitHub (conectar, leer un PR, comentar con aprobación, revocar y comprobar que el token no aparece en UI/logs) y GitHub Actions (`/commander` en modo plan y `--write` en un repo de prueba, con PR y comentario reales). Medir 10 tareas canónicas (bugfix, feature pequeña, refactor, tests, revisión, browser, deploy, permiso denegado, resume y subagente) con 2 corridas, y 3 en las 4 críticas, registrando éxito, pasos, tokens/costo, aprobaciones, duración y fallos. Revisar la matriz de la Parte A marcando cada fila con evidencia o con «sin verificar». Corregir sólo los defectos que impidan la verificación, sin abrir features nuevas. **Fuera:** Vercel en pausa hasta G3 y Linear fuera de alcance (2026-11-10); ninguna de las dos bloquea F0 ni se declara verificada.

**F1 · Núcleo de agente y CLI.** Modo interactivo en `commander`/`commander agent` con prompt multi-turno, selección de modelo/agente y comandos `/plan`, `/build`, `/review`, `/compact`, `/undo`, `/resume`, `/fork`, `/exit`. Aprobaciones en terminal con diff por hunk (aprobar, denegar, recordar para la sesión) y `ask_user` con opciones y texto libre. Mantener `--json` y el contrato NDJSON de la extensión y CI, y añadir `--resume <id>`/`--fork <id>` sin romper flags existentes. Sesión autoritativa en el servidor: el CLI se conecta al servidor embebido y no reimplementa el bucle; al salir y volver, historial, plan y approvals se conservan. Activar `update_plan` en el CLI con estados (`pending`, `in_progress`, `done`, `blocked`), archivos y criterios. Ampliar el catálogo de subagentes a al menos 6 roles (explorer, planner, coder, reviewer, tester, researcher) con allowlist de tools, modo y `maxSteps`, con worktree por subagente cuando se pida. Reutilizar exactamente el motor de permisos del escritorio: el CLI no puede saltarse una regla `ask`/`deny`. Desglose ejecutable en [`backlog-f1.md`](backlog-f1.md).

**F2 · Artifacts de verificación.** Plan artifact (pasos, estado, archivos tocados, criterios y decisiones, enlazado a la sesión), diff artifact (parche completo, revisión por hunk, comentarios, aplicar/descartar y auditoría de lo aplicado), grabación de navegador (WebM con la misma sesión de Playwright y log JSON de consola/red; si no hay encoder, frames + informe, nunca un MP4 falso), evidencia de tests (comando, `exitCode`, duración, versión de Node/SO, commit y cola de stdout/stderr, con un test fallido que no puede pintarse verde), informe local HTML/Markdown autocontenido sin peticiones externas ni secretos, y visor de artifacts con filtros por proyecto/sesión y «abrir carpeta», sin subida remota por defecto. Desglose en [`backlog-f2.md`](backlog-f2.md).

**F3 · Continuidad remota y PWA.** `commander pair` con enlace de un solo uso, QR y caducidad de 5 minutos, cookie de sesión de 30 días y `--remote` explícito para exponer fuera de loopback. Cliente web responsive/PWA con sesiones, chat, plan, approvals, artifacts y estado de trabajos; no es un IDE ni un editor de código. **Control lease:** un dispositivo controla la sesión y los demás ven en lectura, con traspaso explícito y auditado. Registro de dispositivos, revocación, auditoría por dispositivo, rate limit, CSRF y `Origin` ajeno → 403. Streaming reanudable: al caer la red el cliente se reconecta y pide el estado, y las approvals son idempotentes. Requisito previo: el modelo de amenazas remoto (`docs/parity/threat-model-remote.md`, **todavía sin versionar**); `--remote` no se habilita en una release hasta que esa revisión pase.

**F4 · Editor y ecosistema.** *4A, extensión VS Code:* compilar e instalar el `.vsix`, arrancar/reutilizar el servidor embebido sin exigir `npx` en producción, webview de chat con streaming, modelo/modo, selección de código como contexto, plan y approvals con diff; abrir archivo/línea desde un resultado de tool, mostrar diagnósticos del editor y conservar la misma sesión del escritorio, sin duplicar el bucle del agente. *4B, hooks, plugins y política MCP:* lifecycle `sessionStart`, `beforeModel`, `afterModel`, `beforeTool`, `afterTool`, `sessionEnd`, `stop` y `error` con timeout, orden y aislamiento de fallos; manifiesto de plugin con versión de API y permisos declarados, catálogo con instalación revisable y checksum, y nada de ejecutar código sin instalación explícita; MCP con política por tool (`allow`/`ask`/`deny`), salud/reintento, alcance por proyecto y errores visibles; importación de skills compatibles con `SKILL.md`, precedencia proyecto > global y validación de front matter. **Límite deliberado:** paridad de IDE sólo VS Code; JetBrains/Zed/Xcode quedan para una fase posterior sólo con demanda.

**F5 · Plataforma de apps: SSR, backend y realtime.** *5A, hosting SSR/Workers:* extender `DeploymentAdapter` para `ssr`/`worker`, elegir proveedor en G3 (Vercel fuera por la decisión del 2026-11-10; candidato natural, Cloudflare Workers), variables públicas/secretas, logs, previews, dominios y rollback. *5B, backend gestionado:* aprovisionar auth, DB y storage por app reutilizando el contrato y las garantías de aislamiento de `/api/backend`, con migraciones, cuotas, backup/export y borrado. *5C, realtime:* salas autenticadas, snapshots durables y reconexión, con el cliente sin poder elegir `userId` ni capacidades y el estado crítico en el servidor. Plantilla full-stack de referencia: registro/login/logout, CRUD, subida de archivo y una sala realtime.

**F6 · Apuestas estratégicas opcionales.** **No forma parte del compromiso P0/P1.** *Ejecución remota/cloud:* una tarea corre en un workspace aislado, sin acceso al FS del host, con upload/download explícito, logs, cancelación, reconexión y presupuesto; paridad funcional con Remote Agents/Freebuff Cloud, no con su escala. *Automatizaciones/cron:* horario, historial, política de approvals, presupuesto y parada, sin escrituras desatendidas sin opt-in. *Voz conversacional:* el dictado ya existe; full-duplex con interrupción sólo con demanda y un proveedor de audio verificable. *Equipos/SSO:* cuentas compartidas, roles, auditoría y SSO, que exigen un modelo de identidad que no existe y no se improvisa en F3. **Puertas para empezar:** demanda de usuarios, revisión de seguridad, modelo de costo y prueba de que no degrada el camino local-first.

### B.2 Plataforma — PL0 a PL7

**PL0 · Contrato de despliegue y modelo de entornos.** Definir `DeploymentAdapter` con `detectProject(root)` (estático, SPA, Workers/SSR o desconocido), `deploy(releaseDir, environment)`, `promote(deploymentId, environment)`, `rollback(environment)`, `status(environment)` y `logs(deploymentId)`. Extender el estado local sin romperlo: `state.json` sigue siendo la fuente de verdad y se añade `remote: { provider, preview, production, deployments }` con migración tolerante, donde un `release.id` local puede mapear a uno o varios IDs remotos. Definir el manifiesto opcional `commander.app.json` (tipo de app `static`/`spa`/`worker`/`ssr`, comando de build, carpeta de salida, variables públicas y bindings requeridos de `database`, `storage`, `auth` y `realtime`). Test double en memoria para probar preview, promoción y rollback sin red; no es un backend de producción. Decisión tomada entonces: Vercel como primer proveedor (en pausa hasta G3), builds `static`/`spa` y rechazo claro de `worker`/`ssr`, `VERCEL_TOKEN` + `VERCEL_PROJECT_ID` sólo en el servidor, entornos preview/producción fijos sin dominios personalizados ni previews por rama.

**PL1 · Hosting remoto de estáticos.** Primer `DeploymentAdapter` real para builds estáticas/SPA, reutilizando el artefacto de `createRelease` sin volver a compilar al promover. Rutas de servidor `GET /api/deploy/status?root=…`, `POST /api/deploy/preview`, `POST /api/deploy/production`, `POST /api/deploy/rollback` y `GET /api/deploy/logs`. UI en `PublishView.tsx` con selector Local/Remoto, URL pública por entorno, estado del deployment y botones de abrir, promover, rollback y ver logs. Persistir el mapeo release local ↔ deployment remoto. Preflight antes de subir: rechazar `.env*`, `.npmrc`, `.netrc`, symlinks y archivos fuera de la release, avisar de source maps o secretos evidentes y comprobar tamaño y número de archivos. **Fuera:** SSR/Workers, funciones serverless, dominios personalizados y CI/CD externo o deploys en cada push.

**PL2 · Navegador real en el Workbench.** Exponer la sesión existente de `browserSession.ts` al renderer (`POST /api/browser/session`, `GET /api/browser/session/:id/stream`, `POST /api/browser/session/:id/input`, `GET /api/browser/session/:id/logs`). Sustituir el iframe de `BrowserView.tsx` por una vista de frames y conservar la barra de URL. Reutilizar `LiveConsole` y `NetworkMonitor` con eventos reales, eliminando datos de demo y el comando simulado. Añadir selector de sesión, botón de captura, grabación local e indicador de «agente controlando» / «usuario controlando». Mantener intacta la tool `browser` (`open`, `navigate`, `snapshot`, `click`, `type`, `press`, `scroll`, `screenshot`, `logs`, `close`) y respetar la guardia SSRF y la aprobación para navegar fuera de loopback. Implementado además: grabación de frames JPEG desde el SSE con botón **REC**, persistencia en IndexedDB con límite de 120 s y 180 frames, reproductor con timeline, marcadores y comentarios anclados a `atMs` y a coordenadas normalizadas, resolución/reapertura/borrado con filtro por proyecto y auto-apertura de Artifacts al detener la grabación. **Límites declarados:** ~1,4 fps (un frame cada 700 ms), sin captura bajo demanda, sin MP4, sin exportación ni visor remoto, y sin verificación visual en Electron.

**PL3 · Backend gestionado para apps publicadas.** Definir `BackendAdapter` con `provision(projectId, bindings)`, `migrate(projectId, migrations)`, `status(projectId)` y `rotateSecrets(projectId)`. Soportar tres bindings iniciales: base de datos relacional/SQL, object storage y auth para la app publicada. Ampliar `commander.app.json` con `backend.database`, `backend.storage`, `backend.auth`, migraciones en `migrations/` y variables por entorno. Inyectar credenciales sólo en el entorno de despliegue, nunca en el bundle del cliente. Incluir un ejemplo funcional (registro/login, crear una fila propia, subir un archivo propio, cerrar sesión). Reglas de aislamiento: consultas filtradas por `user.id` en el servidor, IDs de recurso nunca confiados al cliente, 401 sin sesión y 403 para recursos ajenos. **Decisiones abiertas:** proveedor gestionado o también self-hosted; auth del proveedor o reutilizar la cuenta de Commander (recomendación: aislar, cada app su tenant); flujo explícito de exportación/borrado al borrar la app.

**PL4 · Realtime para apps publicadas.** `RealtimeAdapter` con salas, presencia, publicación de eventos y tickets de conexión autenticados. Ticket de corta duración emitido por el servidor: el navegador nunca decide `userId` ni permisos. Persistencia authoritative en la base de datos y realtime sólo como notificación. Throttle de eventos interactivos, sin bucles de heartbeat. Pruebas con dos clientes, sala no autorizada, desconexión y reconexión. Depende de PL3.

**PL5 · Conectores nativos.** Registro de conectores (`id`, nombre, icono, scopes, URLs de autorización/token, herramientas expuestas y permisos requeridos). Almacén de tokens cifrado con `safeStorage` de Electron cuando esté disponible y fallback a archivo cifrado con clave del sistema; nunca `localStorage`. Flujo OAuth con PKCE, state y callback loopback, con refresco automático y revocación. Conectores verticales: Linear (`whoami`, `list_teams`, `list_issues`, `create_issue`) y GitHub (OAuth para `github.pr`/`github.comment`, con fallback a `GITHUB_TOKEN`). UI con conectado/desconectado, cuenta y scopes, botón de revocar y último uso. **Pendiente real:** revisar los scopes de GitHub (`repo` es amplio) y decidir si se ofrece `public_repo`; Linear queda fuera de alcance desde 2026-11-10.

**PL6 · Skills de cuenta y plantillas.** Formato de «skill pack» con manifiesto (`id`, versión, descripción, permisos, compatibilidad), contenido Markdown/recursos, checksum, origen y autor. Sincronización con la cuenta (instalar, actualizar, desinstalar, cache offline y resolución de conflictos por versión). Catálogo curado de plantillas con preview antes de crear, una plantilla = proyecto completo y categorías/búsqueda. Reutilizar `skills/loader.ts` y el marketplace de plugins, sin un segundo cargador paralelo. Permisos explícitos: una skill no puede ejecutar shell ni escribir fuera del proyecto sin declararlo.

**PL7 · Workspaces remotos (opcional).** Alcance mínimo si se aprueba: runner remoto con Node, shell, PTY y filesystem efímero o persistente; sincronización explícita de workspace sin sync implícito de secretos; cola de trabajos y reconexión; auth de usuario y aislamiento por workspace; límites de CPU, memoria, disco y tiempo; visor de logs y artefactos **remotos** (los artifacts locales del navegador no cubren este caso). **Decisión previa:** cambia el modelo del producto; si Commander sigue siendo una app personal local-first, se queda fuera y se documenta como no objetivo. No se empieza «porque Freebuff lo tiene».

### B.3 UX 1.0

El roadmap de UX no tenía alcance por fase que rescatar: sus diez mejoras (command palette, layout de tres paneles, diff viewer, status bar, Nono acoplable, streaming de `shell.run`, sidebar de sesiones, atajos, empty states y consolidación de playgrounds) están en la tabla de `ROADMAP.md` §5 con su archivo y su evidencia. Lo único que se perdió fue su lista de **fuera de alcance**, que se conserva aquí: LSP propio, file watcher, paleta, tipografía y el rol de Nono.

## Cómo se mantiene

- Este documento no tiene estado ni casillas a propósito: si algo de aquí cambia, el cambio se hace en el alcance y se refleja en la fase correspondiente de `ROADMAP.md`, que es la única fuente de criterios.
- La Parte A es una foto fechada. Revalidar contra la documentación oficial antes de usarla para justificar una decisión; si se actualiza, se mueve la fecha del encabezado.
- No agregar aquí backlog, métricas, riesgos ni órdenes de ejecución: eso vive en `ROADMAP.md` §8–§9 o en `git show 502ec3b:ROADMAP_PARITY.md`.

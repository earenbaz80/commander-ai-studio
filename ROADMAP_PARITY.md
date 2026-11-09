# Plan de paridad — Commander AI Studio vs. OpenCode, Antigravity y Freebuff

> **Estado:** propuesta revisada contra el árbol 2.5.1 y la documentación oficial, 2026-11-07.
> **Horizonte:** 9–12 semanas de trabajo efectivo para el alcance comprometido (P0 + P1) con 2 personas; 12–16 semanas con una. Las estimaciones son de orden de magnitud (±30%), no fechas comprometidas.
> **Documentos relacionados:** [ROADMAP_PLATFORM.md](ROADMAP_PLATFORM.md) (hosting, backend y conectores), [ROADMAP_UX.md](ROADMAP_UX.md) (UX) y [AGENTS.md](AGENTS.md) (reglas del repo).
> **Numeración:** las fases F0–F6 de este documento son propias del plan de paridad; no renumeran ni sustituyen las fases de `ROADMAP_PLATFORM.md`.
> **Regla de lectura:** paridad significa **la misma capacidad de producto**, no la misma implementación, el mismo modelo ni la misma estética. Commander conserva local-first, Norton y Nono.

## 1. Resumen ejecutivo

Commander ya cubre el núcleo de un agente de código: multi-proveedor, modos plan/build/readonly, permisos y aprobaciones con diff, subagentes, checkpoints/undo, MCP, skills, plugins, terminal real, trabajos en segundo plano, navegador Playwright, artifacts locales, CLI headless, GitHub Actions, publicación estática/SPA y un backend multiinquilino local.

No está lejos en el **bucle del agente**. Está lejos en tres cosas que los productos comparados ya venden como parte de su experiencia:

1. **Continuidad entre superficies.** OpenCode tiene TUI y web/pair; Antigravity tiene App, CLI, IDE, Remote Control y SDK; Freebuff tiene Desktop, CLI, Web, Cloud y Chat. Commander tiene escritorio, Workbench web local y un CLI que todavía es de una sola pasada.
2. **Evidencia verificable.** Antigravity convierte plan, diff y grabación de navegador en artifacts revisables; Freebuff integra previews, terminales y despliegues. Commander ya captura parte de eso, pero no lo exporta, comparte ni convierte en un informe de verificación.
3. **Plataforma para las apps que construye.** Freebuff ofrece auth, base de datos, storage y hosting como parte del producto. Commander tiene un backend local sólido, pero no aprovisiona ni despliega ese backend para una app publicada.

La estrategia propuesta no es copiar el catálogo completo. Es cerrar primero la **confianza** (lo que decimos que funciona, funciona contra el proveedor real), después la **continuidad** (la misma tarea en escritorio, terminal y navegador/móvil) y después la **plataforma** (publicar una app completa cuando el usuario lo pida). La nube por defecto, el móvil nativo, el SSO empresarial y el marketplace propio quedan como apuestas opcionales, no como requisitos de paridad.

**Resultado esperado al terminar P0 + P1:** una tarea puede empezar en el escritorio, continuar en el CLI o en el móvil, aprobarse con el mismo diff, producir un artifact de plan + diff + tests + grabación, y publicarse como app con backend y realtime, sin que el camino local-first deje de funcionar sin cuenta ni red.

## 2. Cómo se ha construido este plan

- **Evidencia del árbol:** se leyó el código real (`bin/commander.ts`, `src/cli/`, `src/agent/`, `browserSession.ts`, `pluginsRuntime.ts`, `publisher.ts`, `deploy/`, `backend/`, `tests/`) y los roadmaps existentes.
- **Evidencia de competidores:** se usó documentación oficial publicada, consultada el 2026-11-07. No se ejecutaron OpenCode, Antigravity ni Freebuff en esta máquina; por tanto, la matriz describe capacidades **documentadas**, no una comparación de rendimiento.
- **Regla de honestidad:** una fila no pasa a “hecho” porque compile o tenga un test con un mock. Si depende de un proveedor externo, necesita una ejecución real y un recibo verificable (URL, issue, PR, captura o log sin secretos).
- **Alcance:** se compara la mejor superficie de cada producto, no todas sus superficies a la vez. Una capacidad que sólo existe en la app de escritorio del competidor no se le exige a cada superficie de Commander.

### Leyenda de la matriz

| Marca | Significado en Commander | Significado en competidores |
| --- | --- | --- |
| **V** | Implementado y con prueba local; si es externo, verificado contra el proveedor real | Documentado como disponible en la superficie indicada |
| **I** | Implementado, pero falta verificación externa o visual | — |
| **P** | Parcial, scaffold o límite conocido | Parcial o limitado a una superficie |
| **F** | Ausente | No documentado como primera parte |
| **—** | No aplica a Commander | No es la propuesta del producto |

## 3. Punto de partida verificable de Commander

| Área | Estado | Evidencia en el árbol | Límite actual |
| --- | --- | --- | --- |
| Bucle del agente, tools y subagentes | **V** | `src/agent/loop.ts`, `src/agent/fnTools.ts`, `src/agent/orchestrator.ts`; pruebas de agente | El CLI no expone todas las tools ni aprobaciones |
| Permisos, aprobaciones y undo | **V** | `permissionRules`, `AgentApprovalModal`, checkpoints y `undoStep`/`redo` | La política vive sobre todo en la UI de escritorio |
| Sesiones | **V** | `src/agent/sessions.ts`, rutas de sesiones y threads del servidor | No hay reanudación desde CLI ni desde un cliente remoto |
| Navegador y artifacts | **V/P** | `browserSession.ts`, `BrowserView.tsx`, `useBrowserRecording.ts`, `ArtifactsView.tsx` | Frames a ~1,4 fps; sin exportación, sin MP4 y sin verificación visual en Electron |
| Publicación estática/SPA | **V local / I remoto** | `publisher.ts`, `deploy/vercelAdapter.ts`, tests de contrato | No hay despliegue real contra Vercel; sin SSR/Workers |
| Backend multiinquilino | **V local** | `backend/tenantStore.ts`, `backend/routes.ts`, `tests/tenantBackend.test.ts` (6/6) | No aprovisiona bindings para apps publicadas |
| Integraciones GitHub/Linear | **I** | `src/integrations/`, rutas OAuth, vault AES-256-GCM | Falta OAuth real con cuentas y permisos reales |
| GitHub Actions | **I** | `.github/workflows/commander-agent.yml`, `scripts/github-agent.ts` | No hay una corrida real en GitHub |
| CLI | **P** | `bin/commander.ts`, `src/cli/repl.ts`, `src/cli/agentClient.ts`, `src/cli/tui.ts` | REPL multi-turno, `ask_user`, `--resume`/`--fork` y diff por hunk operativos; falta la paridad de permisos del escritorio (F1-07) |
| Extensión de VS Code | **P** | `vscode-extension/` | Scaffold: webview que lanza `npx commander agent`; no es un IDE integrado |
| Skills/plugins/MCP | **V/P** | `skills/`, `pluginsRuntime.ts`, `src/agent/mcp.ts` | Hooks sólo `beforeTool`/`afterTool`; sin lifecycle completo ni marketplace propio |

## 4. Matriz de paridad

### 4.1 Superficies y continuidad

| Capacidad | Commander | OpenCode | Antigravity | Freebuff |
| --- | --- | --- | --- | --- |
| App de escritorio | **V** (Electron/Tauri) | **V** | **V** (App) | **V** (Desktop) |
| CLI/TUI interactivo | **P** (REPL multi-turno, `ask_user` y diff por hunk operativos; falta paridad de permisos) | **V** (TUI) | **V** (CLI) | **V** (CLI) |
| Web local / navegador | **V** (Workbench embebido) | **V** (web y `pair`) | **V** (Remote Control web) | **V** (Web) |
| Extensión de IDE | **P** (VS Code scaffold) | **—** | **V** (VS Code, JetBrains, VS, Zed, Xcode, Eclipse) | **—** |
| Móvil / control remoto | **F** | **P** (web pair/QR) | **V** (Remote Control) | **V** (Web/Chat) |
| Ejecución en nube | **F** | **F** (servidor propio; pair remoto no es nube) | **V** (Remote Agents/CLI cloud) | **V** (Cloud) |
| Cuenta, historial y compartir | **F** (todo local) | **P** (share V1; V2 aún no lo soporta) | **V** (historial/conversaciones) | **V** (hilos/cuenta) |
| SDK / automatización programática | **P** (CLI `--json` + HTTP) | **P** (API del servidor) | **V** (SDK Python) | **V** (`@codebuff/sdk`) |

### 4.2 Agente y verificación

| Capacidad | Commander | OpenCode | Antigravity | Freebuff |
| --- | --- | --- | --- | --- |
| Multi-proveedor / routing | **V** (muchos proveedores, fallback, modelos locales) | **V** | **P** (Gemini + Claude/GPT) | **P** (catálogo curado/financiado) |
| Modos plan / build / readonly | **V** | **V** | **V** | **V** |
| Subagentes | **V** (hasta 6 en paralelo; 4 plantillas) | **V** (custom, foreground/background) | **V** (async/swarms) | **V** (especializados) |
| Worktrees aislados | **V** (worktree por subagente y tool `git.worktree`) | **P** | **V** | **V** (workspaces paralelos) |
| Sesiones: resume / fork / rewind | **V** en escritorio; **P** en CLI | **V** (snapshots) | **V** | **V** |
| Compactación de contexto | **V** (`contextBudget.ts`) | **V** | **V** | **V** |
| Plan persistente / artifact de plan | **P** (tool de plan; no artifact de primera clase) | **P** (`todowrite`) | **V** (planes interactivos) | **P** |
| Diagnósticos / LSP | **P** (language service de TypeScript; no LSP genérico) | **F** (V2 sin runtime; V1 experimental) | **V** (integrado en el IDE) | **—** |
| Automatizaciones / cron | **P** (GitHub Actions; sin cron UI) | **P** (GitHub) | **V** (tareas programadas/sidecars) | **—** |
| Voz | **P** (dictado STT, sin conversación full-duplex) | **F** | **V** (voice mode) | **—** |
| Terminal / PTY / background | **V** | **V** | **V** | **V** |
| Browser agent | **V** (Playwright) | **F** (sólo webfetch) | **V** (Chromium sandbox) | **V** |
| Browser UI (consola/red/live) | **V\*** (fixture SSE; sin verificación visual en Electron) | **P** (web UI, sin panel de navegador) | **V** | **V** |
| Artifacts (plan/diff/grabación) | **P** (grabación y comentarios locales; sin export) | **F** | **V** (planes, diffs, grabaciones) | **P** (previews) |
| Diff y aprobación por hunk | **V** | **V** | **V** | **V** |
| Evidencia de tests | **P** (tests y diagnósticos, no artifact de primera clase) | **P** | **V** (verification loops) | **P** |
| Preview de dev server | **V** | **P** (terminal) | **V** | **V** |

### 4.3 Extensibilidad

| Capacidad | Commander | OpenCode | Antigravity | Freebuff |
| --- | --- | --- | --- | --- |
| MCP | **V** | **V** | **V** | **V** |
| Skills | **V** local | **V** | **V** (`SKILL.md`) | **V** (`AGENTS.md`/skills) |
| Plugins / hooks | **P** (sólo `beforeTool`/`afterTool`) | **V** | **V** (hooks/plugins) | **P** (MCP/skills; sin hooks documentados) |
| Agentes y comandos custom | **V** | **V** | **V** | **V** |
| Marketplace / ecosistema | **P** (catálogo de plugins de Claude) | **P** (comunidad) | **V** (plugins) | **—** |
| Integraciones nativas | **P** (GitHub/Linear; falta OAuth real) | **P** (MCP/GitHub) | **V** (bundles de Google + MCP) | **P** (GitHub/repos; sin catálogo amplio documentado) |
| SSO / enterprise | **F** | **P** | **V** (SSO/BYOID, VPC-SC, residencia) | **—** |

### 4.4 Plataforma de apps

| Capacidad | Commander | OpenCode | Antigravity | Freebuff |
| --- | --- | --- | --- | --- |
| Hosting estático/SPA | **P** (local **V**; Vercel **I**) | **—** | **—** | **V** |
| Hosting SSR/full-stack | **F** | **—** | **P** (Google Cloud) | **V** |
| Auth/DB/storage para apps publicadas | **P** (backend local; sin bindings desplegados) | **—** | **P** (Firebase/Google) | **V** |
| Realtime para apps | **F** | **—** | **P** | **—** (no documentado) |
| App builder / deploy en un clic | **P** (estático/SPA) | **—** | **P** | **V** |

### 4.5 Lectura competitiva

- **OpenCode** es el más cercano en el núcleo: TUI madura, agentes/subagentes custom, permisos granulares, snapshots, MCP, plugins y web/pair. No compite como plataforma de apps ni tiene browser/artifacts de primera clase. Su ventaja frente a Commander es la **superficie de terminal** y la **continuidad TUI ↔ web**; no la nube.
- **Antigravity** es el más cercano en **verificación**: planes interactivos, diffs multiarchivo, grabaciones de navegador, subagentes asíncronos con worktrees, Remote Control, CLI/IDE/SDK y tareas programadas. Su centro es Gemini/Google y su oferta empresarial; no es local-first ni multi-proveedor abierto.
- **Freebuff** es el más cercano en **producto de extremo a extremo**: Desktop/CLI/Web/Cloud/Chat, subagentes, browser, previews, auth/DB/storage y despliegue. Su ventaja es la app builder gestionada y la disponibilidad; su costo es depender de su nube y su catálogo.
- **Commander** no debe competir en modelos ni en infraestructura global. Su espacio defendible es **control local, aprobaciones visibles, reproducibilidad, costo y elección de proveedor**. La paridad debe reforzar eso, no diluirlo.

## 5. Backlog priorizado

| ID | Hueco | Por qué importa | Fase | Prioridad |
| --- | --- | --- | --- | --- |
| P0-1 | Verdad externa de Vercel, Linear, GitHub y Actions | Hoy hay código con mocks; afirmar paridad sin recibo erosiona la confianza | F0 | **P0** |
| P0-2 | CLI/TUI de primera clase con approvals y `ask_user` | Es la superficie principal de OpenCode/Antigravity/Freebuff y hoy Commander sólo tiene una pasada | F1 | **P0** |
| P0-3 | Sesión única y plan persistente entre escritorio y CLI | Sin continuidad, el usuario pierde el trabajo al cambiar de superficie | F1 | **P0** |
| P1-0 | Artifact de verificación: plan + diff + tests + grabación | Es lo que hace revisable y confiable una corrida; Antigravity ya lo vende | F2 | **P1** |
| P1-1 | Pair remoto + PWA con la misma sesión y aprobaciones | Cierra la brecha con OpenCode pair, Remote Control y Freebuff Web sin subir el código a una nube | F3 | **P1** |
| P1-2 | Extensión VS Code útil (no scaffold) | Antigravity ya está en seis IDEs; Commander necesita al menos el editor dominante | F4 | **P1** |
| P1-3 | Lifecycle de hooks, plugin API versionada y política MCP | OpenCode/Antigravity tienen ecosistema; Commander tiene sólo dos hooks | F4 | **P1** |
| P1-4 | Hosting SSR + auth/DB/storage para apps | Es el hueco de producto más grande frente a Freebuff | F5 | **P1** |
| P2-1 | Ejecución remota/en nube y agentes desatendidos | Paridad con Remote Agents/Cloud, pero rompe el modelo local-first si se hace por defecto | F6 | **P2** |
| P2-2 | Automatizaciones/cron, voz conversacional y enterprise | Capacidades de plataforma con costo y riesgo altos; sólo con demanda explícita | F6 | **P2** |

## 6. Fases

### Fase 0 — Verdad y línea base · **P0** · 4–5 días

**Objetivo:** convertir “está implementado” en “está verificado” y fijar una línea base medible antes de añadir superficie.

> **Estado 2026-11-07 — bloqueada en G0.** En esta máquina no hay credenciales de Vercel, GitHub ni Linear (ni `.env`, ni variables de entorno, ni conectores OAuth), así que ninguna fila externa está verificada. Lo medido en local, lo que falta y el runbook para cerrarla están en [docs/parity/baseline-2026-11.md](docs/parity/baseline-2026-11.md).

**Alcance**

- Verificar con cuentas reales:
  - despliegue estático/SPA en Vercel: preview, producción, rollback, content types, persistencia tras reinicio;
  - OAuth de Linear y GitHub: conectar, `whoami`, crear issue/comentar PR, revocar, comprobar que el token no aparece en UI/logs;
  - GitHub Actions: `/commander` en modo plan y `--write` en un repo de prueba, con PR real.
- Medir 10 tareas canónicas (bugfix, feature pequeña, refactor, tests, revisión, browser, deploy, permiso denegado, resume y subagente) con 2 corridas; 3 corridas en las 4 críticas. Registrar éxito, pasos, tokens/costo, aprobaciones, duración y fallos.
- Revisar la matriz de este documento y marcar cada fila con evidencia o con “sin verificar”.
- Corregir sólo los defectos que impidan la verificación; no abrir features nuevas.

**Criterios de aceptación**

- [ ] Una app Vite de ejemplo tiene URL real de preview y producción; HTML, JS y CSS responden con content types correctos.
- [ ] El rollback real vuelve a la release anterior en menos de 30 s y el estado sobrevive a reiniciar Commander.
- [ ] Linear y GitHub completan OAuth real; las acciones permitidas funcionan y la revocación invalida el acceso.
- [ ] GitHub Actions ejecuta `/commander` y `--write` en un repo de prueba; el PR y el comentario son reales.
- [ ] Ningún token, `.env`, source map ni secreto aparece en artifacts, logs o respuestas.
- [x] Existe `docs/parity/baseline-2026-11.md` con metodología, resultados y limitaciones (creado 2026-11-07; el resto de criterios sigue sin verificar).
- [ ] `tsc --noEmit`, `vite build` y las pruebas focalizadas siguen en verde.

**Puerta G0:** sin credenciales reales no se puede cerrar F0. F1 puede empezar, pero no se declara paridad de hosting ni de integraciones, y F5 queda bloqueada.

---

### Fase 1 — Núcleo de agente y CLI de primera clase · **P0** · 10–12 días

**Objetivo:** que el CLI sea una superficie completa del mismo agente, no un modo de una sola pasada, y que la sesión sea la misma en escritorio y terminal.

> **Estado 2026-11-09 — F1-05, F1-06, F1-08 y F1-09 completados y cerrados.** `ask_user` se ofrece y resuelve en el CLI (commit `b01264a`); el REPL multi-turno (F1-08) con sus preferencias (F1-09, commit `7a5755f`) y el diff por hunk con `a`/`d`/`s`/`?`/`q` (F1-05) están cerrados. Quedan abiertos F1-07, F1-12 y F1-13.

> **Desglose ejecutable:** [docs/parity/backlog-f1.md](docs/parity/backlog-f1.md) — 14 issues, 21,0 d-persona, dependencias, camino crítico y pruebas por entregable.

**Alcance**

- Modo interactivo en `commander`/`commander agent`: prompt multi-turno, selección de modelo/agente, `/plan`, `/build`, `/review`, `/compact`, `/undo`, `/resume`, `/fork`, `/exit`.
- Aprobaciones en terminal con diff por hunk: aprobar, denegar, recordar para la sesión. `ask_user` con opciones y texto libre.
- Mantener `--json` y el contrato NDJSON actuales para la extensión y CI; añadir `--resume <id>` y `--fork <id>` sin romper flags existentes.
- Sesión autoritativa en el servidor: el CLI se conecta al servidor embebido; no reimplementa el bucle. Al salir y volver a entrar, el historial, el plan y el estado de approvals se conservan.
- Activar `update_plan` en CLI y persistir el plan con estados (`pending`, `in_progress`, `done`, `blocked`), archivos y criterios.
- Ampliar el catálogo de subagentes a al menos 6 roles (explorer, planner, coder, reviewer, tester, researcher) con allowlist de tools, modo y `maxSteps`; permitir worktree por subagente cuando el usuario lo pida.
- Reutilizar exactamente el motor de permisos del escritorio; el CLI no puede saltarse una regla `ask`/`deny`.

**Criterios de aceptación**

- [ ] `commander agent "tarea" --json` conserva su salida y sus consumidores actuales.
- [ ] `commander` abre una sesión interactiva; una edición pide aprobación con diff, y denegar no escribe ni un byte.
- [x] `ask_user` bloquea la corrida hasta recibir respuesta y la respuesta queda en el historial (F1-06, commit `b01264a`).
- [ ] Una tarea iniciada en CLI aparece en el escritorio con el mismo `sessionId`, pasos y plan; `--resume` continúa sin duplicar tool calls y `--fork` no muta la original.
- [ ] El plan se actualiza durante la corrida y sobrevive a un reinicio del servidor.
- [ ] Un subagente con una tool denegada falla cerrado; 6 subagentes pueden correr en paralelo y el worktree no contamina el árbol principal.
- [ ] 10 casos adversariales de permisos (shell, escritura, red, MCP, subagente) no ejecutan nada fuera de política.
- [ ] Pruebas focalizadas del CLI/sesiones, `tsc --noEmit` y `vite build` en verde.

**Puerta G1:** dogfooding de 5 días con el CLI como superficie principal. Si la latencia de aprobación o la tasa de éxito retrocede frente a F0, no se empieza F2 hasta corregirlo.

---

### Fase 2 — Artifacts de verificación · **P1** · 6–8 días

**Objetivo:** que cada corrida deje evidencia revisable y exportable, no sólo mensajes en el chat.

**Alcance**

- **Plan artifact:** pasos, estado, archivos tocados, criterios y decisiones; enlazado a la sesión.
- **Diff artifact:** parche completo, revisión por hunk, comentarios, aplicar/descartar y auditoría de lo aplicado.
- **Grabación de navegador:** exportar WebM con la misma sesión de Playwright y un log JSON de consola/red; si el entorno no tiene encoder, decirlo y ofrecer frames + informe, nunca un MP4 falso.
- **Evidencia de tests:** comando, `exitCode`, duración, versión de Node/SO, commit y cola de stdout/stderr; un test fallido no puede pintarse verde.
- **Informe local:** HTML/Markdown autocontenido, sin peticiones externas ni secretos, con plan, diff, evidencia y grabación.
- Visor de artifacts con filtros por proyecto/sesión y “abrir carpeta”; sin subida remota por defecto.

**Criterios de aceptación**

- [ ] Una tarea de código produce plan, diff, evidencia de tests y (si hubo navegador) grabación, todos enlazados al mismo `sessionId`.
- [ ] El estado del plan coincide con las tool calls reales; un paso bloqueado se distingue de uno completado.
- [ ] El diff se puede revisar por hunk y el artifact registra quién aplicó qué.
- [ ] Una grabación de al menos 30 s se reproduce offline en Chromium y incluye consola/red con timestamps.
- [ ] La evidencia de tests muestra `exitCode != 0` en rojo y no genera un “passed” si el comando falló o no llegó a ejecutarse.
- [ ] El informe se abre desde el disco sin red, sin secretos y sin recursos externos.
- [ ] Los artifacts sobreviven a reiniciar la app y siguen siendo locales; no requieren cuenta.

---

### Fase 3 — Continuidad remota y PWA · **P1** · 10–14 días

**Objetivo:** continuar la misma sesión desde el móvil o el navegador, con la misma política de aprobación, sin convertir a Commander en una nube.

> **Requisito previo de G2:** [docs/parity/threat-model-remote.md](docs/parity/threat-model-remote.md) — modelo de amenazas, requisitos de diseño y criterios de seguridad verificables. `--remote` no se habilita en una release hasta que esa revisión pase.

**Alcance**

- `commander pair`: enlace de un solo uso, QR y caducidad de 5 minutos; cookie de sesión de 30 días; `--remote` explícito para exponer fuera de loopback.
- Cliente web responsive/PWA: sesiones, chat, plan, approvals, artifacts y estado de trabajos; no es un IDE completo ni un editor de código.
- **Control lease:** un dispositivo controla la sesión; los demás ven en lectura. El traspaso de control es explícito y auditado para evitar dos escrituras simultáneas.
- Registro de dispositivos, revocación, auditoría por dispositivo, rate limit, CSRF y `Origin` ajeno → 403.
- Streaming reanudable: al caer la red, el cliente se reconecta y pide el estado; las approvals son idempotentes.

**Criterios de aceptación**

- [ ] Se inicia una tarea en escritorio, se empareja el móvil, se ve la misma sesión y se aprueba un diff; el escritorio refleja la aprobación sin duplicar pasos.
- [ ] El enlace caduca a los 5 minutos, no se puede reutilizar y un `Origin` ajeno recibe 403.
- [ ] El servidor escucha sólo loopback por defecto; sin `--remote`/túnel explícito no hay puerto público.
- [ ] Revocar un dispositivo invalida su cookie y queda registrado en la auditoría.
- [ ] Dos clientes no pueden escribir a la vez; el traspaso de control se prueba y no se pierden eventos.
- [ ] Tras una caída de red, el cliente se reconecta, recupera el estado y no repite una aprobación ya aplicada.
- [ ] La vista de 390×844 no tiene scroll horizontal y permite aprobar/denegar con el diff visible.
- [ ] Ningún token de emparejamiento, cookie o secreto aparece en la URL, logs o artifacts.

**Puerta G2:** revisión de seguridad y modelo de amenazas antes de habilitar `--remote` en builds de release. Si no pasa, se queda sólo el cliente local en loopback.

---

### Fase 4 — Editor y ecosistema · **P1** · 12–15 días

**Objetivo:** llevar el agente al editor dominante y convertir la extensibilidad en una API estable, no en dos hooks ad-hoc.

#### 4A. Extensión VS Code útil

- Compilar e instalar el `.vsix`; arrancar/reutilizar el servidor embebido sin exigir `npx` en producción.
- Webview de chat con streaming, modelo/modo, selección de código como contexto, plan y approvals con diff.
- Abrir archivo/línea desde un resultado de tool; mostrar diagnósticos del editor; conservar la misma sesión del escritorio.
- No duplicar el bucle del agente: la extensión es un cliente del servidor.

**Criterios**

- [ ] Instalación del VSIX en un VS Code limpio y tres tareas reales (leer, editar, revisar) completadas.
- [ ] Una aprobación aplica el diff al workspace y el archivo abierto refleja el cambio.
- [ ] “Ir a la definición” desde un resultado abre el archivo y la línea correctos.
- [ ] La sesión iniciada en VS Code aparece en el escritorio con el mismo id.
- [ ] No hay una segunda implementación del loop ni del motor de permisos.

#### 4B. Hooks, plugins y política MCP

- Lifecycle: `sessionStart`, `beforeModel`, `afterModel`, `beforeTool`, `afterTool`, `sessionEnd`, `stop` y `error`, con timeout, orden y aislamiento de fallos.
- Manifiesto de plugin con versión de API y permisos declarados; un plugin incompatible se rechaza con un mensaje claro.
- Catálogo con instalación revisable y checksum; nada de ejecutar código de un plugin sin instalación explícita.
- MCP: política por tool (`allow`/`ask`/`deny`), salud/reintento, alcance por proyecto y errores visibles.
- Importación de skills compatibles con `SKILL.md`; precedencia proyecto > global y validación de front matter.

**Criterios**

- [ ] Un plugin de referencia ejecuta los hooks en orden y un hook que lanza no rompe la corrida.
- [ ] Un plugin no puede saltarse una regla `deny` del motor de permisos.
- [ ] Una tool MCP denegada no se ejecuta y el modelo recibe un error estructurado.
- [ ] Se importan skills de tres formatos soportados y una skill inválida no se carga.
- [ ] Un plugin con versión de API incompatible se rechaza sin ejecutar código.
- [ ] La instalación y desinstalación no dejan servidores MCP huérfanos ni archivos fuera de `.commander/`.

**Límite deliberado:** paridad de IDE se limita a VS Code en este plan. JetBrains/Zed/Xcode quedan para una fase posterior sólo si hay demanda; no se van a mantener seis extensiones a la vez.

---

### Fase 5 — Plataforma de apps: SSR, backend y realtime · **P1** · 18–25 días

**Objetivo:** que una app creada en Commander se pueda publicar completa, con auth, datos, archivos y realtime, sin fingir que un build estático es full-stack.

**Alcance (tres entregas separadas)**

- **5A. Hosting SSR/Workers.** Extender `DeploymentAdapter` para `ssr`/`worker`, elegir proveedor después de F0 (Vercel Functions o Cloudflare Workers), variables públicas/secretas, logs, previews, dominios y rollback.
- **5B. Backend gestionado.** Aprovisionar auth, DB y storage por app; reutilizar el contrato y las garantías de aislamiento de `/api/backend`; migraciones, cuotas, backup/export y borrado.
- **5C. Realtime.** Salas autenticadas, snapshots durables y reconexión; el cliente no elige `userId` ni capacidades; estado crítico en el servidor.
- Plantilla full-stack de referencia: registro/login/logout, CRUD, subida de archivo y una sala realtime.

**Criterios de aceptación**

- [ ] Una app SSR de ejemplo se despliega en preview y una ruta dinámica responde con variables de entorno correctas.
- [ ] Registro, login, logout y sesión funcionan; sin sesión, las rutas privadas responden 401.
- [ ] Dos usuarios no pueden leer ni modificar datos ni archivos del otro; un recurso ajeno responde 403.
- [ ] Dos clientes realtime reciben eventos; al desconectarse y volver, recuperan el snapshot sin perder el estado durable.
- [ ] Rollback y logs funcionan; los secretos no llegan al cliente, a la release ni a los logs.
- [ ] La app sigue funcionando en local sin cuenta y sin red; el camino local no depende del proveedor.
- [ ] No se publica en producción sin autorización explícita del usuario.

**Puerta G3:** decisión de proveedor y modelo de costo antes de 5A. Si no hay proveedor verificado, Commander sólo publica local/estático y lo dice.

---

### Fase 6 — Apuestas estratégicas opcionales · **P2** · 20–30 días

**Objetivo:** decidir con evidencia si Commander debe entrar en nube, automatización desatendida, voz conversacional o enterprise. **No forma parte del compromiso P0/P1.**

**Candidatos y criterios si se aprueban**

- **Ejecución remota/cloud:** una tarea corre en un workspace aislado, sin acceso al FS del host, con upload/download explícito, logs, cancelación, reconexión y presupuesto. Paridad funcional con Remote Agents/Freebuff Cloud, no con su escala.
- **Automatizaciones/cron:** horario, historial, política de approvals, presupuesto y parada; ninguna escritura desatendida sin opt-in.
- **Voz conversacional:** dictado ya existe; full-duplex con interrupción sólo si hay demanda y un proveedor de audio verificable.
- **Equipos/SSO:** cuentas compartidas, roles, auditoría y SSO. Requiere un modelo de identidad que hoy no existe; no se improviza en F3.

**Puertas:** demanda de usuarios, revisión de seguridad, modelo de costo y prueba de que no degrada el camino local-first. Sin estas cuatro, no se empieza.

## 7. Métricas y definición de terminado

### 7.1 Métricas

| Dimensión | Métrica | Línea base | Objetivo |
| --- | --- | --- | --- |
| Verdad | Afirmaciones P0 con recibo real / total | F0 | 100 %; cero “hecho” sin verificación externa |
| Éxito | Tareas canónicas completadas | F0 | ≥ 8/10, sin regresión frente a la línea base |
| Eficiencia | Pasos y tokens por tarea | F0 | ≤ +10 % de la línea base; costo visible |
| Seguridad de permisos | Escrituras sin aprobación en casos adversariales | F0 | 0 |
| Continuidad | Reanudar la misma sesión en 3 superficies | F0 | p95 < 60 s; 0 tool calls duplicadas |
| Artifacts | Tareas de código con plan + diff + evidencia | F2 | ≥ 90 %; grabaciones 100 % reproducibles |
| Remoto | Enlaces caducados/reutilizados/Origin ajeno rechazados | F3 | 100 % |
| Aislamiento | Accesos cruzados entre inquilinos | F5 | 100 % denegados; 401 sin sesión |
| Realtime | Recuperación tras reconexión | F5 | 100 % con snapshot durable |
| Documentación | Filas de la matriz con estado y límite | Todas | 100 % |

La línea base se mide en F0, no se inventa aquí. Las tareas canónicas y el método quedan versionados en `docs/parity/`.

### 7.2 Definición de terminado de una fase

Una fase termina sólo si:

- [ ] La funcionalidad existe y tiene pruebas focalizadas; no se sustituyen aserciones por mocks para pasar.
- [ ] Si toca un proveedor externo, hay una ejecución real con recibo y limitaciones escritas.
- [ ] El camino local-first sigue funcionando sin cuenta, sin red y sin proveedor cuando aplique.
- [ ] La documentación de usuario y la matriz reflejan el estado real, incluidos los límites.
- [ ] Hay revisión de seguridad para remote, plugins, backend o realtime.
- [ ] Hay rollback o feature flag para lo riesgoso.
- [ ] Las métricas de la fase se registraron antes/después.
- [ ] `tsc --noEmit`, `vite build` y las pruebas de la fase están en verde.
- [ ] No hay secretos en código, logs, artifacts, releases ni capturas.

## 8. Riesgos y mitigaciones

| Riesgo | Prob. | Impacto | Mitigación |
| --- | --- | --- | --- |
| Faltan credenciales reales de Vercel/Linear/GitHub | Alta | Alto | F0 es explícito; F1 puede avanzar, F5 no. No se declara paridad con mocks. |
| El alcance crece por comparar tres productos a la vez | Alta | Alto | Puertas G0–G3, no objetivos y fases separadas; F6 sólo con aprobación. |
| El pair remoto expone código o approvals | Media | Alto | Loopback por defecto, enlace de un uso, caducidad, cookie, Origin/CSRF, control lease, revisión de seguridad. |
| Cambian las APIs de proveedores | Media | Medio | Adaptadores, tests de contrato, versiones y recibos por release. |
| Migración de sesiones/artifacts rompe datos | Media | Alto | Esquema versionado, migración tolerante, backup y prueba de reinicio. |
| Playwright/ffmpeg no empaqueta bien en Electron | Media | Medio | Video opcional, fallback a frames + informe, prueba en el instalador. |
| Un plugin ejecuta código no confiable | Media | Alto | Instalación explícita, manifiesto, permisos, revisión y aislamiento de fallos. |
| El backend gestionado se dispara en costo | Media | Alto | Cuotas, presupuestos, opt-in, proveedor decidido en G3. |
| LSP genérico consume el proyecto | Alta | Medio | No construir un LSP propio; usar TS service y diagnósticos del editor. |
| La UI de artifacts no se ve bien en Electron | Media | Medio | Verificación visual en el instalador, no sólo tests de jsdom. |

## 9. No objetivos de este plan

- Entrenar o poseer modelos fundacionales; Commander seguirá siendo multi-proveedor.
- Inferencia gratuita financiada por anuncios o un catálogo cerrado equivalente a Freebuff.
- Nube por defecto o workspace siempre encendido: lo remoto es opt-in y el host sigue siendo del usuario.
- App móvil nativa iOS/Android en este horizonte; la apuesta es PWA sobre la sesión local.
- Edición multiusuario en tiempo real y chat de equipo; el foco es una persona con varios dispositivos.
- Seis extensiones de IDE; VS Code primero y el resto sólo con demanda.
- Un runtime LSP universal; se integra el diagnóstico del editor y el language service existente.
- Un conector nativo para cada SaaS; el long tail va por MCP.
- SSO, VPC-SC, residencia regional y cumplimiento empresarial.
- Marketplace propio con pagos, firmas y ejecución automática de plugins de terceros.

## 10. Orden de ejecución

Con **2 personas** y sin bloqueos de credenciales:

| Semanas | Trabajo | Gate |
| --- | --- | --- |
| 1 | F0: verificación real + baseline | G0 |
| 2–3 | F1: CLI interactivo, sesiones, plan, subagentes | G1 |
| 4 | F2: artifacts y export | — |
| 5–6 | F3: pair/PWA + F4A: VS Code en paralelo | G2 antes de remote |
| 7 | F4B: hooks/plugins/MCP | — |
| 8–10 | F5A/5B: SSR + backend | G3 |
| 11 | F5C: realtime + hardening | — |
| 12 | Dogfooding, documentación, release | — |

Con **1 persona**, el mismo orden requiere aproximadamente 12–16 semanas. F3 y F4A son los únicos trabajos que se paralelizan bien; F5 no se adelanta antes de G0/G1.

**Primeros 30 días concretos:** cerrar F0, completar F1 y dejar F2 en revisión. No empezar F3/F4/F5 antes de G1; no empezar F6 sin una decisión explícita.

## 11. Fuentes

Documentación oficial consultada el **2026-11-07**. Los productos cambian rápido: F0 debe revalidar lo que aquí se afirma.

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

**Evidencia local principal:** `bin/commander.ts`, `src/cli/`, `src/agent/`, `browserSession.ts`, `pluginsRuntime.ts`, `publisher.ts`, `deploy/`, `backend/`, `vscode-extension/`, `tests/tenantBackend.test.ts` y los tres roadmaps del repo.

---

**Siguiente acción recomendada:** ejecutar F0 con credenciales reales y publicar `docs/parity/baseline-2026-11.md`; sin ese recibo, este plan sigue siendo una hipótesis de trabajo, no una declaración de paridad.

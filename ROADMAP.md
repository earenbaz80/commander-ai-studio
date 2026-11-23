# Roadmap autónomo — Commander AI Studio

> **Instantánea:** 2026-11-23. **Éste es el único roadmap del proyecto.** Paridad F0–F6, plataforma PL0–PL7 y UX 1.0 viven aquí con sus criterios, su alcance, sus métricas y su evidencia; la comparación con los competidores está en §8 y las reglas de cierre en §9. No hay otros documentos de roadmap: `ROADMAP_PARITY.md`, `ROADMAP_PLATFORM.md` y `ROADMAP_UX.md` se retiraron y sus enlaces vivos apuntan a este archivo.
>
> **Vista publicada:** [roadmap autónomo](https://earenbaz80.github.io/commander-ai-studio/roadmap-autonomo.html) — 67 % hacia el multiagente autónomo (2026-11-23), 15 de 27 pasos cerrados, con el avance por paso y su evidencia (fuente: [docs/roadmap-autonomo.html](docs/roadmap-autonomo.html)). Es una vista de este mismo roadmap con su propia numeración; el mapeo está en §7.
>
> **Evidencia:** [baseline F0](docs/parity/baseline-2026-11.md) · [runbook G1/F0](docs/parity/runbook-g1-f0.md) · [recibo F0 local](docs/parity/receipts/F0-LOCAL-2026-11-10.md) · [recibo del dogfooding G1](docs/parity/receipts/G1-DOGFOOD-2026-11-12.md) · [hoja de decisión del p95](docs/parity/g1-approval-gate-decision.md).

No promete fechas; los esfuerzos son órdenes de magnitud. Una fase o un criterio sólo pasa a **hecho** cuando existe evidencia en el árbol o un recibo verificable. Cuando no hay medición, se dice **sin medir**.

## 1. Estado en una vista

| Frente | Fases | Cerradas | Criterios en alcance |
| --- | ---: | ---: | ---: |
| Paridad | 7 | 1 (F0) | 21/47 |
| Plataforma | 8 | 1 (PL0) | 24/38 |
| UX | 1 | 1 (UX 1.0) | 10/10 |
| **Total** | **16** | **4/13 en alcance** | **55/95 (58 %)** |

- **4 fases cerradas:** F0, PL0, UX 1.0 y F2.
- **5 parciales:** F1, PL2, PL3, PL5 y PL6.
- **4 pendientes:** F3, F4, F5 y PL4.
- **Fuera del cómputo:** PL1 (fuera de alcance hasta G3) y F6/PL7 (opcionales).
- **Puertas:** G0 cerrada; G1 abierta (dogfooding ejecutado; **no retiene fases**, §2.1); G2 y G3 no iniciadas.

El 58 % cuenta criterios de fase, no esfuerzo, tiempo ni valor de producto. Tampoco dice que la app esté al 58 %: dice que 55 de los 95 criterios en alcance tienen evidencia. Cada criterio es una casilla de este documento: cuenta el `[x]` o la cobertura que la fase declara (F2 cerró con sus siete criterios y su verificación en Electron); los `[—]`, las fases opcionales y PL1 quedan fuera del numerador y del denominador. F0 cerró G0 con una baseline NVIDIA válida de 24 corridas (8/24, 0 timeouts y 0 inválidas); la paridad es baja. El dogfooding de G1 se ejecutó el 2026-11-12 (17/28, 60,7 %) y la puerta sigue abierta por una sola regla: el p95 de aprobación.

**El norte no es la cifra, es el producto:** un agente que corre local-first, que pide aprobación con diff antes de escribir, que deja evidencia revisable de lo que hizo y que puede instalarse y publicarse sin cuenta. Lo que sigue a §2 mide cuánto de eso está verificado.

## 2. Puertas

| Puerta | Exige | Estado | Qué la desbloquea |
| --- | --- | --- | --- |
| **G0** Verdad externa | GitHub verificado + línea base de 24 corridas | **Cerrada** | Baseline NVIDIA válida: 24 corridas, 0 timeouts |
| **G1** Dogfooding del CLI | 5 días y 24 corridas usando el CLI como superficie principal, sin retroceder frente a F0 | **Abierta** · dogfooding ejecutado; su única regla pendiente salió del roadmap | Sólo la cerraría un recibo humano de `latencyMs`; **no retiene ninguna fase** (§2.1) |
| **G2** Seguridad remota | Modelo de amenazas y revisión antes de habilitar `--remote` | **No iniciada** | Aprobar el modelo de amenazas remoto (`docs/parity/threat-model-remote.md`, todavía sin versionar) |
| **G3** Proveedor de plataforma | Proveedor y modelo de costo decididos antes de 5A | **No iniciada** | Decisión explícita de proveedor |

G1 no se cierra por ejecutar el dogfooding ni comparando contra una estimación: le falta que el producto cumpla el presupuesto de aprobación con una muestra humana válida. G2 bloquea F3; G3 bloquea F5A. Ninguna puerta se cierra por compilar o por tener tests con mocks.

### 2.1 Regla de cierre (2026-11-23)

**Cada fase se cierra con la evidencia de sus propios criterios y, si la tiene, con su puerta.** G1 rige **sólo F1**, la fase que existe para medir: por eso F1 queda «hecho en código» con G1 abierta y no se marca cerrada. Las fases posteriores **no heredan G1**: F2 se cierra con sus siete criterios y su verificación visual en Electron, automatizada en `npm run test:electron`; F3 con los suyos y con G2; F4 y PL3–PL6 con los suyos, sin puerta.

**Por qué.** El único rojo de G1 era el p95 de aprobación ≤ 15 151 ms, y ese bloque salió del roadmap por decisión del autor del 2026-11-23: no se ejecuta ni está agendado. Una puerta cuya única regla pendiente ya no se mide no puede quedar de guardia sobre fases que sí tienen evidencia; si lo hiciera, el roadmap quedaría bloqueado para siempre y la cifra de §1 dejaría de significar algo.

**Qué sigue significando G1.** No se declara cerrada por omisión: sigue abierta en §1, en la tabla de arriba y en los issues de §6, con el dogfooding del 2026-11-12 como recibo. Sólo la cerraría una muestra humana válida de `latencyMs` (n ≥ 40, ≤ 2 de 40 por encima) o una decisión explícita del autor que la retire como puerta. Mientras tanto, T10 y T2 se siguen trabajando por sus issues, no por la puerta.

**Lo que no cambia.** Ninguna fase se cierra por compilar, por tests con mocks o por «pasó una puerta que no le toca»: hace falta evidencia (ruta de código, test, recibo, URL) y, cuando la fase toca a un proveedor externo, una ejecución real.

## 3. Paridad — F0 a F6

Paridad significa **la misma capacidad de producto**, no la misma implementación, el mismo modelo ni la misma estética. Commander conserva local-first, Norton y Nono. De dónde sale cada exigencia está en §8 (matriz de competidores del 2026-11-07, que F0 revalida).

### F0 · Verdad y línea base — Hecho · G0 cerrada · P0 · 4–5 d · 6/6

**Alcance.** Verificar con cuentas reales dentro del alcance vigente: OAuth de GitHub (conectar, leer un PR, comentar con aprobación, revocar y comprobar que el token no aparece en UI/logs) y GitHub Actions (`/commander` en modo plan y `--write` en un repo de prueba, con PR y comentario reales). Medir 10 tareas canónicas (bugfix, feature pequeña, refactor, tests, revisión, browser, deploy, permiso denegado, resume y subagente) con 2 corridas, y 3 en las 4 críticas, registrando éxito, pasos, tokens/costo, aprobaciones, duración y fallos. Revisar la matriz de §8 marcando cada fila con evidencia o con «sin verificar». Corregir sólo los defectos que impidan la verificación, sin abrir features nuevas. **Fuera:** Vercel en pausa hasta G3 y Linear fuera de alcance (2026-11-10); ninguna de las dos bloquea F0 ni se declara verificada.

- [x] GitHub completa OAuth real: lectura de un PR, comentario con aprobación y revocación que invalida el acceso (recibo `F0-LOCAL-2026-11-10` §8).
- [x] GitHub Actions ejecuta `/commander` en modo plan y `--write` en el repo de prueba; el comentario y el PR son reales (recibo `F0-LOCAL-2026-11-10` §11).
- [x] Ningún token, `.env`, source map ni secreto aparece en artifacts, logs o respuestas.
- [x] Existe `docs/parity/baseline-2026-11.md` con metodología, resultados y limitaciones.
- [x] `tsc --noEmit`, `vite build` y las pruebas focalizadas siguen en verde (recibo `F0-LOCAL-2026-11-10` §2).
- [x] La línea base de 24 corridas (T1–T10) está medida y registrada con NVIDIA (8/24, 0 timeouts, 0 inválidas).
- [—] ~~App Vite de ejemplo con URL real de preview y producción y content types correctos~~ **en pausa hasta G3 (2026-11-10):** no hay cuenta de Vercel.
- [—] ~~Rollback real en menos de 30 s y estado persistente tras reiniciar contra el proveedor~~ **en pausa hasta G3 (2026-11-10).**
- [—] ~~Linear completa OAuth real~~ **fuera de alcance por decisión (2026-11-10):** no hay cuenta de Linear.

**G0 cerrada (2026-11-11).** GitHub verificado y baseline registrada; Vercel en pausa hasta G3 y Linear fuera de alcance no forman parte de la puerta.

### F1 · Núcleo de agente y CLI — Hecho en código · G1 abierto · P0 · 10–12 d · 8/8

**Alcance.** Modo interactivo en `commander`/`commander agent` con prompt multi-turno, selección de modelo/agente y comandos `/plan`, `/build`, `/review`, `/compact`, `/undo`, `/resume`, `/fork`, `/exit`. Aprobaciones en terminal con diff por hunk (aprobar, denegar, recordar para la sesión) y `ask_user` con opciones y texto libre. Mantener `--json` y el contrato NDJSON de la extensión y CI, y añadir `--resume <id>`/`--fork <id>` sin romper flags existentes. Sesión autoritativa en el servidor: el CLI se conecta al servidor embebido y no reimplementa el bucle; al salir y volver, historial, plan y approvals se conservan. Activar `update_plan` en el CLI con estados (`pending`, `in_progress`, `done`, `blocked`), archivos y criterios. Ampliar el catálogo de subagentes a al menos 6 roles (explorer, planner, coder, reviewer, tester, researcher) con allowlist de tools, modo y `maxSteps`, con worktree por subagente cuando se pida. Reutilizar exactamente el motor de permisos del escritorio: el CLI no puede saltarse una regla `ask`/`deny`.

Los 14 issues de F1 están cerrados ([backlog](docs/parity/backlog-f1.md), 21,0 d-persona): `ask_user` en el CLI (`b01264a`), REPL multi-turno, diff por hunk, paridad de permisos del escritorio, seis roles de subagente con allowlist y worktree, y plan persistente con estados, archivos y criterios.

- [x] `commander agent "tarea" --json` conserva su salida y sus consumidores actuales.
- [x] `commander` abre una sesión interactiva; una edición pide aprobación con diff, y denegar no escribe ni un byte.
- [x] `ask_user` bloquea la corrida hasta recibir respuesta y la respuesta queda en el historial (F1-06, `b01264a`).
- [x] Una tarea iniciada en CLI aparece en el escritorio con el mismo `sessionId`, pasos y plan; `--resume` continúa sin duplicar tool calls y `--fork` no muta la original.
- [x] El plan se actualiza durante la corrida y sobrevive a un reinicio del servidor.
- [x] Un subagente con una tool denegada falla cerrado; 6 subagentes pueden correr en paralelo y el worktree no contamina el árbol principal.
- [x] 10 casos adversariales de permisos (shell, escritura, red, MCP, subagente) no ejecutan nada fuera de política.
- [x] Pruebas focalizadas del CLI/sesiones, `tsc --noEmit` y `vite build` en verde.

**G1 sigue abierta con el dogfooding ejecutado.** D1–D5 se corrieron el 2026-11-12 con modelo y `maxSteps` congelados: 24 corridas planificadas, 28 válidas y **17 `passed` (60,7 %)** frente a 8/24 (33,3 %) de F0, con 0 escrituras sin aprobación, 0 duplicadas en `--resume`, 0 secretos y 0 fallbacks ([recibo](docs/parity/receipts/G1-DOGFOOD-2026-11-12.md)). Siete de las ocho reglas están en verde; la única en rojo es el **p95 de aprobación ≤ 15 151 ms**: 76 982 ms (n=40, operador automatizado), 65 056 ms en CAL2 (n=6) y 26 501 ms en CAL4 (n=41), este último **no válido como muestra humana**. La [hoja de decisión](docs/parity/g1-approval-gate-decision.md) deja rigiendo la **salida B**: la referencia no se toca y la casilla sólo pasa a verde con `latencyMs`, n ≥ 40 y ≤ 2 de 40 por encima. **Ese bloque sale del roadmap por decisión del autor del 2026-11-23:** no se ejecuta, no está agendado y G1 sigue abierta sin fecha; por la regla de §2.1 retiene sólo a F1.

**T10 no es regla de puerta.** Sigue **0/3 en las 24** (0/9 con las extras) con issue propio; fuera de ellas, `G1-T10-15` dio **6/6 con los siete checks** y `G1-SUBAGENT-CLOSE` quedó cerrado con el riesgo residual de los worktrees `prunable` declarado. `G1-EMPTY-TURN` sigue abierto. Detalle en §6.

### F2 · Artifacts de verificación — Hecho y verificado en Electron · P1 · 6–8 d · 7/7

**Alcance.** Plan artifact (pasos, estado, archivos tocados, criterios y decisiones, enlazado a la sesión), diff artifact (parche completo, revisión por hunk, comentarios, aplicar/descartar y auditoría de lo aplicado), grabación de navegador (WebM con la misma sesión de Playwright y log JSON de consola/red; si no hay encoder, frames + informe, nunca un MP4 falso), evidencia de tests (comando, `exitCode`, duración, versión de Node/SO, commit y cola de stdout/stderr, con un test fallido que no puede pintarse verde), informe local HTML/Markdown autocontenido sin peticiones externas ni secretos, y visor de artifacts con filtros por proyecto/sesión y «abrir carpeta», sin subida remota por defecto.

Plan, diff, evidencia de tests, informe local, visor, revisión por hunk con auditoría y grabación WebM: F2-01 a F2-09 están hechos ([backlog](docs/parity/backlog-f2.md)) y la verificación visual ya no es manual: `npm run test:electron` (`tests/e2e/electron/artifacts.spec.ts`) lanza el ejecutable de `release/win-unpacked`, siembra los fixtures en IndexedDB, recarga el renderer y exige tarjetas, diff por hunk, evidencia con el test en rojo, «Reproducir el fallo», caja con tamaño, fondo con estilos, cero desborde horizontal, fuentes cargadas y ninguna excepción del renderer; deja la captura en `test-results/electron/artifacts-view.png`. El E2E de Chromium sigue cubriendo los tres proyectos de navegador.

- [x] Una tarea de código produce plan, diff, evidencia de tests y (si hubo navegador) grabación, todos enlazados al mismo `sessionId`.
- [x] El estado del plan coincide con las tool calls reales; un paso bloqueado se distingue de uno completado.
- [x] El diff se puede revisar por hunk y el artifact registra quién aplicó qué.
- [x] Una grabación de al menos 30 s se reproduce offline en Chromium y incluye consola/red con timestamps.
- [x] La evidencia de tests muestra `exitCode != 0` en rojo y no genera un “passed” si el comando falló o no llegó a ejecutarse.
- [x] El informe se abre desde el disco sin red, sin secretos y sin recursos externos.
- [x] Los artifacts sobreviven a reiniciar la app y siguen siendo locales; no requieren cuenta.

### F3 · Continuidad remota y PWA — Pendiente · espera G2 · P1 · 10–14 d · 0/8

**Alcance.** `commander pair` con enlace de un solo uso, QR y caducidad de 5 minutos, cookie de sesión de 30 días y `--remote` explícito para exponer fuera de loopback. Cliente web responsive/PWA con sesiones, chat, plan, approvals, artifacts y estado de trabajos; no es un IDE ni un editor de código. **Control lease:** un dispositivo controla la sesión y los demás ven en lectura, con traspaso explícito y auditado. Registro de dispositivos, revocación, auditoría por dispositivo, rate limit, CSRF y `Origin` ajeno → 403. Streaming reanudable: al caer la red el cliente se reconecta y pide el estado, y las approvals son idempotentes.

Continuar la misma sesión desde el móvil o el navegador con la misma política de aprobación, sin convertir a Commander en una nube. Requisito previo: el modelo de amenazas remoto (`docs/parity/threat-model-remote.md`, **todavía sin versionar**); `--remote` no se habilita en una release hasta que esa revisión pase.

- [ ] Se inicia una tarea en escritorio, se empareja el móvil, se ve la misma sesión y se aprueba un diff; el escritorio refleja la aprobación sin duplicar pasos.
- [ ] El enlace caduca a los 5 minutos, no se puede reutilizar y un `Origin` ajeno recibe 403.
- [ ] El servidor escucha sólo loopback por defecto; sin `--remote`/túnel explícito no hay puerto público.
- [ ] Revocar un dispositivo invalida su cookie y queda registrado en la auditoría.
- [ ] Dos clientes no pueden escribir a la vez; el traspaso de control se prueba y no se pierden eventos.
- [ ] Tras una caída de red, el cliente se reconecta, recupera el estado y no repite una aprobación ya aplicada.
- [ ] La vista de 390×844 no tiene scroll horizontal y permite aprobar/denegar con el diff visible.
- [ ] Ningún token de emparejamiento, cookie o secreto aparece en la URL, logs o artifacts.

**G2** exige la revisión de seguridad antes de habilitar `--remote` en builds de release; si no pasa, queda sólo el cliente local en loopback.

### F4 · Editor y ecosistema — Pendiente · P1 · 12–15 d · 0/11

**Alcance 4A (extensión VS Code).** Compilar e instalar el `.vsix`, arrancar/reutilizar el servidor embebido sin exigir `npx` en producción, webview de chat con streaming, modelo/modo, selección de código como contexto, plan y approvals con diff; abrir archivo/línea desde un resultado de tool, mostrar diagnósticos del editor y conservar la misma sesión del escritorio, sin duplicar el bucle del agente.

**Alcance 4B (hooks, plugins y política MCP).** Lifecycle `sessionStart`, `beforeModel`, `afterModel`, `beforeTool`, `afterTool`, `sessionEnd`, `stop` y `error` con timeout, orden y aislamiento de fallos; manifiesto de plugin con versión de API y permisos declarados, catálogo con instalación revisable y checksum, y nada de ejecutar código sin instalación explícita; MCP con política por tool (`allow`/`ask`/`deny`), salud/reintento, alcance por proyecto y errores visibles; importación de skills compatibles con `SKILL.md`, precedencia proyecto > global y validación de front matter.

Llevar el agente al editor dominante y convertir la extensibilidad en una API estable, no en dos hooks ad-hoc. Paridad de IDE limitada a VS Code: JetBrains/Zed/Xcode sólo con demanda.

#### 4A · Extensión de VS Code útil (5)

- [ ] Instalación del VSIX en un VS Code limpio y tres tareas reales (leer, editar, revisar) completadas.
- [ ] Una aprobación aplica el diff al workspace y el archivo abierto refleja el cambio.
- [ ] “Ir a la definición” desde un resultado abre el archivo y la línea correctos.
- [ ] La sesión iniciada en VS Code aparece en el escritorio con el mismo id.
- [ ] No hay una segunda implementación del loop ni del motor de permisos.

#### 4B · Hooks, plugins y política MCP (6)

- [ ] Un plugin de referencia ejecuta los hooks en orden y un hook que lanza no rompe la corrida.
- [ ] Un plugin no puede saltarse una regla `deny` del motor de permisos.
- [ ] Una tool MCP denegada no se ejecuta y el modelo recibe un error estructurado.
- [ ] Se importan skills de tres formatos soportados y una skill inválida no se carga.
- [ ] Un plugin con versión de API incompatible se rechaza sin ejecutar código.
- [ ] La instalación y desinstalación no dejan servidores MCP huérfanos ni archivos fuera de `.commander/`.

### F5 · SSR, backend y realtime — Pendiente · espera G3 · P1 · 18–25 d · 0/7

**Alcance 5A (hosting SSR/Workers).** Extender `DeploymentAdapter` para `ssr`/`worker`, elegir proveedor en G3 (Vercel fuera por la decisión del 2026-11-10; candidato natural, Cloudflare Workers), variables públicas/secretas, logs, previews, dominios y rollback.

**Alcance 5B (backend gestionado).** Aprovisionar auth, DB y storage por app reutilizando el contrato y las garantías de aislamiento de `/api/backend`, con migraciones, cuotas, backup/export y borrado.

**Alcance 5C (realtime).** Salas autenticadas, snapshots durables y reconexión, con el cliente sin poder elegir `userId` ni capacidades y el estado crítico en el servidor.

Plantilla full-stack de referencia: registro/login/logout, CRUD, subida de archivo y una sala realtime. Que una app creada en Commander se pueda publicar completa (auth, datos, archivos y realtime) sin fingir que un build estático es full-stack.

- [ ] Una app SSR de ejemplo se despliega en preview y una ruta dinámica responde con variables de entorno correctas.
- [ ] Registro, login, logout y sesión funcionan; sin sesión, las rutas privadas responden 401.
- [ ] Dos usuarios no pueden leer ni modificar datos ni archivos del otro; un recurso ajeno responde 403.
- [ ] Dos clientes realtime reciben eventos; al desconectarse y volver, recuperan el snapshot sin perder el estado durable.
- [ ] Rollback y logs funcionan; los secretos no llegan al cliente, a la release ni a los logs.
- [ ] La app sigue funcionando en local sin cuenta y sin red; el camino local no depende del proveedor.
- [ ] No se publica en producción sin autorización explícita del usuario.

**G3** decide proveedor y modelo de costo antes de 5A; Vercel quedó fuera por la decisión del 2026-11-10 y Cloudflare Workers es sólo un candidato. Sin proveedor verificado, Commander publica local/estático y lo dice.

### F6 · Apuestas opcionales — no comprometido · P2 · 20–30 d · n/c

**No forma parte del compromiso P0/P1** y no se empieza por imitación. *Ejecución remota/cloud:* una tarea corre en un workspace aislado, sin acceso al FS del host, con upload/download explícito, logs, cancelación, reconexión y presupuesto; paridad funcional con Remote Agents/Freebuff Cloud, no con su escala. *Automatizaciones/cron:* horario, historial, política de approvals, presupuesto y parada, sin escrituras desatendidas sin opt-in. *Voz conversacional:* el dictado ya existe; full-duplex con interrupción sólo con demanda y un proveedor de audio verificable. *Equipos/SSO:* cuentas compartidas, roles, auditoría y SSO, que exigen un modelo de identidad que no existe y no se improvisa en F3. **Puertas para empezar:** demanda de usuarios, revisión de seguridad, modelo de costo y prueba de que no degrada el camino local-first.

## 4. Plataforma — PL0 a PL7

Hosting, backend, conectores y cuenta, sin dejar de ser local-first. Lo remoto es opt-in y el artefacto se construye una vez y se despliega tal cual. Cada fase trae su alcance, sus decisiones tomadas y sus criterios; el detalle de implementación y los recibos viven en `docs/parity/`.

### PL0 · Contrato de despliegue — Hecho · P0 · 2–3 d · 5/5

**Alcance.** `DeploymentAdapter` con `detectProject(root)` (estático, SPA, Workers/SSR o desconocido), `deploy(releaseDir, environment)`, `promote(deploymentId, environment)`, `rollback(environment)`, `status(environment)` y `logs(deploymentId)`. Extender el estado local sin romperlo: `state.json` sigue siendo la fuente de verdad y se añade `remote: { provider, preview, production, deployments }` con migración tolerante, donde un `release.id` local puede mapear a uno o varios IDs remotos. Manifiesto opcional `commander.app.json` (tipo de app `static`/`spa`/`worker`/`ssr`, comando de build, carpeta de salida, variables públicas y bindings de `database`, `storage`, `auth` y `realtime`). Test double en memoria para preview, promoción y rollback sin red; no es un backend de producción. Archivos: `deploy/types.ts`, `deploy/adapter.ts`, `deploy/fakeAdapter.ts`, `deploy/preflight.ts`, `deploy/stateStore.ts`, `publisher.ts`. **Decisión tomada:** Vercel como primer proveedor (en pausa hasta G3), builds `static`/`spa` y rechazo claro de `worker`/`ssr`, credenciales sólo en el servidor, entornos preview/producción fijos sin dominios personalizados ni previews por rama.

- [x] El publicador local actual sigue pasando sus pruebas sin cambios de comportamiento.
- [x] Un estado antiguo sin `remote` se lee y se guarda con migración.
- [x] El test double en memoria completa preview → producción → rollback.
- [x] Ninguna interfaz nueva exige credenciales para publicar en local.
- [x] `tsc --noEmit` y `vite build` en verde.

### PL1 · Hosting remoto de estáticos — Fuera de alcance · código listo · P1 · 4/4 + 3 fuera

Adaptador, rutas y UI implementados; **no hay despliegue real**: la cobertura es con `fetch` simulado y un servidor de contrato. Fuera del cómputo hasta G3.

**Alcance.** Primer `DeploymentAdapter` real para builds estáticas/SPA, reutilizando el artefacto de `createRelease` sin volver a compilar al promover. Rutas `GET /api/deploy/status?root=…`, `POST /api/deploy/preview`, `POST /api/deploy/production`, `POST /api/deploy/rollback` y `GET /api/deploy/logs`. UI en `PublishView.tsx` con selector Local/Remoto, URL por entorno, estado del deployment y botones de abrir, promover, rollback y ver logs. Persistir el mapeo release local ↔ deployment remoto. Preflight antes de subir: rechazar `.env*`, `.npmrc`, `.netrc`, symlinks y archivos fuera de la release, avisar de source maps o secretos evidentes y comprobar tamaño y número de archivos. **Fuera:** SSR/Workers, funciones serverless, dominios personalizados y CI/CD externo o deploys en cada push.

- [ ] Una app Vite de ejemplo se publica en preview y devuelve una URL pública que carga HTML, JS y CSS con los content types correctos. **Pendiente de verificación real:** los tests usan un `fetch` simulado.
- [x] Promover preview a producción no vuelve a compilar ni a copiar la release (cubierto en `vercelAdapter.test.ts`).
- [ ] Rollback vuelve a la release anterior en menos de 30 segundos. **Pendiente de medición real.**
- [ ] El estado sobrevive a reiniciar Commander. **Pendiente de prueba real.**
- [x] Un fallo del proveedor deja el estado local en un estado recuperable, no en “publicado”.
- [x] El token del proveedor no aparece en la respuesta HTTP, en el renderer ni en los logs.
- [x] La release no contiene `.env*`, `.npmrc`, `.netrc` ni symlinks.

### PL2 · Navegador real y artifacts — Hecho con límites · P2 · 8/8

**Alcance.** Exponer la sesión de `browserSession.ts` al renderer (`POST /api/browser/session`, `GET /api/browser/session/:id/stream`, `POST /api/browser/session/:id/input`, `GET /api/browser/session/:id/logs`). Sustituir el iframe de `BrowserView.tsx` por una vista de frames y conservar la barra de URL. Reutilizar `LiveConsole` y `NetworkMonitor` con eventos reales, eliminando datos de demo y el comando simulado. Añadir selector de sesión, captura, grabación local e indicador de «agente controlando» / «usuario controlando». Mantener intacta la tool `browser` (`open`, `navigate`, `snapshot`, `click`, `type`, `press`, `scroll`, `screenshot`, `logs`, `close`) y respetar la guardia SSRF y la aprobación fuera de loopback. Implementado además: grabación de frames JPEG desde el SSE con botón **REC**, persistencia en IndexedDB con límite de 120 s y 180 frames, reproductor con timeline, marcadores y comentarios anclados a `atMs` y a coordenadas normalizadas, y auto-apertura de Artifacts al detener la grabación. **Límites:** ~1,4 fps (un frame cada 700 ms), sin captura bajo demanda, sin MP4, sin exportación ni visor remoto, y sin verificación visual en Electron.

- [x] Un dev server local se ve en el panel y el agente puede hacer clic en un elemento visible (fixture local en `browserSse.test.ts`; sin verificación visual en Electron).
- [x] La consola muestra un `console.error` real de la página.
- [x] El monitor de red muestra una petición 404 real, con método, URL, estado y duración.
- [x] Usuario y agente comparten la misma sesión; un clic del agente se refleja en el panel.
- [x] Al cerrar y reabrir el panel, la sesión se reconecta o se explica que expiró.
- [x] No queda ningún texto de “demo” ni de “simulate” en la ruta de preview.
- [x] Navegar fuera de loopback sigue pidiendo aprobación.
- [x] Grabar una sesión, guardar frames y comentarios, y revisarlos (UI e IndexedDB; sin verificación visual en Electron).

### PL3 · Backend gestionado — Parcial: contrato, app de ejemplo y panel · P0 · 2–3 sem · 5/7

**Alcance.** `BackendAdapter` con `provision(projectId, bindings)`, `migrate(projectId, migrations)`, `status(projectId)` y `rotateSecrets(projectId)`. Tres bindings iniciales: base de datos relacional/SQL, object storage y auth para la app publicada. Ampliar `commander.app.json` con `backend.database`, `backend.storage`, `backend.auth`, migraciones en `migrations/` y variables por entorno. Credenciales sólo en el entorno de despliegue, nunca en el bundle del cliente. Ejemplo funcional: registro/login, crear una fila propia, subir un archivo propio, cerrar sesión. Aislamiento: consultas filtradas por `user.id` en el servidor, IDs de recurso nunca confiados al cliente, 401 sin sesión y 403 para recursos ajenos. Archivos previstos: `deploy/backend/types.ts`, `deploy/backend/<provider>.ts`, `deploy/migrations.ts`, `PublishView.tsx`, `tests/unit/backendProvision.test.ts`, `tests/backendEndpoints.test.ts`, app de referencia en `examples/` o `templates/`. **Decisiones abiertas:** proveedor gestionado o también self-hosted; auth del proveedor o reutilizar la cuenta de Commander (recomendación: aislar, cada app su tenant); flujo explícito de exportación/borrado al borrar la app.

`BackendAdapter` con `provision`/`migrate`/`status`/`rotateSecrets`, bindings de base de datos, storage y auth por app, y una app de ejemplo con aislamiento entre cuentas. Hecho: el contrato y su doble en memoria (`deploy/backend/`), las rutas `/api/backend/manage`, el runner de migraciones SQLite real (`deploy/backend/migrations.ts`, `schema_migrations`, una transacción por migración) y la app de referencia `examples/pl3-backend-app` —registro/login, notas y archivos con 401/403 y una base y un storage por proyecto— con su suite (`tests/unit/pl3ExampleApp.test.ts`, 11 casos). Las rutas `/provision`, `/migrate` y `/rotate` están expuestas: la rotación entrega el valor al sink del adaptador y responde sólo nombres; al publicar preview, producción o volver atrás, ese valor se escribe en el entorno de la release (`<publish>/<slug>/env/…`, fuera del árbol servido) para que lo lea el runner de la app (`tests/unit/releaseEnv.test.ts`). La app de ejemplo lee ese archivo al arrancar por `--env-file <ruta>` o `PL3_RELEASE_ENV` y deja las credenciales en `process.env` antes de abrir la base; por HTTP y en el banner sólo salen los nombres (`tests/unit/pl3ExampleReleaseEnv.test.ts`). El panel de `PublishView` muestra estado, bindings y migraciones sin valores de credenciales y permite rotar; router, HTTP y UI están cubiertos en `tests/unit/backendManageRoutes.test.ts`, `tests/backendManageEndpoints.test.ts` y `tests/ui/BackendBindingsPanel.test.tsx`. Falta lo que depende de G3: aprovisionar contra un proveedor real y que esos valores lleguen también al entorno de un despliegue remoto; hoy el único adaptador seleccionable es el doble tras `COMMANDER_BACKEND_FAKE=1` y el entorno se escribe junto a la release local.

- [ ] Un proyecto nuevo aprovisiona base de datos, storage y auth desde la UI o un comando explícito.
- [x] Las migraciones se ejecutan en el servidor y son idempotentes.
- [x] La app de ejemplo permite registro, login, creación de datos y subida de archivo.
- [x] Dos cuentas distintas no ven datos ni archivos de la otra.
- [x] Una petición sin sesión recibe 401; una petición a un recurso ajeno recibe 403.
- [ ] Las credenciales no aparecen en el HTML, JS público, logs ni repositorio.
- [x] El estado del backend se puede consultar sin exponer secretos.

### PL4 · Realtime para apps — Pendiente · depende de PL3 · 1 sem · 0/5

**Alcance.** `RealtimeAdapter` con salas, presencia, publicación de eventos y tickets de conexión autenticados. Ticket de corta duración emitido por el servidor: el navegador nunca decide `userId` ni permisos. Persistencia authoritative en la base de datos y realtime sólo como notificación. Throttle de eventos interactivos, sin bucles de heartbeat. Pruebas con dos clientes, sala no autorizada, desconexión y reconexión. Archivos previstos: `deploy/realtime/types.ts`, `deploy/realtime/<provider>.ts`, ruta de ticket y `tests/realtimeEndpoints.test.ts`, `tests/unit/realtimeTicket.test.ts`.

Salas, presencia y eventos con tickets autenticados; el estado crítico queda en la base y realtime sólo notifica.

- [ ] Dos clientes autenticados en la misma sala reciben eventos.
- [ ] Un cliente que no pertenece a la sala recibe 403.
- [ ] El ticket expira y no se puede reutilizar.
- [ ] Tras reconectar, el cliente recarga el snapshot authoritative.
- [ ] Los eventos no se usan como fuente de verdad para permisos ni para reglas de negocio.

### PL5 · Conectores nativos — GitHub verificado · Linear fuera · P1 · 6/7

**Alcance.** Registro de conectores (`id`, nombre, icono, scopes, URLs de autorización/token, herramientas expuestas y permisos requeridos). Almacén de tokens cifrado con `safeStorage` de Electron cuando esté disponible y fallback a archivo cifrado con clave del sistema; nunca `localStorage`. OAuth con PKCE, state y callback loopback, con refresco automático y revocación. Conectores verticales: Linear (`whoami`, `list_teams`, `list_issues`, `create_issue`) y GitHub (OAuth para `github.pr`/`github.comment`, con fallback a `GITHUB_TOKEN`). UI con conectado/desconectado, cuenta y scopes, botón de revocar y último uso. Archivos: `src/integrations/*`, `src/components/settings/IntegrationsSettings.tsx`, `src/agent/tools/{linear,github}.ts`, `tests/unit/integrations.test.ts`, `tests/integrationsEndpoints.test.ts`.

OAuth con PKCE, vault AES-256-GCM, refresh y revocación remota. GitHub verificado con cuenta real (recibo §8 y §11); Linear no se configura.

- [x] Conectar, usar una herramienta y desconectar GitHub con una cuenta real (recibo §8). **Linear:** fuera de alcance (2026-11-10).
- [ ] El token sobrevive a un reinicio y se refresca si expira. **Implementado** con vault y refresh de un solo vuelo; **el refresco no está verificado**.
- [x] Revocar elimina el token local y no deja copias en logs.
- [x] Los scopes son visibles antes de autorizar (`repo,read:user` en GitHub).
- [x] Un fallo de OAuth no bloquea el resto de la app.
- [x] `src/mcp/oauth.ts` deja de ser la única vía de tokens persistentes.
- [x] Dos conectores comparten vault, callback y flujo PKCE.

Pendiente real: revisar los scopes de GitHub (`repo` es amplio) y decidir si se ofrece `public_repo`.

### PL6 · Skills de cuenta y plantillas — Parcial · P2 · 1–2 sem · 0/6

**Alcance.** Formato de «skill pack» con manifiesto (`id`, versión, descripción, permisos, compatibilidad), contenido Markdown/recursos, checksum, origen y autor. Sincronización con la cuenta: instalar, actualizar, desinstalar, cache offline y resolución de conflictos por versión. Catálogo curado de plantillas con preview antes de crear, una plantilla = proyecto completo y categorías/búsqueda. Reutilizar `skills/loader.ts` y el marketplace de plugins, sin un segundo cargador paralelo. Permisos explícitos: una skill no puede ejecutar shell ni escribir fuera del proyecto sin declararlo. Archivos previstos: `skills/pack.ts`, `skills/sync.ts`, `ExtensionsSettings.tsx`, `src/data/composerTemplates.ts`, `tests/unit/skillPack.test.ts`, `tests/ui/ExtensionsSettings.skills.test.tsx`.

Hay catálogo de plugins y cinco plantillas locales; falta que skills y plantillas viajen con la cuenta.

- [ ] Una skill instalada en una máquina aparece en otra tras iniciar sesión.
- [ ] Se puede usar sin conexión con la última copia cacheada.
- [ ] Actualizar una skill no duplica archivos ni deja huérfanos.
- [ ] Desinstalar borra sólo lo que instaló.
- [ ] Una skill con permisos no declarados se rechaza o pide aprobación.
- [ ] Una plantilla crea un proyecto que compila sin pasos manuales ocultos.

### PL7 · Workspaces remotos — Opcional · no iniciar sin decisión · 4–6 sem · 0/5

**Alcance mínimo si se aprueba.** Runner remoto con Node, shell, PTY y filesystem efímero o persistente; sincronización explícita de workspace sin sync implícito de secretos; cola de trabajos y reconexión; auth de usuario y aislamiento por workspace; límites de CPU, memoria, disco y tiempo; visor de logs y artefactos **remotos** (los artifacts locales del navegador no cubren este caso). **Decisión previa:** cambia el modelo del producto; si Commander sigue siendo una app personal local-first, se queda fuera y se documenta como no objetivo. No se empieza «porque Freebuff lo tiene».

Ejecutar el agente fuera de la máquina cambia el modelo del producto y no se inicia por imitación.

- [ ] Un trabajo lanzado en la nube sobrevive a cerrar el portátil.
- [ ] Al reconectar, el usuario ve el estado y los artefactos.
- [ ] Un workspace no puede leer archivos de otro.
- [ ] Los secretos se inyectan en el runner, no en la imagen ni en el repositorio.
- [ ] Se puede cancelar y limpiar un workspace sin dejar procesos huérfanos.

## 5. UX 1.0 — Hecho · 10/10

Estilo retro Norton intacto (`#000080`, `#00ffff`, `#ffff55`), single-process y Nono como diferenciador. Cada punto está implementado con su archivo y su evidencia:

| # | Mejora | Estado | Evidencia |
| --- | --- | --- | --- |
| 1. | Command palette | **Hecho** | `CommandPalette.tsx` + `paletteSearch.ts` + `useCommandPaletteShortcut.ts` |
| 2. | Layout 3 paneles | **Hecho** | `ResizableSplit.tsx` + `layoutStore.ts` |
| 3. | Diff viewer | **Hecho** | `DiffViewer.tsx` en `AgentApprovalModal.tsx`, por hunk |
| 4. | Status bar | **Hecho** | `StatusBar.tsx` en `App.tsx` |
| 5. | Nono acoplable | **Hecho** | `NonoDock.tsx` sobre `ResizableSplit` |
| 6. | Streaming de shell.run | **Hecho** | `ShellJobLog.tsx` (polling de `shell.job` cada 1000 ms) |
| 7. | Sidebar de sesiones | **Hecho** | Historial del `Sidebar` por proyecto y resume con un clic |
| 8. | Atajos | **Hecho** | `useKeyboardShortcuts.ts` + modal de atajos |
| 9. | Empty states | **Hecho** | `EmptyState.tsx` en chat, árbol y agente |
| 10. | Consolidar playgrounds | **Hecho** | `Playground.tsx` monta los seis modos |

Fuera de alcance: LSP propio, file watcher, paleta, tipografía y el rol de Nono.

## 6. Issues de G1

Los cuatro son de diagnóstico o de producto: ninguno tiene número en GitHub, ninguno cambia un criterio de tarea y ninguno mueve el umbral de 15 151 ms. El detalle vive en [docs/parity/issues/](docs/parity/issues/README.md).

| Issue | Estado | Criterio o medición | Qué queda |
| --- | --- | --- | --- |
| [G1-EMPTY-TURN](docs/parity/issues/G1-EMPTY-TURN.md) | **Abierto** | T9: turno vacío del proveedor (`finish_reason: "length"`, `content` vacío) que tumbó `G1-D4-03`/`03R` | Causa reproducida y arreglo aplicado en los cuatro puntos (2026-11-23); falta re-medir T10 |
| [G1-T2-READ-LOOP](docs/parity/issues/G1-T2-READ-LOOP.md) | **Abierto** | T2 sigue **0/2** en F0 y en G1 | Guardas de lecturas, tope de avisos y cierre del callejón de `fs.propose` aplicados; el criterio no se toca |
| [G1-APPROVAL-SHELL-TAIL](docs/parity/issues/G1-APPROVAL-SHELL-TAIL.md) | **Abierto** | Cola de `shell.run` de CAL4 (10 de 21 `allow` > 15 151 ms, p95 26 820 ms), evidencia descriptiva | P0 y P1 implementados; el **P2 (CAL4H) en pausa** por decisión del 2026-11-23 |
| [G1-SUBAGENT-CLOSE](docs/parity/issues/G1-SUBAGENT-CLOSE.md) | **Cerrado** (2026-11-23) | T10 sigue **0/3** en las 24 (0/9 con las extras) | Cierre sobre el **6/6 con siete checks** de [`G1-T10-15`](docs/parity/receipts/G1-T10-15-2026-11-23.md); riesgo residual `prunable` declarado |

## 7. Vista gráfica y mapeo de etiquetas

El roadmap visual numera sus cinco bloques `F0`–`F4`, y esas etiquetas **no** son las fases `F0`–`F6` de §3 ni las `PL0`–`PL7` de §4: coinciden en la letra y no en el contenido. Para citar un paso se escribe el id completo (`F2-4`, `F4-1`) y se dice de qué documento sale.

| Bloque del visual | Qué cubre aquí | Colisión a vigilar |
| --- | --- | --- |
| **F0 · Núcleo del agente** (`F0-1`…`F0-10`) | Paridad **F0** (verdad y línea base) y **F1** (núcleo de agente y CLI) | El `F0` del visual no es el `F0` de paridad: el visual reparte en diez pasos lo que aquí son dos fases con G0 y G1 |
| **F1 · Fiabilidad medida** (`F1-1`…`F1-6`) | Paridad **F1** y puerta **G1** | No es una fase nueva: mide F1 y su puerta |
| **F2 · Distribución del CLI** (`F2-1`…`F2-3`) | Sin fase equivalente: entrega del paquete (criterio de F1 y contrato de PL0) | El `F2` del visual no es el `F2` de paridad (artifacts de verificación) |
| **F2-4 · Extensión de VS Code** | Paridad **F4** (4A) | El paso `F2-4` cuelga de `F2` pero su fase es `F4` |
| **F3 · Continuidad de superficies** (`F3-1`…`F3-4`) | Paridad **F3**; la parte de hosting queda sujeta a **PL1** y a G3 | Coincide en tema, no en criterios: aquí no hay G2 |
| **F4 · Plataforma** (`F4-2`, `F4-3`) | `F4-2` (marketplace) es la apuesta **F6**/PL6; `F4-3` (coste y tokens) no tiene fase | El `F4` del visual no es el `F4` de paridad (editor) |
| **F4-1 · Backend de las apps publicadas** | Plataforma **PL3**, con **PL4** detrás | El paso `F4-1` no es la fase `F4` de paridad: es `PL3` |

La página no es un segundo roadmap: es la vista publicada de este archivo, con pesos por paso y su evidencia. Se actualiza en el bloque `<script id="plan">` de `docs/roadmap-autonomo.html`.

## 8. Competencia — matriz del 2026-11-07

De dónde salen las exigencias de §3 y §4. **Foto fechada:** documentación oficial publicada, consultada el 2026-11-07; no se ejecutaron OpenCode, Antigravity ni Freebuff en esta máquina, así que describe capacidades **documentadas**, no rendimiento. F0 revalida lo que aquí se afirma y el producto comparado puede haber cambiado.

### 8.1 Cómo se construyó

- **Evidencia del árbol:** se leyó el código real (`bin/commander.ts`, `src/cli/`, `src/agent/`, `browserSession.ts`, `pluginsRuntime.ts`, `publisher.ts`, `deploy/`, `backend/`, `tests/`) y los roadmaps de la época.
- **Regla de honestidad:** una fila no pasa a «hecho» porque compile o tenga un test con un mock. Si depende de un proveedor externo, necesita una ejecución real y un recibo verificable (URL, issue, PR, captura o log sin secretos).
- **Alcance de la comparación:** se compara la mejor superficie de cada producto, no todas sus superficies a la vez. Una capacidad que sólo existe en la app de escritorio del competidor no se exige a cada superficie de Commander.

### 8.2 Leyenda

| Marca | Significado en Commander | Significado en competidores |
| --- | --- | --- |
| **V** | Implementado y con prueba local; si es externo, verificado contra el proveedor real | Documentado como disponible en la superficie indicada |
| **I** | Implementado, pero falta verificación externa o visual | — |
| **P** | Parcial, scaffold o límite conocido | Parcial o limitado a una superficie |
| **F** | Ausente | No documentado como primera parte |
| **—** | No aplica a Commander | No es la propuesta del producto |

### 8.3 Punto de partida de Commander (2026-11-07)

Foto del árbol en esa fecha; el estado actual está en §1 y §3.

| Área | Estado | Evidencia en el árbol | Límite actual |
| --- | --- | --- | --- |
| Bucle del agente, tools y subagentes | **V** | `src/agent/loop.ts`, `src/agent/fnTools.ts`, `src/agent/orchestrator.ts`; pruebas de agente | El CLI no expone todas las tools ni aprobaciones |
| Permisos, aprobaciones y undo | **V** | `permissionRules`, `AgentApprovalModal`, checkpoints y `undoStep`/`redo` | La política vive sobre todo en la UI de escritorio |
| Sesiones | **V** | `src/agent/sessions.ts`, rutas de sesiones y threads del servidor | No hay reanudación desde CLI ni desde un cliente remoto |
| Navegador y artifacts | **V/P** | `browserSession.ts`, `BrowserView.tsx`, `useBrowserRecording.ts`, `ArtifactsView.tsx` | Frames a ~1,4 fps; sin exportación, sin MP4 y sin verificación visual en Electron |
| Publicación estática/SPA | **V local; remoto en pausa hasta G3** | `publisher.ts`, `deploy/vercelAdapter.ts`, tests de contrato | Sin proveedor verificado; sin SSR/Workers |
| Backend multiinquilino | **V local** | `backend/tenantStore.ts`, `backend/routes.ts`, `tests/tenantBackend.test.ts` (6/6) | No aprovisiona bindings para apps publicadas |
| Integraciones GitHub/Linear | **V GitHub; Linear fuera de alcance** | `src/integrations/`, rutas OAuth, vault AES-256-GCM | GitHub con OAuth real verificado; Linear no se configura |
| GitHub Actions | **V** | `.github/workflows/commander-agent.yml`, `scripts/github-agent.ts` | Corrida real en el repo de prueba con PR y comentario (recibo `F0-LOCAL-2026-11-10` §11) |
| CLI | **P** | `bin/commander.ts`, `src/cli/repl.ts`, `src/cli/agentClient.ts`, `src/cli/tui.ts` | REPL multi-turno, `ask_user`, `--resume`/`--fork`, diff por hunk y paridad de permisos del escritorio operativos |
| Extensión de VS Code | **P** | `vscode-extension/` | Scaffold: webview que lanza `npx commander agent`; no es un IDE integrado |
| Skills/plugins/MCP | **V/P** | `skills/`, `pluginsRuntime.ts`, `src/agent/mcp.ts` | Hooks sólo `beforeTool`/`afterTool`; sin lifecycle completo ni marketplace propio |

### 8.4 Superficies y continuidad

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

### 8.5 Agente y verificación

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

### 8.6 Extensibilidad

| Capacidad | Commander | OpenCode | Antigravity | Freebuff |
| --- | --- | --- | --- | --- |
| MCP | **V** | **V** | **V** | **V** |
| Skills | **V** local | **V** | **V** (`SKILL.md`) | **V** (`AGENTS.md`/skills) |
| Plugins / hooks | **P** (sólo `beforeTool`/`afterTool`) | **V** | **V** (hooks/plugins) | **P** (MCP/skills; sin hooks documentados) |
| Agentes y comandos custom | **V** | **V** | **V** | **V** |
| Marketplace / ecosistema | **P** (catálogo de plugins de Claude) | **P** (comunidad) | **V** (plugins) | **—** |
| Integraciones nativas | **V** (GitHub con OAuth real; Linear fuera de alcance) | **P** (MCP/GitHub) | **V** (bundles de Google + MCP) | **P** (GitHub/repos; sin catálogo amplio documentado) |
| SSO / enterprise | **F** | **P** | **V** (SSO/BYOID, VPC-SC, residencia) | **—** |

### 8.7 Plataforma de apps

| Capacidad | Commander | OpenCode | Antigravity | Freebuff |
| --- | --- | --- | --- | --- |
| Hosting estático/SPA | **P** (local **V**; proveedor remoto fuera de alcance) | **—** | **—** | **V** |
| Hosting SSR/full-stack | **F** | **—** | **P** (Google Cloud) | **V** |
| Auth/DB/storage para apps publicadas | **P** (backend local; sin bindings desplegados) | **—** | **P** (Firebase/Google) | **V** |
| Realtime para apps | **F** | **—** | **P** | **—** (no documentado) |
| App builder / deploy en un clic | **P** (estático/SPA) | **—** | **P** | **V** |

### 8.8 Lectura competitiva

- **OpenCode** es el más cercano en el núcleo: TUI madura, agentes/subagentes custom, permisos granulares, snapshots, MCP, plugins y web/pair. No compite como plataforma de apps ni tiene browser/artifacts de primera clase. Su ventaja frente a Commander es la **superficie de terminal** y la **continuidad TUI ↔ web**; no la nube.
- **Antigravity** es el más cercano en **verificación**: planes interactivos, diffs multiarchivo, grabaciones de navegador, subagentes asíncronos con worktrees, Remote Control, CLI/IDE/SDK y tareas programadas. Su centro es Gemini/Google y su oferta empresarial; no es local-first ni multi-proveedor abierto.
- **Freebuff** es el más cercano en **producto de extremo a extremo**: Desktop/CLI/Web/Cloud/Chat, subagentes, browser, previews, auth/DB/storage y despliegue. Su ventaja es la app builder gestionada y la disponibilidad; su costo es depender de su nube y su catálogo.
- **Commander** no debe competir en modelos ni en infraestructura global. Su espacio defendible es **control local, aprobaciones visibles, reproducibilidad, costo y elección de proveedor**. La paridad debe reforzar eso, no diluirlo.

### 8.9 Fuentes

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

**Evidencia local principal:** `bin/commander.ts`, `src/cli/`, `src/agent/`, `browserSession.ts`, `pluginsRuntime.ts`, `publisher.ts`, `deploy/`, `backend/`, `vscode-extension/` y `tests/tenantBackend.test.ts`.

## 9. Métricas y definición de terminado

### 9.1 Métricas

Objetivos declarados el 2026-11-07; **no son estado medido**. La línea base se mide en F0 y no se inventa aquí; se actualiza con recibos, no con estimaciones.

| Dimensión | Métrica | Línea base | Objetivo |
| --- | --- | --- | --- |
| Verdad | Afirmaciones P0 con recibo real / total | F0 | 100 %; cero «hecho» sin verificación externa |
| Éxito | Tareas canónicas completadas | F0 | ≥ 8/10, sin regresión frente a la línea base |
| Eficiencia | Pasos y tokens por tarea | F0 | ≤ +10 % de la línea base; costo visible |
| Seguridad de permisos | Escrituras sin aprobación en casos adversariales | F0 | 0 |
| Continuidad | Reanudar la misma sesión en 3 superficies | F0 | p95 < 60 s; 0 tool calls duplicadas |
| Artifacts | Tareas de código con plan + diff + evidencia | F2 | ≥ 90 %; grabaciones 100 % reproducibles |
| Remoto | Enlaces caducados/reutilizados/Origin ajeno rechazados | F3 | 100 % |
| Aislamiento | Accesos cruzados entre inquilinos | F5 | 100 % denegados; 401 sin sesión |
| Realtime | Recuperación tras reconexión | F5 | 100 % con snapshot durable |
| Documentación | Filas de la matriz de §8 con estado y límite | Todas | 100 % |

### 9.2 Definición de terminado de una fase

Una fase termina sólo si:

- La funcionalidad existe y tiene pruebas focalizadas; no se sustituyen aserciones por mocks para pasar.
- Si toca un proveedor externo, hay una ejecución real con recibo y limitaciones escritas.
- El camino local-first sigue funcionando sin cuenta, sin red y sin proveedor cuando aplique.
- La documentación de usuario y la matriz de §8 reflejan el estado real, incluidos los límites.
- Hay revisión de seguridad para remote, plugins, backend o realtime.
- Hay rollback o feature flag para lo riesgoso.
- Las métricas de la fase se registraron antes/después.
- `tsc --noEmit`, `vite build` y las pruebas de la fase están en verde.
- No hay secretos en código, logs, artifacts, releases ni capturas.

## 10. Secuencia recomendada

**Ahora**

1. **Bloque de aprobación fuera del roadmap (2026-11-23):** por decisión del autor no se agenda; G1 queda **abierta**, la referencia de 15 151 ms intacta y, por §2.1, sólo retiene a F1. F2, F3, F4 y PL3 avanzan con su propia evidencia.
2. **PL3 (backend gestionado)**: sin puerta. Tiene contrato, doble, rutas, migraciones reales, app de ejemplo y panel; lo que falta es el proveedor real de G3. **F2** quedó cerrada con su verificación automática en Electron (`npm run test:electron`).
3. T10 y T2 se trabajan por sus issues, no por la puerta: `G1-EMPTY-TURN` abierto (arreglo aplicado, falta re-medir), `G1-T2-READ-LOOP` abierto (T2 en 0/2, guardas aplicadas) y `G1-APPROVAL-SHELL-TAIL` con P0/P1 hechos y P2 en pausa. `G1-SUBAGENT-CLOSE` quedó cerrado con el 6/6 de `G1-T10-15`.

**Después**

4. F3 (pair/PWA) en cuanto G2 esté aprobada, y F4A (VS Code) en paralelo: ninguna de las dos espera a G1.
5. Decidir proveedor en G3.
6. F5A (SSR/Workers) y 5B (backend gestionado).

**Más adelante**

7. F5C (realtime), PL4, PL6.
8. F6 y PL7 sólo con una decisión de producto explícita.

Con dos personas, el alcance P0 + P1 es del orden de 9–12 semanas de trabajo efectivo; con una, 12–16. Primeros 30 días: cerrar F0 (hecho), completar F1 y dejar F2 en revisión.

## 11. Riesgos y no objetivos

| Riesgo | Prob. | Impacto | Mitigación |
| --- | --- | --- | --- |
| Falta la credencial real de un proveedor (Vercel en pausa hasta G3, Linear fuera) | Media | Medio | Se mide lo que sí hay (GitHub) y no se declara paridad con mocks; un proveedor nuevo exige su propio recibo |
| El alcance crece por comparar tres productos a la vez | Alta | Alto | Puertas G0–G3, no objetivos y fases separadas; F6 sólo con aprobación |
| El pair remoto expone código o approvals | Media | Alto | Loopback por defecto, enlace de un uso, caducidad, cookie, Origin/CSRF, control lease, revisión de seguridad |
| Un plugin ejecuta código no confiable | Media | Alto | Instalación explícita, manifiesto, permisos, revisión y aislamiento de fallos |
| El backend gestionado se dispara en costo | Media | Alto | Cuotas, presupuestos, opt-in, proveedor decidido en G3 |
| Migración de sesiones/artifacts rompe datos | Media | Alto | Esquema versionado, migración tolerante, backup y prueba de reinicio |
| Playwright/ffmpeg no empaqueta bien en Electron | Media | Medio | Vídeo opcional, fallback a frames + informe, prueba en el instalador |
| La UI de artifacts no se ve bien en Electron | Media | Medio | Verificación visual en el instalador, no sólo tests de jsdom |
| Cambian las APIs de los proveedores | Media | Medio | Adaptadores, tests de contrato, versiones y recibos por release |
| Un LSP genérico consume el proyecto | Alta | Medio | No construir un LSP propio; usar el language service de TS y los diagnósticos del editor |

**No objetivos:** nube por defecto o workspace siempre encendido; app móvil nativa iOS/Android en este horizonte (la apuesta es PWA); edición multiusuario en tiempo real; seis extensiones de IDE (VS Code primero); runtime LSP universal; SSO empresarial, VPC-SC o residencia regional; marketplace propio con pagos y ejecución automática de plugins de terceros; entrenar o poseer modelos fundacionales; inferencia gratuita financiada por anuncios; facturación, planes o créditos; multi-tenant SaaS para terceros; Kubernetes o contenedores arbitrarios en el hosting.

## 12. Cómo se mantiene

- Este archivo es el roadmap completo y el único. Los criterios viven aquí y sólo aquí: no se duplican en otros documentos, y las fases que se retiraron (`ROADMAP_PARITY.md`, `ROADMAP_PLATFORM.md`, `ROADMAP_UX.md`) no se recrean.
- Al cambiar el estado de una fase o puerta se actualiza su sección y se mueve la fecha de la instantánea. Todo «hecho» necesita evidencia: ruta de código, test, PR, issue, recibo o URL. Lo no medido se queda como **sin medir**.
- El cierre de fases sigue §2.1: la puerta de esa fase y sólo esa. G1 no se hereda hacia fases posteriores, y una puerta sin regla ejecutable no se usa para retener trabajo ya evidenciado.
- `docs/parity/` guarda la evidencia (baseline, dogfooding, recibos, backlogs, hojas de decisión) y `docs/parity/issues/` el cuerpo de cada issue; ningún documento de ahí es un roadmap paralelo.
- La vista publicada se actualiza en el bloque `<script id="plan">` de `docs/roadmap-autonomo.html` (peso y % por paso); los porcentajes de fase y el global se recalculan al abrir la página.
- Guardas en CI: `tests/unit/roadmapFigures.test.ts` comprueba que la vista y este documento citan las mismas cifras, que la tabla de §1 cuadra con las casillas de §3/§4/§5 y que se cita el recibo `G1-T10-*` más alto; `npm run check:criteria` falla si un issue cerrado conserva criterios sin marcar.
- Gates mínimos antes de cerrar una fase: `npx tsc --noEmit`, `npx vite build` y las pruebas focalizadas de la fase, más la definición de terminado de §9.2. Los tests de endpoints usan el arnés compartido (`startServer()`), no un servidor propio.
- La línea base se ejecuta con `npm run baseline` y se registra en [docs/parity/baseline-2026-11.md](docs/parity/baseline-2026-11.md).

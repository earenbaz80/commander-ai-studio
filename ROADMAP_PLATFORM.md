# Hoja de ruta de plataforma — Commander AI Studio

> **Estado:** revisado contra el árbol, 2026-11-07. Complementa [ROADMAP_UX.md](ROADMAP_UX.md) y [ROADMAP_PARITY.md](ROADMAP_PARITY.md); no los sustituye.
>
> **Objetivo:** cerrar los huecos de plataforma frente a un entorno como Freebuff sin dejar de ser local-first por defecto. Cada fase debe poder entregarse y probarse por separado. Las fases 0–2 y el agente de GitHub Actions ya están implementadas en código; Linear y GitHub están implementados pero pendientes de verificación real. El estado distingue código de verificación real.

## Principios

- **Local-first por defecto.** Publicar en local sigue funcionando sin cuenta, sin red y sin proveedor externo. Lo remoto es opt-in.
- **Una release, varios destinos.** El artefacto inmutable que ya produce `publisher.ts` se construye una vez y se despliega tal cual. Promover no vuelve a compilar.
- **Nada de secretos en el renderer ni en el repositorio.** Los tokens de despliegue viven en el servidor o en el almacén seguro del sistema; nunca en `localStorage`, en logs ni en la release.
- **No fingir capacidades.** Si una app necesita runtime de servidor, se dice; no se publica como estática y se espera que funcione.
- **Norton intacto.** Azul `#000080`, cyan `#00ffff`, amarillo `#ffff55`, tipografía retro y Nono no se tocan.
- **Cada fase termina en verde.** `tsc --noEmit`, `vite build` y las pruebas focalizadas de la fase. Las suites de endpoints usan `startServer()` del arnés, no servidores propios.

## Punto de partida

| Capacidad | Estado actual | Evidencia |
| --- | --- | --- |
| Releases locales inmutables | **Hecho** | `publisher.ts`: copia a `.commander/publish/<slug>/releases/<id>/`, punteros `preview`/`production`, promoción y rollback |
| Publicación local | **Hecho** | `server.ts` sirve `/published/<slug>/<entorno>/`; `PublishView.tsx` ya tiene la pestaña **Publicar** |
| Build antes de publicar | **Hecho** | `createRelease({ build: true })` ejecuta `npm run build` con timeout y límites de archivos/tamaño |
| Contrato de despliegue | **Hecho** | `deploy/types.ts` incluye `configured`; `deploy/adapter.ts`, `deploy/stateStore.ts` y `commander.app.json`; el estado local conserva `remote` con migración tolerante |
| Hosting público | **Implementado; E2E local, falta Vercel real** | `deploy/vercelAdapter.ts` sube la release ya construida, con preview, promoción, rollback y logs. `tests/unit/vercelAdapter.e2e.test.ts` recorre el ciclo contra un servidor HTTP local que implementa el contrato; no es una cuenta Vercel |
| Navegador del agente | **Hecho** | `browserSession.ts` y `src/agent/tools/browser.ts` usan Playwright; la misma sesión alimenta frames, consola y red |
| Panel Navegador | **Hecho** | `BrowserView.tsx` pinta frames JPEG por SSE (700 ms), envía entrada real, selecciona sesión, captura screenshots y graba; `LiveConsole`/`NetworkMonitor` leen eventos reales |
| Grabaciones y artifacts | **Hecho local** | `useBrowserRecording.ts` captura frames; `ArtifactsView.tsx` reproduce, guarda en IndexedDB y permite comentarios inline. Límite: 120 s/180 frames, sin MP4, export ni visor remoto |
| Hosting SSR/Workers | **Falta** | El adaptador Vercel sólo acepta `static`/`spa`; `detectProject` identifica `worker`/`ssr` pero no hay adaptador que los despliegue |
| Backend para apps publicadas | **Falta** | No hay `BackendAdapter` ni bindings de la app desplegada. Existe `/api/backend` local multiinquilino (auth, registros, archivos) como base, pero no aprovisiona ni despliega ese backend |
| Realtime para apps publicadas | **Falta** | El SSE/WebSocket existente es del agente/terminal, no de las apps del usuario |
| Conectores nativos | **Parcial: Linear + GitHub** | `src/integrations/` tiene OAuth PKCE, vault AES-256-GCM, refresh, revocación remota y UI para Linear y GitHub; `linear` expone `whoami`, `list_teams`, `list_issues`, `create_issue`; `github.pr`/`github.comment` usan OAuth o `GITHUB_TOKEN`. Falta validación OAuth real |
| Automatización CI | **Implementado; no ejecutado en GitHub** | `.github/workflows/commander-agent.yml` y `scripts/github-agent.ts` reutilizan el CLI headless; hay tests de parser y stream, pero no una corrida real en GitHub |
| Skills de cuenta | **Parcial** | `skills/loader.ts` carga skills locales; hay catálogo público y marketplace de plugins, pero no sync de cuenta |
| Plantillas | **Parcial** | `src/data/composerTemplates.ts` tiene 5 plantillas; no hay galería curada equivalente |
| Ejecución en nube | **Falta** | El agente corre en el servidor Node/Electron local |

## Orden recomendado (repriorizado 2026-11-07)

0. **Cerrar la verificación real de lo ya construido** (Vercel, Linear y GitHub Actions). No es una fase nueva: una capacidad no pasa a “hecho” sólo porque compile y tenga tests con mocks.
1. **Backend gestionado para apps publicadas** (auth, base de datos, storage). Es el hueco de producto más grande que queda.
2. **SSR/Workers y dominios personalizados** para que el hosting no se limite a builds estáticas/SPA.
3. **Realtime para apps**, una vez exista el backend y el modelo de auth por app.
4. **Conectores**: verificar Linear y GitHub con cuentas reales; el segundo conector ya existe.
5. **Skills de cuenta y plantillas curadas**.
6. **Workspaces remotos** (sólo si se decide dejar de ser local-first; no arrancar por imitación).

El navegador real y los artifacts locales ya no están en la cola: están implementados en la Fase 2. Lo que queda del navegador es pulido (fps/fallback y exportación), no la base.

---

## Fase 0 — Contrato de despliegue y modelo de entornos — HECHO

**Estado:** implementado (2026-11-07). **Esfuerzo:** 2–3 días.

**Objetivo:** separar “release” de “destino” antes de escribir un adaptador concreto.

**Evidencia:** `deploy/types.ts` define `DeploymentAdapter` (con `configured`) y los tipos del manifiesto; `deploy/adapter.ts` describe el proyecto; `deploy/fakeAdapter.ts` es sólo un test double del contrato y no se selecciona en producción; `deploy/stateStore.ts` persiste el bloque remoto; `publisher.ts` migra estados antiguos con `normalizeRemoteState` sin romper el publicador local.

### Alcance

- Definir `DeploymentAdapter` con operaciones mínimas:
  - `detectProject(root)`: estático, SPA, Workers/SSR o desconocido.
  - `deploy(releaseDir, environment)`: subir una release inmutable.
  - `promote(deploymentId, environment)`: mover el puntero.
  - `rollback(environment)`: volver al deployment anterior.
  - `status(environment)`: URL, ID remoto, fecha y estado.
  - `logs(deploymentId)`: salida del proveedor.
- Extender el estado local sin romper el actual:
  - `state.json` sigue siendo la fuente de verdad local.
  - Añadir `remote: { provider, preview, production, deployments }` con migración tolerante.
  - Un `release.id` local puede mapear a uno o varios IDs remotos.
- Definir el manifiesto opcional `commander.app.json`:
  - tipo de app (`static`, `spa`, `worker`, `ssr`),
  - comando de build,
  - carpeta de salida,
  - variables públicas,
  - bindings requeridos (`database`, `storage`, `auth`, `realtime`).
- Crear un test double en memoria para pruebas: guarda deployments y permite probar preview, promoción y rollback sin red. No es un backend de producción.

### Archivos implementados

- `deploy/types.ts`, `deploy/adapter.ts`, `deploy/fakeAdapter.ts`, `deploy/preflight.ts`, `deploy/stateStore.ts`.
- `deploy/vercelAdapter.ts`: primer adaptador real (detalle en Fase 1).
- `publisher.ts`: `PublishState.remote` y migración `normalizeRemoteState`.
- `tests/unit/deployAdapter.test.ts`, `tests/unit/vercelAdapter.test.ts`, `tests/deployEndpoints.test.ts`.

### Criterios de aceptación

- [x] El publicador local actual sigue pasando sus pruebas sin cambios de comportamiento.
- [x] Un estado antiguo sin `remote` se lee y se guarda con migración.
- [x] El test double en memoria completa preview → producción → rollback.
- [x] Ninguna interfaz nueva exige credenciales para publicar en local.
- [x] `tsc --noEmit` y `vite build` en verde.

### Decisión tomada

- **Proveedor:** Vercel para el primer corte.
- **Alcance:** builds `static`/`spa`; `worker`/`ssr` se detectan y se rechazan con un mensaje claro.
- **Auth:** `VERCEL_TOKEN` + `VERCEL_PROJECT_ID` (y `VERCEL_TEAM_ID` opcional) en el servidor; el token nunca llega al renderer.
- **Entornos:** preview y producción fijos, con promoción y rollback por deployment. **Sin dominios personalizados ni previews por rama** en este corte.

---

## Fase 1 — Hosting remoto de estáticos — IMPLEMENTADO; FALTA VERIFICACIÓN REAL

**Estado:** adaptador, rutas y UI implementados (2026-11-07). La cobertura es con `fetch` simulado: **no hay evidencia de un despliegue real contra Vercel**.

**Objetivo:** que una release local se pueda abrir en una URL pública, con preview, producción y rollback.

### Alcance

- Implementar el primer `DeploymentAdapter` real para builds estáticas/SPA.
- Reutilizar el artefacto de `createRelease`: no volver a ejecutar `npm run build` al promover.
- Añadir rutas de servidor:
  - `GET /api/deploy/status?root=…`
  - `POST /api/deploy/preview`
  - `POST /api/deploy/production`
  - `POST /api/deploy/rollback`
  - `GET /api/deploy/logs`
- UI en `PublishView.tsx`:
  - selector **Local / Remoto**,
  - URL pública por entorno,
  - estado del deployment,
  - botón de abrir, promover, rollback y ver logs.
- Persistir el mapeo release local ↔ deployment remoto.
- Preflight antes de subir:
  - rechazar `.env*`, `.npmrc`, `.netrc`, symlinks y archivos fuera de la release,
  - avisar si el build contiene source maps o secretos evidentes,
  - comprobar tamaño y número de archivos antes de la subida.
- Manejo de errores:
  - credencial ausente o inválida se explica sin volcar el token,
  - un deployment `running` no se reintenta a ciegas,
  - un fallo de red no marca la release como publicada.

### Archivos implementados

- `deploy/vercelAdapter.ts`, `deploy/routes.ts`, `deploy/preflight.ts`, `deploy/stateStore.ts`.
- `server.ts`: rutas `/api/deploy/*` y guardas de escritura.
- `src/components/panel/PublishView.tsx`: destino remoto, estado, URL y logs.
- `tests/unit/vercelAdapter.test.ts`, `tests/deployEndpoints.test.ts`, `tests/ui/PublishView.test.tsx`.

### Criterios de aceptación

- [ ] Una app Vite de ejemplo se publica en preview y devuelve una URL pública que carga HTML, JS y CSS con los content types correctos. **Pendiente de verificación real:** los tests usan un `fetch` simulado.
- [x] Promover preview a producción no vuelve a compilar ni a copiar la release (cubierto en `vercelAdapter.test.ts`).
- [ ] Rollback vuelve a la release anterior en menos de 30 segundos. **Pendiente de medición real:** el camino está implementado y probado, pero no cronometrado contra Vercel.
- [ ] El estado sobrevive a reiniciar Commander. **Pendiente de prueba real:** `PublisherRemoteStateStore` está implementado, pero no se probó un reinicio.
- [x] Un fallo del proveedor deja el estado local en un estado recuperable, no en “publicado”.
- [x] El token del proveedor no aparece en la respuesta HTTP, en el renderer ni en los logs.
- [x] La release no contiene `.env*`, `.npmrc`, `.netrc` ni symlinks.

### Pendiente real y deuda conocida

- Desplegar una app Vite de ejemplo con una cuenta real y comprobar HTML, JS, CSS y content types.
- Medir el rollback real; el objetivo de <30 s sigue sin evidencia.
- El E2E local ya recorre subida, HTML, JS, content types, promoción y rollback contra un servidor de contrato; no sustituye la verificación contra Vercel.
- Sin dominios personalizados, previews por rama, SSR/Workers ni CI/CD externo. Eso queda en las fases posteriores.

### Fuera de alcance

- SSR/Workers, funciones serverless y dominios personalizados. Se abordan después de validar estáticos.
- CI/CD externo o deploys automáticos en cada push.

---

## Fase 2 — Navegador real en el Workbench — HECHO CON LÍMITES

**Estado:** implementado (2026-11-07). Incluye el visor de frames, consola/red reales, entrada, reconexión y grabación local con artifacts. La captura se cubre con un fixture SSE y la vista de artifacts con tests de UI; no se verificó visualmente en Electron.

**Objetivo:** que el panel **Navegador** y las pestañas **Consola/Red** muestren la misma sesión de Playwright que ya usa el agente.

### Alcance

- Exponer la sesión existente de `browserSession.ts` al renderer:
  - `POST /api/browser/session` para abrir,
  - `GET /api/browser/session/:id/stream` para frames y eventos,
  - `POST /api/browser/session/:id/input` para clics, teclado, scroll y navegación,
  - `GET /api/browser/session/:id/logs` para consola y red reales.
- Sustituir el iframe de `BrowserView.tsx` por una vista de frames (canvas o imagen) y conservar la barra de URL.
- Reutilizar `LiveConsole` y `NetworkMonitor` como consumidores de eventos reales; eliminar los datos de demo y el comando simulado.
- Añadir:
  - selector de sesión,
  - botón de captura,
  - grabación local implementada,
  - indicador de “agente controlando” / “usuario controlando”.
- Mantener la tool `browser` intacta: el agente sigue usando `open`, `navigate`, `snapshot`, `click`, `type`, `press`, `scroll`, `screenshot`, `logs`, `close`.
- Respetar la guardia SSRF y la aprobación para navegar fuera de loopback.

### Archivos implementados

- `browserSession.ts`: eventos de frame, entrada y suscripción.
- `server.ts` y `browserRoutes.ts`: rutas `/api/browser/session/*`.
- `src/components/panel/BrowserView.tsx`: visor, controles y REC.
- `src/components/WorkbenchPreview.tsx`: consola/red reales.
- `src/hooks/useBrowserRecording.ts`, `src/artifacts/`, `src/components/panel/ArtifactsView.tsx`: grabación, persistencia y revisión.
- `tests/browserEndpoints.test.ts`, `tests/browserSse.test.ts`, `tests/ui/BrowserView.test.tsx`, `tests/ui/ArtifactsView.test.tsx`.

### Criterios de aceptación

- [x] Un dev server local se ve en el panel y el agente puede hacer clic en un elemento visible (fixture local en `browserSse.test.ts`; sin verificación visual en Electron).
- [x] La consola muestra un `console.error` real de la página.
- [x] El monitor de red muestra una petición 404 real, con método, URL, estado y duración.
- [x] Usuario y agente comparten la misma sesión; un clic del agente se refleja en el panel.
- [x] Al cerrar y reabrir el panel, la sesión se reconecta o se explica que expiró.
- [x] No queda ningún texto de “demo” ni de “simulate” en la ruta de preview.
- [x] Navegar fuera de loopback sigue pidiendo aprobación.
- [x] Grabar una sesión, guardar frames y comentarios, y revisarlos (tests de UI y persistencia en IndexedDB; sin verificación visual en Electron).

### Implementado además: grabaciones y artifacts

- Grabación de frames JPEG desde el mismo SSE, con botón **REC** en `BrowserView`.
- Persistencia en IndexedDB; límite de **120 s** y **180 frames**.
- Reproductor con timeline, marcadores y comentarios inline anclados a `atMs` y a coordenadas normalizadas `x/y` del fotograma.
- Resolver, reabrir y eliminar comentarios; filtro por proyecto.
- Auto-apertura de **Artifacts** al detener la grabación y guardado al cambiar de pestaña.

### Límites y riesgo materializado

- El stream emite un frame cada **700 ms (~1.4 fps)**, no 10–15 fps. Sirve para ver la sesión y comentar, no para vídeo fluido. **No existe fallback de captura bajo demanda**; si se necesita, es trabajo pendiente.
- La grabación es una secuencia de frames, **no un MP4**; no hay exportación, descarga ni visor remoto de artifacts.
- La captura se cubre con un fixture SSE y la vista de artifacts con tests de UI; no se verificó visualmente en Electron.

---

## Fase 3 — Backend gestionado para apps publicadas — PENDIENTE

**Estado:** no iniciado como backend gestionado. Ya existe una base local multiinquilino en `/api/backend` (registro/login bearer, registros y archivos aislados; ver [docs/API.md](docs/API.md#backend-multiinquilino)), pero no hay `BackendAdapter`, aprovisionamiento desde la UI ni inyección de bindings en una app publicada. Es el hueco de producto más grande y la siguiente prioridad después de cerrar la verificación real de la Fase 1.

**Duración estimada:** 2–3 semanas.

**Objetivo:** que una app publicada pueda tener login, datos persistentes y archivos sin que el usuario monte un backend a mano.

### Alcance

- Definir `BackendAdapter`:
  - `provision(projectId, bindings)`,
  - `migrate(projectId, migrations)`,
  - `status(projectId)`,
  - `rotateSecrets(projectId)`.
- Soportar tres bindings iniciales:
  - **base de datos** relacional/SQL,
  - **object storage** para archivos,
  - **auth** para la app publicada.
- Añadir `commander.app.json` con:
  - `backend.database`, `backend.storage`, `backend.auth`,
  - migraciones en `migrations/`,
  - variables de entorno por entorno.
- Inyectar credenciales sólo en el entorno de despliegue; nunca en el bundle del cliente.
- Incluir un ejemplo funcional en `templates/` o `evals/`:
  - registro/login,
  - crear una fila propia,
  - subir un archivo propio,
  - cerrar sesión.
- Reglas de aislamiento:
  - consultas filtradas por `user.id` en el servidor,
  - IDs de recurso nunca confiados al cliente,
  - 401 para peticiones sin sesión,
  - 403 para recursos de otro usuario.

### Archivos previstos

- `deploy/backend/types.ts`, `deploy/backend/<provider>.ts`.
- `deploy/migrations.ts`.
- `src/components/panel/PublishView.tsx`: bindings y estado del backend.
- `tests/unit/backendProvision.test.ts`, `tests/backendEndpoints.test.ts`.
- `examples/` o `templates/` con la app de referencia.

### Criterios de aceptación

- [ ] Un proyecto nuevo aprovisiona base de datos, storage y auth desde la UI o un comando explícito.
- [ ] Las migraciones se ejecutan en el servidor y son idempotentes.
- [ ] La app de ejemplo permite registro, login, creación de datos y subida de archivo.
- [ ] Dos cuentas distintas no ven datos ni archivos de la otra.
- [ ] Una petición sin sesión recibe 401; una petición a un recurso ajeno recibe 403.
- [ ] Las credenciales no aparecen en el HTML, JS público, logs ni repositorio.
- [ ] El estado del backend se puede consultar sin exponer secretos.

### Puerta de decisión

- ¿Se usa un proveedor gestionado o se permite también un backend local/self-hosted?
- ¿La auth de la app es del proveedor o se reutiliza la cuenta de Commander? La recomendación es aislar: cada app publicada tiene su propio tenant.
- ¿Qué pasa si el usuario borra la app? Debe existir un flujo explícito de exportación/borrado; no borrar datos por accidente.

---

## Fase 4 — Realtime para apps publicadas — PENDIENTE

**Estado:** no iniciado; depende de la Fase 3 (auth y persistencia por app).

**Duración estimada:** 1 semana.

**Objetivo:** salas, presencia y eventos en vivo para las apps del usuario, separadas del streaming interno del agente.

### Alcance

- `RealtimeAdapter` con:
  - salas,
  - presencia,
  - publicación de eventos,
  - tickets de conexión autenticados.
- Ticket de corta duración emitido por el servidor; el navegador nunca decide el `userId` ni los permisos.
- Persistencia authoritative en la base de datos; realtime sólo notifica.
- Throttle de eventos interactivos; sin bucles de heartbeat.
- Pruebas con dos clientes, sala no autorizada, desconexión y reconexión.

### Archivos previstos

- `deploy/realtime/types.ts`, `deploy/realtime/<provider>.ts`.
- Ruta de ticket en el servidor de la app o en el adaptador.
- `tests/realtimeEndpoints.test.ts`, `tests/unit/realtimeTicket.test.ts`.

### Criterios de aceptación

- [ ] Dos clientes autenticados en la misma sala reciben eventos.
- [ ] Un cliente que no pertenece a la sala recibe 403.
- [ ] El ticket expira y no se puede reutilizar.
- [ ] Tras reconectar, el cliente recarga el snapshot authoritative.
- [ ] Los eventos no se usan como fuente de verdad para permisos ni para reglas de negocio.

---

## Fase 5 — Conectores nativos — PARCIAL: LINEAR + GITHUB IMPLEMENTADOS

**Estado:** Linear y GitHub están implementados en código (2026-11-07); ningún flujo OAuth real se validó con una cuenta. **Duración restante:** verificación real; el marco ya admite más conectores.

**Objetivo:** pasar de “MCP genérico” a conectores OAuth de un clic, con tokens persistentes y herramientas tipadas.

### Alcance

- Registro de conectores:
  - `id`, nombre, icono, scopes, URL de autorización/token,
  - herramientas expuestas,
  - permisos requeridos.
- Almacén de tokens cifrado:
  - `safeStorage` de Electron cuando esté disponible,
  - fallback a archivo cifrado con clave del sistema; nunca `localStorage`.
- Flujo OAuth con PKCE, state y callback loopback.
- Refresco automático y revocación.
- Conectores verticales: **Linear** (`whoami`, `list_teams`, `list_issues`, `create_issue`) y **GitHub** (OAuth para `github.pr`/`github.comment`, con fallback a `GITHUB_TOKEN`).
- Mostrar en UI:
  - conectado/desconectado,
  - cuenta y scopes,
  - botón de revocar,
  - última vez que se usó.

### Archivos implementados

- `src/integrations/oauth.ts`, `linear.ts`, `github.ts`, `linearActions.ts`, `tokenVault.ts`, `router.ts`, `providers.ts`.
- `src/components/settings/IntegrationsSettings.tsx`: conexión, estado y revocación.
- `src/agent/tools/linear.ts`, `src/agent/tools/github.ts`.
- `tests/unit/integrations.test.ts`, `tests/integrationsEndpoints.test.ts`.

### Criterios de aceptación

- [ ] Conectar, usar una herramienta y desconectar Linear o GitHub con una cuenta real. **Pendiente:** no se ejecutó el OAuth completo contra ninguno de los dos; los tests no cubren la autorización real.
- [ ] El token sobrevive a un reinicio y se refresca si expira. **Implementado** con vault AES-256-GCM y refresh de un solo vuelo; GitHub también admite tokens sin expiración, pero **no verificado contra proveedores reales**.
- [x] Revocar elimina el token local y no deja copias en logs.
- [x] Los scopes son visibles antes de autorizar (`read,write` en Linear; `repo,read:user` en GitHub).
- [x] Un fallo de OAuth no bloquea el resto de la app.
- [x] `src/mcp/oauth.ts` deja de ser la única vía de tokens persistentes.
- [x] Dos conectores comparten vault, callback y flujo PKCE; GitHub añade refresh opcional y tokens sin expiración.

### Pendiente real

- Configurar credenciales de Linear y GitHub y probar autorización, callback, uso de herramientas, refresh y revocación con cuentas reales.
- Revisar los scopes de GitHub (`repo` es amplio) y decidir si se ofrece una variante `public_repo` para repos públicos.
- Documentar en la UI el estado exacto de cada conector (implementado, no verificado) sin presentarlo como integración lista para producción.

---

## Fase 6 — Skills de cuenta y plantillas — PARCIAL

**Estado:** existen catálogo/marketplace y 5 plantillas locales; no hay sincronización de skills con la cuenta ni galería curada. **Duración restante:** 1–2 semanas.

**Objetivo:** que las skills y las plantillas viajen con la cuenta, no sólo con el checkout local.

### Alcance

- Formato de “skill pack”:
  - manifiesto (`id`, versión, descripción, permisos, compatibilidad),
  - contenido Markdown/recursos,
  - checksum,
  - origen y autor.
- Sincronización con la cuenta existente de Commander:
  - instalar, actualizar, desinstalar,
  - cache offline,
  - resolución de conflictos por versión.
- Catálogo curado de plantillas:
  - preview antes de crear,
  - una plantilla = proyecto completo, no sólo archivos sueltos,
  - categorías y búsqueda.
- Reutilizar `skills/loader.ts` y el marketplace de plugins; no crear un segundo cargador paralelo.
- Permisos explícitos: una skill no puede ejecutar shell ni escribir fuera del proyecto sin declararlo.

### Archivos previstos

- `skills/pack.ts`, `skills/sync.ts`.
- `src/components/settings/ExtensionsSettings.tsx`: cuenta, versiones, actualizaciones.
- `src/data/composerTemplates.ts`: ampliar catálogo o mover a datos remotos con cache.
- `tests/unit/skillPack.test.ts`, `tests/ui/ExtensionsSettings.skills.test.tsx`.

### Criterios de aceptación

- [ ] Una skill instalada en una máquina aparece en otra tras iniciar sesión.
- [ ] Se puede usar sin conexión con la última copia cacheada.
- [ ] Actualizar una skill no duplica archivos ni deja huérfanos.
- [ ] Desinstalar borra sólo lo que instaló.
- [ ] Una skill con permisos no declarados se rechaza o pide aprobación.
- [ ] Una plantilla crea un proyecto que compila sin pasos manuales ocultos.

---

## Fase 7 — Workspaces remotos (opcional) — NO INICIADO

**Estado:** no iniciado y fuera de la prioridad actual. **Duración estimada:** 4–6 semanas. **No empezar sin decisión de producto.**

**Objetivo:** ejecutar el agente y el workspace fuera de la máquina local, con continuidad entre dispositivos.

### Alcance mínimo si se aprueba

- Runner remoto con Node, shell, PTY y filesystem efímero o persistente.
- Sincronización explícita de workspace; no sync implícito de secretos.
- Cola de trabajos y reconexión.
- Auth de usuario y aislamiento por workspace.
- Límites de CPU, memoria, disco y tiempo.
- Visor de logs y artefactos **remotos**. Los artifacts locales del navegador (Fase 2) no cubren este caso.

### Criterios de aceptación

- [ ] Un trabajo lanzado en la nube sobrevive a cerrar el portátil.
- [ ] Al reconectar, el usuario ve el estado y los artefactos.
- [ ] Un workspace no puede leer archivos de otro.
- [ ] Los secretos se inyectan en el runner, no en la imagen ni en el repositorio.
- [ ] Se puede cancelar y limpiar un workspace sin dejar procesos huérfanos.

### Decisión previa

Esto cambia el modelo del producto. Si Commander sigue siendo una app personal local-first, esta fase se queda fuera y se documenta como no objetivo. No se debe empezar “porque Freebuff lo tiene”.

---

## Implementado fuera de las fases originales

### Agente de GitHub Actions

- `.github/workflows/commander-agent.yml` permite lanzar el agente desde un issue o manualmente.
- `scripts/github-agent.ts` y `src/github/agentCommand.ts` reutilizan el CLI headless; no hay un segundo agente.
- Se corrigió `fs_read` en `agentClient.ts` para que el flujo headless pueda leer archivos.
- **Estado:** implementado y con tests de parser/stream (`tests/unit/githubAgent.test.ts`), pero **no ejecutado en GitHub ni con un modelo real**. Falta configurar la clave, hacer push y completar una corrida.

---

## Matriz de prioridad (revisada 2026-11-07)

| Fase | Estado | Valor | Esfuerzo restante | Dependencias | Prioridad |
| --- | --- | --- | --- | --- | --- |
| 0. Contrato | Hecho | Alto (base) | — | Ninguna | — |
| 1. Hosting estático | Implementado; verificación real pendiente | Muy alto | Bajo/medio | Cuenta Vercel | P0 verificar |
| 2. Navegador + artifacts | Hecho con límites | Alto | Bajo (fps/export) | Ninguna | P2 pulir |
| 3. Backend | Pendiente | Muy alto | Alto | Proveedor y auth por app | **P0** |
| 4. Realtime | Pendiente | Medio | Medio | Fase 3 | P1 |
| 5. Conectores | Linear + GitHub implementados; falta verificación real | Alto | Bajo verificar | OAuth y vault | P1 |
| 6. Skills/cuenta | Parcial | Medio | Medio | Auth de cuenta | P2 |
| 7. Workspaces remotos | No iniciado | Muy alto | Muy alto | Infraestructura y producto | P3/opcional |

## Métricas de éxito

- **Hosting real:** una app estática publicada, abierta y promovida con una cuenta real de Vercel. Hoy hay evidencia con `fetch` simulado y con un E2E local contra el contrato de Vercel, pero no con una cuenta real.
- **Tiempo a URL pública:** objetivo < 3 minutos; **no medido contra Vercel**.
- **Éxito de despliegue:** objetivo ≥ 95% en la app de ejemplo y 3 proyectos reales; pendiente de la primera corrida real.
- **Rollback:** objetivo < 30 segundos y sin rebuild; el camino existe, falta medirlo.
- **Fugas de secretos:** 0 en artefactos, logs y respuestas; cubierto por preflight y tests del adaptador.
- **Navegador:** consola y red reales; stream a ~1.4 fps, no 10–15 fps. 0 datos simulados en la ruta de preview.
- **Artifacts:** grabar, recargar y comentar sin pérdida; tests de UI en verde, sin verificación visual en Electron.
- **Backend:** dos cuentas aisladas en la app de ejemplo; 401/403 correctos. Pendiente.
- **Conectores:** Linear y GitHub conectar/usar/revocar con cuentas reales; refresh y scopes pendientes de validación.
- **Skills:** misma skill disponible en dos máquinas tras login. Pendiente.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| El adaptador Vercel se probó con `fetch` simulado y un contrato local, no con Vercel | Desplegar una app real antes de presentar el hosting como verificado |
| El proveedor de hosting cambia límites o precios | Adaptador desacoplado; el estado local sigue siendo la fuente de verdad |
| Se sube un secreto por accidente | Preflight de `.env*`, source maps y patrones de claves; denegar por defecto |
| El servidor de contrato local se confunde con Vercel | El E2E y la documentación lo declaran explícitamente; la verificación real sigue pendiente |
| SSR/Workers no cabe en el modelo estático | `detectProject` rechaza `worker`/`ssr` con mensaje claro; no publicar una SPA rota |
| El backend filtra datos entre usuarios | Aislamiento por tenant, filtros server-side por `user.id`, pruebas con dos cuentas |
| Linear no se probó con OAuth real | Configurar credenciales y probar autorización, refresco y revocación antes de añadir el segundo conector |
| GitHub Actions nunca corrió en GitHub | Hacer una corrida real con modelo y clave; no presentarlo como automatización validada |
| Los artifacts locales se confunden con el visor remoto de Fase 7 | Mantener la distinción en la UI y en la documentación; no prometer artifacts remotos |
| El stream del navegador va a ~1.4 fps | Documentado; falta un fallback de captura bajo demanda |
| La fase 7 convierte el proyecto en otra cosa | Puerta de decisión explícita; no arrancar sin aprobación |
| Windows: rutas, symlinks y locks | Pruebas en Windows; el publicador ya ignora symlinks y normaliza rutas |

## Qué no entra en este roadmap

- Facturación, planes o créditos.
- Multi-tenant SaaS para terceros.
- Kubernetes, contenedores arbitrarios o procesos de servidor persistentes en el hosting.
- Un editor colaborativo en tiempo real.
- Reemplazar Firebase como auth de Commander.
- Cambiar la paleta, la tipografía o el rol de Nono.

## Siguiente corte recomendado (2026-11-07)

**Ahora — P0: verificar lo construido**

- Desplegar una app Vite real en Vercel: preview, URL pública, content types, promoción y rollback cronometrado.
- Configurar Linear y completar OAuth, uso, refresco y revocación con una cuenta real.
- Ejecutar el workflow de GitHub Actions con un modelo real.
- Publicar una app Vite real en Vercel y medir el rollback; el E2E local ya no sustituye esa comprobación.

**Semanas 1–3 — P0: Fase 3**

- Elegir proveedor de backend y modelo de auth por app.
- Implementar `BackendAdapter`, migraciones, storage y la app de ejemplo con aislamiento entre cuentas.

**Semanas 4–5 — P1: Fase 4**

- Realtime sobre el backend y la auth ya existentes; dos clientes, permisos y reconexión.

**Después — P1/P2**

- SSR/Workers y dominios personalizados.
- Verificación real de Linear y GitHub; revisar scopes de GitHub.
- Skills de cuenta, plantillas curadas y exportación de artifacts.

**No arrancar**

- Fase 7 hasta que exista una decisión de producto explícita. No se empieza “porque Freebuff lo tiene”.

## Definición de terminado por fase

Una fase no está terminada hasta que:

- [ ] El código compila con `tsc --noEmit`.
- [ ] `vite build` pasa.
- [ ] Las pruebas focalizadas de la fase pasan.
- [ ] Si depende de un proveedor externo, se probó contra ese proveedor; los mocks no cuentan como verificación real.
- [ ] La UI se probó en el Workbench, no sólo con tests.
- [ ] Los errores muestran una causa accionable y no filtran secretos.
- [ ] La documentación de usuario explica el nuevo flujo y sus límites.
- [ ] El comportamiento local sigue funcionando sin el proveedor nuevo.
- [ ] El estado del roadmap no marca “hecho” una capacidad cuyo único respaldo es código sin ejecutar.

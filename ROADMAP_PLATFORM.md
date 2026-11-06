# Hoja de ruta de plataforma — Commander AI Studio

> **Estado:** propuesta inicial, 2026-11-05. Complementa [ROADMAP_UX.md](ROADMAP_UX.md); no lo sustituye.
>
> **Objetivo:** cerrar los huecos de plataforma frente a un entorno como Freebuff sin dejar de ser local-first por defecto. Cada fase debe poder entregarse y probarse por separado.

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
| Navegador del agente | **Hecho, pero sin UI compartida** | `browserSession.ts` y `src/agent/tools/browser.ts` usan Playwright; guardan consola y red por sesión |
| Panel Navegador | **Parcial** | `BrowserView.tsx` es un iframe; `WorkbenchPreview.tsx` simula la consola y las peticiones de red |
| Hosting público | **Falta** | No hay adaptador remoto; todo se sirve desde el proceso local |
| Backend para apps publicadas | **Falta** | Firebase/SQLite son datos de Commander, no bindings de la app desplegada |
| Realtime para apps publicadas | **Falta** | El SSE/WebSocket existente es del agente/terminal, no de las apps del usuario |
| Conectores nativos | **Parcial** | MCP con OAuth y GitHub; los tokens OAuth de MCP están en memoria (`src/mcp/oauth.ts`) |
| Skills de cuenta | **Parcial** | `skills/loader.ts` carga skills locales; hay catálogo público y marketplace de plugins, pero no sync de cuenta |
| Plantillas | **Parcial** | `src/data/composerTemplates.ts` tiene 5 plantillas; no hay galería curada equivalente |
| Ejecución en nube | **Falta** | El agente corre en el servidor Node/Electron local |

## Orden recomendado

1. **Contrato de despliegue** (base para todo lo remoto).
2. **Hosting remoto de estáticos** (mayor retorno visible).
3. **Navegador real en el Workbench** (victoria contenida y muy visible).
4. **Backend gestionado para apps** (auth, base de datos, storage).
5. **Realtime para apps**.
6. **Conectores nativos**.
7. **Skills de cuenta y plantillas**.
8. **Workspaces remotos** (sólo si se decide dejar de ser local-first).

El hosting remoto y el navegador real pueden ir en paralelo: no comparten dependencias técnicas.

---

## Fase 0 — Contrato de despliegue y modelo de entornos

**Duración estimada:** 2–3 días.

**Objetivo:** separar “release” de “destino” antes de escribir un adaptador concreto.

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
- Crear un adaptador `fake` para pruebas: guarda deployments en memoria y permite probar preview, promoción y rollback sin red.

### Archivos previstos

- `deploy/types.ts`, `deploy/adapter.ts`, `deploy/fakeAdapter.ts`.
- `publisher.ts`: ampliar `PublishState` sin cambiar el comportamiento local.
- `tests/unit/deployAdapter.test.ts`.

### Criterios de aceptación

- [ ] El publicador local actual sigue pasando sus pruebas sin cambios de comportamiento.
- [ ] Un estado antiguo sin `remote` se lee y se guarda con migración.
- [ ] El adaptador `fake` completa preview → producción → rollback.
- [ ] Ninguna interfaz nueva exige credenciales para publicar en local.
- [ ] `tsc --noEmit` y `vite build` en verde.

### Puerta de decisión

Elegir el primer proveedor de hosting. No se implementa hasta cerrar:

- ¿estáticos primero o Workers/SSR desde el inicio?
- ¿el proveedor permite previews por rama o sólo entornos fijos?
- ¿cómo se autentica el CLI/API: token de cuenta, token de proyecto o OAuth?
- ¿los dominios personalizados son parte del primer corte o de una fase posterior?

---

## Fase 1 — Hosting remoto de estáticos

**Duración estimada:** 1–2 semanas.

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

### Archivos previstos

- `deploy/<provider>Adapter.ts`.
- `server.ts`: rutas `/api/deploy/*` y guardas de escritura.
- `src/components/panel/PublishView.tsx`: destino remoto y logs.
- `tests/unit/deployRemote.test.ts`, `tests/ui/PublishView.remote.test.tsx`, `tests/deployEndpoints.test.ts`.

### Criterios de aceptación

- [ ] Una app Vite de ejemplo se publica en preview y devuelve una URL pública que carga HTML, JS y CSS con los content types correctos.
- [ ] Promover preview a producción no vuelve a compilar ni a copiar la release.
- [ ] Rollback vuelve a la release anterior en menos de 30 segundos.
- [ ] El estado sobrevive a reiniciar Commander.
- [ ] Un fallo del proveedor deja el estado local en un estado recuperable, no en “publicado”.
- [ ] El token del proveedor no aparece en la respuesta HTTP, en el renderer ni en los logs.
- [ ] La release no contiene `.env*`, `.npmrc`, `.netrc` ni symlinks.

### Fuera de alcance

- SSR/Workers, funciones serverless y dominios personalizados. Se abordan después de validar estáticos.
- CI/CD externo o deploys automáticos en cada push.

---

## Fase 2 — Navegador real en el Workbench

**Duración estimada:** 1 semana.

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
  - grabación opcional,
  - indicador de “agente controlando” / “usuario controlando”.
- Mantener la tool `browser` intacta: el agente sigue usando `open`, `navigate`, `snapshot`, `click`, `type`, `press`, `scroll`, `screenshot`, `logs`, `close`.
- Respetar la guardia SSRF y la aprobación para navegar fuera de loopback.

### Archivos previstos

- `browserSession.ts`: eventos de frame, entrada y suscripción.
- `server.ts`: rutas `/api/browser/session/*`.
- `src/components/panel/BrowserView.tsx`: visor y controles.
- `src/components/WorkbenchPreview.tsx`: consola/red reales.
- `tests/unit/browserSession.test.ts`, `tests/ui/BrowserView.test.tsx`.

### Criterios de aceptación

- [ ] Un dev server local se ve en el panel y el agente puede hacer clic en un elemento visible.
- [ ] La consola muestra un `console.error` real de la página.
- [ ] El monitor de red muestra una petición 404 real, con método, URL, estado y duración.
- [ ] Usuario y agente comparten la misma sesión; un clic del agente se refleja en el panel.
- [ ] Al cerrar y reabrir el panel, la sesión se reconecta o se explica que expiró.
- [ ] No queda ningún texto de “demo” ni de “simulate” en la ruta de preview.
- [ ] Navegar fuera de loopback sigue pidiendo aprobación.

### Riesgo principal

El streaming de frames y la entrada remota pueden añadir latencia. Si el consumidor no puede mantener 10–15 fps, se degrada a captura bajo demanda (botón o acción del agente) y se documenta; no se finge un stream continuo.

---

## Fase 3 — Backend gestionado para apps publicadas

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

## Fase 4 — Realtime para apps publicadas

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

## Fase 5 — Conectores nativos

**Duración estimada:** 1–2 semanas para el primer conector; el marco queda listo para más.

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
- Primer conector vertical: elegir uno por uso real (Slack, Linear o Gmail). No generalizar hasta que ese flujo completo funcione.
- Mostrar en UI:
  - conectado/desconectado,
  - cuenta y scopes,
  - botón de revocar,
  - última vez que se usó.

### Archivos previstos

- `src/integrations/registry.ts`, `src/integrations/oauth.ts`, `src/integrations/tokenVault.ts`.
- `src/components/settings/ExtensionsSettings.tsx`: sección de conectores.
- Adaptadores de herramientas en `src/agent/tools/integrations/*.ts`.
- `tests/unit/tokenVault.test.ts`, `tests/integrations/oauth.test.ts`.

### Criterios de aceptación

- [ ] Conectar, usar una herramienta y desconectar el primer conector sin reiniciar Commander.
- [ ] El token sobrevive a un reinicio y se refresca si expira.
- [ ] Revocar elimina el token local y no deja copias en logs.
- [ ] Los scopes son mínimos y visibles antes de autorizar.
- [ ] Un fallo de OAuth no bloquea el resto de la app.
- [ ] `src/mcp/oauth.ts` deja de ser la única vía de tokens persistentes.

---

## Fase 6 — Skills de cuenta y plantillas

**Duración estimada:** 1–2 semanas.

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

## Fase 7 — Workspaces remotos (opcional)

**Duración estimada:** 4–6 semanas. **No empezar sin decisión de producto.**

**Objetivo:** ejecutar el agente y el workspace fuera de la máquina local, con continuidad entre dispositivos.

### Alcance mínimo si se aprueba

- Runner remoto con Node, shell, PTY y filesystem efímero o persistente.
- Sincronización explícita de workspace; no sync implícito de secretos.
- Cola de trabajos y reconexión.
- Auth de usuario y aislamiento por workspace.
- Límites de CPU, memoria, disco y tiempo.
- Visor de logs y artefactos.

### Criterios de aceptación

- [ ] Un trabajo lanzado en la nube sobrevive a cerrar el portátil.
- [ ] Al reconectar, el usuario ve el estado y los artefactos.
- [ ] Un workspace no puede leer archivos de otro.
- [ ] Los secretos se inyectan en el runner, no en la imagen ni en el repositorio.
- [ ] Se puede cancelar y limpiar un workspace sin dejar procesos huérfanos.

### Decisión previa

Esto cambia el modelo del producto. Si Commander sigue siendo una app personal local-first, esta fase se queda fuera y se documenta como no objetivo. No se debe empezar “porque Freebuff lo tiene”.

---

## Matriz de prioridad

| Fase | Valor para el usuario | Esfuerzo | Dependencias | Riesgo |
| --- | --- | --- | --- | --- |
| 0. Contrato | Alto (base) | Bajo | Ninguna | Bajo |
| 1. Hosting estático | Muy alto | Medio | Proveedor elegido | Medio |
| 2. Navegador real | Alto | Medio | Ninguna | Bajo |
| 3. Backend | Muy alto | Alto | Proveedor y modelo de auth | Alto |
| 4. Realtime | Medio | Medio | Fase 3 | Medio |
| 5. Conectores | Alto | Medio | OAuth y vault | Medio |
| 6. Skills/cuenta | Medio | Medio | Auth de cuenta | Bajo |
| 7. Workspaces remotos | Muy alto | Muy alto | Infraestructura y producto | Muy alto |

## Métricas de éxito

- **Tiempo a URL pública:** menos de 3 minutos para una app estática ya construida.
- **Éxito de despliegue:** ≥ 95% en la app de ejemplo y en 3 proyectos reales.
- **Rollback:** menos de 30 segundos y sin rebuild.
- **Fugas de secretos:** 0 en artefactos, logs y respuestas.
- **Navegador:** consola y red reales en el 100% de las sesiones del panel; 0 datos simulados.
- **Backend:** dos cuentas aisladas en la app de ejemplo; 401/403 correctos.
- **Conectores:** conectar/usar/revocar completo sin reiniciar.
- **Skills:** misma skill disponible en dos máquinas tras login.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| El proveedor de hosting cambia límites o precios | Adaptador desacoplado; el estado local sigue siendo la fuente de verdad |
| Se sube un secreto por accidente | Preflight de `.env*`, source maps y patrones de claves; denegar por defecto |
| SSR/Workers no cabe en el modelo estático | `detectProject` devuelve `unsupported` con mensaje claro; no publicar una SPA rota |
| El backend filtra datos entre usuarios | Aislamiento por tenant, filtros server-side por `user.id`, pruebas con dos cuentas |
| Los tokens OAuth se pierden o se filtran | Vault cifrado, refresh, revocación y prohibición de logs |
| El stream del navegador va lento | Captura bajo demanda como fallback documentado |
| La fase 7 convierte el proyecto en otra cosa | Puerta de decisión explícita; no arrancar sin aprobación |
| Windows: rutas, symlinks y locks | Pruebas en Windows; el publicador ya ignora symlinks y normaliza rutas |

## Qué no entra en este roadmap

- Facturación, planes o créditos.
- Multi-tenant SaaS para terceros.
- Kubernetes, contenedores arbitrarios o procesos de servidor persistentes en el hosting.
- Un editor colaborativo en tiempo real.
- Reemplazar Firebase como auth de Commander.
- Cambiar la paleta, la tipografía o el rol de Nono.

## Primer corte recomendado

**Semanas 1–2**

- Fase 0 completa.
- Inicio de Fase 1: adaptador real y despliegue de una app Vite de ejemplo.

**Semanas 3–4**

- Fase 1 completa con preview, producción y rollback.
- Fase 2 en paralelo: navegador real con consola y red.

**Semana 5**

- Demo interna: publicar, abrir la URL, ver la app en el panel, hacer un clic con el agente y mostrar un error real de consola.
- Revisar métricas y decidir si se sigue con backend o se ajusta el proveedor.

**Semana 6**

- Congelar alcance de Fase 3 y elegir el modelo de auth de apps publicadas.

## Definición de terminado por fase

Una fase no está terminada hasta que:

- [ ] El código compila con `tsc --noEmit`.
- [ ] `vite build` pasa.
- [ ] Las pruebas focalizadas de la fase pasan.
- [ ] La UI se probó en el Workbench, no sólo con tests.
- [ ] Los errores muestran una causa accionable y no filtran secretos.
- [ ] La documentación de usuario explica el nuevo flujo y sus límites.
- [ ] El comportamiento local sigue funcionando sin el proveedor nuevo.

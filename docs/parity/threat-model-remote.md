# Modelo de amenazas — pair remoto y `--remote` (puerta G2)

> **Fecha:** 2026-11-25
> **Estado:** borrador versionado, **sin revisión**. G2 sigue **no iniciada**: este documento es el insumo que la revisión tiene que aprobar, no la aprobación.
> **Qué desbloquea:** sólo G2. F3 (`commander pair`, cliente web/PWA, control lease) está **parcial (6/8)** y no se declara hecha por tener este modelo ni por los seis criterios que ya tienen test.
> **Qué no es:** no es un recibo, no declara verificado ningún control, no habilita `--remote` en una release y **no cierra ninguna casilla de F3**.
> **Referencias:** [ROADMAP](../../ROADMAP.md) §2 (G2), §3 (F3) y §11 (riesgos) · [bindHost](../../src/lib/bindHost.ts) · [F1 approvals](../../ROADMAP.md) §3.F1 · [issues de G1](issues/README.md).

## 1. Alcance

**Entra en el modelo** la superficie que F3 introduce para usar la misma sesión desde otro dispositivo:

- `commander pair`: emisión y canje del enlace de emparejamiento (QR y URL).
- La cookie de sesión del cliente emparejado y su revocación.
- El cliente web responsive/PWA: sesiones, chat, plan, approvals con diff, artifacts y estado de trabajos.
- El **control lease**: quién puede escribir en la sesión y cómo se traspasa.
- `--remote`: exponer el servidor fuera de loopback, con o sin túnel.
- La auditoría y los límites (rate limit, dispositivos, tamaño de mensaje).

**No entra:** cuentas en la nube, multi-tenant, SSO, workspaces remotos (F6/PL7), sincronización de secretos entre máquinas, ejecución de tareas en un runner remoto y edición multiusuario simultánea del mismo archivo.

### 1.1 Estado del código a 2026-11-25

`commander pair` existe ya en su tramo local: emisión y canje del enlace, `--devices` y `--revoke <id>` sobre las rutas del host (`GET /api/pair/devices`, `DELETE /api/pair/devices/:id`), con `Origin` exacto y caducidad de 5 minutos (`src/pair/`, `POST /api/pair/issue` y `/api/pair/redeem`), más la cookie de dispositivo opaca con su registro y su revocación (`src/pair/pairDevices.ts`, `GET /api/pair/device`, `GET /api/pair/devices` y `DELETE /api/pair/devices/:id`), y el control lease por sesión con un solo escritor, renovación, traspaso explícito con `ack` (el destino se valida contra el registro activo: un id inexistente o revocado da 409 `LEASE_TARGET_UNAVAILABLE`), 409 `LEASE_HELD`/`LEASE_STALE` para el resto y auditoría persistida en JSONL (`.commander/pair/lease-audit.jsonl`, tope de 200 entradas, escritura atómica, releída al arrancar; `src/pair/pairLease.ts`; `GET /api/pair/lease`, `POST /api/pair/lease`, `/renew`, `/request`, `/transfer`, `/release` y `GET /api/pair/lease/audit`). El cliente web arranca con `src/pair/pairLeaseClient.ts`: reclamo, renovación cada 30 s con el `seq` vigente, traspaso que no habilita la escritura hasta verificar el `ack` y `sendMessage`/`resolveApproval`/`cancel`/`forkAndRun`/`saveState`/`applyProposal`, que firman cada escritura de sesión —el turno, la decisión de una aprobación, parar la corrida, bifurcar y arrancar la copia, el checkpoint del CLI y aplicar una propuesta— con el `seq` del lease y, ante un `LEASE_STALE`, releen el estado y reintentan una sola vez con el `seq` nuevo si el control sigue siendo propio. La pantalla de sesión vive en `/pair/session` (`src/features/pair/PairSessionScreen.tsx`, montada también al margen de la SPA): chat con turnos firmados, plan de la sesión y aprobaciones resueltas con `resolveApproval`, sin escribir sin el control confirmado y siguiendo la sesión por el **stream SSE** (`src/pair/pairSessionStream.ts`) con `Last-Event-ID`: al caer la red reconecta desde el último `seq` visto, el `resync` reemplaza el estado completo y una aprobación ya decidida en la pantalla no se vuelve a ofrecer aunque un snapshot atrasado la liste. La pantalla mínima de control vive en `/pair` (`src/features/pair/PairControlScreen.tsx`, montada por `src/main.tsx` al margen del resto de la SPA): toma la sesión de `?sessionId=` o de un formulario, muestra dueño y `seq`, permite reclamar y liberar, indica la renovación cada 30 s mientras corre, pide y acepta el traspaso mostrando el `ack`, enseña el 409 `LEASE_HELD` tal cual, y con el control confirmado lista las aprobaciones pendientes de la sesión y las resuelve con `resolveApproval` (permitir/denegar), firmadas con el `seq` del lease. Las mutaciones de sesión que escriben ya exigen el lease: `POST /api/agent/sessions/:id/message`, `POST …/approvals/:approvalId`, `PUT …/state`, `POST …/fork` con `run: true`, `POST …/cancel` y `POST …/proposals/:proposalId/apply` (salvo `dryRun`, que sólo simula) sólo entran si el solicitante es el dueño y manda el `seq` vigente (409 `LEASE_HELD` para cualquier otro, incluido el escritorio mientras un dispositivo tenga el control, y 409 `LEASE_STALE` con un `seq` viejo); el escritorio sin cookie sigue escribiendo cuando el control está en el escritorio, y leer, copiar sin `run` y borrar la sesión no piden control. No es todavía el cliente de sesión/chat de F3. **Falta el resto de F3** —cliente web/PWA completo— y **`--remote` sigue sin existir**. Lo que este modelo reutiliza:

| Pieza | Dónde | Qué aporta |
| --- | --- | --- |
| Bind loopback por defecto | `src/lib/bindHost.ts` (`DEFAULT_BIND_HOST`, `resolveBindHost`) | La API no se expone salvo pedido explícito; hoy no tiene autenticación propia |
| Aviso de exposición | `bindExposureWarning` | Aviso en consola cuando el bind no es loopback |
| Guarda anti DNS rebinding | `server.ts` (`allowedHostsFromEnv`, `isAllowedHost`) | Un dominio ajeno que resuelva a loopback recibe 403 por `Host` |
| CORS con allowlist | `server.ts` (`CORS_ALLOW`, `CORS_ORIGINS`) | Sin comodín; `Vary: Origin` |
| Parser de cookies | `server.ts` | Base para la cookie de dispositivo, sin dependencia nueva |
| Motor de approvals | F1 (`agentSession.ts`, `approvalEndpoints`) | El `deny` no se salta con `allow-session`; la aprobación es por paso |
| Tokens de pair | `src/pair/pairTokens.ts`, `src/pair/pairOrigin.ts`, `src/pair/pairLink.ts` | 256 bits, TTL 5 min, hash en memoria, un solo uso; canje con `Origin` exacto y `Sec-Fetch-Site` (T1–T4) |
| Cookie de dispositivo | `src/pair/pairDevices.ts` | Identificador opaco de 256 bits, hash en memoria, `HttpOnly; SameSite=Strict; Path=/` (+`Secure` en HTTPS), 30 días renovados por uso, registro con `id`/`createdAt`/`lastSeenAt`/`userAgent`/`revokedAt`, tope de 5 activos, revocación idempotente (T6, T7) |
| Rate limit del pair | `src/pair/pairRateLimit.ts`, `server.ts` (`pairRateGuard`) | Ventana fija de 60 s con presupuesto por caller y global en canje, approvals y stream; 429 con `Retry-After`; el canje sólo cuenta fallos (T2, T12) |

Ningún control de §6 se afirma implementado: son **requisitos de diseño** con parámetros propuestos que la implementación de F3 debe cumplir y probar. Donde hay un número, es una propuesta a fijar en el código, no una medición.

## 2. Activos

| Activo | Por qué importa | Sensibilidad |
| --- | --- | --- |
| Sesión e historial (prompts, respuestas, tool calls) | Contiene código y decisiones del proyecto | Alta |
| Approvals en vuelo y diffs | Aprobar es ejecutar la tool: escribir, `shell.run`, red | Crítica |
| Tools del agente (`fs.*`, `shell.run`, `mcp.*`) | Ejecutan sobre el workspace real | Crítica |
| Secretos del entorno (`.env`, claves de proveedores, tokens MCP/OAuth) | Ya hay reglas de redacción; el pair no puede reabrirlas | Crítica |
| Artifacts y grabaciones | Pueden incluir capturas de pantalla del proyecto | Alta |
| Enlace de emparejamiento y cookie de dispositivo | Son la credencial de acceso al resto | Crítica |
| Auditoría de dispositivos | Es la evidencia de quién hizo qué | Media |

## 3. Supuestos de despliegue

1. **Un solo operador humano** en la máquina anfitriona; el producto sigue siendo local-first.
2. **Loopback por defecto.** Sin `--remote` ni túnel explícito no hay puerto público (§3.F3, criterio 3).
3. `--remote` es una **decisión del operador por corrida**, no un valor persistente que se active solo.
4. Fuera de loopback, el transporte lo pone un **túnel con TLS** (proveedor a decidir en G3); el servidor no implementa su propio TLS.
5. El navegador del escritorio es relativamente de confianza; el del móvil, también, pero **puede perderse**.
6. No hay autenticación de usuario final: la identidad es el **dispositivo emparejado**, no una cuenta.
7. La sesión es única; no hay aislamiento entre inquilinos (eso es F5/PL3 y no se simula aquí).

## 4. Adversarios

| Id | Adversario | Capacidad asumida |
| --- | --- | --- |
| A1 | Página web maliciosa abierta en el mismo navegador | Enviar peticiones cross-site, leer respuestas sólo si CORS lo permite, forzar navegaciones y formularios |
| A2 | Atacante en la misma LAN | Escanear puertos, abrir el servidor si escucha fuera de loopback, leer tráfico sin TLS |
| A3 | Quien ve el QR o la URL de emparejamiento | Capturas de pantalla, streaming de la pantalla, historial del portapapeles |
| A4 | Dispositivo emparejado perdido o robado | Cookie válida hasta que se revoque |
| A5 | Extensión o malware del navegador en el dispositivo emparejado | Leer el DOM, las respuestas y las cookies no `HttpOnly` |
| A6 | Proveedor de túnel o red intermedia | Ver y modificar tráfico si el TLS termina mal o no existe |
| A7 | Otro cliente ya emparejado | Reusar su cookie para escribir mientras otro controla la sesión |
| A8 | Red intermitente / repetición de mensajes | Reenviar una aprobación o un evento ya aplicado |

**Fuera de modelo:** un atacante con ejecución de código en la máquina anfitriona (puede leer el workspace y las claves directamente: el pair no empeora lo que ya tiene), la rotura criptográfica de TLS, y el usuario que aprueba a sabiendas algo destructivo.

## 5. Amenazas y controles

Cada amenaza tiene control **y** criterio de aceptación verificable. La columna «Residual» dice qué queda abierto aunque el control funcione.

| Id | Amenaza | Vector | Impacto | Control | Residual |
| --- | --- | --- | --- | --- | --- |
| T1 | Reutilizar el enlace de pair | URL guardada, historial, proxy | Alta: acceso permanente | Un solo canje, TTL 5 min, hash en memoria (§6.1) | Quien canjee **antes** que el dueño obtiene el dispositivo; se detecta en la lista y se revoca |
| T2 | Enlace adivinable | Fuerza bruta al endpoint de canje | Crítica | 256 bits de entropía, rate limit por IP, un intento por token | — |
| T3 | Enlace visible en logs o URL persistida | Logs del túnel, `Referer`, analytics | Alta | Token sólo en el fragmento/QR, `Referrer-Policy: no-referrer`, borrado del log al canjear (§6.1) | Capturas de pantalla (A3) |
| T4 | CSRF sobre approvals o escritura | Formulario cross-site | Crítica: escribe o aprueba | Origin exacto + 403 ajeno, `SameSite=Strict`, `Sec-Fetch-Site`, Host guard (§6.3) | Un navegador que no manda Origin (herramientas viejas) se rechaza, no se permite |
| T5 | DNS rebinding hacia loopback | Dominio propio → 127.0.0.1 | Crítica | Guarda de `Host` existente, extendida al modo pair (§6.3) | — |
| T6 | Robo de cookie | XSS, extensión (A5) | Crítica | `HttpOnly`, `Secure` con TLS, `SameSite=Strict`, no en `localStorage` (§6.2) | Malware con control del navegador puede actuar como el usuario |
| T7 | Dispositivo perdido | A4 | Alta | Lista de dispositivos, revocación que invalida la cookie en el siguiente request, auditoría (§6.2, §6.6) | Ventana hasta que el dueño revoca |
| T8 | Dos escritores a la vez | Dos pestañas/dispositivos | Alta: pasos duplicados, approvals cruzadas | Control lease con un solo escritor, traspaso explícito, 409 al resto (§6.4) | El traspaso puede perder un evento en vuelo si el emisor no espera `ack`; se exige `ack` |
| T9 | Repetición de una aprobación | Reconnect + reintento | Alta: doble escritura | Idempotencia por `(approvalId, decisionSeq)`, no se reaplica (§6.4, §6.7) | — |
| T10 | `--remote` activado por accidente | Config vieja, script, variable de entorno | Crítica: workspace expuesto | Flag por corrida, aviso, exigencia de TLS/túnel, sin persistencia (§6.5) | El operador puede ignorar el aviso: se registra en auditoría |
| T11 | Fuga de secretos al cliente web | Payload de estado demasiado generoso | Crítica | Lista blanca de campos por endpoint, redacción reutilizada de F1, sin `.env` ni claves en artifacts (§6.6) | Un artifact puede contener texto que el usuario mismo volcó |
| T12 | Saturación del servidor | Bucle de eventos o de approvals | Media | Rate limit por dispositivo y global, tamaño máximo de frame, cierre por inactividad (§6.6) | — |

## 6. Controles

### 6.1 Enlace de emparejamiento

- **Formato:** token opaco de **256 bits** de CSPRNG, `base64url`, sin información de sesión, usuario ni ruta del proyecto.
- **Transporte:** llega en el **fragmento** de la URL (`#pair=…`) o en el QR, que nunca se envía al servidor en la petición inicial ni queda en el `Referer`. El cliente lo canjea por `POST /api/pair/redeem` en el cuerpo.
- **Caducidad:** **5 minutos** desde la emisión. Caducado → 410, sin distinguir «no existe» de «caducó» en la respuesta.
- **Un solo uso:** el servidor guarda **sólo el hash SHA-256** del token vivo; al canjearlo lo borra antes de responder. Un segundo canje → 401. No hay reintento idempotente del canje: un fallo de red obliga a generar otro enlace.
- **Alcance:** el enlace empareja **un** dispositivo con **una** sesión; no crea un usuario ni habilita `--remote`.
- **Logs:** ni el token ni su hash aparecen en consola, auditoría, artifacts ni mensajes de error. El evento registra `deviceId`, hora y resultado.
- **Emisión:** sólo desde la máquina anfitriona, con bind loopback. El endpoint de canje es el único que acepta tráfico sin cookie.

### 6.2 Cookie de dispositivo

- **Contenido:** identificador opaco de 256 bits; el servidor guarda `hash`, `deviceId`, `createdAt`, `lastSeenAt`, `userAgent` (recortado) y `revokedAt`.
- **Flags:** `HttpOnly; SameSite=Strict; Path=/` y `Secure` cuando el origen es HTTPS (túnel). Sin `Domain` (host-only).
- **Duración:** 30 días, renovada por uso; la rotación del identificador ocurre al canjear, no en cada request.
- **Almacenamiento:** nunca en `localStorage` ni en memoria del cliente más allá de la cookie.
- **Revocación:** `DELETE /api/pair/devices/:id` marca `revokedAt`; el siguiente request con esa cookie recibe 401 aunque no haya caducado. Se registra en auditoría con hora y dispositivo que revocó. El registro de un revocado se conserva **24 h** (ventana de idempotencia de la baja) y después se poda: no se guarda hasta la caducidad de 30 días de la cookie, porque emparejar y revocar en bucle haría crecer la memoria sin límite.
- **Límite:** como máximo **5 dispositivos** activos; emparejar el sexto exige revocar uno.

### 6.3 Origin, CSRF y rebinding

- **Mutaciones** (`POST`/`PUT`/`PATCH`/`DELETE`) exigen `Origin` **exacto** contra la allowlist del modo pair (`https://<host-del-túnel>` o `http://127.0.0.1:<puerto>`). Sin `Origin` → 403; origen ajeno → 403. No se admite comodín ni `null`.
- **`Sec-Fetch-Site`:** `cross-site` → 403 en mutaciones, como segunda barrera independiente del `Origin`.
- **`Host`:** se mantiene la guarda anti rebinding y se extiende al host del túnel; un `Host` que no esté en la allowlist → 403 antes de tocar rutas.
- **`SameSite=Strict`** en la cookie y **`Vary: Origin`** en las respuestas.
- **CORS:** allowlist explícita, nunca `*`, y sin `Access-Control-Allow-Credentials` para orígenes que no estén en la lista.
- **Cabeceras:** `X-Frame-Options: SAMEORIGIN` (el cliente web no se embebe), `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.

### 6.4 Control lease

- **Un solo escritor.** El servidor mantiene `lease = { deviceId, expiresAt, seq }`; el escritor lo renueva cada **30 s** con TTL de **60 s**. Quien no lo tiene puede leer y **pedir** el traspaso, pero no mutar: 409 `LEASE_HELD` en cualquier mutación.
- **Traspaso explícito:** el dueño actual recibe la solicitud y la acepta; sólo entonces cambia el `deviceId`. El cliente nuevo espera `ack` antes de habilitar la UI de escritura. Sin `ack` no hay cambio.
- **Auditoría:** cada adquisición, renovación, traspaso y expiración se registra con `deviceId`, `seq` y hora. El historial de control es visible en el escritorio.
- **Aprobaciones idempotentes:** una decisión se identifica por `(approvalId, decisionSeq)`; reenviar la misma no vuelve a aplicar la tool. Una decisión de un dispositivo sin lease se rechaza con 409, no se encola.
- **Cierre:** al revocar un dispositivo o al expirar el lease sin renovación, el control vuelve al escritorio y se emite un evento de cambio de control.

### 6.5 `--remote`

- **Sin flag no hay superficie pública:** bind en `127.0.0.1` (`DEFAULT_BIND_HOST`) y el endpoint de pair sólo acepta loopback.
- **Con `--remote`:** exige un origen HTTPS (túnel con TLS) o, en su defecto, un bind de loopback con reenvío del túnel; nunca plaintext a la LAN. El arranque imprime el aviso de `bindExposureWarning` y lo registra en auditoría.
- **No persiste:** `--remote` no se guarda en `commander.json` ni se hereda de una corrida anterior.
- **Release:** `--remote` no se habilita en una build publicada hasta que esta revisión pase; si no pasa, sólo se publica el cliente local en loopback.

### 6.6 Límites, auditoría y redacción

- **Rate limit** por dispositivo y global en canje, approvals y stream; respuesta 429 con `Retry-After`.
  Implementado en `src/pair/pairRateLimit.ts` con ventana fija de 60 s y dos contadores por alcance: **caller** (el dispositivo emparejado o, antes de canjear, la IP) y **global** del proceso. El canje **sólo cuenta fallos** —un enlace válido entra aunque la ventana esté agotada—, para que la fuerza bruta de un tercero no deje al dueño sin poder emparejar; approvals y stream cuentan cada intento. El 429 lleva `Retry-After` en segundos (lo que falta de la ventana, nunca menos de 1) y `Cache-Control: no-store`. Topes por defecto por minuto: canje 10 por IP / 60 global, approvals 60 por dispositivo / 600 global, stream **60 por dispositivo / 600 global** (el cliente reconecta con backoff 1–8 s, ~10 aperturas/min por pestaña, y una sesión puede estar en tres pestañas del teléfono más la del escritorio: 30 era el tope exacto de ese caso, sin margen). Se ajustan con `COMMANDER_PAIR_RATE_REDEEM_MAX`, `_REDEEM_GLOBAL_MAX`, `_APPROVAL_MAX`, `_APPROVAL_GLOBAL_MAX`, `_STREAM_MAX`, `_STREAM_GLOBAL_MAX` y `COMMANDER_PAIR_RATE_WINDOW_MS`.
  La ventana es fija, así que en el borde dos ventanas seguidas permiten hasta el doble del tope en un pico de segundos; se acepta porque T12 es saturación sostenida, no de ráfaga. Una cubeta de fichas **no** lo acotaría (su capacidad más la recarga de un minuto da el mismo 2×); lo único que lo acota es una ventana deslizante, que se descarta por `Retry-After` difuso y un parámetro más.
- **Cupo de streams vivos** (`src/pair/pairStreamCapacity.ts`): 4 por caller y 24 por proceso, porque el rate limit cuenta **aperturas por minuto** y no mide una conexión que se queda colgada. El stream se cierra solo por inactividad (10 min sin eventos, `COMMANDER_STREAM_IDLE_MS`) y por consumidor lento (dos frames seguidos con el socket lleno); ambos casos terminan con `end` **sin** `gone`, así el cliente reconecta con `Last-Event-ID` y no da la sesión por muerta. Cuando no hay cupo: 429 `PAIR_STREAM_LIMITED` con `Retry-After`.
- **Acceso al stream**: exige cookie de dispositivo válida, o peer de loopback sin cookie (UI local y CLI). Un cookie presente pero revocado da 401 aunque venga de loopback, para que la revocación aplique sin esperar la caducidad.
- **Contadores en memoria, por proceso**: no se persisten ni se comparten. El atacante no puede reiniciar el servidor, el horizonte es de un minuto y persistirlos agregaría una escritura a disco alcanzable sin cookie —justo la superficie que el limitador cierra—. Si algún día hubiera varios procesos sobre el mismo puerto, lo correcto es dividir el presupuesto, no coordinar estado.
- **Detrás del túnel** el servidor ve `127.0.0.1`: el presupuesto “por caller” colapsa en uno solo y se vuelve un segundo global. En canje no cambia nada (sólo fallos); en approvals y stream es conservador y se acepta. `X-Forwarded-For` **no** se lee; hacerlo exigiría un proxy confiable con allowlist.
- **Tamaño máximo por frame SSE:** 512 KB (`MAX_STREAM_EVENT_BYTES`, ajustable con `COMMANDER_STREAM_EVENT_MAX_BYTES`). El evento que no cabe se rechaza con `event: error` y `code: STREAM_EVENT_TOO_LARGE`, **sin `id`** para que el cursor del cliente no avance sobre algo que no recibió; el `resync` entra en el mismo tope. Nada se trunca en silencio.
- **Sesión inactiva:** el stream se cierra tras un periodo de inactividad y el cliente debe reautenticarse con la cookie viva.
- **Redacción:** todo payload hacia el cliente pasa por la lista blanca de campos y por las reglas de redacción de F1. Ni `.env`, ni claves de proveedor, ni tokens OAuth/MCP llegan al cliente web, a la URL, a los logs o a los artifacts.
- **Auditoría:** dos JSONL con tope de 200 entradas, sin secretos: `.commander/pair/lease-audit.jsonl` (adquisición, renovación, traspaso, caducidad y revocación del control) y `.commander/pair/audit.jsonl` (emisión del enlace, canje y baja de dispositivo, con el motivo del fallo). Se leen desde loopback (`GET /api/pair/lease/audit` y `GET /api/pair/audit`), nunca desde el cliente emparejado.

### 6.7 Streaming y reconexión

- Cada evento lleva `seq` monotónica por sesión; el cliente reconecta con `Last-Event-ID` y pide **snapshot** si el hueco es mayor que el buffer.
- Al reconectar: se recarga el estado autoritativo (sesión, plan, approvals pendientes, lease) y no se repite una aprobación ya aplicada.
- La reconexión no renueva el lease por sí sola: el escritor debe renovarlo explícitamente.

## 7. Invariantes verificables

| Invariante | Cómo se prueba | Criterio de F3 |
| --- | --- | --- |
| El enlace caduca a los 5 min y no se puede reutilizar | Dos canjes del mismo token: el segundo 401/410; token con reloj adelantado → 410 | 2 |
| `Origin` ajeno → 403 | `POST` de mutación con `Origin: https://evil.example` y sin `Origin` | 2 |
| Sin `--remote` no hay puerto público | Arranque por defecto y comprobación del bind efectivo (`127.0.0.1`) | 3 |
| Revocar invalida la cookie y queda auditado | Request con cookie revocada → 401; entrada de auditoría presente | 4 |
| Un solo escritor | Dos clientes emparejados intentan mutar: el segundo recibe 409 | 5 |
| El traspaso no pierde eventos | Traspaso con `ack`, comparando `seq` de ambos clientes | 5 |
| Reconexión sin duplicar approval | Cortar la red, reconectar y reenviar la misma decisión | 6 |
| Ningún secreto en URL/logs/artifacts | Búsqueda del token, cookie y claves en logs y payloads; `Referrer-Policy` | 8 |
| Móvil 390×844 sin scroll horizontal y approval con diff | Vista del cliente en ese ancho | 7 |
| Desktop y móvil comparten sesión sin pasos duplicados | Tarea iniciada en escritorio, aprobada desde el móvil, mismo `sessionId` y `steps` | 1 |

Ninguna fila se marca por tener un test con mocks: F3 y §9.2 exigen ejecución real (LAN o túnel) con recibo y limitaciones escritas. Los casos de Origin, caducidad y reúso sí son automatizables y deben correr en CI.

## 8. Criterios de aceptación de G2

G2 se cierra cuando exista una revisión que, sobre este documento:

1. Recorra **T1–T12** y acepte o corrija cada control, con el residual declarado.
2. Confirme que ningún control depende de autenticación de usuario que no existe.
3. Verifique el reparto de responsabilidades con el túnel: terminación de TLS, cabeceras que añade o quita, y qué IP/origen ve el servidor.
4. Fije el proveedor de TLS/túnel o deje explícito que F3 sale sólo en loopback.
5. Confirme los parámetros de §6 (256 bits, 5 min, 30 días, 60 s de lease, 5 dispositivos) o los cambie con motivo escrito.
6. Declare la política de logs y auditoría: qué se guarda, cuánto y dónde.
7. Deje escrito qué **no** cubre el modelo (§4, fuera de modelo).
8. Concluya con un veredicto explícito: **pasa**, **pasa con condiciones** o **no pasa**. Sólo con «pasa» se habilita `--remote` en release; con «no pasa», F3 se limita al cliente local en loopback.

**Lo que no cierra G2:** este documento, que exista el endpoint de pair, que los tests de Origin/caducidad estén en verde, o que el cliente web funcione en loopback. G2 es una **decisión de revisión**, no un artefacto.

**Preparación de la revisión:** [`receipts/G2-REVIEW-2026-11-25.md`](receipts/G2-REVIEW-2026-11-25.md) — recorrido T1–T12 sobre el código del pair, tres hallazgos y **veredicto propuesto** (pasa con condiciones, limitado a loopback), sin firma; la mitad remota sigue abierta hasta G3.

## 9. Riesgos residuales y decisiones abiertas

| Tema | Estado | Qué falta |
| --- | --- | --- |
| Terminación TLS | Abierto | Proveedor de túnel (G3): quién termina TLS y qué cabeceras reescribe |
| `--remote` en release | Bloqueado | Esta revisión; sin veredicto «pasa» no se publica |
| Vida de la cookie (30 días) | Propuesto | Decidir si se acorta y si se exige re-pair tras revocar todos los dispositivos |
| QR en pantalla compartida | Residual | Aviso en la UI al generar el enlace; no hay control técnico |
| Múltiples dispositivos | Propuesto (5) | Decidir si se permite expulsar al más antiguo automáticamente |
| Identidad | Limitación | No hay usuario: la cookie **es** la identidad; un navegador comprometido actúa como el operador (A5) |
| Auditoría | Parcial | El control lease ya audita en `.commander/pair/lease-audit.jsonl` (200 entradas, relectura al arrancar, sin secretos); faltan la emisión, el canje y la baja de dispositivo, y la política de retención |
| Reloj y expiración | Abierto | La caducidad la evalúa el servidor, nunca el cliente |

## 10. Mantenimiento

- Este documento se actualiza cuando cambie un control, un parámetro o el reparto con el túnel; un cambio de parámetro sin actualizar la tabla de §6 deja el modelo mintiendo.
- No es un roadmap paralelo: el estado de F3 y de G2 vive en [`ROADMAP.md`](../../ROADMAP.md) §2 y §3. Aquí sólo vive el modelo de amenazas.
- La revisión que cierre G2 se adjunta como recibo en [`docs/parity/receipts/`](receipts/) y se enlaza desde §8.

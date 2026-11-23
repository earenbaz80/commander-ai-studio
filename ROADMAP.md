# Roadmap — Commander AI Studio

> **Instantánea:** 2026-11-23. **Éste es el único roadmap del proyecto:** paridad F0–F6, plataforma PL0–PL7 y UX 1.0 viven aquí, con sus criterios y su evidencia. `ROADMAP_PARITY.md`, `ROADMAP_PLATFORM.md` y `ROADMAP_UX.md` quedaron como punteros a este archivo.
>
> **Vista gráfica:** [roadmap autónomo publicado](https://earenbaz80.github.io/commander-ai-studio/roadmap-autonomo.html) — 67 % hacia el multiagente autónomo (2026-11-23), 15 de 27 pasos cerrados, con el avance por paso y su evidencia (fuente: [docs/roadmap-autonomo.html](docs/roadmap-autonomo.html)). Es una vista del mismo roadmap con su propia numeración; el mapeo está en §7.
>
> **Evidencia:** [baseline F0](docs/parity/baseline-2026-11.md) · [runbook G1/F0](docs/parity/runbook-g1-f0.md) · [recibo F0 local](docs/parity/receipts/F0-LOCAL-2026-11-10.md) · [recibo del dogfooding G1](docs/parity/receipts/G1-DOGFOOD-2026-11-12.md) · [hoja de decisión del p95](docs/parity/g1-approval-gate-decision.md).

No promete fechas; los esfuerzos son órdenes de magnitud. Una fase o un criterio sólo pasa a **hecho** cuando existe evidencia en el árbol o un recibo verificable. Cuando no hay medición, se dice **sin medir**.

## 1. Estado en una vista

| Frente | Fases | Cerradas | Criterios en alcance |
| --- | ---: | ---: | ---: |
| Paridad | 7 | 1 (F0) | 21/47 |
| Plataforma | 8 | 1 (PL0) | 19/38 |
| UX | 1 | 1 (UX 1.0) | 10/10 |
| **Total** | **16** | **3/13 en alcance** | **50/95 (53 %)** |

- **3 fases cerradas:** F0, PL0 y UX 1.0.
- **5 parciales:** F1, F2, PL2, PL5 y PL6.
- **5 pendientes:** F3, F4, F5, PL3 y PL4.
- **Fuera del cómputo:** PL1 (fuera de alcance hasta G3) y F6/PL7 (opcionales).
- **Puertas:** G0 cerrada; G1 abierta (dogfooding ejecutado, p95 en rojo); G2 y G3 no iniciadas.

El 53 % cuenta criterios de fase, no esfuerzo, tiempo ni valor de producto. Tampoco dice que la app esté al 53 %: dice que 50 de los 95 criterios en alcance tienen evidencia. Cada criterio es una casilla de este documento: cuenta el `[x]` o la cobertura que la fase declara (F2, cubierta por evidencia y sin marcar); los `[—]`, las fases opcionales y PL1 quedan fuera del numerador y del denominador. F0 cerró G0 con una baseline NVIDIA válida de 24 corridas (8/24, 0 timeouts y 0 inválidas); la paridad es baja. El dogfooding de G1 se ejecutó el 2026-11-12 (17/28, 60,7 %) y la puerta sigue abierta por una sola regla: el p95 de aprobación.

## 2. Puertas

| Puerta | Exige | Estado | Qué la desbloquea |
| --- | --- | --- | --- |
| **G0** Verdad externa | GitHub verificado + línea base de 24 corridas | **Cerrada** | Baseline NVIDIA válida: 24 corridas, 0 timeouts |
| **G1** Dogfooding del CLI | 5 días y 24 corridas usando el CLI como superficie principal, sin retroceder frente a F0 | **Abierta** · dogfooding ejecutado; p95 en rojo | T10 sigue 0/3 en las 24 (6/6 fuera de ellas, `G1-T10-15`); el bloque de medición de aprobación no está en el roadmap (decisión del 2026-11-23) |
| **G2** Seguridad remota | Modelo de amenazas y revisión antes de habilitar `--remote` | **No iniciada** | Aprobar el [modelo de amenazas](docs/parity/threat-model-remote.md) |
| **G3** Proveedor de plataforma | Proveedor y modelo de costo decididos antes de 5A | **No iniciada** | Decisión explícita de proveedor |

G1 no se cierra por ejecutar el dogfooding ni comparando contra una estimación: le falta que el producto cumpla el presupuesto de aprobación con una muestra humana válida. G2 bloquea F3; G3 bloquea F5A. Ninguna puerta se cierra por compilar o por tener tests con mocks.

## 3. Paridad — F0 a F6

Paridad significa **la misma capacidad de producto**, no la misma implementación, el mismo modelo ni la misma estética. Commander conserva local-first, Norton y Nono. La comparación con OpenCode, Antigravity y Freebuff está en [referencia-competencia-y-alcance.md](docs/parity/referencia-competencia-y-alcance.md) (documentación oficial consultada el 2026-11-07; F0 revalida lo que allí se afirma), junto con el alcance por fase que no cabe en las casillas.

### F0 · Verdad y línea base — Hecho · G0 cerrada · P0 · 4–5 d · 6/6

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

Los 14 issues de F1 están cerrados ([backlog](docs/parity/backlog-f1.md), 21,0 d-persona): `ask_user` en el CLI (`b01264a`), REPL multi-turno, diff por hunk, paridad de permisos del escritorio, seis roles de subagente con allowlist y worktree, y plan persistente con estados, archivos y criterios.

- [x] `commander agent "tarea" --json` conserva su salida y sus consumidores actuales.
- [x] `commander` abre una sesión interactiva; una edición pide aprobación con diff, y denegar no escribe ni un byte.
- [x] `ask_user` bloquea la corrida hasta recibir respuesta y la respuesta queda en el historial (F1-06, `b01264a`).
- [x] Una tarea iniciada en CLI aparece en el escritorio con el mismo `sessionId`, pasos y plan; `--resume` continúa sin duplicar tool calls y `--fork` no muta la original.
- [x] El plan se actualiza durante la corrida y sobrevive a un reinicio del servidor.
- [x] Un subagente con una tool denegada falla cerrado; 6 subagentes pueden correr en paralelo y el worktree no contamina el árbol principal.
- [x] 10 casos adversariales de permisos (shell, escritura, red, MCP, subagente) no ejecutan nada fuera de política.
- [x] Pruebas focalizadas del CLI/sesiones, `tsc --noEmit` y `vite build` en verde.

**G1 sigue abierta con el dogfooding ejecutado.** D1–D5 se corrieron el 2026-11-12 con modelo y `maxSteps` congelados: 24 corridas planificadas, 28 válidas y **17 `passed` (60,7 %)** frente a 8/24 (33,3 %) de F0, con 0 escrituras sin aprobación, 0 duplicadas en `--resume`, 0 secretos y 0 fallbacks ([recibo](docs/parity/receipts/G1-DOGFOOD-2026-11-12.md)). Siete de las ocho reglas están en verde; la única en rojo es el **p95 de aprobación ≤ 15 151 ms**: 76 982 ms (n=40, operador automatizado), 65 056 ms en CAL2 (n=6) y 26 501 ms en CAL4 (n=41), este último **no válido como muestra humana**. La [hoja de decisión](docs/parity/g1-approval-gate-decision.md) deja rigiendo la **salida B**: la referencia no se toca y la casilla sólo pasa a verde con `latencyMs`, n ≥ 40 y ≤ 2 de 40 por encima. **Ese bloque sale del roadmap por decisión del autor del 2026-11-23:** no se ejecuta, no está agendado, G1 sigue abierta sin fecha y ninguna fase se marca cerrada por la puerta.

**T10 no es regla de puerta.** Sigue **0/3 en las 24** (0/9 con las extras) con issue propio; fuera de ellas, `G1-T10-15` dio **6/6 con los siete checks** y `G1-SUBAGENT-CLOSE` quedó cerrado con el riesgo residual de los worktrees `prunable` declarado. `G1-EMPTY-TURN` sigue abierto. Detalle en §6.

### F2 · Artifacts de verificación — Parcial: criterios cubiertos, sin marcar · P1 · 6–8 d · 7/7 con evidencia

Plan, diff, evidencia de tests, informe local, visor, revisión por hunk con auditoría y grabación WebM: F2-01 a F2-09 están hechos ([backlog](docs/parity/backlog-f2.md)), pero las casillas siguen vacías porque la regla no cierra criterios de F2 con G1 abierto y falta la verificación visual en Electron (el E2E de Chromium no la sustituye).

- [ ] Una tarea de código produce plan, diff, evidencia de tests y (si hubo navegador) grabación, todos enlazados al mismo `sessionId`.
- [ ] El estado del plan coincide con las tool calls reales; un paso bloqueado se distingue de uno completado.
- [ ] El diff se puede revisar por hunk y el artifact registra quién aplicó qué.
- [ ] Una grabación de al menos 30 s se reproduce offline en Chromium y incluye consola/red con timestamps.
- [ ] La evidencia de tests muestra `exitCode != 0` en rojo y no genera un “passed” si el comando falló o no llegó a ejecutarse.
- [ ] El informe se abre desde el disco sin red, sin secretos y sin recursos externos.
- [ ] Los artifacts sobreviven a reiniciar la app y siguen siendo locales; no requieren cuenta.

### F3 · Continuidad remota y PWA — Pendiente · espera G2 · P1 · 10–14 d · 0/8

Continuar la misma sesión desde el móvil o el navegador con la misma política de aprobación, sin convertir a Commander en una nube. Requisito previo: [modelo de amenazas](docs/parity/threat-model-remote.md); `--remote` no se habilita en una release hasta que esa revisión pase.

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

Que una app creada en Commander se pueda publicar completa (auth, datos, archivos y realtime) sin fingir que un build estático es full-stack. Tres entregas: **5A** hosting SSR/Workers, **5B** backend gestionado, **5C** realtime.

- [ ] Una app SSR de ejemplo se despliega en preview y una ruta dinámica responde con variables de entorno correctas.
- [ ] Registro, login, logout y sesión funcionan; sin sesión, las rutas privadas responden 401.
- [ ] Dos usuarios no pueden leer ni modificar datos ni archivos del otro; un recurso ajeno responde 403.
- [ ] Dos clientes realtime reciben eventos; al desconectarse y volver, recuperan el snapshot sin perder el estado durable.
- [ ] Rollback y logs funcionan; los secretos no llegan al cliente, a la release ni a los logs.
- [ ] La app sigue funcionando en local sin cuenta y sin red; el camino local no depende del proveedor.
- [ ] No se publica en producción sin autorización explícita del usuario.

**G3** decide proveedor y modelo de costo antes de 5A; Vercel quedó fuera por la decisión del 2026-11-10 y Cloudflare Workers es sólo un candidato. Sin proveedor verificado, Commander publica local/estático y lo dice.

### F6 · Apuestas opcionales — no comprometido · P2 · 20–30 d · n/c

Ejecución remota/cloud, automatizaciones/cron, voz conversacional y equipos/SSO. **No forman parte del compromiso P0/P1** y no se empiezan por imitación: exigen demanda de usuarios, revisión de seguridad, modelo de costo y prueba de que no degradan el camino local-first.

## 4. Plataforma — PL0 a PL7

Hosting, backend, conectores y cuenta, sin dejar de ser local-first. Lo remoto es opt-in y el artefacto se construye una vez y se despliega tal cual. Los criterios de cada fase están abajo; el detalle de implementación y de archivos vive en `docs/parity/` y en los recibos.

### PL0 · Contrato de despliegue — Hecho · P0 · 2–3 d · 5/5

- [x] El publicador local actual sigue pasando sus pruebas sin cambios de comportamiento.
- [x] Un estado antiguo sin `remote` se lee y se guarda con migración.
- [x] El test double en memoria completa preview → producción → rollback.
- [x] Ninguna interfaz nueva exige credenciales para publicar en local.
- [x] `tsc --noEmit` y `vite build` en verde.

### PL1 · Hosting remoto de estáticos — Fuera de alcance · código listo · P1 · 4/4 + 3 fuera

Adaptador, rutas y UI implementados; **no hay despliegue real**: la cobertura es con `fetch` simulado y un servidor de contrato. Fuera del cómputo hasta G3.

- [ ] Una app Vite de ejemplo se publica en preview y devuelve una URL pública que carga HTML, JS y CSS con los content types correctos. **Pendiente de verificación real:** los tests usan un `fetch` simulado.
- [x] Promover preview a producción no vuelve a compilar ni a copiar la release (cubierto en `vercelAdapter.test.ts`).
- [ ] Rollback vuelve a la release anterior en menos de 30 segundos. **Pendiente de medición real.**
- [ ] El estado sobrevive a reiniciar Commander. **Pendiente de prueba real.**
- [x] Un fallo del proveedor deja el estado local en un estado recuperable, no en “publicado”.
- [x] El token del proveedor no aparece en la respuesta HTTP, en el renderer ni en los logs.
- [x] La release no contiene `.env*`, `.npmrc`, `.netrc` ni symlinks.

### PL2 · Navegador real y artifacts — Hecho con límites · P2 · 8/8

Frames JPEG (~1,4 fps), consola y red reales, entrada, reconexión y grabación local de 120 s / 180 frames; sin verificación visual en Electron y sin MP4 ni export remoto.

- [x] Un dev server local se ve en el panel y el agente puede hacer clic en un elemento visible (fixture local en `browserSse.test.ts`; sin verificación visual en Electron).
- [x] La consola muestra un `console.error` real de la página.
- [x] El monitor de red muestra una petición 404 real, con método, URL, estado y duración.
- [x] Usuario y agente comparten la misma sesión; un clic del agente se refleja en el panel.
- [x] Al cerrar y reabrir el panel, la sesión se reconecta o se explica que expiró.
- [x] No queda ningún texto de “demo” ni de “simulate” en la ruta de preview.
- [x] Navegar fuera de loopback sigue pidiendo aprobación.
- [x] Grabar una sesión, guardar frames y comentarios, y revisarlos (UI y IndexedDB; sin verificación visual en Electron).

### PL3 · Backend gestionado — Pendiente · siguiente P0 · 2–3 sem · 0/7

`BackendAdapter` con `provision`/`migrate`/`status`/`rotateSecrets`, bindings de base de datos, storage y auth por app, y una app de ejemplo con aislamiento entre cuentas. Hoy existe la base local multiinquilino de `/api/backend`, pero no aprovisiona ni despliega.

- [ ] Un proyecto nuevo aprovisiona base de datos, storage y auth desde la UI o un comando explícito.
- [ ] Las migraciones se ejecutan en el servidor y son idempotentes.
- [ ] La app de ejemplo permite registro, login, creación de datos y subida de archivo.
- [ ] Dos cuentas distintas no ven datos ni archivos de la otra.
- [ ] Una petición sin sesión recibe 401; una petición a un recurso ajeno recibe 403.
- [ ] Las credenciales no aparecen en el HTML, JS público, logs ni repositorio.
- [ ] El estado del backend se puede consultar sin exponer secretos.

### PL4 · Realtime para apps — Pendiente · depende de PL3 · 1 sem · 0/5

Salas, presencia y eventos con tickets autenticados; el estado crítico queda en la base y realtime sólo notifica.

- [ ] Dos clientes autenticados en la misma sala reciben eventos.
- [ ] Un cliente que no pertenece a la sala recibe 403.
- [ ] El ticket expira y no se puede reutilizar.
- [ ] Tras reconectar, el cliente recarga el snapshot authoritative.
- [ ] Los eventos no se usan como fuente de verdad para permisos ni para reglas de negocio.

### PL5 · Conectores nativos — GitHub verificado · Linear fuera · P1 · 6/7

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

Hay catálogo de plugins y cinco plantillas locales; falta que skills y plantillas viajen con la cuenta.

- [ ] Una skill instalada en una máquina aparece en otra tras iniciar sesión.
- [ ] Se puede usar sin conexión con la última copia cacheada.
- [ ] Actualizar una skill no duplica archivos ni deja huérfanos.
- [ ] Desinstalar borra sólo lo que instaló.
- [ ] Una skill con permisos no declarados se rechaza o pide aprobación.
- [ ] Una plantilla crea un proyecto que compila sin pasos manuales ocultos.

### PL7 · Workspaces remotos — Opcional · no iniciar sin decisión · 4–6 sem · 0/5

Ejecutar el agente fuera de la máquina cambia el modelo del producto. No se empieza «porque Freebuff lo tiene».

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

## 8. Secuencia recomendada

**Ahora**

1. **Bloque de aprobación fuera del roadmap (2026-11-23):** por decisión del autor no se agenda; G1 queda **abierta**, la referencia de 15 151 ms intacta y ninguna fase se marca cerrada por la puerta.
2. F1-1 (T10): sigue 0/3 en las 24 y es el paso de mayor peso fuera de la puerta; `G1-EMPTY-TURN` sigue abierto y `G1-SUBAGENT-CLOSE` quedó cerrado con el 6/6 de `G1-T10-15`. Los otros dos issues de G1 siguen abiertos y tampoco son regla de puerta: `G1-T2-READ-LOOP` (T2 en 0/2, guardas aplicadas) y `G1-APPROVAL-SHELL-TAIL` (P0/P1 hechos, P2 en pausa).

**Después de G1**

3. F3 (pair/PWA) y F4A (VS Code) en paralelo, con G2 antes de habilitar remote.
4. Decidir proveedor en G3.
5. F5A (SSR/Workers) y 5B (backend gestionado).

**Más adelante**

6. F5C (realtime), PL4, PL6.
7. F6 y PL7 sólo con una decisión de producto explícita.

Con dos personas, el alcance P0 + P1 es del orden de 9–12 semanas de trabajo efectivo; con una, 12–16. Primeros 30 días: cerrar F0 (hecho), completar F1 y dejar F2 en revisión.

## 9. Riesgos y no objetivos

| Riesgo | Mitigación |
| --- | --- |
| Falta la credencial real de un proveedor (Vercel en pausa hasta G3, Linear fuera) | Se mide lo que sí hay (GitHub) y no se declara paridad con mocks; un proveedor nuevo exige su propio recibo |
| El alcance crece por comparar tres productos a la vez | Puertas G0–G3, no objetivos y fases separadas; F6 sólo con aprobación |
| El pair remoto expone código o approvals | Loopback por defecto, enlace de un uso, caducidad, cookie, Origin/CSRF, control lease, revisión de seguridad |
| Un plugin ejecuta código no confiable | Instalación explícita, manifiesto, permisos, revisión y aislamiento de fallos |
| El backend gestionado se dispara en costo | Cuotas, presupuestos, opt-in, proveedor decidido en G3 |
| Migración de sesiones/artifacts rompe datos | Esquema versionado, migración tolerante, backup y prueba de reinicio |
| Playwright/ffmpeg no empaqueta bien en Electron | Vídeo opcional, fallback a frames + informe, prueba en el instalador |
| La UI de artifacts no se ve bien en Electron | Verificación visual en el instalador, no sólo tests de jsdom |

**No objetivos:** nube por defecto o workspace siempre encendido; app móvil nativa iOS/Android en este horizonte (la apuesta es PWA); edición multiusuario en tiempo real; seis extensiones de IDE (VS Code primero); runtime LSP universal; SSO empresarial, VPC-SC o residencia regional; marketplace propio con pagos y ejecución automática de plugins de terceros; entrenar o poseer modelos fundacionales; facturación, planes o créditos; multi-tenant SaaS para terceros; Kubernetes o contenedores arbitrarios en el hosting.

## 10. Cómo se mantiene

- Este archivo es el roadmap completo. Los criterios viven aquí y sólo aquí: no se duplican en otros documentos.
- Al cambiar el estado de una fase o puerta se actualiza su sección y se mueve la fecha de la instantánea. Todo «hecho» necesita evidencia: ruta de código, test, PR, issue, recibo o URL. Lo no medido se queda como **sin medir**.
- `docs/parity/` guarda la evidencia (baseline, dogfooding, recibos, backlogs, hojas de decisión) y `docs/parity/issues/` el cuerpo de cada issue; ningún documento de ahí es un roadmap paralelo. [referencia-competencia-y-alcance.md](docs/parity/referencia-competencia-y-alcance.md) es material de consulta (matriz de competidores y alcance por fase), sin criterios ni casillas.
- La vista gráfica se actualiza en el bloque `<script id="plan">` de `docs/roadmap-autonomo.html` (peso y % por paso); los porcentajes de fase y el global se recalculan al abrir la página.
- Guardas en CI: `tests/unit/roadmapFigures.test.ts` comprueba que la vista y este documento citan las mismas cifras, que la tabla de §1 cuadra con las casillas de §3/§4/§5 y que se cita el recibo `G1-T10-*` más alto; `npm run check:criteria` falla si un issue cerrado conserva criterios sin marcar.
- Gates mínimos antes de cerrar una fase: `npx tsc --noEmit`, `npx vite build` y las pruebas focalizadas de la fase. Los tests de endpoints usan el arnés compartido (`startServer()`), no un servidor propio.
- La línea base se ejecuta con `npm run baseline` y se registra en [docs/parity/baseline-2026-11.md](docs/parity/baseline-2026-11.md).

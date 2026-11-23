# Backlog ejecutable — Fase 2 (artifacts de verificación)

> **Base:** fase **F2** de [ROADMAP.md](../../ROADMAP.md) §3.
> **Estado (2026-11-09):** **F2-01 a F2-07 implementados** (contrato/store, evidencia de tests, diff/decisiones, informe local, visor, enlace a la grabación y E2E local); G1 sigue pendiente. **G1 sigue sin medirse**: F0 ya tiene una baseline válida con NVIDIA (24 corridas, 8/24, 0 timeouts), pero no se ejecutó el dogfooding que permita comparar latencia/éxito. F2-02 añade evidencia al resultado de `shell.run` sin cambiar el bucle ni las aprobaciones.
> **Actualización (2026-11-16):** **F2-08 y F2-09 implementados** (revisión por hunk con auditoría; WebM, consola/red y reproducción de 30 s). G1 sigue sin medirse y los criterios de fase siguen sin marcar por esa regla.
> **Estimaciones:** días-persona, ±30 %. Suman **8,25 d-persona** con F2-08/F2-09; el roadmap estima 6–8 días.
> **Regla de cierre:** `tsc --noEmit` + pruebas focalizadas en verde; si toca UI, además `vite build`. Un test con `exitCode != 0` o que no llegó a ejecutarse **no** se pinta como aprobado.
> **Dependencias externas:** ninguna. F2 no requiere Vercel, Linear ni un proveedor de modelo.

## 1. Punto de partida real

| Pieza | Estado actual | Consecuencia para F2 |
| --- | --- | --- |
| `src/artifacts/types.ts` | `BrowserRecordingArtifact` + `VerificationArtifact` (F2-01) | Contrato listo; falta el productor y el visor de verificación |
| `src/artifacts/store.ts` | IndexedDB con `keyPath: 'id'`; Map en memoria si no hay IndexedDB | Compatible: las grabaciones antiguas no necesitan migración |
| `src/components/panel/ArtifactsView.tsx` | Lista grabaciones y verificaciones con filtro por tipo/proyecto; detalle de verificación (F2-05) | F2-06 resuelve la grabación por id y abre su selección; F2-07 cubre el E2E |
| `src/agent/sessionTypes.ts` | `SessionStateV2` con `plan`, `steps` y `pendingApproval.diff/hunks` | Fuente de las decisiones; el patch se toma de la solicitud de aprobación, no se regenera |
| Herramientas de tests | `shell.run` adjunta `testEvidence` y entorno para comandos de tests; el artifact aún no se crea | F2-04/F2-05 consumen la evidencia; el ejecutor no cambia de contrato |
| Informe | `src/artifacts/report.ts` (F2-04) y el visor (F2-05) | Se muestra como texto y se puede generar/descargar; no requiere red |
| Grabación | Frames JPEG locales; no hay WebM/MP4 | F2-06 resuelve por `browserRecordingId`; no duplica frames |

La vista actual asume `frames` en todos los artifacts. F2-01 la limita a grabaciones; el visor de verificación es F2-05, no un efecto colateral del schema.

## 2. Tabla de issues

| ID | Issue | Estado | d-persona | Depende de |
| --- | --- | --- | --- | --- |
| F2-01 | Contrato `VerificationArtifact` y store compatible | **Hecho** | 0,75 | — |
| F2-02 | Evidencia de tests y entorno | **Hecho** | 1,0 | F2-01 |
| F2-03 | Diff y decisiones de la sesión | **Hecho** | 1,0 | F2-01 |
| F2-04 | Informe local Markdown/HTML | **Hecho** | 1,0 | F2-01, F2-02 |
| F2-05 | Visor de artifacts de verificación | **Hecho** | 1,25 | F2-01, F2-04 |
| F2-06 | Enlace a la grabación de navegador | **Hecho** | 0,5 | F2-01 |
| F2-07 | E2E local y límites del artifact | **Hecho** | 1,0 | F2-02 a F2-06 |
| F2-08 | Revisión por hunk y auditoría de aplicación | **Hecho** | 0,75 | F2-03 |
| F2-09 | WebM, consola/red y 30 s offline | **Hecho** | 1,0 | F2-01, F2-06 |

## 3. Issues

### F2-01 — Contrato `VerificationArtifact` y store compatible

**Labels:** `f2`, `p1`, `area:artifacts`
**Estimación:** 0,75 d-persona · **Depende de:** nada · **Estado:** hecho

**Por qué.** El store sólo conocía grabaciones de navegador. Sin un contrato común, plan, diff, tests e informe acaban en formas distintas y la vista no puede distinguir un artifact de otro.

**Alcance**
- `VerificationArtifact` con `schemaVersion: 1`, `sessionId`, `projectPath`, `status`, `plan`, `decisions`, `diff`, `tests`, `browserRecordingId`, `environment` y `report`.
- `VerificationTestEvidence` con `status`, `exitCode`, duración, timestamps y tails acotados.
- `VerificationDiff`, `VerificationDecision`, `VerificationEnvironment` y `VerificationReport`.
- `Artifact` pasa a ser una unión; guardas `isBrowserRecordingArtifact` / `isVerificationArtifact`.
- El store no cambia: sigue guardando por `id` y las grabaciones existentes se leen igual.
- `ArtifactsView` filtra `browser-recording` hasta que F2-05 añada el detalle.

**Fuera de alcance:** capturar tests, generar el diff, renderizar el plan o generar el informe.

**Criterios de aceptación**
- [x] Un `VerificationArtifact` se guarda, se lista y se recupera sin perder plan, diff, tests ni informe.
- [x] Las grabaciones antiguas siguen funcionando y no requieren migración.
- [x] Las guardas distinguen ambos `kind` y TypeScript estrecha el tipo.
- [x] La vista existente no intenta leer `frames` de un artifact de verificación.
- [x] `tsc --noEmit`, `vite build` y las pruebas focalizadas pasan.

**Pruebas**
- [`tests/unit/artifacts.test.ts`](../../tests/unit/artifacts.test.ts): guardas, round-trip del `VerificationArtifact` y un fallo que sigue siendo fallo.
- [`tests/ui/ArtifactsView.test.tsx`](../../tests/ui/ArtifactsView.test.tsx) y [`tests/ui/BrowserView.test.tsx`](../../tests/ui/BrowserView.test.tsx): la grabación sigue funcionando con el tipo unión.

**Archivos:** `src/artifacts/types.ts`, `src/components/panel/ArtifactsView.tsx`, `tests/unit/artifacts.test.ts`, tests de UI afectados.

---

### F2-02 — Evidencia de tests y entorno

**Labels:** `f2`, `p1`, `area:artifacts`, `area:tests`
**Estimación:** 1,0 d-persona · **Depende de:** F2-01 · **Estado:** hecho (2026-11-09)

**Por qué.** Hoy se puede ejecutar un test y ver su salida en el chat, pero no queda un recibo que distinga “pasó” de “no llegó a ejecutarse”. El informe necesita esa evidencia.

**Alcance**
- Módulo puro `src/artifacts/testEvidence.ts` que construya `VerificationTestEvidence` a partir del comando, `exitCode`, tiempos y tails.
- Reglas: `exitCode === 0` → `passed`; `exitCode !== 0` → `failed`; sin ejecución → `not-run` con `exitCode: null`.
- Límites de tails (por ejemplo 8 KB por stream) y marca `timedOut`.
- Captura de Node, SO, commit y branch en `VerificationEnvironment`.
- Integración con la ejecución de tests existente sin cambiar el contrato de tools.

**Fuera de alcance:** un runner de tests nuevo, cobertura, UI de evidencia.

**Criterios de aceptación**
- [x] Un fallo con `exitCode: 1` se conserva como `failed` y el informe no puede convertirlo en verde.
- [x] Un comando no ejecutado queda `not-run`, no `passed`.
- [x] La duración y los tails quedan acotados; un timeout se distingue de un fallo normal.
- [x] No se guardan variables de entorno ni tokens en la evidencia.

**Cierre (2026-11-09).** La evidencia viaja en el resultado de `shell.run` para comandos de tests; el artifact se crea en F2-04/F2-05. 21/21 tests nuevos de `testEvidence`, 3/3 de artifacts y 91/91 de `agentTools` con la integración real; `npm run build` verde.

**Pruebas**
- `tests/unit/testEvidence.test.ts`: éxito, fallo, no ejecutado, timeout, tails, redacción, entorno y detección de comandos.
- `tests/agentTools.test.ts`: `shell.run` ejecuta un `node --test` real en un fixture temporal y devuelve `testEvidence` + `environment`.

**Archivos:** `src/artifacts/testEvidence.ts` (nuevo), `agentTools.ts`, `src/agent/tools/shell.ts`, `src/utils/agentToolsApi.ts`, `tests/unit/testEvidence.test.ts`, `tests/agentTools.test.ts`.

---

### F2-03 — Diff y decisiones de la sesión

**Labels:** `f2`, `p1`, `area:artifacts`, `area:agent`
**Estimación:** 1,0 d-persona · **Depende de:** F2-01 · **Estado:** hecho (2026-11-09)

**Por qué.** El diff ya existe para aprobar una tool y queda en `SessionStepV2.approval`, pero no se conserva como artifact revisable. Sin eso, el informe no puede enseñar qué cambió ni quién lo aprobó.

**Alcance**
- Construir `VerificationDiff` desde el patch de la aprobación y los archivos tocados.
- Mapear `SessionStepV2.approval` a `VerificationDecision` (`stepId`, `tool`, decisión y motivo).
- Conservar `base`/`head` cuando estén disponibles; no inventar un diff si no hubo cambios.
- Dejar el patch completo para F2-04; la revisión por hunk llega con F2-05.

**Fuera de alcance:** volver a aplicar el diff, editar hunks o reemplazar el motor de aprobaciones.

**Criterios de aceptación**
- [x] El patch del artifact coincide con el que se aprobó; no se regenera con otra herramienta.
- [x] Una denegación queda registrada como decisión y no produce un diff aplicado.
- [x] Los archivos listados coinciden con el patch.
- [x] Un artifact sin cambios no inventa un diff vacío “exitoso”.

**Cierre (2026-11-09).** `buildVerificationDiff` une `SessionStepV2.approval` con la solicitud de aprobación por `approval.id`; copia el patch tal cual y deriva los archivos de sus cabeceras `---`/`+++`, descartando `/dev/null`, rutas absolutas y `..`. Sólo entran aprobaciones `allow`/`allow-session` cuyo paso terminó `completed`; una denegación queda como decisión y no aporta patch. `withVerificationSections` fija decisiones y diff en el artifact y elimina un diff previo si la corrida no cambió nada. Las decisiones viven en el estado; el patch debe aportarlo quien vio la solicitud (SSE o `getPendingApprovals()`), porque el paso sólo persiste la decisión. 18/18 tests nuevos; `npm run build` verde.

**Pruebas**
- `tests/unit/verificationDiff.test.ts`: patch real, varios archivos, denegación, sin cambios, archivos derivados del patch y persistencia en el artifact.

**Archivos:** `src/artifacts/verificationDiff.ts` (nuevo), `src/artifacts/types.ts`, `tests/unit/verificationDiff.test.ts`; `src/agent/sessionTypes.ts` (sólo lectura).

---

### F2-04 — Informe local Markdown/HTML

**Labels:** `f2`, `p1`, `area:artifacts`, `security`
**Estimación:** 1,0 d-persona · **Depende de:** F2-01, F2-02 · **Estado:** hecho (2026-11-09)

**Por qué.** El artifact aislado no sirve para revisar si no se puede abrir y compartir. El informe convierte plan, diff, tests y entorno en una unidad revisable.

**Alcance**
- Generador `src/artifacts/report.ts` con Markdown como formato canónico.
- HTML autocontenido y escapado; sin scripts, iframes, fuentes ni imágenes externas.
- Incluir plan, decisiones, diff, evidencia de tests, entorno, fecha y referencia a la grabación.
- No incluir `.env`, variables de entorno, tokens ni rutas fuera del proyecto.
- Abrir desde disco; no requiere red ni cuenta.

**Criterios de aceptación**
- [x] El informe se abre offline y no hace peticiones externas.
- [x] Un test fallido aparece en rojo y con su `exitCode`; uno no ejecutado no aparece como aprobado.
- [x] El HTML escapa contenido no confiable del modelo, del comando o de la sesión.
- [x] No aparecen tokens, `.env` ni rutas fuera del workspace.
- [x] El informe sobrevive a reiniciar la app porque vive en el artifact/store, no sólo en memoria.

**Cierre (2026-11-09).** `renderMarkdownReport`/`renderHtmlReport` son funciones puras sobre `VerificationArtifact`; `withVerificationReport` deja el informe dentro del artifact para que el store lo persista. El estado efectivo degrada a `failed` si algún test falla o expira y a `incomplete` si hay `not-run`, aunque el artifact diga `passed`. 18/18 tests de `report`, 21/21 de `testEvidence` y 3/3 de artifacts; `npm run build` verde.

**Pruebas**
- `tests/unit/report.test.ts`: Markdown, HTML escapado, fallo rojo, sin recursos externos, sin secretos.
- Un fixture con una ruta `..` y un token falso que no deben aparecer.

**Archivos:** `src/artifacts/report.ts` (nuevo), `src/artifacts/types.ts`, UI de F2-05.

---

### F2-05 — Visor de artifacts de verificación

**Labels:** `f2`, `p1`, `area:artifacts`, `area:ui`
**Estimación:** 1,25 d-persona · **Depende de:** F2-01, F2-04 · **Estado:** hecho (2026-11-09)

**Por qué.** La vista actual es un reproductor de grabaciones. Si no se ramifica por `kind`, un artifact de verificación no se puede revisar y la lista mezcla dos cosas distintas.

**Alcance**
- `ArtifactsView` con filtro por proyecto y por tipo; conservar la lista y los comentarios de grabaciones.
- Detalle de verificación: plan con estados, decisiones, diff, tests con `exitCode`, entorno e informe.
- Enlace “abrir carpeta” y visualización del informe; sin subida remota.
- Estados vacíos claros: “sin grabaciones” no es lo mismo que “sin artifacts de verificación”.

**Fuera de alcance:** editor de hunks, comentarios sobre el diff, visor remoto.

**Criterios de aceptación**
- [x] Una grabación existente se sigue reproduciendo y comentando igual.
- [x] Un artifact de verificación muestra plan, diff, tests e informe sin errores.
- [x] El filtro por proyecto no mezcla artifacts de otro workspace.
- [x] El botón de abrir carpeta apunta al directorio local del artifact.
- [x] La vista no hace peticiones externas.

**Cierre (2026-11-09).** `ArtifactsView` lista ambos tipos con filtro por tipo y proyecto; `VerificationArtifactDetail` muestra plan, decisiones, diff, tests con `exitCode`, entorno, referencia a la grabación e informe. El informe se muestra como texto (nunca HTML interpretado) y se puede generar con F2-04 si falta o descargar. “Abrir carpeta” usa `app:openFolder` de Electron, que valida ruta absoluta y directorio existente; en web cae a copiar la ruta. 10/10 tests de `ArtifactsView` y 13/13 de `BrowserView`; `npm run build` verde.

**Pruebas**
- `tests/ui/ArtifactsView.test.tsx`: ambos tipos, filtros por tipo/proyecto, detalle, generación de informe, apertura de carpeta y estado vacío por tipo.
- `tests/ui/BrowserView.test.tsx`: 13/13 sin regresión de grabación.
- `vite build` verde.

**Archivos:** `src/components/panel/ArtifactsView.tsx`, `src/components/panel/VerificationArtifactDetail.tsx` (nuevo), `electron/main.cjs`, `electron/preload.cjs`, `src/types/electron.d.ts`, tests de UI.

---

### F2-06 — Enlace a la grabación de navegador

**Labels:** `f2`, `p1`, `area:artifacts`, `area:browser`
**Estimación:** 0,5 d-persona · **Depende de:** F2-01 · **Estado:** hecho (2026-11-09)

**Por qué.** El artifact de verificación no debe duplicar los frames de una grabación. Una referencia por id mantiene el store pequeño y permite ver la evidencia visual desde el informe.

**Alcance**
- Guardar `browserRecordingId` en el artifact de verificación.
- Resolver la grabación al abrir el detalle; si fue borrada, mostrar “grabación no disponible” sin romper el artifact.
- Enlazar desde el informe y desde el visor.
- No copiar frames ni crear una segunda grabación.

**Criterios de aceptación**
- [x] El artifact guarda el id y el informe enlaza a la grabación correcta.
- [x] Borrar la grabación no corrompe el artifact de verificación.
- [x] No hay frames duplicados en IndexedDB.
- [x] El detalle funciona con y sin grabación.

**Cierre (2026-11-09).** `ArtifactsView` resuelve `browserRecordingId` contra los artifacts del proyecto y pasa la grabación a `VerificationArtifactDetail`; el detalle muestra título, frames, duración y un botón “Ver grabación” que cambia la selección (el filtro vuelve a “Todos”) sin copiar frames. Si la grabación fue borrada, muestra “Grabación no disponible” y conserva el artifact y el informe. El informe mantiene la referencia por id y el detalle ofrece el enlace también desde su sección. 4/4 tests de artifacts, 19/19 de report, 15/15 de ArtifactsView y 13/13 de BrowserView; `npm run build` verde.

**Pruebas**
- `tests/unit/artifacts.test.ts`: referencia por id, una sola copia de frames y round-trip.
- `tests/unit/report.test.ts`: la referencia del Markdown/HTML coincide y no incrusta frames.
- `tests/ui/ArtifactsView.test.tsx`: grabación resuelta, enlace desde el visor y el informe, borrado y referencia huérfana.

**Archivos:** `src/components/panel/ArtifactsView.tsx`, `src/components/panel/VerificationArtifactDetail.tsx`, `tests/unit/artifacts.test.ts`, `tests/unit/report.test.ts`, `tests/ui/ArtifactsView.test.tsx`.

---

### F2-07 — E2E local y límites del artifact

**Labels:** `f2`, `p1`, `area:artifacts`, `area:testing`
**Estimación:** 1,0 d-persona · **Depende de:** F2-02 a F2-06 · **Estado:** hecho (2026-11-09)

**Por qué.** El schema y el informe pueden pasar tests unitarios y fallar al unir una sesión real, un comando de tests y una recarga. Hace falta un recorrido completo sin cuentas externas.

**Alcance**
- Fixture determinista de sesión (proveedor falso; no requiere modelo) que produzca plan, diff, un test fallido y una grabación opcional.
- Crear el artifact, generar el informe, recargar la app y comprobar que sigue en el store.
- Verificar que el fallo sigue rojo y que no se filtraron secretos.
- Medir el tamaño del artifact y documentar límites de frames/tails.

**Criterios de aceptación**
- [x] Una corrida local produce un artifact con plan, diff, test e informe enlazados al mismo `sessionId`.
- [x] Tras recargar, el artifact y el informe siguen disponibles.
- [x] Un test fallido no se pinta verde; uno no ejecutado queda `not-run`.
- [x] No hay secretos, `.env`, source maps ni recursos externos en el artifact.
- [x] El E2E no depende de Vercel, Linear ni GitHub Models.

**Cierre (2026-11-09).** `tests/e2e/verificationArtifact.spec.ts` siembra IndexedDB con `buildVerificationArtifactFixture` (guion fijo que simula un proveedor, sin modelo ni red), abre Workbench → Artifacts, comprueba plan, diff, test fallido con `exitCode: 1`, test `not-run`, informe y grabación enlazada, y recarga la app para verificar que ambos artifacts y el informe siguen en el store. Medición del fixture: verificación **19.124 B**, grabación **1.252 B**, `stdoutTail` **8.000 caracteres**. Límites vigentes: `MAX_RECORDING_FRAMES=180`, `MAX_RECORDING_MS=120.000`, `DEFAULT_TAIL_CHARS=8.000`; el E2E usa 1 frame, no el peor caso. 1/1 en Chromium; `npm run build` verde.

**Pruebas**
- `tests/e2e/verificationArtifact.spec.ts`: 1/1 en Chromium; persistencia real en IndexedDB y recarga.
- `tests/helpers/verificationArtifactFixture.ts`: fixture determinista con evidencia, diff, informe y grabación opcional.
- `tsc --noEmit` + `vite build` (verde).

**Archivos:** `tests/e2e/verificationArtifact.spec.ts` (nuevo), `tests/helpers/verificationArtifactFixture.ts` (nuevo), `docs/parity/backlog-f2.md`. No cambia el schema ni el productor del artifact.

### F2-08 — Revisión por hunk y auditoría de aplicación

**Labels:** `f2`, `p1`, `area:artifacts`
**Estimación:** 0,75 d-persona · **Depende de:** F2-03 · **Estado:** hecho (2026-11-16)

**Por qué.** El artifact ya tenía el patch completo, pero revisarlo por partes obligaba a leerlo entero y no quedaba constancia de quién lo había aplicado. El criterio de fase pide revisión por hunk y auditoría; ninguna de las dos cosas se resuelve reescribiendo el patch.

**Alcance**
- `src/artifacts/hunks.ts`: parser de patch unificado (`@@ -a,b +c,d @@`) con ids estables por archivo y rango, y rango de líneas dentro del patch.
- Decisiones por hunk en `VerificationDiff.reviews` (quién, cuándo y, opcionalmente, nota); el patch no se toca al revisar.
- Atribución por hunk en `VerificationDiff.attributions`: la aprobación (`stepId`, `tool`, decisión) que aportó ese hunk, derivada del patch ya aprobado, no regenerada.
- Exportación del patch con sólo los hunks aceptados, conservando las cabeceras originales (`diff --git`, `---`, `+++`) y sin recortar espacios finales.
- Las revisiones sobreviven a reconstruir el artifact mientras los hunks sigan existiendo (`carryHunkReviews`).
- Visor: estado por hunk, aceptar/rechazar/pendiente, quién aplicó y descarga del patch aceptado. El informe resume hunks y atribución.

**Fuera de alcance:** volver a aplicar el patch, editar su texto, reemplazar el motor de aprobaciones o revisar hunks sin `@@`.

**Criterios de aceptación**
- [x] Un hunk se marca aceptado o rechazado y la decisión persiste tras recargar (E2E en IndexedDB).
- [x] Volver a pulsar la decisión la deja pendiente otra vez.
- [x] Cada hunk muestra la tool y el paso que lo aplicaron; un hunk sin fuente no inventa atribución.
- [x] El patch aceptado contiene sólo esos hunks y sus cabeceras; sin aceptados no se descarga un "vacío exitoso".
- [x] El patch original no se reescribe al revisar (`diff.patch` no cambia).

**Pruebas**
- [`tests/unit/hunks.test.ts`](../../tests/unit/hunks.test.ts): 12/12 — parseo multiarchivo, ids estables, revisión inmutable, atribución por fuente, filtrado por aceptados.
- [`tests/e2e/verificationArtifact.spec.ts`](../../tests/e2e/verificationArtifact.spec.ts): acepta el primer hunk, comprueba la atribución y que `ACEPTADO` sigue tras recargar.

**Archivos:** `src/artifacts/hunks.ts` (nuevo), `src/artifacts/types.ts`, `src/artifacts/verificationDiff.ts`, `src/artifacts/report.ts`, `src/components/panel/VerificationArtifactDetail.tsx`.

---

### F2-09 — WebM, consola/red y 30 s offline

**Labels:** `f2`, `p1`, `area:artifacts`, `area:browser`
**Estimación:** 1,0 d-persona · **Depende de:** F2-01, F2-06 · **Estado:** hecho (2026-11-16)

**Por qué.** Los frames JPEG se reproducían, pero no se podían sacar del artifact como vídeo y la grabación no llevaba consola ni red. El criterio de fase pide WebM real, 30 s offline y log con timestamps; inventar un MP4 o un vídeo sin encoder no vale.

**Alcance**
- `src/artifacts/recordingLogs.ts`: recorta la consola y la red de la sesión a la ventana de la grabación, calcula `atMs` relativo a los frames, deduplica por `seq`, redacta secretos y aplica topes (200 consola / 300 red) dejando constancia de lo omitido.
- `src/artifacts/webmTimeline.ts`: parte pura (códec VP8→VP9→genérico, línea de tiempo con cambio de frame por instante, nombre de archivo).
- `src/artifacts/webm.ts`: exportación con `canvas.captureStream` + `MediaRecorder`; si no hay encoder lo dice y conserva frames + log, sin MP4 falso.
- `useBrowserRecording` captura los logs al detener; si el fetch falla, guarda la grabación sin log en vez de perderla.
- Visor: consola y red con timestamps, aviso de entradas omitidas, descarga del log JSON y botón de exportación con progreso.

**Fuera de alcance:** MP4, captura a más fps o recodificar desde Playwright; la exportación reproduce los frames ya guardados.

**Criterios de aceptación**
- [x] El WebM descargado es un archivo real (>200 B) generado por el encoder del navegador (E2E con descarga).
- [x] Una grabación de 30 s se reproduce offline en Chromium y la línea de tiempo avanza sola.
- [x] La consola y la red muestran su marca de tiempo relativa (`0:15`) y el estado HTTP.
- [x] Sin `MediaRecorder` la vista explica el motivo y mantiene frames + log.
- [x] Los logs no llevan tokens sin redactar ni superan los topes declarados.

**Pruebas**
- [`tests/unit/recordingLogs.test.ts`](../../tests/unit/recordingLogs.test.ts): 5/5 — ventana, orden, deduplicación, topes/omitidos, redacción.
- [`tests/unit/webmTimeline.test.ts`](../../tests/unit/webmTimeline.test.ts): 6/6 — códec, 30 s, colapso de frames, topes, nombre.
- [`tests/ui/webm.test.ts`](../../tests/ui/webm.test.ts): 1/1 — degradación sin encoder.
- [`tests/e2e/recordingWebm.spec.ts`](../../tests/e2e/recordingWebm.spec.ts): 2/2 — descarga WebM real y reproducción de 30 s con consola/red.

**Cierre (2026-11-16).** Medición reproducible del caso de 30 s: `WEBM_MEASURE=1 npx playwright test tests/e2e/recordingWebm.spec.ts --project=chromium -g "mide la exportación"` en Chromium headless (Playwright 1.65; Windows 10.0.26200, i7-11700F, 64 GiB). Caso: 42 frames JPEG de 1152×720 (30 s a la cadencia real de ~1,4 fps, viewport 1280×800 escalado), artifact origen de **0,69 MiB**. Exportar a 1× tardó **30.299 ms** y produjo un WebM de **0,27 MiB**.

Límite real que fija esa medición: la exportación es **1:1 en tiempo real** (no hay aceleración por defecto), así que el máximo de grabación (120 s / 180 frames) implica ~2 min de exportación. El peso depende del contenido, no del tamaño del artifact: el encoder está topado a 2 Mbps (techo teórico de 7,5 MB por 30 s) y un timeline casi estático queda muy por debajo (0,27 MiB medido). La pestaña debe permanecer visible, porque `setTimeout` se estrangula en segundo plano y estira el tiempo real. La vista no ofrece cancelar la exportación, aunque el exportador ya acepta `AbortSignal`.

La medición es una prueba **opt-in**: con la suite normal el caso queda `skip` y la exportación por defecto no cambia.

**Archivos:** `src/artifacts/recordingLogs.ts`, `src/artifacts/webmTimeline.ts`, `src/artifacts/webm.ts` (nuevos), `src/artifacts/types.ts`, `src/hooks/useBrowserRecording.ts`, `src/components/panel/ArtifactsView.tsx`.

---

## 4. Camino crítico

`F2-01` → `F2-02`/`F2-03`/`F2-06` → `F2-04` → `F2-05` → `F2-07`.

F2-01 a F2-09 ya están hechos. El desglose de F2 queda cerrado con la salvedad de la revisión visual en Electron; G1 sigue siendo el gate pendiente y no se cierra sin el dogfooding de 5 días.

## 5. Fuera de alcance de F2

- Subida remota de artifacts, visor en la nube o cuentas.
- MP4 o captura a más fps; la exportación WebM reproduce los frames guardados y no recodifica desde Playwright.
- Nuevos proveedores de modelo, Vercel o Linear.
- Reescribir el motor de aprobaciones o el bucle del agente.

## 6. Nota sobre G1

G1 pide cinco días de dogfooding comparados con F0. F0 ya tiene una línea base válida con NVIDIA (24 corridas, 8/24, 0 timeouts), pero falta el dogfooding, así que **G1 no está cerrado**. F2-01 es schema/store y F2-02 añade un campo opcional al resultado de `shell.run`; ninguno cambia el bucle ni las aprobaciones. F2-07 usa un proveedor falso determinista y no sustituye ese dogfooding. Si se quiere respetar el gate al pie de la letra, hay que decidir explícitamente si se acepta avanzar F2 con G1 pendiente o si se pospone hasta tener un modelo real.

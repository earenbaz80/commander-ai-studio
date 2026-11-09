# Backlog ejecutable — Fase 2 (artifacts de verificación)

> **Base:** Fase 2 de [ROADMAP_PARITY.md](../../ROADMAP_PARITY.md).
> **Estado (2026-11-09):** **F2-01 a F2-07 implementados** (contrato/store, evidencia de tests, diff/decisiones, informe local, visor, enlace a la grabación y E2E local); G1 sigue pendiente. **G1 sigue sin medirse**: F0 está aparcado y no hay una corrida real con modelo que permita comparar latencia/éxito. F2-02 añade evidencia al resultado de `shell.run` sin cambiar el bucle ni las aprobaciones.
> **Estimaciones:** días-persona, ±30 %. Suman **6,5 d-persona**; el roadmap estima 6–8 días.
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

## 4. Camino crítico

`F2-01` → `F2-02`/`F2-03`/`F2-06` → `F2-04` → `F2-05` → `F2-07`.

F2-01 a F2-07 ya están hechos. El desglose de F2 queda cerrado; G1 sigue siendo el gate pendiente y no se cierra sin el dogfooding de 5 días.

## 5. Fuera de alcance de F2

- Subida remota de artifacts, visor en la nube o cuentas.
- WebM/MP4 o captura a más fps; los frames actuales se enlazan, no se recodifican.
- Nuevos proveedores de modelo, Vercel o Linear.
- Reescribir el motor de aprobaciones o el bucle del agente.

## 6. Nota sobre G1

G1 pide cinco días de dogfooding comparados con F0. F0 está aparcado y no hay una línea base medida, así que **G1 no está cerrado**. F2-01 es schema/store y F2-02 añade un campo opcional al resultado de `shell.run`; ninguno cambia el bucle ni las aprobaciones. F2-07 usa un proveedor falso determinista y no sustituye ese dogfooding. Si se quiere respetar el gate al pie de la letra, hay que decidir explícitamente si se acepta avanzar F2 con G1 pendiente o si se pospone hasta tener un modelo real.

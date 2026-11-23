# Roadmap de evolución — Commander AI Studio

> **Instantánea:** 2026-11-21. **Frentes:** paridad F0–F6, plataforma PL0–PL7 y UX 1.0.
>
> **Nota 2026-11-19:** el adaptador de Strata cloud se retiró en `43fc3ae`; `strata-local` siguió en `PROVIDER_SPECS` y es el único proveedor Strata vigente. No cambia el estado de ninguna fase ni puerta.
>
> **Detalle por frente:** [Paridad](ROADMAP_PARITY.md) · [Plataforma](ROADMAP_PLATFORM.md) · [UX](ROADMAP_UX.md).
>
> **Roadmap visual:** [roadmap autónomo publicado](https://earenbaz80.github.io/commander-ai-studio/roadmap-autonomo.html) — 65 % hacia el multiagente autónomo (2026-11-23), 15 de 27 pasos cerrados, con el avance por paso y su evidencia (fuente: [docs/roadmap-autonomo.html](docs/roadmap-autonomo.html)).
>
> **Evidencia:** [baseline F0](docs/parity/baseline-2026-11.md) · [runbook G1/F0](docs/parity/runbook-g1-f0.md) · [recibo F0 local](docs/parity/receipts/F0-LOCAL-2026-11-10.md) · [recibo del dogfooding G1](docs/parity/receipts/G1-DOGFOOD-2026-11-12.md) · [hoja de decisión del p95](docs/parity/g1-approval-gate-decision.md).

Este documento es el roadmap umbrella: cuenta el proceso de evolución del producto, qué está hecho, qué está en curso y qué falta. No promete fechas; los esfuerzos son órdenes de magnitud. Una fase o un criterio sólo pasa a **hecho** cuando existe evidencia en el árbol o un recibo verificable. Cuando no hay medición, se dice **sin medir**.

## 1. Estado en una vista

| Frente | Fases | Cerradas | Criterios en alcance |
| --- | ---: | ---: | ---: |
| Paridad | 7 | 1 (F0) | 21/47 |
| Plataforma | 8 | 1 (PL0) | 23/42 |
| UX | 1 | 1 (UX 1.0) | 10/10 |
| **Total** | **16** | **3/13 en alcance** | **54/99 (55 %)** |

- **3 fases cerradas:** F0, PL0 y UX 1.0.
- **5 parciales:** F1, F2, PL2, PL5 y PL6.
- **5 pendientes:** F3, F4, F5, PL3 y PL4.
- **Fuera del cómputo:** PL1 (fuera de alcance) y F6/PL7 (opcionales).
- **Puertas:** G0 cerrada; G1 abierta (dogfooding ejecutado, p95 en rojo); G2 y G3 no iniciadas.

El 55 % cuenta criterios de fase, no esfuerzo, tiempo ni valor de producto. Tampoco dice que la app esté al 55 %: dice que 54 de los 99 criterios comprometidos tienen evidencia. Cada criterio es una casilla de los roadmaps de detalle: cuenta el `[x]` o la cobertura que el propio detalle declara (F2, cubierta por evidencia y sin marcar); los `[—]` y las fases opcionales quedan fuera. F0 cerró G0 con una baseline NVIDIA válida de 24 corridas (8/24, 0 timeouts y 0 inválidas); la paridad es baja. El dogfooding de G1 se ejecutó el 2026-11-12 (17/28, 60,7 %) y la puerta sigue abierta por una sola regla: el p95 de aprobación.

## 2. G1 en pausa: el siguiente paso es T10

**Objetivo:** dejar constancia de que G1 sigue **abierta** —la referencia de 15 151 ms no se toca y ninguna fase se marca cerrada por la puerta— y avanzar por el paso de mayor peso que no depende de esa medición: T10 (F1-1).

**Criterios de F0 en alcance**

- [x] GitHub OAuth real: leer un PR, comentar con aprobación y revocar.
- [x] Actions ejecuta `/commander` en plan y `--write` con PR y comentario reales.
- [x] Sin tokens, `.env` ni source maps en artifacts, logs o respuestas.
- [x] Existe `baseline-2026-11.md` con metodología, resultados y limitaciones.
- [x] Gates locales (`tsc`, `vite build`, tests focalizados) en verde.
- [x] Línea base de 24 corridas (T1–T10) medida y registrada el 2026-11-11 con NVIDIA (8/24; 0 timeouts y 0 inválidas).

**Fuera de alcance por decisión (2026-11-10):** Vercel y Linear. No hay cuenta de ninguno de los dos y no se simula una verificación. El hosting remoto se decide en G3.

**Estado de la medición (2026-11-11):** la baseline vigente se midió con `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b`: 24/24 corridas, 8 pasan, 16 fallan, 0 timeouts y 0 inválidas. T1 y T7 pasan 3/3; T3 y T5 1/2; T2, T4, T6, T8, T9 y T10 no pasan. El id NIM válido es el doble prefijo; los ids de models.dev dieron 410/404. Los intentos previos con DeepSeek, Qwen y Gemini quedan como historial y no cuentan. **G0 queda cerrada**; G1 se mide contra esta referencia (ver «Estado de G1»).

**Estado de G1 (2026-11-16): dogfooding ejecutado, puerta abierta por el p95. El bloque de medición de aprobación sale del roadmap por decisión del 2026-11-23.**

- D1–D5 se ejecutaron el 2026-11-12 con el modelo y `maxSteps` congelados: 24 corridas planificadas medidas, 28 válidas y **17 `passed` (60,7 %)** frente a 8/24 (33,3 %) de F0. Cero escrituras sin aprobación, cero tool calls duplicadas en `--resume`, cero secretos y cero fallbacks; los 2 timeouts son de operación.
- El [recibo `G1-DOGFOOD-2026-11-12`](docs/parity/receipts/G1-DOGFOOD-2026-11-12.md) decide **NO CERRADO**: de las ocho reglas de la puerta, siete están en verde.
- La única regla en rojo es el **p95 de aprobación ≤ 15 151 ms**: 76 982 ms (n=40, operador automatizado por PTY), 65 056 ms en la re-medición humana CAL2 (n=6) y 26 501 ms en CAL4 (n=41), que **no vale como muestra humana** porque el PTY lo condujo el agente.
- La [hoja de decisión](docs/parity/g1-approval-gate-decision.md) deja rigiendo la **salida B** (sin firma): la referencia no se toca y la casilla sólo pasa a verde con un bloque con `latencyMs`, n ≥ 40 y **como mucho 2 de 40** por encima de 15 151 ms. **Ese bloque no está en el roadmap por decisión del 2026-11-23:** no se ejecuta, G1 sigue abierta y ninguna fase se marca cerrada por la puerta.
- T10 sigue **0/3** en las 24 corridas, con issue propio; es un defecto declarado, no una regla de puerta. F1 y F2 no se marcan cerradas mientras G1 siga abierta. La re-medición del 2026-11-20 con el arnés ([recibo `G1-T10-09`](docs/parity/receipts/G1-T10-09-2026-11-20.md)) dio **0/6** sobre `0d8567d`: el padre cerró 5/6 y lanzó los dos hijos 5/6, pero los hijos cerraron 0/6 (el presupuesto de salida de 4096 tokens truncó al hijo A, más dos timeouts y una fuga de worktree). La re-medición del 2026-11-21 sobre `0407784`, ya con 8 192 tokens y el worktree confinado ([recibo `G1-T10-10`](docs/parity/receipts/G1-T10-10-2026-11-21.md)), volvió a dar **0/3** (**0/15** acumuladas): el hijo A se trunca en 1 de 3 y la fuga de `hijo-b.txt` ya no aparece. La re-medición del 2026-11-21 sobre `199f393`, con timeout heredado de 240 s ([recibo `G1-T10-12`](docs/parity/receipts/G1-T10-12-2026-11-21.md)), dio **2/3**: T10-1 y T10-3 pasaron 7/7 y T10-2 falló por un cierre hueco (`Archivos: ninguno`) y un padre que no confirmó la cuenta. La tanda del 2026-11-21 sobre `360f8c2` ([recibo `G1-T10-13`](docs/parity/receipts/G1-T10-13-2026-11-21.md)) dio **1/3**: T10-2 pasó con la denegación real, mientras T10-1 y T10-3 fallaron por cierre hueco y turno vacío. Son **24 líneas T10** registradas y **3 `passed`**, pero **T10 sigue 0/3 en las 24** y la referencia no cambia: **G1 continúa abierta por la casilla del p95**, no por esta medición.

El arnés está listo:

```bash
npm run baseline
```

Detalle y evidencia: [baseline §6](docs/parity/baseline-2026-11.md#6-línea-base-de-las-10-tareas-canónicas) y [recibo §13](docs/parity/receipts/F0-LOCAL-2026-11-10.md).

## 3. Fases

### Paridad

| Fase | Estado | Puerta | Prioridad | Esfuerzo | Criterios | Siguiente hito |
| --- | --- | --- | --- | --- | ---: | --- |
| **F0** Verdad y línea base | Hecho · G0 cerrada | G0 | P0 | 4–5 d | 6/6 | Mantener la referencia para G1 |
| **F1** Núcleo de agente y CLI | Hecho en código · G1 abierto | G1 | P0 | 10–12 d | 8/8 | T10 (F1-1) primero; T10 sigue 0/3 en las 24 (1/3 fuera de ellas, `G1-T10-13`) |
| **F2** Artifacts de verificación | Parcial · criterios cubiertos, G1 abierto | — | P1 | 6–8 d | 7/7 | Cerrar G1 y verificación visual en Electron |
| **F3** Continuidad remota y PWA | Pendiente · espera G2 | G2 | P1 | 10–14 d | 0/8 | Modelo de amenazas |
| **F4** Editor y ecosistema | Pendiente | — | P1 | 12–15 d | 0/11 | VSIX útil y lifecycle de hooks |
| **F5** SSR, backend y realtime | Pendiente · espera G3 | G3 | P1 | 18–25 d | 0/7 | Proveedor y entrega 5A |
| **F6** Apuestas opcionales | Opcional · no comprometido | — | P2 | 20–30 d | n/c | Decisión explícita |

F1 tiene los 14 issues cerrados y 8/8 criterios; el dogfooding de G1 se ejecutó el 2026-11-12 (17/28 frente a 8/24 de F0), pero la puerta no se cierra: el p95 de aprobación sigue por encima de 15 151 ms y la hoja de decisión, sin firma, deja rigiendo B. F2 tiene plan, diff, evidencia de tests, informe local, visor, revisión por hunk con auditoría y grabación exportable a WebM con consola/red; los criterios de fase siguen sin marcar (7/7 con evidencia en la cuenta) porque la regla del roadmap no los cierra con G1 pendiente. F5 no empieza antes de decidir proveedor en G3; Vercel quedó fuera y Cloudflare Workers es sólo un candidato.

### Plataforma

| Fase | Estado | Prioridad | Esfuerzo | Criterios | Siguiente hito |
| --- | --- | --- | --- | ---: | --- |
| **PL0** Contrato de despliegue | Hecho | P0 | 2–3 d | 5/5 | Mantener el contrato |
| **PL1** Hosting remoto de estáticos | Fuera de alcance · código listo | P1 | — | 4/4 + 3 fuera | Decidir en G3 |
| **PL2** Navegador real y artifacts | Hecho con límites | P2 | Pulir | 8/8 | Fallback, exportación y revisión en Electron |
| **PL3** Backend gestionado | Pendiente · siguiente P0 | P0 | 2–3 sem | 0/7 | `BackendAdapter` y bindings |
| **PL4** Realtime para apps | Pendiente · depende de PL3 | P1 | 1 sem | 0/5 | Tickets, salas y snapshots |
| **PL5** Conectores nativos | GitHub verificado · Linear fuera | P1 | Verificación | 6/7 | Revisar scopes de GitHub |
| **PL6** Skills de cuenta y plantillas | Parcial · catálogo local | P2 | 1–2 sem | 0/6 | Sync de skills y galería |
| **PL7** Workspaces remotos | Opcional · no iniciar sin decisión | P2 | 4–6 sem | n/c | Decisión de producto |

PL0 separó release de destino y funciona sin credenciales. PL1 tiene adaptador, rutas y UI, pero no hay despliegue real; no se declara verificado. PL2 tiene frames, consola, red, entrada, reconexión y grabación local, con un techo de ~1,4 fps, 120 s y 180 frames. PL5 tiene GitHub OAuth y Actions verificados; Linear no se configura. PL6 tiene catálogo y cinco plantillas locales, pero no sincronización con la cuenta.

### UX

| Fase | Estado | Criterios | Siguiente hito |
| --- | --- | ---: | --- |
| **UX 1.0** Command palette, layout de 3 paneles, diff por hunk, status bar, Nono acoplable, shell en vivo, historial, atajos, empty states y playgrounds | Hecho · 10/10 | 10/10 | Mantener la base Norton |

## 4. Puertas

| Puerta | Exige | Estado | Qué la desbloquea |
| --- | --- | --- | --- |
| **G0** Verdad externa | GitHub verificado + línea base de 24 corridas | **Cerrada** | Baseline NVIDIA válida: 24 corridas, 0 timeouts |
| **G1** Dogfooding del CLI | 5 días y 24 corridas usando el CLI como superficie principal, sin retroceder frente a F0 | **Abierta** · dogfooding ejecutado; p95 en rojo | T10 sigue 0/3 en las 24 (1/3 fuera de ellas, `G1-T10-13`); el bloque de medición de aprobación no está en el roadmap (decisión del 2026-11-23) |
| **G2** Seguridad remota | Modelo de amenazas y revisión antes de habilitar `--remote` | **No iniciada** | Aprobar el modelo de amenazas |
| **G3** Proveedor de plataforma | Proveedor y modelo de costo decididos antes de 5A | **No iniciada** | Decisión explícita de proveedor |

G1 no se cierra por ejecutar el dogfooding ni comparando contra una estimación: le falta que el producto cumpla el presupuesto de aprobación con una muestra humana válida. G2 bloquea F3; G3 bloquea F5A. Ninguna puerta se cierra por compilar o por tener tests con mocks.

## 5. Secuencia recomendada

**Ahora**

1. **Bloque de aprobación fuera del roadmap (2026-11-23):** por decisión del autor no se agenda; G1 queda **abierta**, la referencia de 15 151 ms intacta y ninguna fase se marca cerrada por la puerta.
2. F1-1 (T10): el defecto sigue 0/3 en las 24 con issue abierto y es el paso de mayor peso fuera de la puerta (`G1-EMPTY-TURN`, `G1-SUBAGENT-CLOSE`).

**Después de G1**

3. F3 (pair/PWA) y F4A (VS Code) en paralelo, con G2 antes de habilitar remote.
4. Decidir proveedor en G3.
5. F5A (SSR/Workers) y 5B (backend gestionado).

**Más adelante**

6. F5C (realtime), PL4, PL6.
7. F6 y PL7 sólo con una decisión de producto explícita; no se empiezan por imitación.

Con dos personas, el alcance P0 + P1 es del orden de 9–12 semanas de trabajo efectivo; con una, 12–16. Son estimaciones, no fechas comprometidas.

## 6. No objetivos

- Nube por defecto: Commander sigue siendo local-first; lo remoto es opt-in.
- Móvil nativo, SSO empresarial y marketplace propio como requisitos de paridad.
- Declarar Vercel o Linear dentro del alcance: la decisión del 2026-11-10 los dejó fuera.
- Convertir un build estático en «full-stack» sin backend real.
- Cerrar una puerta con una estimación, un mock o una captura sin recibo.

## 7. Cómo se mantiene

- Este archivo es el resumen de proceso; los detalles viven en los tres roadmaps enlazados y en `docs/parity/`.
- Al cambiar el estado de una fase o puerta, se actualiza la tabla y se mueve la fecha de la instantánea.
- Todo «hecho» necesita evidencia: ruta del código, test, PR, issue, recibo o URL. Lo no medido se queda como **sin medir**.
- Gates mínimos antes de cerrar una fase: `npx tsc --noEmit`, `npx vite build` y las pruebas focalizadas de la fase. Los tests de endpoints usan el arnés compartido, no un servidor propio.
- La línea base se ejecuta con `npm run baseline` y se registra en [docs/parity/baseline-2026-11.md](docs/parity/baseline-2026-11.md).

## 8. Fuentes

- [ROADMAP_PARITY.md](ROADMAP_PARITY.md) — fases F0–F6, matriz de paridad y métricas.
- [ROADMAP_PLATFORM.md](ROADMAP_PLATFORM.md) — fases PL0–PL7, hosting, backend y conectores.
- [ROADMAP_UX.md](ROADMAP_UX.md) — UX 1.0 y sus diez mejoras.
- [docs/parity/baseline-2026-11.md](docs/parity/baseline-2026-11.md) — criterios de F0 y estado de la baseline.
- [docs/parity/runbook-g1-f0.md](docs/parity/runbook-g1-f0.md) — orden para cerrar G0 y G1.
- [docs/parity/receipts/F0-LOCAL-2026-11-10.md](docs/parity/receipts/F0-LOCAL-2026-11-10.md) — recibos de GitHub, gates locales y bloqueo de medición.
- [docs/parity/receipts/G1-DOGFOOD-2026-11-12.md](docs/parity/receipts/G1-DOGFOOD-2026-11-12.md) — dogfooding de G1: 28 válidas, 17/28 y decisión NO CERRADO.
- [docs/parity/g1-approval-gate-decision.md](docs/parity/g1-approval-gate-decision.md) — salida B vigente y disparador de la casilla del p95.

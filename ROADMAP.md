# Roadmap de evolución — Commander AI Studio

> **Instantánea:** 2026-11-11. **Frentes:** paridad F0–F6, plataforma PL0–PL7 y UX 1.0.
>
> **Detalle por frente:** [Paridad](ROADMAP_PARITY.md) · [Plataforma](ROADMAP_PLATFORM.md) · [UX](ROADMAP_UX.md).
>
> **Evidencia:** [baseline F0](docs/parity/baseline-2026-11.md) · [runbook G1/F0](docs/parity/runbook-g1-f0.md) · [recibo F0 local](docs/parity/receipts/F0-LOCAL-2026-11-10.md).

Este documento es el roadmap umbrella: cuenta el proceso de evolución del producto, qué está hecho, qué está en curso y qué falta. No promete fechas; los esfuerzos son órdenes de magnitud. Una fase o un criterio sólo pasa a **hecho** cuando existe evidencia en el árbol o un recibo verificable. Cuando no hay medición, se dice **sin medir**.

## 1. Estado en una vista

| Frente | Fases | Cerradas | Criterios en alcance |
| --- | ---: | ---: | ---: |
| Paridad | 7 | 1 (F0) | 18/33 |
| Plataforma | 8 | 1 (PL0) | 16/35 |
| UX | 1 | 1 (UX 1.0) | 10/10 |
| **Total** | **16** | **3/13 en alcance** | **44/78 (56 %)** |

- **3 fases cerradas:** F0, PL0 y UX 1.0.
- **5 parciales:** F1, F2, PL2, PL5 y PL6.
- **5 pendientes:** F3, F4, F5, PL3 y PL4.
- **Fuera del cómputo:** PL1 (fuera de alcance) y F6/PL7 (opcionales).
- **Puertas:** G0 cerrada; G1 abierta; G2 y G3 no iniciadas.

El 56 % cuenta criterios de fase, no esfuerzo, tiempo ni valor de producto. Tampoco dice que la app esté al 56 %: dice que 44 de los 78 criterios comprometidos tienen evidencia. F0 cerró G0 con una baseline NVIDIA válida de 24 corridas (8/24, 0 timeouts y 0 inválidas); la paridad es baja y G1 sigue abierta hasta el dogfooding.

## 2. Ahora: cerrar G1

**Objetivo:** usar la baseline F0 ya cerrada como referencia y ejecutar el dogfooding de G1 antes de añadir superficie.

**Criterios de F0 en alcance**

- [x] GitHub OAuth real: leer un PR, comentar con aprobación y revocar.
- [x] Actions ejecuta `/commander` en plan y `--write` con PR y comentario reales.
- [x] Sin tokens, `.env` ni source maps en artifacts, logs o respuestas.
- [x] `baseline-2026-11.md` y gates locales (`tsc`, `vite build`, tests) en verde.
- [x] Línea base de 24 corridas (T1–T10) medida y registrada el 2026-11-11 con NVIDIA (8/24; 0 timeouts y 0 inválidas).

**Fuera de alcance por decisión (2026-11-10):** Vercel y Linear. No hay cuenta de ninguno de los dos y no se simula una verificación. El hosting remoto se decide en G3.

**Estado de la medición (2026-11-11):** la baseline vigente se midió con `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b`: 24/24 corridas, 8 pasan, 16 fallan, 0 timeouts y 0 inválidas. T1 y T7 pasan 3/3; T3 y T5 1/2; T2, T4, T6, T8, T9 y T10 no pasan. El id NIM válido es el doble prefijo; los ids de models.dev dieron 410/404. Los intentos previos con DeepSeek, Qwen y Gemini quedan como historial y no cuentan. **G0 queda cerrada**; G1 sigue abierta hasta el dogfooding.

El arnés está listo:

```bash
npm run baseline
```

Detalle y evidencia: [baseline §6](docs/parity/baseline-2026-11.md#6-línea-base-de-las-10-tareas-canónicas) y [recibo §13](docs/parity/receipts/F0-LOCAL-2026-11-10.md).

## 3. Fases

### Paridad

| Fase | Estado | Puerta | Prioridad | Esfuerzo | Criterios | Siguiente hito |
| --- | --- | --- | --- | --- | ---: | --- |
| **F0** Verdad y línea base | Hecho · G0 cerrada | G0 | P0 | 4–5 d | 5/5 | Mantener la referencia para G1 |
| **F1** Núcleo de agente y CLI | Hecho en código · G1 abierto | G1 | P0 | 10–12 d | 8/8 | Dogfooding de 5 días |
| **F2** Artifacts de verificación | Parcial · límites declarados | — | P1 | 6–8 d | 5/7 | Exportación y revisión por hunk |
| **F3** Continuidad remota y PWA | Pendiente · espera G2 | G2 | P1 | 10–14 d | 0/4 | Modelo de amenazas |
| **F4** Editor y ecosistema | Pendiente | — | P1 | 12–15 d | 0/4 | VSIX útil y lifecycle de hooks |
| **F5** SSR, backend y realtime | Pendiente · espera G3 | G3 | P1 | 18–25 d | 0/5 | Proveedor y entrega 5A |
| **F6** Apuestas opcionales | Opcional · no comprometido | — | P2 | 20–30 d | n/c | Decisión explícita |

F1 tiene los 14 issues cerrados y 8/8 criterios, pero G1 no se cierra sin el dogfooding; ya existe una baseline F0 válida (NVIDIA, 8/24) para comparar. F2 tiene plan, diff, evidencia de tests, informe local y visor; faltan la grabación exportable y la revisión por hunk. F5 no empieza antes de decidir proveedor en G3; Vercel quedó fuera y Cloudflare Workers es sólo un candidato.

### Plataforma

| Fase | Estado | Prioridad | Esfuerzo | Criterios | Siguiente hito |
| --- | --- | --- | --- | ---: | --- |
| **PL0** Contrato de despliegue | Hecho | P0 | 2–3 d | 5/5 | Mantener el contrato |
| **PL1** Hosting remoto de estáticos | Fuera de alcance · código listo | P1 | — | 4/4 + 3 fuera | Decidir en G3 |
| **PL2** Navegador real y artifacts | Hecho con límites | P2 | Pulir | 7/9 | Fallback, exportación y revisión en Electron |
| **PL3** Backend gestionado | Pendiente · siguiente P0 | P0 | 2–3 sem | 0/7 | `BackendAdapter` y bindings |
| **PL4** Realtime para apps | Pendiente · depende de PL3 | P1 | 1 sem | 0/5 | Tickets, salas y snapshots |
| **PL5** Conectores nativos | GitHub verificado · Linear fuera | P1 | Verificación | 4/5 + 1 fuera | Revisar scopes de GitHub |
| **PL6** Skills de cuenta y plantillas | Parcial · catálogo local | P2 | 1–2 sem | 0/4 | Sync de skills y galería |
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
| **G1** Dogfooding del CLI | 5 días y 24 corridas usando el CLI como superficie principal, sin retroceder frente a F0 | **Abierta** | Ejecutar el dogfooding |
| **G2** Seguridad remota | Modelo de amenazas y revisión antes de habilitar `--remote` | **No iniciada** | Aprobar el modelo de amenazas |
| **G3** Proveedor de plataforma | Proveedor y modelo de costo decididos antes de 5A | **No iniciada** | Decisión explícita de proveedor |

G1 puede prepararse con F0 cerrada, pero no se cierra comparando contra una estimación. G2 bloquea F3; G3 bloquea F5A. Ninguna puerta se cierra por compilar o por tener tests con mocks.

## 5. Secuencia recomendada

**Ahora**

1. Completar el dogfooding del CLI y cerrar G1.
2. Dejar F2 en revisión: grabación exportable y revisión por hunk.

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

# G1 — Hoja de decisión: la puerta del p95 de aprobación después de CAL2

> **Fecha:** 2026-11-13
> **Estado:** **rige B (sin firma) — CAL4 (2026-11-14) no es válido como muestra humana**. La casilla sigue en rojo y G1 sigue **NO CERRADO**. Recibo: [`G1-APPROVAL-CAL4-2026-11-14`](receipts/G1-APPROVAL-CAL4-2026-11-14.md).
> **Base:** [protocolo de re-medición](g1-approval-remeasure.md) §7.1–§7.5 · [recibo CAL2](receipts/G1-APPROVAL-CAL2-2026-11-13.md) · [plan G1](dogfooding-g1.md) §7.1 · [recibo del dogfooding](receipts/G1-DOGFOOD-2026-11-12.md) §3 y §8.
> **Qué es:** el **acto separado** que §7.3.3 exige *antes* de cualquier medición nueva, para que el bloque siguiente no se mida contra una regla sin definir.
> **Qué no es:** no es un recibo, no declara una referencia nueva, no re-mide nada, no toca código y **no cierra G1**.

## 1. La decisión

CAL2 cerró con **n=6 → p95 65 056 ms → NO CUMPLE**, y el veredicto no puede cambiar con más muestras (§2.2, enmienda E1). De las ocho reglas de §7.1 del plan, **siete están en verde**; el p95 de aprobación es la única en rojo. G1 ya no está bloqueado por falta de medición: está bloqueado por **una regla que el producto no cumple**.

Hay dos salidas, y sólo dos:

- **A. CAL3:** declarar `decisionMs` como métrica de la puerta, con referencia nueva, regla de inclusión nueva y validación prospectiva.
- **B. Mantener la regla:** la casilla sigue en rojo y G1 queda **NO CERRADO** hasta que una muestra prospectiva contra 15 151 ms la ponga verde.

Esta hoja fija las dos por adelantado, con sus condiciones y sus disparadores. No elige: deja escrito qué observación cambia la casilla en cada caso.

## 2. Los hechos que la fijan

| Hecho | Dato | Fuente |
| --- | --- | --- |
| Referencia vigente | **15 151 ms**, p95 de 10 decisiones con operador automatizado por PTY | [calibración](g1-approval-calibration.md) §2 y §5 |
| Naturaleza de la referencia | **Presupuesto de revisión** («cuánto puede tardar una persona en leer un diff y decidir»), no una estadística de lo que el producto hace | protocolo §7.3 |
| CAL2 | n=6 · p50 4 641 · p95 65 056 · mín 1 792 · máx 65 056 · media 25 757 ms · **3 de 6** por encima · 1 exclusión de 7 (14,3 %) · 0 escrituras sin aprobación | [recibo CAL2](receipts/G1-APPROVAL-CAL2-2026-11-13.md) |
| Lectura del p95 con n=6 | Es el **máximo observado**. El signo no cambia con las 34 muestras que faltan | §2.2, enmienda E1 |
| `latencyMs` | Mide de creación a decisión: incluye el tiempo en que nadie miraba el panel. La misma edición de una línea dio 2 104, 4 641, 19 702, 61 246 y 65 056 ms | protocolo §12.10–§12.11 |
| `decisionMs` | Instrumentado el 2026-11-13 (`8f969d1`) y corregido el 2026-11-14: decisión − **primera tecla no decisoria** (`firstNonDecisionKeyAt`). Una decisión directa **no genera `decisionMs`** y se marca `directDecision`. CAL2 se midió **sin** el campo; las muestras anteriores a la corrección no sirven para la métrica corregida | protocolo §12.11 |
| Primer toque (corregido) | `firstKeyAt` se graba con el primer `data` **antes de interpretarlo**: cuenta una flecha, un `?` **o la propia decisión**. Para la métrica no se usa: `decisionMs` arranca en `firstNonDecisionKeyAt`; la tecla que decide no cuenta y una decisión directa queda fuera de `decisionMs` | protocolo §12.11 |
| Erratum de §7.2 | §7.2 dice «como mucho 1 de 40 por encima»; con nearest-rank, el p95 de 40 es la 38.ª, así que la puerta equivale a **como mucho 2 de 40**. Esta hoja usa **2** (§2.2 y la aritmética de E1) | hallazgo de esta hoja, §9 |

De ahí sale lo que ninguna de las dos salidas puede ignorar: **`latencyMs` mezcla disponibilidad con lectura, y `decisionMs` ya no mide el reflejo pero no existe cuando la decisión fue directa**. Ninguna de las dos aísla la lectura por sí sola.

## 3. Salida A — CAL3 con `decisionMs` y referencia nueva

### 3.1 Qué sería

Un bloque **nuevo**, con etiqueta `CAL3-*`, que mida `decisionMs` y compare contra una **referencia nueva** declarada antes de recoger la primera muestra. No es una revisión de 15 151 ms ni una re-lectura de CAL2: es otra métrica, con otro presupuesto y otra casilla.

### 3.2 Condiciones, todas obligatorias y pre-registradas

- **A1 — Enmienda E2 del protocolo.** Documento propio, fechado **después** de esta hoja y **antes** de la primera muestra, que declare: métrica de la puerta = `decisionMs`; regla de inclusión completa; referencia nueva; piso; tamaño de muestra. No vale en el mismo recibo que reporta un fallo (§7.3.3).
- **A2 — Regla del primer toque.** Una muestra con **decisión directa** no produce `decisionMs`; la enmienda tiene que decidir antes de medir si esas muestras se excluyen del p95 de `decisionMs` o se publican aparte, sin tratarlas como 0. Las opciones son:
  1. exigir una tecla **no decisoria** (`?`/`¿`/`h` o una flecha) antes de `a`, y contar sólo esas muestras; o
  2. publicar `decisionMs` para las muestras con lectura previa y `latencyMs` para las de decisión directa, sin mezclarlos en un p95 único.

  Sin A2, **CAL3 no tendría una muestra definida**: las decisiones directas no aportan `decisionMs` y el p95 se calcularía sólo con las que tuvieron lectura previa, sin declarar qué se hace con el resto. Es la condición que decide si la salida A es honesta o es cambiar la métrica por una más cómoda.
- **A3 — Referencia justificada por el trabajo de revisión**, no por lo medido (§7.3.4): del tipo «diff de hasta N líneas con vista previa: presupuesto X», derivada de lo que hay que leer y decidir. **Si la justificación cita las latencias de CAL2, se rechaza.** El tope de cordura de §7.3 sigue vigente: por encima de 60 604 ms no se declara nada, se abre issue y se para.
- **A4 — Muestra mecánicamente válida:** n ≥ 40 decisiones **incluidas** en el estrato primario, **un solo operador** con el TTY reservado, log de PTY por corrida, `decisionMs` contrastado con el estado, cero exclusiones por lentitud, exclusiones totales ≤ 20 %, y el piso por tool declarado **antes** de medir (el de 1 500 ms de `latencyMs` no se traslada sin decirlo).
- **A5 — El registro tiene que poder leer la métrica.** **Resuelto el 2026-11-13:** `npm run g1:cal2` guarda `decisionMs` en `samples.jsonl` (`add --decision-ms` e `import` desde el estado) y el `summary` publica sus p50/p90/p95 en un bloque aparte, sin tocar el de `latencyMs` ni la puerta. Sigue siendo **prerrequisito** de la salida A y está cumplido; lo que falta es la enmienda E2, no el registro.
- **A6 — Validación prospectiva (§7.4).** Una referencia nueva **no se considera cumplida**: otro bloque de n ≥ 40 recogido después de congelarla, con **p95 ≤ 0,8 × referencia nueva**. Mientras no ocurra, la casilla queda **NO CUMPLE (referencia provisional sin validar)**.
- **A7 — La regla vieja no se reescribe.** §7.1 conserva lo medido contra 15 151 ms (76 982 ms y 65 056 ms) como historia. La regla nueva es **otra regla**, con su propia casilla; G1 no pasa a `CERRADO` retroactivamente por cambiar de métrica.

### 3.3 Qué desbloquea y qué cuesta

- **Desbloquea** un número que habla del producto: separa «volvió a mirar el panel» de «leyó y decidió». Es la única vía que puede publicar una latencia de **lectura** con nombre propio.
- **Cuesta** dos bloques de 40 decisiones con TTY reservado (el de medida y el de validación, ≈ 45–60 min cada uno, más siembra y captura) y dos documentos (E2 y recibo). Y cuesta asumir el riesgo de que el número nuevo salga mejor **sin** que el producto haya cambiado —de ahí A2 y A3—.

### 3.4 Cuándo **no** elegirla

- Si A2 no se puede escribir sin premiar el clic rápido: entonces `decisionMs` no mide lectura y la salida A es un cambio de pregunta, no una respuesta.
- Si no hay dos bloques de TTY reservado: sin validación prospectiva no hay casilla verde (§7.4).
- Si se pretende usar **15 151 ms** como umbral de `decisionMs`: sería trasplantar el presupuesto de una métrica a otra, justo lo que §7.5 prohíbe en espíritu.

## 4. Salida B — mantener la regla y dejar G1 NO CERRADO

### 4.1 Qué significa exactamente

| Elemento | Estado con la salida B |
| --- | --- |
| Regla de §7.1 | Se queda **tal cual**: `p95 de aprobación ≤ 15 151 ms` |
| Valor medido | **76 982 ms** (n=40, operador automatizado), **65 056 ms** (n=6, operador humano) y **26 501 ms** (n=41, CAL4 en PTY; operador no humano, ver recibo) |
| Casilla | **NO CUMPLE**, en rojo |
| Las otras siete reglas | Sin cambios: tasa 17/28, 0 escrituras sin aprobación, 0 duplicadas, artifacts por la vía de §7.5, 0 secretos, defectos con issue |
| Decisión de G1 | **NO CERRADO**, con una sola regla en rojo |
| T10 | Sigue como defecto abierto con issue, no como regla de puerta |
| F1 | Puede continuar: la implementación está acreditada por sus 14 issues; lo que falta es el gate |

No es «paridad parcial» ni «no aplica»: §7.5 prohíbe declarar el criterio no aplicable, y el runbook no lo permite para esta métrica.

### 4.2 Por qué es defendible

CAL2 lo midió con **una persona delante del TTY** y el resultado no cambió de signo: tres de seis decisiones por encima de 15 s para una edición de **una línea**. Eso no es un artefacto de sondeo —el sondeo lo sustituía la primera medición—, es el producto: el panel no anuncia que hay una aprobación esperando, el operador llega tarde y la latencia de creación a decisión lo registra. Un presupuesto que el producto no cumple es un hallazgo para arreglar, no un número para reemplazar. La precisión de n=6 es baja; el signo está determinado.

### 4.3 Qué tendría que pasar para poner la casilla verde **sin** cambiar el umbral

1. **Producto, primero.** Que la aprobación pendiente se anuncie en el estado y en la TUI (hoy el servidor la deriva en `toState()`, pero el camino del CLI con el bucle en proceso no la publica, y `replaceState` la descarta), que el menú no pierda lo pintado (ya mitigado, §12.9) y que el diff que se pide leer sea el mínimo suficiente. El objetivo es que la cola de 61–65 s deje de ser disponibilidad y pase a ser lectura. Issue de producto por la cola de `shell.run` en CAL4: [`G1-APPROVAL-SHELL-TAIL`](issues/G1-APPROVAL-SHELL-TAIL.md).
2. **Una muestra prospectiva con la métrica de siempre.** Bloque nuevo `CAL4-*` con `latencyMs`, **n ≥ 40** incluidas, un solo operador con TTY reservado, mismas condiciones I1–I4, piso y tope de exclusiones.
3. **El disparador, escrito ahora:** la casilla pasa a verde si, y sólo si, **como mucho 2 de 40** decisiones quedan por encima de **15 151 ms** en ese bloque. La referencia **no se toca**. Con p95 ≤ 15 151 ms y el resto de §7.1 igual, G1 puede pasar a `CERRADO` en su recibo.
4. Si el bloque falla otra vez, la salida B continúa y **sólo entonces** la salida A pasa a ser elegible, en su propio acto.

### 4.4 Qué cuesta

G1 queda **abierto** y el gate no se cierra. No hay números nuevos ni verde retroactivo, y el trabajo de F1 sigue su curso sin la puerta cerrada. Es el precio de no cambiar la pregunta después de ver la respuesta.

## 5. Qué tendría que pasar para cambiar la casilla

Una sola tabla, con observaciones y no con intenciones:

| Situación | Casilla | Qué la cambia |
| --- | --- | --- |
| Hoy (2026-11-14) | **NO CUMPLE** (sigue el 65 056 ms de CAL2; CAL4, n=41, p95 26 501 ms descriptivo, no es muestra humana válida) | — |
| B + arreglo de producto + bloque `CAL4` con `latencyMs`, n ≥ 40, **≤ 2 de 40 por encima** de 15 151 ms | **CUMPLE** | El recibo de `CAL4`, con la referencia intacta; T10 queda como defecto declarado con issue abierto, fuera de la puerta |
| B + bloque `CAL4` que vuelve a fallar | **NO CUMPLE** | Nada; se abre el paso siguiente de producto |
| A firmada (E2 + A2 + referencia nueva, acto separado) | **NO CUMPLE (referencia provisional sin validar)** | La firma **no** pone nada verde (§7.4) |
| A + validación prospectiva con p95 ≤ 0,8 × referencia nueva | **CUMPLE en la regla nueva** | El recibo de validación; la regla vieja sigue en rojo como historia |
| A sin A2 (no se define qué pasa con las decisiones directas) | **NO CUMPLE** | Se invalida por pre-registro: esas muestras no tienen `decisionMs` y no se pueden contar como 0 ni mezclar sin declararlo |
| Sin firma de A ni de B antes de la próxima medición | **NO CUMPLE** | El defecto es B (§6): no se mide contra una regla indefinida |

## 6. Recomendación y defecto

**CAL4 (2026-11-14) no se usa como cierre:** el bloque dio 41 decisiones `allow`, p95 26 501 ms y 14 de 41 por encima del umbral; la lectura pre-registrada de 40 (descartando la primera de dos `shell.run` idénticas) da el mismo p95 y las mismas 14. Se ejecutó en un PTY conducido por el agente, así que **no es una muestra humana válida** y no acredita la puerta. G1 sigue NO CERRADO; la salida B sigue vigente y el paso siguiente es producto, no otra referencia.

**Recomendación: B primero, con el arreglo de producto delante.** Es la única salida que responde a la pregunta que la puerta hace —«¿la aprobación humana cabe en 15 s?»— sin cambiar la métrica después de conocer la respuesta. Si el arreglo de producto acerca la distribución al presupuesto, la casilla se pone verde con la referencia intacta y sin discusión metodológica. La salida A queda como plan B **legítimo** si `CAL4` vuelve a fallar y si A2 se puede escribir sin premiar el clic rápido; en ese caso se declara con su propia casilla y su propia validación, nunca como reinterpretación del 65 056 ms.

**Defecto:** sin firma, rige **B**. No es una decisión cómoda: es la que §7.5 deja permitida, porque declarar el criterio no aplicable está prohibido y cambiar la métrica por otra más favorable no es una salida silenciosa.

## 7. Lo que esta hoja no cambia

- Las 28 corridas válidas, el 17/28 (60,7 %) y las cifras por tarea de §7 del plan.
- Los valores medidos: 76 982 ms (n=40), 65 056 ms (n=6) y 26 501 ms (n=41, CAL4), con sus `n` al lado.
- La referencia de 15 151 ms, las condiciones I1–I4, el piso de 1 500 ms y el tope del 20 %.
- El issue [`G1-SUBAGENT-CLOSE`](issues/G1-SUBAGENT-CLOSE.md), el issue de producto por la cola de `shell.run` [`G1-APPROVAL-SHELL-TAIL`](issues/G1-APPROVAL-SHELL-TAIL.md) y la decisión **NO CERRADO** del [recibo del dogfooding](receipts/G1-DOGFOOD-2026-11-12.md).
- Ningún archivo de código: esta hoja sólo decide cómo se decide.

## 8. Firma

| Salida | Firma | Fecha | Efecto inmediato |
| --- | --- | --- | --- |
| **B — mantener la regla** (recomendada) | ☐ | | La casilla sigue roja; el paso siguiente es producto y luego `CAL4` |
| **A — CAL3 con `decisionMs`** | ☐ | | Exige E2 con A1–A7 antes de la primera muestra; la casilla sigue roja hasta validar |

Quien firme A se compromete a escribir la enmienda E2 **antes** de medir y a no usar 15 151 ms como umbral de `decisionMs`. Quien firme B se compromete a no proponer un cambio de referencia en el recibo de `CAL4` (§7.3.3).

## 9. Hallazgos de esta hoja

1. **Erratum en el protocolo §7.2:** decía «como mucho 1 de 40 por encima». Con nearest-rank, el p95 de 40 es la 38.ª, de modo que la puerta admite **2 de 40**. §2.2 (E1) y la aritmética ya lo decían bien; la frase de §7.2 se corrigió el 2026-11-14, sin cambiar el umbral ni reabrir ninguna muestra.
2. **`decisionMs` ya tiene registro:** el cálculo, la marca y el runner están en su sitio desde el 2026-11-13 —`g1:cal2` lo guarda y publica sus percentiles aparte—, así que a la salida A le falta **la enmienda E2 y su referencia**, no la instrumentación.
3. **El campo que anuncia la aprobación no llegaba al estado persistido en el camino del CLI.** El servidor lo deriva en `toState()`, pero el CLI escribía su propio estado y `replaceState` descartaba `pendingApproval`. **Corregido el 2026-11-13:** el CLI la publica en su checkpoint y el servidor la conserva mientras la sesión está `running` (y la retira al decidir, caducar o abortar). Es el arreglo de producto de §4.3 y también el insumo que haría medible la salida A.

# Calibración G1 — latencia de aprobación (preflight)

> **Estado:** calibración ejecutada el 2026-11-11; **10/10 muestras canónicas** y **5/5 corridas válidas**. Recibo: [G1-APPROVAL-CAL-2026-11-11](receipts/G1-APPROVAL-CAL-2026-11-11.md). Resultado **provisional** por el solapamiento de cal-04/05/07 y por descartar cal-01/cal-06.
> **Precondición:** el fix de allowlist (`node --test` y `node --test <archivo>`) debe estar en un commit fijo y el árbol debe estar limpio. No se calibra sobre cambios sin commit.
> **Propósito:** obtener una referencia reproducible de latencia de aprobación antes de D1, sin contar estas corridas dentro de las 24 de G1.
> **Límite:** la baseline F0 no registró aprobaciones ni latencia. Esta calibración **no es paridad F0**; es una referencia provisional que debe declararse como tal.

## 1. Qué mide

`approvalLatencyMs` es el tiempo entre:

- `approval_request.createdAt`, cuando el CLI emite la solicitud;
- la resolución de la decisión y la emisión de `approval_result`.

El CLI publica el valor como `latencyMs` en el evento `approval_result` y en `SessionStepV2.approval`.

Incluye:

- pintado del menú de aprobación;
- tiempo humano de lectura y decisión;
- procesamiento de la tecla y restauración de la terminal.

No incluye:

- latencia del modelo;
- ejecución de la tool;
- tiempo de arranque del servidor o de la sesión.

La unidad de muestra es **una decisión explícita**, no una corrida. Las llamadas posteriores cubiertas por `allow-session` no generan muestra porque no vuelven a preguntar. Las denegaciones sí cuentan.

## 2. Diseño de la calibración

- **5 corridas de T1** con el mismo commit, modelo y servidor.
- Cada corrida debe producir **2 decisiones explícitas**:
  1. `fs.edit` sobre `math.mjs`;
  2. `shell.run` con `node --test math.test.mjs` (forma canónica).
- Muestra objetivo: **10 decisiones**.
- Usar **Permitir una vez** (`a`), no `allow-session`, para forzar los dos prompts.
- La auditoría de D0 confirmó que `node --test` y `node --test <archivo>` están permitidos; `node <script>` no. `node --test` sin archivo se registra como variante separada y no se mezcla con la forma canónica.
- No usar `node math.test.mjs`; esa forma sigue fuera de la allowlist. La forma válida es `node --test math.test.mjs`.
- Si una corrida no produce las dos decisiones, registrar las que haya; no rellenar ni inventar muestras. Con menos de 8 muestras, el resultado es **provisional**.
- Estas 5 corridas **no cuentan** para D1–D5 ni para las 24 de G1.

La p95 con 10 muestras es descriptiva: será el máximo observado o un valor muy cercano. No se presenta como inferencia estadística.

## 3. Procedimiento

1. Fijar un commit que incluya el fix de allowlist y confirmar que `git status --short` está vacío. Congelar modelo, servidor y `maxSteps`; verificar `/api/health`.
2. Preparar el workspace desechable de T1 con `math.mjs` roto y `math.test.mjs` intacto.
3. Abrir el CLI en una TTY real:

   ```bash
   npx tsx bin/commander.ts agent "<tarea T1>" \
     --server http://127.0.0.1:3283 \
     --model nvidia/nvidia/nemotron-3.5-lightning-30b-a3b \
     --max-steps 24 --no-stream
   ```

4. Cuando aparezca el menú de `fs.edit`, elegir `a`.
5. Cuando aparezca el menú de `shell.run`, elegir `a` para `node --test math.test.mjs`. Si el modelo propone `node --test` sin archivo, es válido, pero se anota como variante y no se mezcla con la forma canónica.
6. Anotar la línea que muestra la TUI, por ejemplo:

   ```text
   ✓ aprobación allow · 1840 ms
   ```

7. Repetir hasta completar 5 corridas o hasta que una corrida invalide la muestra.
8. Calcular n, p50, p95, mínimo y máximo. Guardar el recibo saneado en `docs/parity/receipts/G1-APPROVAL-CAL-<fecha>.md`.

## 4. Datos que se guardan

| Campo | Valor |
| --- | --- |
| `sampleId` | `CAL-01`… |
| Fecha / hora | ISO-8601 |
| Commit | `git rev-parse HEAD` |
| Modelo | nombre exacto |
| `runId` | identificador de la corrida de calibración |
| `sessionId` | id de sesión |
| Tool | `fs.edit` o `shell.run` |
| Decisión | `allow` / `deny` |
| `latencyMs` | entero medido por el CLI |
| Notas | sólo causas de invalidación |

No guardar `input`, diff, contenido de archivos, tokens, cookies ni `.env`. La calibración sólo necesita tiempos y metadatos.

## 5. Uso en la puerta G1

- La referencia de aprobación es el **p95 de esta calibración**, no un valor inventado.
- En el diario de G1 se compara el p95 de las decisiones reales contra esa referencia.
- Si la calibración no se ejecutó o tiene menos de 8 muestras, la latencia de aprobación queda **provisional** y G1 no puede cerrar ese criterio como verificado.
- La comparación contra F0 queda explícitamente **sin medir**: F0 no tiene `approvals` ni `approvalLatencyMs`.
- Si aparece una escritura sin aprobación o un secreto, se detiene la calibración y se registra el incidente; no se continúa para “completar la muestra”.

## 6. Checklist de cierre de la calibración

- [x] Commit fijo que incluye el fix de allowlist; árbol limpio al inicio.
- [x] 5 corridas T1 válidas de 7 intentos (`cal-01` y `cal-06` descartadas), con modelo y servidor sin cambios.
- [x] 10 decisiones canónicas registradas, sin `allow-session`.
- [x] `latencyMs` presente en cada `approval_result`.
- [x] p50/p95 calculados y recibo saneado guardado.
- [x] Cero escrituras sin aprobación.
- [x] Sin secretos en la evidencia capturada.
- [x] Nota explícita de que F0 no midió esta métrica.
- [ ] Cierre definitivo: el resultado es provisional por el solapamiento de `cal-04/05/07`.

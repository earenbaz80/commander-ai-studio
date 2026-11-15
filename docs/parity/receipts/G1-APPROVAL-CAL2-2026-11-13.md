# G1 — Re-medición del p95 de aprobación con operador humano (bloque CAL2)

> **Fecha:** 2026-11-13
> **Commit:** `b3186f9` (`f0/baseline-intento`), protocolo en `docs/parity/g1-approval-remeasure.md`
> **Modelo:** `nvidia/nvidia/nemotron-3.5-lightning-30b-a3b`
> **Servidor:** `http://127.0.0.1:3283`
> **`maxSteps`:** 24
> **Superficie:** CLI en TTY real, operador humano leyendo el menú (`a` / `1`)
> **Estado:** **CERRADO con n=6 · NO CUMPLE**

## Decisión

**La casilla de §7.1 del plan sigue en rojo.** El p95 del estrato primario es **65 056 ms** frente a la referencia provisional de **15 151 ms**: cuatro veces el presupuesto. No hay tercera vía en §7.1, así que el resultado es **NO CUMPLE**.

La referencia **no se toca**: no se propone un número nuevo (§7.3 exige cuatro condiciones y una de ellas es una medición mecánicamente válida con n ≥ 40, que este bloque no tiene), y el umbral no se relaja para que la casilla cuadre.

El bloque se cierra con **6 de las 40 decisiones** previstas. Es una **enmienda** al diseño muestral, declarada en §2.2 del protocolo con su motivo aritmético: con tres muestras ya por encima de 15 151 ms, el p95 de 40 —la 38.ª— no puede bajar del umbral con ninguna corrida futura. Completar las 34 restantes sólo afinaría la magnitud, no el signo.

## Resultado

- Decisiones incluidas: **6** (de 40 previstas; ver cierre anticipado).
- Corridas que aportan muestra: **5** (`CAL2-R13`, `R14`, `R15`, `R17` con dos mitades y `R20`).
- Todas `allow`; ninguna `allow-session`; ninguna `deny` en el estrato primario.
- Escrituras sin aprobación: **0**. Secretos en la evidencia capturada: **0**.
- **n=6 · p50 4 641 ms · p90 65 056 ms · p95 65 056 ms · mín 1 792 ms · máx 65 056 ms · media 25 757 ms.**
- Decisiones por encima de 15 151 ms: **3 de 6** (61 246, 65 056 y 19 702 ms).

El p95 es **descriptivo**, no una inferencia: con nearest-rank sobre 6 muestras es el máximo observado. Se publica con su `n` al lado, como en la calibración de 2026-11-11.

## Muestras

| `sampleId` | Corrida | Tool | Decisión | `latencyMs` | Evidencia de I1–I2 |
| --- | --- | --- | --- | ---: | --- |
| CAL2-01 | `CAL2-R13` | `fs.edit` | `allow` | 61 246 | `render.diffShown:true`; lectura declarada: `math.mjs: values.length - 1 → values.length` |
| CAL2-02 | `CAL2-R14` | `fs.edit` | `allow` | 65 056 | `render.diffShown:true`; misma lectura declarada |
| CAL2-03 | `CAL2-R15` | `fs.edit` | `allow` | 19 702 | `render.diffShown:true`; misma lectura declarada |
| CAL2-04 | `CAL2-R17` | `fs.edit` | `allow` | 2 104 | `render.diffShown:true`; misma lectura declarada |
| CAL2-05 | `CAL2-R17` | `shell.run` | `allow` | 1 792 | comando `node --test math.test.mjs` leído en el menú antes de decidir |
| CAL2-06 | `CAL2-R20` | `fs.edit` | `allow` | 4 641 | `render.diffShown:true`; diff leído en el menú antes de aprobar |

Crudo: `.commander/g1/cal2/` (`samples.jsonl`, estados de sesión y logs). No se guardaron `input` de herramientas, contenido de `.env`, tokens ni cookies.

## Desglose por tool

| Tool | n | p50 | p90 | p95 | mín | máx |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `fs.edit` | 5 | 19 702 ms | 65 056 ms | 65 056 ms | 2 104 ms | 65 056 ms |
| `shell.run` | 1 | 1 792 ms | 1 792 ms | 1 792 ms | 1 792 ms | 1 792 ms |

La única `shell.run` incluida es también la muestra más rápida del bloque, y la única que pasó el piso de 1 500 ms de cinco intentos: las otras cuatro quedaron en 1 300, 1 116, 872 y 993 ms, y en `CAL2-R20` en 1 447 ms. Eso no es una propiedad de la tool, es la consecuencia de decidir un comando que se lee de un vistazo: por eso el piso por tool es una de las propuestas para el ciclo siguiente.

## Piso, exclusiones y tope del 20 %

- **Piso I3 (1 500 ms):** se mantiene. `CAL2-R20` perdió su mitad `shell.run` por **53 ms** (1 447 ms) y el guard de `import` la rechazó antes de escribirla.
- **Exclusiones:** 1 de 7 decisiones `allow` (**14,3 %**), por debajo del tope del 20 % de §4.1. No se escribieron en `samples.jsonl`, que es lo que pide §11.1: van a §11.1 del protocolo con su motivo y no engordan el recuento del store.
- **Sin exclusiones por lentitud:** las tres muestras más lentas son las que deciden el veredicto y están dentro.

## Cierre anticipado del bloque (enmienda E1)

El protocolo pre-registrado pide 40 decisiones y, si no se llega, corridas `CAL2-R21`… hasta 40 o hasta 24 corridas. Se cierra con **6** porque el resultado está determinado:

1. El p95 de 40 con nearest-rank es la **38.ª** de la lista ordenada, y la puerta es `p95 ≤ 15 151 ms`, es decir **como mucho 2 de 40 por encima**.
2. Ya hay **3** valores por encima (61 246, 65 056, 19 702 ms).
3. El número de valores por encima del umbral no disminuye al añadir muestras, así que la 38.ª será mayor que 15 151 ms con cualquier `n` entre 6 y 40.

La enmienda **baja la precisión, no el umbral**: con n=6 el p95 es el máximo observado y no describe la cola de una muestra grande. Queda escrito que un ciclo posterior que quiera publicar un p95 estable necesita el bloque completo, con su propio TTY reservado.

## Procedimiento ejecutado

Tarea T1 en workspace desechable por corrida (`npm run g1:seed -- --force --only d1-t1-01`), `math.mjs` roto y `math.test.mjs` intacto, lanzada con:

```bash
npx tsx ../../../bin/commander.ts agent 'El test de `math.mjs` falla: …' \
  --server http://127.0.0.1:3283 --model nvidia/nvidia/nemotron-3.5-lightning-30b-a3b --max-steps 24
```

El operador decidió en el menú del TTY, leyendo el diff (o el comando) antes de pulsar. Las latencias salen del estado de la sesión (`state.steps[].approval.{decision,latencyMs,render}`), no de la salida del CLI.

Corridas **descartadas**, todas en §11.1 del protocolo con su motivo: `CAL2-R16` (el prompt caducó sin decisión), `CAL2-R18` (sesión huérfana al cerrarse el panel), `CAL2-R19` (aprobación pulsada desde el chat, no mide lectura; además bucle de `fs.edit` que agotó los pasos), y las mitades `shell.run` de `R13`–`R15` y `R20` por I3.

## Límites

- **`latencyMs` no aísla la lectura humana.** Mide desde que se crea la aprobación hasta la decisión, e incluye el tiempo en que el operador no estaba mirando el panel. En este bloque hay muestras de 2 104 ms junto a otras de 65 056 ms para la **misma** edición de una línea: esa dispersión no describe lectura de un diff, describe disponibilidad del panel. Es la limitación principal y la razón por la que el número no debe leerse como «tarda 65 s en aprobar».
- **No hay marca de primera tecla.** Sin `firstKeyAt` no se puede separar «leyó en 4 s» de «volvió al panel a los 60 s». Es lo que hace falta antes de otro bloque.
- **n=6, no 40.** El p95 es el máximo observado. El veredicto no depende de eso, la magnitud sí.
- **Estrato `deny` sin medir.** No se ejecutó el bloque secundario de T8; no se publica nada de él.
- **Un solo operador, un solo modelo, una sola tarea (T1).** No se generaliza a otras tools ni a otros modelos.

## Qué no cambia

- Las 28 corridas de G1, las cifras por tarea de §7, el agregado de §5.3 y la decisión **NO CERRADO** del [recibo G1-DOGFOOD-2026-11-12](G1-DOGFOOD-2026-11-12.md).
- Las condiciones de inclusión I1–I4, el piso de 1 500 ms, el tope del 20 % y la referencia de 15 151 ms.
- Estas corridas **no cuentan** para las 24 de G1 ni para D1–D5: son calibración, como las `cal-*` de 2026-11-11.

## Próximos pasos

1. **Producto, no más muestras.** Abrir issue por la cola: el prompt no anuncia en el estado que hay una aprobación pendiente, y el panel puede perder lo pintado (ya mitigado con el repintado de §12.9). El síntoma medido es la dispersión, no el promedio.
2. **Instrumentar `firstKeyAt`** y publicar la latencia desde la primera tecla, no desde la creación de la aprobación. *Actualización 2026-11-14: `firstKeyAt` quedó instrumentado y `decisionMs` se corrigió para arrancar en `firstNonDecisionKeyAt`; una decisión directa no genera `decisionMs`. La referencia sigue en 15 151 ms.*
3. **Piso por tool** en el protocolo siguiente: 1 500 ms sirve para `fs.edit`, no para un `shell.run` que se lee en un vistazo.
4. **Si se quiere un p95 estable**, bloque completo de 40 decisiones con TTY reservado, en un ciclo nuevo y con la referencia intacta.

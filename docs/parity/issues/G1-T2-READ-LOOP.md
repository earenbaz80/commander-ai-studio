> **Labels:** `g1`, `p1`, `area:cli`, `area:agent` · **Estimación:** 0,5 d-persona · **No depende de:** nada abierto
>
> Issue de paridad de G1, sin número en GitHub: no forma parte del backlog F1. No cambia el criterio de T2 ni los enunciados del dogfooding.

**Estado:** Abierto — causa medida sobre el estado archivado; **guarda de lecturas aplicada en los dos bucles** (CLI y servidor), con tests en `tests/cli/readLoop.test.ts` y `tests/agent/readLoop.test.ts`; **tope de `MAX_TEST_POLICY_REMINDERS` aplicado en el CLI** (al tercer aviso seguido sin editar el test ni ejecutarlo, la corrida cierra `failed` con el motivo, `tests/cli/toolPolicy.test.ts`); y **callejón de `fs.propose` cerrado en el CLI**: la política ya no la ofrece para cambiar archivos y el resultado se marca como «Propuesta no aplicada», con `runTool` propagando el `ok:false` del payload al paso (`tests/cli/toolResults.test.ts`). El criterio de T2 no cambia (sigue 0/2).

**Por qué.** T2 es la única tarea que sigue **0/2 en F0 y 0/2 en G1**, y las dos corridas de D1 no fallan por el criterio sino por gastar los 24 pasos sin progresar: `G1-D1-04` no aplicó ni una escritura y `G1-D1-05` implementó `maxLength` pero nunca editó el test. Las dos, por el mismo patrón: llamadas idénticas repetidas que no cambian el workspace. El corte por mutaciones no las ve, y la ficha que se escribió entonces atribuía el bucle a una tool equivocada.

## Errata del registro (2026-11-13)

La hoja de D1 y el recibo dicen «22 `fs.propose.edit` en bucle». **El estado archivado dice otra cosa.** `sess_b2773f25` (`.commander/g1/G1-D1-04.json`) tiene 45 tool calls y **cuatro claves distintas**:

| Tool | Llamadas | Claves únicas |
| --- | ---: | ---: |
| `fs.read` | 42 | 2 |
| `fs.list` | 2 | 1 |
| `fs.propose.edit` | **1** | 1 |

Las 42 lecturas se reparten **21 y 21** entre dos archivos, y la racha de llamadas idénticas **consecutivas** nunca pasa de 2: el modelo alternaba `slug.mjs` y `slug.test.mjs`. La propuesta apareció **una vez**, devolvió `changed:true` y un diff, y no había nada que aplicar. La cifra de 22 describe lo que se vio en el PTY en vivo, no la evidencia que quedó guardada; la lectura correcta es la de esta ficha. Las hojas afectadas conservan su texto con una nota de errata fechada.

## Lo medido

| Corrida | Pasos | Tool calls | Claves únicas | Repetición máx. por clave | Ventana desde la última mutación aplicada | Política de test |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| `G1-D1-04` | 90 | 45 | 4 | **21×** (`fs.read`) | 45 llamadas (0 mutaciones aplicadas) | **0 veces** |
| `G1-D1-05` | 62 | 30 | 5 | **18×** (`fs.read`) | 25 llamadas | **1 vez** (paso 16 de 62) |

Lo que estos números dicen y el «bucle de propuestas» no:

- **La repetición es por clave, no consecutiva.** Un detector de «la misma llamada dos veces seguidas» no habría disparado en `G1-D1-04` (máximo 2 consecutivas): el modelo alternaba dos archivos.
- **El contador tiene que sobrevivir al turno.** Reiniciarlo en cada paso borra la señal: 21 repeticiones repartidas en 24 pasos se ven como «una lectura por paso».
- **Hay que reiniciarlo con el progreso.** En `G1-D1-05`, tras el `fs.edit` que aplicó `maxLength`, el modelo hizo 18 lecturas idénticas del mismo archivo: releer tras editar es legítimo, releer 18 veces sin editar no.
- **La política de test no es el bucle, es un aviso que no escala.** Saltó **una vez** (paso 16) y el modelo siguió leyendo 18 llamadas más; además sólo se evalúa cuando `calls.length === 0`, así que un modelo que no deja de llamar tools nunca la ve.

## Por qué el corte por mutaciones no lo cubre

El corte vive en `src/cli/agentClient.ts` y tiene tres condiciones, las tres ajenas a este bucle:

1. `mutationKey` sólo existe si la tool está en `LOOP_GUARDED_TOOLS`, que es `MUTATING_TOOLS` menos `browser`. `fs.read`, `fs.list` y `fs.propose.*` **no están**, y con razón: una lectura repetida no cambia el mundo.
2. El corte no mira la repetición sola: exige `completedMutations.has(mutationKey)`, y ese conjunto se llena sólo con `result.ok` de una tool mutante. La clave de una lectura nunca entra.
3. Aun metiendo `fs.propose.*` en `MUTATING_TOOLS`, **no habría cortado ninguna de las dos corridas**: en `G1-D1-04` hubo **una** propuesta y en `G1-D1-05` **ninguna**. El bucle eran lecturas.

Y meterlas ahí tiene un coste medible en el código: `mode !== 'build' && MUTATING_TOOLS.has(mapped.tool)` bloquea la tool con «Tool bloqueada en modo plan». `fs.propose.edit`/`fs.propose.write` existen justamente para **proponer sin escribir y funcionar en modo plan**; clasificarlas como mutantes las rompería en ese modo sin arreglar el bucle.

## Decisión: guarda propia, no `MUTATING_TOOLS`

**Se arregla con una guarda propia de repetición sin progreso.** Tres razones, las tres con la medición delante:

1. **Eficacia:** el corte por mutaciones no puede dispararse sobre lecturas por diseño, y la extensión propuesta no habría cambiado el resultado (1 y 0 propuestas).
2. **Precisión del mensaje:** reutilizar el corte de mutaciones haría que la sesión cerrara con «la edición ya estaba aplicada», que en `G1-D1-04` es falso: no se aplicó ninguna edición.
3. **Sin regresión de modo plan:** una guarda separada deja `MUTATING_TOOLS` como está y `fs.propose.*` sigue disponible donde se documentó.

### Diseño (para implementar tal cual)

- **Constante propia** `MAX_IDENTICAL_READS = 4`, con su mensaje; no se reutiliza `MAX_IDENTICAL_MUTATIONS` para no mezclar dos causas en un número.
- **Alcance:** tools que no cambian el workspace — `fs.read`, `fs.list`, `fs.propose.read`/`edit`/`write`. `browser` queda fuera (releer tras un click es legítimo, como ya documenta el corte actual) y las mutantes siguen con su corte.
- **Clave:** `tool\0stableInput(input)`, la misma que ya usa `mutationKeyFor`, para que el `fs.read` con distinto `offset`/`limit` no cuente como repetición.
- **Ventana:** contador acumulado en la corrida por clave, **no** consecutivo, y se **vacía entero** en cuanto una llamada mutante termina `ok` (`fs.write`, `fs.edit`, `shell.run`, `git.*`…): releer después de escribir es normal.
- **Escalada igual que el corte actual:** 2.ª repetición → aviso («ya leíste este archivo; usa lo que devolvió»), 3.ª → fallo explícito de la tool, **4.ª → se corta la corrida** con motivo, `state.status = 'failed'` y `state.answer` con la causa, en vez de gastar los 24 pasos. Con 21 y 18 repeticiones medidas, el ahorro es de 17–18 llamadas por corrida.
- **Mensaje correcto:** «Bucle de lectura: N llamadas idénticas a `fs.read` sin que el workspace cambie. Se corta la corrida para no gastar los pasos que quedan; la tarea queda sin verificar.»
- **Política de test con tope:** `MAX_TEST_POLICY_REMINDERS = 2`; al tercer aviso seguido sin progreso, la sesión cierra `failed` con el motivo en vez de repetir el recordatorio hasta `maxSteps`. Así el caso «el modelo no deja de llamar tools» también termina con una causa legible.
- **Test:** escenario `read-loop` en `tests/helpers/fakeAgentServer.ts` que alterna dos archivos como `G1-D1-04`; exige corte en la 4.ª lectura de la misma clave, tres ejecuciones reales y sesión `failed` con el motivo. Y un caso que comprueba que **no** corta si entre lecturas hay una mutación aplicada.

## Lo que este issue no hace

- No cambia el criterio de T2 ni lo pone verde: las dos corridas siguen `failed`.
- No añade una vía para **aplicar** una propuesta. `fs.propose.*` devuelve diff y no escribe, y en el CLI no hay `fs.apply`; el prompt compartido (`src/agent/llm.ts`) sigue invitando a proponer, pero la política del CLI ya no la presenta como cambio y el resultado se marca como «Propuesta no aplicada», con `fs.edit`/`fs.write` como camino. Añadir la aplicación sigue siendo una decisión de producto aparte.
- No reescribe las 28 corridas ni toca la puerta del p95.

## Efecto en G1

- Tasa global **17/28**: no cambia.
- T2 sigue **0/2** en F0 y G1; el aviso de §7.2 no cambia porque T2 no era una tarea que F0 pasara.
- El cambio se mide cuando se repita T2 en un ciclo nuevo; no entra en las 24.

## Evidencia

```bash
# replay de la guarda real sobre las 28 corridas archivadas: tabla, ahorro y
# corridas `passed` que se cortarían
npm run audit:loop-guard
# sale 1 si alguna corrida `passed` habría sido cortada (señal de regresión)
npm run audit:loop-guard -- --strict

# recuento por corrida sobre el estado archivado
node -e "const s=require('./.commander/g1/G1-D1-04.json').state; const c=s.steps.filter(x=>x.type==='tool_call'); \
  const k=c.map(x=>x.toolId+' '+JSON.stringify(x.input)); console.log(c.length, new Set(k).size)"

# repetición por clave desde la última mutación aplicada
node -e "const s=require('./.commander/g1/G1-D1-05.json').state; let m=-1; \
  s.steps.forEach((x,i)=>{if(x.type==='tool_result'&&['fs.edit','fs.write'].includes(x.toolId)&&x.status!=='failed')m=i;}); \
  const c=s.steps.slice(m+1).filter(x=>x.type==='tool_call'); \
  const n={}; c.forEach(x=>{const k=x.toolId+' '+JSON.stringify(x.input); n[k]=(n[k]||0)+1;}); console.log(c.length, n);"
```

Crudo: `.commander/g1/G1-D1-04.json` y `G1-D1-05.json` (ignorados por git). No se guardan `input` de archivos sensibles, tokens ni cookies.

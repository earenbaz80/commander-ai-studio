# RUNBOOK — leer un run de Actions sin sesión en el navegador

Guía para diagnosticar un job rojo cuando **no hay sesión de GitHub en el navegador**:
la vista del run, el log del paso y el artifact piden login. Esto es lo que trabó el
diagnóstico del run **#292** (`Verify merged Playwright report` en rojo, mensaje
ilegible) y quedó resuelto por la vía que se describe acá. No hay que volver a
buscarla desde cero.

Repositorio: `earenbaz80/commander-ai-studio` · workflow: `.github/workflows/tests.yml`.

## 1. Qué no sirve

| Vía | Resultado |
| --- | --- |
| `/actions/runs/{id}/artifacts` en el navegador sin sesión | 404 (el endpoint tampoco existe para anónimos) |
| API anónima (`api.github.com`) | 60 req/h por IP, y la IP del runner/preview es compartida: se agota enseguida |
| `/actions/jobs/{id}/logs` | 403 `Must have admin rights` |
| Panel de preview del editor | no tiene sesión de GitHub; `navigation_partial`/`artifacts_partial` vuelven vacíos |

No se pierde tiempo con eso: la vía directa es la integración de GitHub conectada.

## 2. La vía que sirve: integración de GitHub

Cuenta conectada: `github_montia-pagus` (login `earenbaz80`). Expone, entre otras:

- `GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY` — encontrar el run (`owner`, `repo`, `branch`, `status: failure`).
- `GITHUB_GET_A_WORKFLOW_RUN` — metadatos del run que ya se conoce por id.
- `GITHUB_LIST_JOBS_FOR_A_WORKFLOW_RUN` — jobs del run con su `conclusion` y el id de cada uno.
- `GITHUB_DOWNLOAD_JOB_LOGS_FOR_A_WORKFLOW_RUN` — texto del log del job (la alternativa al log del paso que pide sesión). El texto puede traer BOM y códigos ANSI; si viene truncado o responde 413, usar `GITHUB_DOWNLOAD_WORKFLOW_RUN_LOGS`.
- `GITHUB_LIST_WORKFLOW_RUN_ARTIFACTS` — artifacts del run (`name`, `id`, `size_in_bytes`).
- `GITHUB_DOWNLOAD_AN_ARTIFACT` — el zip del artifact; devuelve `artifact_file.s3url`, una URL firmada válida ~1 h.

## 3. Procedimiento

1. **Run id**: sale de la URL del run, `https://github.com/earenbaz80/commander-ai-studio/actions/runs/<run_id>`. Si sólo se sabe qué falló, `GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY` con `owner: earenbaz80`, `repo: commander-ai-studio`, `branch: main`, `status: failure`, `per_page: 5`.

2. **Qué job y qué paso**: `GITHUB_LIST_JOBS_FOR_A_WORKFLOW_RUN` con el `run_id`. Buscar el job en rojo (en el #292 fue `e2e` / `E2E Tests (Playwright)`, id `140893755335`) y, dentro, el paso con `conclusion: failure` (`Verify merged Playwright report`).

3. **El mensaje del job**: `GITHUB_DOWNLOAD_JOB_LOGS_FOR_A_WORKFLOW_RUN` con `owner`, `repo` y el `job_id` del punto 2. Es el texto que en la UI exige sesión. Ojo: el gate también publica su veredicto en el **resumen del job** (`GITHUB_STEP_SUMMARY`), que sí se ve sin sesión si el run está abierto en el navegador; los conteos del merge los agrega `npm run ci:summary -- e2e`.

4. **El artifact**: `GITHUB_LIST_WORKFLOW_RUN_ARTIFACTS` con el `run_id` lista `playwright-report` (7 días de retención). `GITHUB_DOWNLOAD_AN_ARTIFACT` con ese `artifact_id` devuelve la `s3url` firmada; bajarla a una carpeta temporal **fuera del repo** (nunca commitear el reporte):

   ```bash
   curl -fsSL -o "$TEMP/rep.zip" "<s3url>"
   ```

5. **Descomprimir**: en Git Bash el `tar` es GNU y no lee zip; hay que llamar al bsdtar de Windows, que sí:

   ```bash
   MSYS2_ARG_CONV_EXCL='*' /c/Windows/System32/tar.exe -xf "$TEMP/rep.zip" -C "$TEMP/rep"
   ```

   Extraer **todo** el zip, no sólo `results.json`: el gate mira `index.html` al lado del JSON y los adjuntos pueden venir como archivos con ruta relativa.

6. **Reproducir el gate en local**: `PLAYWRIGHT_JSON_PATH` apunta al `results.json` descomprimido y el chequeo corre con las mismas reglas que CI:

   ```bash
   PLAYWRIGHT_JSON_PATH="$TEMP/rep/results.json" npx tsx scripts/check-playwright-report.ts
   ```

   `PLAYWRIGHT_JSON_PATH` también sirve con `npm run check:playwright-report`. El directorio base es el del propio JSON, así que `index.html` tiene que estar en esa misma carpeta. Sale 1 si el artifact no cumple: imprime `N problema(s) en <ruta>` con una línea por regla incumplida.

7. **Leer el reporte como lo vería un humano**, sin sesión: `npx playwright show-report "$TEMP/rep"` (sirve la carpeta local; no necesita red ni credenciales).

## 4. Cómo leer el veredicto

El gate exige ocho cosas (el detalle está en el comentario de cabecera de `scripts/check-playwright-report.ts`): las dos piezas del merge presentes, proyectos con los mismos conteos, cada archivo de la suite general en todos los proyectos, el E2E del artifact sólo en Chromium, el caso de C8 una sola vez con sus 5 pasos, un `index.html` no vacío, que no haya fallos reales y que un mismo test no venga flaky en dos corridas seguidas. Un `flaky` **no** tumba el gate: `retries: 1` está para absorber un parpadeo, así que se informa en los conteos y en una línea **Flaky** del resumen. La excepción es la racha: si el mismo test aparece flaky en dos corridas seguidas, el gate avisa con `::warning::` y publica una línea **Flaky repetido**; la tercera corrida seguida ya lo pone en rojo (un parpadeo que se repite una vez todavía puede ser azar). Esa racha viaja en `.flaky-state.json`, que el job de E2E arrastra con `actions/cache` (restore antes del gate, save con `always()`); sin cache arranca de cero, así que el peor caso es perder un aviso, nunca inventar un rojo. Los mensajes que importan:

- `stats.<estado>=N no coincide con las filas (M)` — el merge perdió un blob o el JSON está editado; no es un fallo de test.
- `N ejecución(es) fallida(s): el reporte no está verde` — fallo real: el intento final quedó en rojo. Ahí está la causa, no en el exit code.
- `falta index.html` / `index.html está vacío` — el merge no generó el HTML aunque el JSON esté bien.
- Cualquier línea de C8 (`no trae un arreglo steps`, `no corrió en ningún proyecto`, conteos de pasos) — el adjunto `c8-steps` se recortó: el recibo G2 citaría una secuencia que ya no existe.

Un flaky no pinta rojo, pero se mira igual (es deuda, no ruido): el nombre y el proyecto están en el `results.json` (`specs[].title`, `tests[].projectName`, `status: flaky`) y se ven enteros en `show-report`.

## 5. Caso de referencia: run #292

- Run `46116807041`, job `e2e` `140893755335`, artifact `playwright-report` id `15252507099`.
- El artifact decía: 98 ejecuciones (expected 74, skipped 23, unexpected 0, **flaky 1**), proyectos chromium 34 / firefox 32 / mobile-chrome 32, C8 con sus 5 pasos.
- La regla que lo tumbó entonces: `1 ejecución(es) flaky: el reporte no está verde`. Con la regla actual ese mismo artifact **pasa** el gate (el flaky se informa en los conteos y en la línea **Flaky**); el test se arregló igual porque el flake era real.
- Causa: `tests/e2e/app.spec.ts` → `debe navegar al modo Agent desde la paleta`, proyecto **firefox**: el intento 1 murió en `expect(locator).toBeVisible()` sobre `text=MODO AGENTE` (*element(s) not found*, timeout 5 000 ms) y el reintento pasó. El adjunto `error-context` del artifact (el artifact guarda screenshot y video del intento fallido, `screenshot`/`video: retain-on-failure`) dice qué pasaba: el clic **sí** había ejecutado el comando —el árbol trae `🔄 Modo agent` en la frase de Nono— pero el `main` seguía en `CARGANDO…`, que es el `LazyFallback` de `React.lazy` mientras baja el chunk de `AgentMode`. La app ya estaba en modo agent; lo que no había llegado era el panel. Los 5 s por defecto de `expect` no cubren la descarga de un recurso, y el reintento pasó porque el chunk ya estaba en la caché HTTP. Los tiempos de cada intento están en la tabla de abajo.

### Antes y después, en la misma fila

La misma fila de `results.json` (`app.spec.ts` › `debe navegar al modo Agent desde la paleta`, proyecto `firefox`) en los dos artifacts reales:

| Run | Artifact | `stats` del reporte | Fila de Firefox | Intentos |
| --- | --- | --- | --- | --- |
| **#292** (`46116807041`) | `15252507099` | expected 74, skipped 23, unexpected 0, **flaky 1** | `status: flaky` | 2: `failed` 16 466 ms (`retry: 0`) → `passed` 9 250 ms (`retry: 1`) |
| **#294** (`46125812615`) | `15256251127` | expected 75, skipped 23, unexpected 0, **flaky 0** | `status: expected` | 1: `passed` 6 346 ms (`retry: 0`) |

Las 98 ejecuciones son las mismas en los dos runs; lo que cambió es cómo se reparte el intento de Firefox. Las dos piezas:

- **El test** (`e22f1dd` y la espera del panel): la primera corrección eligió la opción por su texto (`hasText: 'Agente autónomo'`) en vez de `.first()`, que dependía del orden de la lista; acertó, pero no era la causa del flaky —el árbol del intento fallido prueba que el comando se ejecutó—. Lo que cerró el flake fue el margen de la espera; el criterio quedó escrito una sola vez más abajo, en **Regla: una espera sobre contenido de `React.lazy` lleva 30 s**.
- **El gate** (`c5ec859`): un `flaky` deja de ser error; se informa en los conteos y en una línea **Flaky** del resumen. Con esa regla el artifact del #292 también sale en verde, pero el flake se arregló igual porque era real.

Los otros proyectos no cambiaron: chromium 3 841 → 3 651 ms y mobile-chrome 3 879 → 3 748 ms. `expected` sube de 74 a 75 porque la fila de Firefox ahora cuenta como pass a la primera, no porque se haya agregado un test. Reproducido con el gate actual sobre los dos artifacts: el #294 sale `OK: 98 ejecuciones (75 expected, 23 skipped, 0 failed, 0 flaky)`, exit 0.

### Regla: una espera sobre contenido de `React.lazy` lleva 30 s

Lo que quedó del #292, aplicado a mano en los siete sitios que esperan contenido cargado con `React.lazy`. El criterio para contarlos es ese y no un grep de `timeout: 30000`: ese número no distingue estas esperas de las del arranque de la app, de las de `lmstudio-loading` y `pairTwoDevices`, ni de los deadlines que no son esperas.

- **La espera lleva `{ timeout: 30000 }`.** Se está esperando la descarga de un recurso; el margen por defecto de `expect` (5 s) mide la red y no lo que hizo el test. En el #292 el intento 1 se agotó a los 5 000 ms con la app ya en modo agent —el árbol traía `🔄 Modo agent`— y el `main` todavía en `CARGANDO…`; el reintento pasó con el chunk ya en la caché HTTP.
- **Siempre por debajo del `test.setTimeout` del describe**, para que la espera pueda agotarse y el fallo nombre el locator en vez de morir como *test timeout*: 30 s dentro de los 60 s de `Core` y `Agent Mode`, dentro de los 150 s de `Contraste` y dentro de los 180 s del artifact de verificación.
- **La opción de la paleta se elige por su texto** (`hasText: 'Agente autónomo'`, `hasText: 'Configuración'`), nunca por posición: el `.first()` que sigue sólo resuelve el único nodo que pasa el filtro.

Dónde está aplicada, para que no vuelva a colarse un `expect` con el margen por defecto: en `app.spec.ts` cuatro (`debe navegar al modo Agent desde la paleta`, el `beforeEach` de `Agent Mode`, `debe mostrar el modal de atajos con Ctrl+/` y `debe cubrir un chunk de AgentMode lento con el margen del panel`), en `contrast.spec.ts` dos («Apariencia e idioma» y `MODO AGENTE`) y en `agentVerificationArtifact.spec.ts` una (`MODO AGENTE`).

No hace falta creerle a la simulación manual: `app.spec.ts` → `debe cubrir un chunk de AgentMode lento con el margen del panel` retrasa el chunk real con `page.route('**/assets/AgentMode-*.js', …)` 7 s y comprueba que el panel llega con los 30 s. Con la espera corta falla a los 5 000 ms (`element(s) not found`), que es la firma del #292. Dos guardas evitan que pase en vacío: el route tiene que haber interceptado el chunk y el panel tiene que aparecer después del retraso.

Moraleja del episodio: sin sesión, el camino es **integración → log del job → artifact → gate local**, y el artefacto de Playwright basta para nombrar el test y el motivo aunque el log sea inaccesible.

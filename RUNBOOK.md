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

El gate exige siete cosas (el detalle está en el comentario de cabecera de `scripts/check-playwright-report.ts`): las dos piezas del merge presentes, proyectos con los mismos conteos, cada archivo de la suite general en todos los proyectos, el E2E del artifact sólo en Chromium, el caso de C8 una sola vez con sus 5 pasos, un `index.html` no vacío y que no haya fallos reales. Un `flaky` **no** tumba el gate: `retries: 1` está para absorber un parpadeo, así que se informa en los conteos y en una línea **Flaky** del resumen. Los mensajes que importan:

- `stats.<estado>=N no coincide con las filas (M)` — el merge perdió un blob o el JSON está editado; no es un fallo de test.
- `N ejecución(es) fallida(s): el reporte no está verde` — fallo real: el intento final quedó en rojo. Ahí está la causa, no en el exit code.
- `falta index.html` / `index.html está vacío` — el merge no generó el HTML aunque el JSON esté bien.
- Cualquier línea de C8 (`no trae un arreglo steps`, `no corrió en ningún proyecto`, conteos de pasos) — el adjunto `c8-steps` se recortó: el recibo G2 citaría una secuencia que ya no existe.

Un flaky no pinta rojo, pero se mira igual (es deuda, no ruido): el nombre y el proyecto están en el `results.json` (`specs[].title`, `tests[].projectName`, `status: flaky`) y se ven enteros en `show-report`.

## 5. Caso de referencia: run #292

- Run `46116807041`, job `e2e` `140893755335`, artifact `playwright-report` id `15252507099`.
- El artifact decía: 98 ejecuciones (expected 74, skipped 23, unexpected 0, **flaky 1**), proyectos chromium 34 / firefox 32 / mobile-chrome 32, C8 con sus 5 pasos.
- La regla que lo tumbó entonces: `1 ejecución(es) flaky: el reporte no está verde`. Con la regla actual ese mismo artifact **pasa** el gate (el flaky se informa en los conteos y en la línea **Flaky**); el test se arregló igual porque el flake era real.
- Causa: `tests/e2e/app.spec.ts` → `debe navegar al modo Agent desde la paleta`, proyecto **firefox**; intento 1 `failed` a los 16 466 ms (`expect(locator).toBeVisible()` sobre `text=MODO AGENTE`, *element(s) not found*, timeout 5 000 ms) y el reintento pasó en 9 250 ms.

Moraleja del episodio: sin sesión, el camino es **integración → log del job → artifact → gate local**, y el artefacto de Playwright basta para nombrar el test y el motivo aunque el log sea inaccesible.

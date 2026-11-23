# Runbook de G3: verificación real del backend sobre Supabase

Este runbook cierra la parte de G3 que ningún test con `fetch` simulado puede
cerrar: que el adaptador hable de verdad con una cuenta de Supabase y que la
credencial rotada llegue al entorno de una release **sin aparecer en HTTP ni en
los logs**.

El adaptador vive en `deploy/backend/supabase.ts`; el verificador, en
`scripts/verify-g3-supabase.ts`. Usa siempre una organización de prueba: crea
proyectos y rota contraseñas reales.

## Qué demuestra y qué no

Demuestra:

1. `provision` crea (o reutiliza) un proyecto y su bucket en Supabase.
2. `migrate` aplica SQL por la Management API y es idempotente entre llamadas.
3. `rotate` cambia la contraseña de Postgres, emite `DATABASE_URL` y
   `AUTH_SECRET`, y deja `STORAGE_SECRET` explícitamente omitido.
4. Publicar escribe esas credenciales en
   `<publish>/<slug>/env/preview-<release>.json`, fuera del árbol servido.
5. Ninguna respuesta HTTP ni el log del server contienen los valores.
6. El `ref` sobrevive a reiniciar Commander (estado persistido en
   `.commander/backend` o `COMMANDER_BACKEND_STATE_DIR`).

No demuestra por sí solo:

- Que la app de ejemplo use `DATABASE_URL` para hablar con Postgres: la app de
  `examples/pl3-backend-app` sigue sobre SQLite. El runbook incluye una
  comprobación opcional con `psql` para validar la contraseña contra la base.
- Que las claves S3 del storage se hayan emitido: Supabase no las emite por la
  Management API. El verificador exige que la rotación las declare omitidas.
- Nada sobre un despliegue remoto: la release es local. El entorno remoto sigue
  siendo el límite conocido de G3.

## Credenciales y datos de entrada

| Dato | Dónde se obtiene | Forma |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Dashboard → Account → Access Tokens (`/dashboard/account/tokens`) | `sbp_…`, secreto |
| `SUPABASE_ORG_ID` | URL del dashboard de la organización (`/dashboard/org/<org-id>`) o `GET https://api.supabase.com/v1/organizations` | id de organización |
| `SUPABASE_REGION` | Región del proyecto; `GET https://api.supabase.com/v1/projects` la devuelve como `region` | slug, p. ej. `us-east-1` |
| `COMMANDER_BACKEND_PROVIDER` | Lo eliges tú al arrancar Commander | `supabase` |
| `COMMANDER_PUBLISH_DIR` | Base de releases; el verificador debe usar la misma | ruta absoluta |
| `COMMANDER_BACKEND_STATE_DIR` | Opcional; aísla el estado persistido de esta prueba | ruta absoluta |

Reglas:

- El token **no** se pega en el chat, ni en el runbook, ni en un commit. Vive en
  el entorno del server o en un `.env` no versionado.
- No uses la organización de producción. Un proyecto y un bucket de prueba son
  suficientes; bórralos al terminar.
- El verificador no lee estas variables: sólo habla con Commander, que las tiene
  en su proceso.

## Preparación

1. Elige una app con build estático y un directorio de salida:

   ```bash
   ls dist/index.html   # o el --output-dir que uses
   ```

2. Arranca Commander desde la raíz del repo, con log a archivo (la evidencia de
   logs se escanea desde ahí):

   ```bash
   export COMMANDER_BACKEND_PROVIDER=supabase
   export SUPABASE_ACCESS_TOKEN='...'
   export SUPABASE_ORG_ID='...'
   export SUPABASE_REGION='us-east-1'
   export COMMANDER_PUBLISH_DIR="$PWD/.commander/g3-publish"
   export COMMANDER_BACKEND_STATE_DIR="$PWD/.commander/g3-backend-state"
   npx tsx server.ts > .commander/g3-server.log 2>&1
   ```

   Anota el puerto que anuncia el server (por defecto `3283`; con `PORT=0` lo
   elige el SO y aparece en el log).

3. Comprueba que el adaptador está habilitado y configurado:

   ```bash
   curl -s "http://127.0.0.1:3283/api/backend/manage/status?projectId=demo" | head -c 400
   ```

   Debe responder `"provider":"supabase"`, `"configured":true`,
   `"enabled":true`. Si responde `enabled:false`, el server no arrancó con el
   proveedor; si `configured:false`, faltan variables.

## Ejecución

```bash
npm run verify:g3-supabase -- \
  --root "$PWD/examples/pl3-backend-app" \
  --output-dir dist \
  --publish-dir "$COMMANDER_PUBLISH_DIR" \
  --server-log .commander/g3-server.log
```

Flags útiles:

- `--base-url http://127.0.0.1:<puerto>` si Commander no usa el 3283.
- `--report <ruta>` para el JSON de evidencia; por defecto cae en
  `.commander/g3-supabase/evidence-<epoch>.json`.
- `--skip-log-check` sólo si no puedes capturar el log; el reporte marcará
  `serverLog: "skipped"` y la evidencia queda incompleta.
- `--status-only` tras reiniciar (ver más abajo).

La app debe tener un `index.html` en su directorio de salida: el verificador no
construye, publica con `build:false`.

## Qué hace el verificador

1. `GET /api/health` y `status` del proyecto: exige proveedor `supabase`,
   `configured` y `enabled`.
2. `POST /provision` con `database`, `storage` y `auth`. Imprime el `ref` y el
   bucket, nunca credenciales.
3. `POST /migrate` con `001_g3_probe` dos veces: la primera aplica o salta, la
   segunda **debe** saltar. Exige `failed: []`.
4. `POST /rotate`: exige `DATABASE_URL` y `AUTH_SECRET`, y que
   `STORAGE_SECRET` venga en `skipped` con nombre y motivo.
5. `POST /publish/preview` con la app real y `build:false`.
6. Lee el archivo de entorno de la release desde disco y comprueba:
   - contiene `DATABASE_URL` y `AUTH_SECRET`, no vacías;
   - no contiene `STORAGE_SECRET`;
   - `DATABASE_URL` apunta a `db.<ref>.supabase.co` del proyecto aprovisionado;
   - permisos `0600` (en Windows se informa que no son verificables).
7. Recorre todas las respuestas HTTP acumuladas (status, provision, migrate,
   rotate, publish, status posterior) y falla si aparece cualquier valor, crudo o
   URL-encoded.
8. Pide la release servida, comprueba que responde 200 y que el archivo de
   entorno **no** se sirve: `…/env/preview-<id>.json` debe dar 404.
9. Escanea el log del server completo y falla si aparece un valor.
10. Escribe el reporte JSON sin valores: rutas, nombres, ref, permisos, estado
    de cada check y una huella `sha256:<12 hex>` por credencial.

## Evidencia esperada

Salida (los valores nunca se imprimen):

```text
[g3] base=http://127.0.0.1:3283 · proyecto=pl3-backend-app-1a2b3c4d
[g3] server: supabase configurado · bindings previos=ninguno
[g3] provision: database=abcdefghijklmnop · storage=cmdr-…-files · auth=abcdefghijklmnop
[g3] migrate: 001_g3_probe applied=0 skipped=1 · repetición skipped=1
[g3] rotate: DATABASE_URL, AUTH_SECRET · omitido STORAGE_SECRET (Supabase no emite…)
[g3] release: preview=2026-… url=/published/pl3-backend-app-1a2b3c4d/preview/
[g3] env: …/env/preview-2026-….json · vars=AUTH_SECRET, DATABASE_URL · modo=600
[g3] huellas: AUTH_SECRET=sha256:… · DATABASE_URL=sha256:…
[g3] rotación/publicación: 7 respuestas sin valores de credenciales
[g3] release servida y estado de publicación: 10 respuestas sin valores de credenciales
[g3] log: 12345 bytes sin valores · …/g3-server.log
[g3] reporte: …/.commander/g3-supabase/evidence-….json
[g3] ok: credenciales de 2026-… en el entorno de la release, sin pasar por HTTP ni logs
```

El reporte es la evidencia adjuntable. Campos clave:

```json
{
  "provider": "supabase",
  "ref": "abcdefghijklmnop",
  "release": {
    "envFile": "…/env/preview-….json",
    "vars": ["AUTH_SECRET", "DATABASE_URL"],
    "fingerprints": { "DATABASE_URL": "sha256:…" },
    "mode": "600"
  },
  "checks": {
    "valuesInHttp": 0,
    "envOverHttp": 404,
    "serverLog": { "status": "clean", "bytes": 12345 }
  }
}
```

La huella permite comparar la credencial del archivo con la que el proceso de la
app carga, sin revelar ninguna de las dos.

## Reinicio: el estado persistido

El `ref` y los bindings se guardan en `.commander/backend` (o
`COMMANDER_BACKEND_STATE_DIR`). Para comprobarlo:

1. Para Commander (Ctrl+C) y vuelve a arrancarlo con las mismas variables y el
   mismo `COMMANDER_BACKEND_STATE_DIR`.

   ```bash
   npx tsx server.ts > .commander/g3-server-restart.log 2>&1
   ```

2. Ejecuta:

   ```bash
   npm run verify:g3-supabase -- \
     --root "$PWD/examples/pl3-backend-app" \
     --status-only
   ```

   Debe imprimir el mismo `ref` y los tres bindings, sin volver a aprovisionar.
   Si responde «sin aprovisionar», revisa que el server use el mismo
   `COMMANDER_BACKEND_STATE_DIR` y el mismo `cwd` que antes.

3. El sink de credenciales es memoria del proceso: tras reiniciar, rota de nuevo
   y vuelve a publicar antes de probar la app. La contraseña anterior ya no
   existe, así que un `DATABASE_URL` viejo no sirve.

## La app lee el archivo de entorno

El runner de la release recibe la ruta del archivo, no el valor por HTTP:

```bash
npx tsx examples/pl3-backend-app/server.ts \
  --env-file "$COMMANDER_PUBLISH_DIR/<slug>/env/preview-<release>.json"
```

El banner y `GET /api/health` muestran sólo los nombres (`vars`). La app aplica
los valores a `process.env` antes de abrir datos; el ejemplo usa SQLite, así que
lo que esta prueba demuestra es la entrega al entorno del proceso.

Comprobación opcional de la contraseña contra Postgres (si tienes `psql`):

```bash
ENV_FILE="$COMMANDER_PUBLISH_DIR/<slug>/env/preview-<release>.json"
DATABASE_URL="$(node -e "const e=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.stdout.write(e.vars.DATABASE_URL)" "$ENV_FILE")" \
  psql "$DATABASE_URL" -c 'select 1;'
unset DATABASE_URL
```

No imprimas `DATABASE_URL`; `select 1;` es suficiente para probar que la
contraseña rotada autentica.

## Limpieza

1. Borra el proyecto de Supabase de la organización de prueba (dashboard →
   Project Settings → General → Delete project). El adaptador no implementa el
   borrado.
2. Borra el estado local de la prueba:

   ```bash
   rm -rf "$COMMANDER_BACKEND_STATE_DIR" "$COMMANDER_PUBLISH_DIR" \
     .commander/g3-supabase .commander/g3-server*.log
   ```

3. No commitees `.env`, logs, reportes ni archivos de entorno: contienen rutas y
   huellas, y el archivo de entorno contiene las credenciales reales.

## Criterio de cierre de G3

Marca G3 como verificado sólo si **todo** esto es cierto en una corrida real:

- [ ] `provision` respondió con un `ref` y un bucket, sin duplicar el proyecto
      al repetir.
- [ ] `migrate` aplicó `001_g3_probe` y la repetición la saltó.
- [ ] `rotate` emitió `DATABASE_URL` y `AUTH_SECRET`; `STORAGE_SECRET` quedó en
      `skipped` con motivo.
- [ ] El archivo de entorno existe, está fuera de `releases/`, tiene modo `0600`
      y las dos credenciales no vacías.
- [ ] `DATABASE_URL` apunta a `db.<ref>.supabase.co`.
- [ ] `valuesInHttp` es 0 y el archivo de entorno responde 404 por HTTP.
- [ ] El log del server no contiene ningún valor (`serverLog.status: clean`).
- [ ] Tras reiniciar, `--status-only` conserva el `ref` y los bindings.
- [ ] (Opcional, recomendado) `psql` autentica con la contraseña rotada.

## Problemas frecuentes

- **401/403 de Supabase**: token revocado o de otra organización. El error del
  adaptador no repite el token.
- **`configured:false`**: faltan `SUPABASE_ACCESS_TOKEN`, `SUPABASE_ORG_ID` o
  `SUPABASE_REGION` en el proceso del server.
- **`provision` falla con 4xx**: región inválida, límite de proyectos de la
  organización o nombre ya usado por otro proyecto no gestionado.
- **`no existe el entorno de la release`**: el server usa otro
  `COMMANDER_PUBLISH_DIR`, o se reinició después de rotar y el sink quedó vacío.
- **`el archivo de entorno se sirvió por HTTP`**: no continúes; es una fuga. El
  publicador debe escribir fuera de `releases/`.
- **Windows y modo `600`**: los permisos POSIX no se comprueban; el reporte lo
  indica y la evidencia de contenido sigue valiendo.

# Vite static example

App mínima de Vite usada para validar el adaptador real de hosting estático.

## Construir

Desde la raíz del repositorio:

```bash
npx vite build examples/vite-static
```

La salida queda en `examples/vite-static/dist`.

## Publicar en Vercel

1. Define en `.env`:

   ```env
   VERCEL_TOKEN=
   VERCEL_PROJECT_ID=
   VERCEL_TEAM_ID=
   ```

2. Desde la raíz del repositorio ejecuta:

   ```bash
   npm run deploy:example
   ```

   Añade `-- --production` para promover el preview a producción.

La release se sube tal como se construyó: Vercel no vuelve a ejecutar el build.
El comando también sirve desde el panel **Publicar** si abres esta carpeta como
proyecto en Commander.

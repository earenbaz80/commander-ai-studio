/**
 * Publica `examples/vite-static` con el adaptador real.
 *
 * Construye la demo, crea una release local inmutable y la entrega a Vercel.
 * Sin credenciales falla antes de tocar la red; el token nunca se imprime.
 */
import 'dotenv/config';
import path from 'node:path';
import { build } from 'vite';
import { createRelease, getReleaseForDeploy } from '../publisher';
import { createConfiguredDeploymentAdapter } from '../deploy/configuredAdapter';

const exampleRoot = path.resolve('examples/vite-static');
const toProduction = process.argv.includes('--production');

async function waitUntilReady(
  adapter: ReturnType<typeof createConfiguredDeploymentAdapter>,
  project: Awaited<ReturnType<typeof adapter.detectProject>>,
  deploymentId: string
) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await adapter.status(project);
    const deployment = status.deployments.find((item) => item.id === deploymentId);
    if (deployment?.status === 'ready') return deployment;
    if (deployment?.status === 'failed') {
      throw new Error(`Vercel marcó el deployment ${deploymentId} como fallido`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error('Vercel no terminó el deployment en 120 segundos');
}

async function main() {
  const adapter = createConfiguredDeploymentAdapter();
  if (adapter.id !== 'vercel') {
    throw new Error(
      'Faltan VERCEL_TOKEN y VERCEL_PROJECT_ID. Configúralos en .env y vuelve a ejecutar el comando.'
    );
  }

  console.log('Construyendo examples/vite-static…');
  await build({ root: exampleRoot, logLevel: 'info' });

  const { release } = await createRelease(exampleRoot, {
    outputDir: 'dist',
    build: false,
  });
  const local = await getReleaseForDeploy(exampleRoot, release.id);
  if (!local) throw new Error('No se pudo preparar la release local');

  const project = await adapter.detectProject(exampleRoot);
  const deployment = await adapter.deploy({
    project,
    release: { id: local.release.id, dir: local.dir, fileCount: local.release.fileCount, bytes: local.release.bytes },
    environment: 'preview',
  });

  const ready = await waitUntilReady(adapter, project, deployment.id);
  const url = ready.url || deployment.url;
  if (!url) throw new Error('Vercel no devolvió una URL para el preview');

  if (toProduction) {
    const promoted = await adapter.promote({
      project,
      deploymentId: ready.id,
      environment: 'production',
    });
    console.log(`Producción: ${promoted.url || url}`);
  } else {
    console.log(`Preview: ${url}`);
  }
}

main().catch((error: any) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});

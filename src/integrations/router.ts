import { Router, type Request } from 'express';
import type { IntegrationStatus } from './types';
import { getIntegrationProvider } from './providers';
import {
  IntegrationError,
  completeOAuth,
  disconnectIntegration,
  getIntegrationStatus,
  listIntegrationStatuses,
  startOAuth,
} from './oauth';

function requestBaseUrl(req: Request): string {
  const configured = process.env.COMMANDER_BASE_URL || process.env.BASE_URL || process.env.PUBLIC_URL;
  if (configured?.trim()) return configured.trim().replace(/\/+$/, '');

  const host = req.get('host');
  if (!host) throw new IntegrationError('No se pudo determinar el host del callback.', 400);
  // Express no confía en X-Forwarded-Proto por defecto. En local el callback es
  // http; si se publica detrás de HTTPS, se configura COMMANDER_BASE_URL.
  return `${req.protocol === 'https' ? 'https' : 'http'}://${host}`;
}

function sameOrigin(req: Request): boolean {
  const origin = req.get('origin');
  // Peticiones nativas (CLI, tests) no mandan Origin; el navegador sí, y una
  // página ajena no debe poder desconectar una integración por CSRF.
  if (!origin) return true;
  try {
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

function withRedirectUri(status: IntegrationStatus, base: string): IntegrationStatus {
  return { ...status, redirectUri: `${base}/api/integrations/${status.id}/callback` };
}

function providerLabel(id: string): string {
  return getIntegrationProvider(id)?.label || id;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function callbackPage(ok: boolean, message: string, provider?: string): string {
  const payload = JSON.stringify({
    type: 'commander-integration-oauth',
    provider,
    ok,
    message,
  })
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>Commander · ${ok ? 'Conectado' : 'Error'}</title>
<style>
  body{margin:0;background:#000080;color:#ffff55;font:14px/1.4 ui-monospace,monospace;display:grid;place-items:center;min-height:100vh}
  .box{border:2px solid #00ffff;background:#000040;padding:24px 28px;max-width:520px}
  h1{font-size:16px;color:#00ffff;margin:0 0 12px}
  p{margin:0 0 8px;white-space:pre-wrap}
  .muted{color:#c8c8ff;font-size:12px}
</style></head>
<body><div class="box"><h1>${ok ? '✓ CONECTADO' : '✗ NO SE PUDO CONECTAR'}</h1>
<p>${escapeHtml(message)}</p>
<p class="muted">${ok ? 'Puedes cerrar esta ventana; Commander ya tiene el token cifrado.' : 'Vuelve a Commander para ver el detalle.'}</p>
</div>
<script>
  try {
    if (window.opener) window.opener.postMessage(${payload}, '*');
  } catch (e) {}
  setTimeout(function () { window.close(); }, ${ok ? 600 : 5000});
</script></body></html>`;
}

export function createIntegrationsRouter(): Router {
  const router = Router();

  router.get('/', (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const base = requestBaseUrl(req);
      res.json({
        success: true,
        providers: listIntegrationStatuses().map((status) => withRedirectUri(status, base)),
      });
    } catch (error: any) {
      const status = error instanceof IntegrationError ? error.status : 500;
      res.status(status).json({ success: false, error: error?.message || 'No se pudo leer integraciones' });
    }
  });

  router.get('/:provider/status', (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const status = withRedirectUri(getIntegrationStatus(req.params.provider), requestBaseUrl(req));
      res.json({ success: true, ...status });
    } catch (error: any) {
      const code = error instanceof IntegrationError ? error.status : 500;
      res.status(code).json({ success: false, error: error?.message || 'No se pudo leer el conector' });
    }
  });

  router.post('/:provider/authorize', (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ success: false, error: 'Origen no permitido' });
    try {
      const started = startOAuth(req.params.provider, requestBaseUrl(req));
      res.json({ success: true, ...started });
    } catch (error: any) {
      const code = error instanceof IntegrationError ? error.status : 500;
      res.status(code).json({ success: false, error: error?.message || 'No se pudo iniciar OAuth' });
    }
  });

  router.get('/:provider/callback', async (req, res) => {
    const provider = String(req.params.provider || '');
    const label = providerLabel(provider);
    const error = String(req.query.error || '');
    if (error) {
      const description = String(req.query.error_description || error);
      return res
        .status(400)
        .type('html')
        .send(callbackPage(false, `${label} denegó la autorización: ${description}`, provider));
    }

    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    if (!code || !state) {
      return res.status(400).type('html').send(callbackPage(false, 'Faltó code o state en el callback.', provider));
    }

    try {
      const status = await completeOAuth(provider, code, state);
      return res
        .status(200)
        .type('html')
        .send(callbackPage(true, `${label} conectado${status.account?.name ? ` como ${status.account.name}` : ''}.`, provider));
    } catch (err: any) {
      const message = err instanceof Error ? err.message : 'No se pudo completar OAuth.';
      return res.status(400).type('html').send(callbackPage(false, message, provider));
    }
  });

  router.post('/:provider/disconnect', async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ success: false, error: 'Origen no permitido' });
    try {
      const result = await disconnectIntegration(req.params.provider);
      const status = withRedirectUri(result.status, requestBaseUrl(req));
      res.json({
        success: true,
        ...status,
        revoked: result.revoked,
        ...(result.warning ? { warning: result.warning } : {}),
      });
    } catch (error: any) {
      const code = error instanceof IntegrationError ? error.status : 500;
      res.status(code).json({ success: false, error: error?.message || 'No se pudo desconectar' });
    }
  });

  return router;
}

/**
 * Puente HTTP entre la sesión de Playwright del agente y el Workbench.
 *
 * La sesión sigue siendo única por proyecto y vive en `browserSession.ts`. Este
 * router no abre navegadores por su cuenta: reutiliza la que ya exista y expone
 * frames, consola, red y entrada del usuario.
 */
import express, { type Response } from 'express';
import { resolveProjectPath } from './projects';
import {
  captureBrowserScreenshot,
  closeBrowserSession,
  getBrowserSessionFrame,
  getBrowserSessionInfo,
  getBrowserSessionLogs,
  listBrowserSessions,
  runBrowserAction,
  runBrowserInput,
  subscribeBrowserSession,
  type BrowserSessionEvent,
} from './browserSession';

function projectRoot(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) throw new Error('Proyecto requerido');
  if (raw.length > 2000) throw new Error('Ruta de proyecto demasiado larga');
  return resolveProjectPath('.', raw).abs;
}

function browserError(res: Response, error: any, status = 400) {
  return res.status(status).json({ success: false, error: error?.message || String(error) });
}

function sseWrite(res: Response, type: string, payload: unknown): void {
  if (res.writableEnded) return;
  const seq = (payload as any)?.seq;
  const id = Number.isFinite(seq) ? `id: ${seq}\n` : '';
  res.write(`event: ${type}\n${id}data: ${JSON.stringify(payload)}\n\n`);
}

export function createBrowserRouter() {
  const browserRouter = express.Router();

  browserRouter.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  /** Abre o reutiliza la sesión del proyecto. */
  browserRouter.post('/session', async (req, res) => {
    try {
      const root = projectRoot(req.body?.root);
      const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
      const result = await runBrowserAction({
        action: 'open',
        root,
        actor: 'user',
        ...(url ? { url } : {}),
      });
      if (!result.ok) return browserError(res, result.error, result.status || 500);
      const session = await getBrowserSessionInfo({ id: result.data?.sessionId });
      if (!session) return browserError(res, new Error('La sesión no quedó disponible'), 500);
      return res.status(result.data?.reused ? 200 : 201).json({
        success: true,
        created: !result.data?.reused,
        session,
      });
    } catch (error: any) {
      return browserError(res, error);
    }
  });

  /** Lista todas las sesiones activas para el selector del panel. */
  browserRouter.get('/sessions', async (_req, res) => {
    try {
      return res.json({ success: true, sessions: await listBrowserSessions() });
    } catch (error: any) {
      return browserError(res, error);
    }
  });

  /** Consulta la sesión activa de un proyecto sin abrir Chromium. */
  browserRouter.get('/session', async (req, res) => {
    try {
      const root = projectRoot(req.query.root);
      const session = await getBrowserSessionInfo({ root });
      if (!session) {
        return res.status(404).json({ success: false, error: 'No hay una sesión de navegador abierta' });
      }
      return res.json({ success: true, session });
    } catch (error: any) {
      return browserError(res, error);
    }
  });

  browserRouter.get('/session/:id', async (req, res) => {
    try {
      const session = await getBrowserSessionInfo({ id: req.params.id });
      if (!session) return res.status(404).json({ success: false, error: 'Sesión no encontrada' });
      return res.json({ success: true, session });
    } catch (error: any) {
      return browserError(res, error);
    }
  });

  /** Entrada del usuario sobre el frame actual. */
  browserRouter.post('/session/:id/input', async (req, res) => {
    try {
      const result = await runBrowserInput({
        ...(req.body || {}),
        sessionId: req.params.id,
      });
      if (!result.ok) return browserError(res, result.error, result.status || 500);
      return res.json({ success: true, ...result.data });
    } catch (error: any) {
      return browserError(res, error);
    }
  });

  /** Captura PNG real de la página para descargar desde el panel. */
  browserRouter.post('/session/:id/screenshot', async (req, res) => {
    try {
      const screenshot = await captureBrowserScreenshot(
        req.params.id,
        req.body?.fullPage === true,
      );
      if (!screenshot) {
        return res.status(404).json({ success: false, error: 'Sesión no encontrada' });
      }
      return res.json({ success: true, screenshot });
    } catch (error: any) {
      return browserError(res, error, /Tiempo agotado/.test(String(error?.message)) ? 504 : 500);
    }
  });

  browserRouter.get('/session/:id/logs', (req, res) => {
    const after = Number(req.query.after);
    const limit = Number(req.query.limit);
    const logs = getBrowserSessionLogs(
      req.params.id,
      Number.isFinite(after) ? after : 0,
      Number.isFinite(limit) ? limit : 200,
    );
    if (!logs) return res.status(404).json({ success: false, error: 'Sesión no encontrada' });
    return res.json({ success: true, ...logs });
  });

  browserRouter.delete('/session/:id', (req, res) => {
    if (!closeBrowserSession(req.params.id)) {
      return res.status(404).json({ success: false, error: 'Sesión no encontrada' });
    }
    return res.status(204).end();
  });

  /**
   * SSE: snapshot + último frame + historial retenido, y después el bus vivo.
   * El EventSource del renderer reconecta solo; el servidor sólo tiene que
   * mantener el socket y cerrarlo limpiamente.
   */
  browserRouter.get('/session/:id/stream', async (req, res) => {
    const session = await getBrowserSessionInfo({ id: req.params.id });
    if (!session) return res.status(404).json({ success: false, error: 'Sesión no encontrada' });

    // Un EventSource que reconecta manda Last-Event-ID: reanudar desde ahí
    // evita repetir consola/red que el cliente ya tenía. El frame sí se
    // reenvía siempre: es estado actual, no un evento acumulable.
    const lastEventId = Number(req.headers['last-event-id']);
    const resumeAfter = Number.isFinite(lastEventId) && lastEventId > 0 ? Math.trunc(lastEventId) : 0;

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let ready = false;
    let ended = false;
    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const queued: BrowserSessionEvent[] = [];

    const cleanup = () => {
      if (ended) return;
      ended = true;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      unsubscribe?.();
      unsubscribe = null;
    };

    const push = (event: BrowserSessionEvent) => {
      if (ended) return;
      if (!ready) {
        queued.push(event);
        return;
      }
      if (event.type === 'status' && event.status === 'closed') {
        sseWrite(res, event.type, event);
        cleanup();
        res.end();
        return;
      }
      sseWrite(res, event.type, event);
    };

    unsubscribe = subscribeBrowserSession(session.id, push);
    if (!unsubscribe) {
      cleanup();
      if (!res.writableEnded) return res.status(404).json({ success: false, error: 'Sesión no encontrada' });
      return;
    }

    sseWrite(res, 'snapshot', { session });
    const frame = getBrowserSessionFrame(session.id);
    if (frame) sseWrite(res, 'frame', { type: 'frame', seq: frame.seq, frame });

    const logs = getBrowserSessionLogs(session.id, resumeAfter);
    if (logs) {
      for (const entry of logs.console) {
        sseWrite(res, 'console', { type: 'console', seq: entry.seq, entry });
      }
      for (const entry of logs.network) {
        sseWrite(res, 'network', { type: 'network', seq: entry.seq, entry });
      }
    }

    const replayThrough = logs?.lastSeq ?? 0;
    ready = true;
    for (const event of queued) {
      if (Number(event.seq) > replayThrough) push(event);
    }
    queued.length = 0;

    heartbeat = setInterval(() => {
      if (!ended) res.write(': ping\n\n');
    }, 15_000);
    heartbeat.unref?.();

    req.on('close', cleanup);
    res.on('close', cleanup);
  });

  return browserRouter;
}

export default createBrowserRouter;

/**
 * API HTTP del backend multiinquilino.
 *
 * Todo lo que no sea registro/login exige `Authorization: Bearer <token>`.
 * El `tenant_id` y el `user_id` salen de la sesión; no se aceptan del body,
 * query ni cabeceras del cliente. Los recursos de otro inquilino responden 403.
 */
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import {
  TENANT_FILE_MAX_BYTES,
  TenantStore,
  TenantStoreError,
  type TenantAuth,
  type TenantFile,
  type TenantRecord,
  type TenantSession,
  type TenantStoreOptions,
} from './tenantStore';

export interface TenantBackendOptions extends TenantStoreOptions {}

interface TenantRequestLocals {
  tenantAuth?: TenantAuth;
  tenantToken?: string;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

function sessionResponse(session: TenantSession) {
  return {
    token: session.token,
    expiresAt: session.expiresAt,
    user: session.user,
    tenant: session.tenant,
  };
}

function publicRecord(record: TenantRecord) {
  return {
    id: record.id,
    title: record.title,
    body: record.body,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function publicFile(file: TenantFile) {
  return {
    id: file.id,
    name: file.name,
    mime: file.mime,
    size: file.size,
    createdAt: file.createdAt,
  };
}

function authOf(res: Response): TenantAuth {
  return (res.locals as TenantRequestLocals).tenantAuth as TenantAuth;
}

function requireTenant(store: TenantStore): RequestHandler {
  return (req, res, next) => {
    const token = bearerToken(req);
    const auth = token ? store.authenticate(token) : null;
    if (!token || !auth) {
      return res.status(401).json({ success: false, error: 'No autenticado' });
    }
    const locals = res.locals as TenantRequestLocals;
    locals.tenantAuth = auth;
    locals.tenantToken = token;
    return next();
  };
}

function requireRecord(store: TenantStore, auth: TenantAuth, id: string): TenantRecord {
  const record = store.getRecord(id);
  if (!record) throw new TenantStoreError(404, 'Registro no encontrado');
  if (record.tenantId !== auth.tenantId) throw new TenantStoreError(403, 'No autorizado');
  return record;
}

function requireFile(store: TenantStore, auth: TenantAuth, id: string): TenantFile {
  const file = store.getFile(id);
  if (!file) throw new TenantStoreError(404, 'Archivo no encontrado');
  if (file.tenantId !== auth.tenantId) throw new TenantStoreError(403, 'No autorizado');
  return file;
}

export function createTenantBackendRouter(options: TenantBackendOptions = {}): express.Router {
  const store = new TenantStore(options);
  const maxFileBytes = options.maxFileBytes ?? TENANT_FILE_MAX_BYTES;
  const router = express.Router();

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.post('/auth/register', (req, res) => {
    const session = store.register({
      email: req.body?.email,
      password: req.body?.password,
      name: req.body?.name,
      tenantName: req.body?.tenantName,
    });
    return res.status(201).json({ success: true, ...sessionResponse(session) });
  });

  router.post('/auth/login', (req, res) => {
    const session = store.login({
      email: req.body?.email,
      password: req.body?.password,
    });
    return res.json({ success: true, ...sessionResponse(session) });
  });

  const authenticated = requireTenant(store);

  router.post('/auth/logout', authenticated, (_req, res) => {
    const token = (res.locals as TenantRequestLocals).tenantToken;
    if (token) store.logout(token);
    return res.json({ success: true });
  });

  router.get('/auth/me', authenticated, (_req, res) => {
    const auth = authOf(res);
    return res.json({
      success: true,
      user: { id: auth.userId, email: auth.email, name: auth.name },
      tenant: { id: auth.tenantId, name: auth.tenantName },
    });
  });

  router.get('/records', authenticated, (_req, res) => {
    const records = store.listRecords(authOf(res).tenantId).map(publicRecord);
    return res.json({ success: true, records });
  });

  router.post('/records', authenticated, (req, res) => {
    const auth = authOf(res);
    const record = store.createRecord(auth.tenantId, auth.userId, {
      title: req.body?.title,
      body: req.body?.body,
    });
    return res.status(201).json({ success: true, record: publicRecord(record) });
  });

  router.get('/records/:id', authenticated, (req, res) => {
    const record = requireRecord(store, authOf(res), String(req.params.id));
    return res.json({ success: true, record: publicRecord(record) });
  });

  router.patch('/records/:id', authenticated, (req, res) => {
    const record = store.updateRecord(String(req.params.id), authOf(res).tenantId, {
      title: req.body?.title,
      body: req.body?.body,
    });
    return res.json({ success: true, record: publicRecord(record) });
  });

  router.delete('/records/:id', authenticated, (req, res) => {
    store.deleteRecord(String(req.params.id), authOf(res).tenantId);
    return res.status(204).end();
  });

  router.get('/files', authenticated, (_req, res) => {
    const files = store.listFiles(authOf(res).tenantId).map(publicFile);
    return res.json({ success: true, files });
  });

  router.post(
    '/files',
    authenticated,
    express.raw({ type: () => true, limit: maxFileBytes }),
    (req, res) => {
      const data = Buffer.isBuffer(req.body) ? req.body : null;
      if (!data) {
        throw new TenantStoreError(
          400,
          'El archivo debe enviarse como cuerpo binario (no JSON)'
        );
      }
      const rawName = req.headers['x-commander-file-name'];
      const file = store.saveFile(authOf(res).tenantId, authOf(res).userId, {
        name: Array.isArray(rawName) ? rawName[0] : rawName || 'archivo.bin',
        mime: req.headers['content-type'],
        data,
      });
      return res.status(201).json({ success: true, file: publicFile(file) });
    }
  );

  router.get('/files/:id', authenticated, (req, res) => {
    const file = requireFile(store, authOf(res), String(req.params.id));
    const data = store.readFile(file);
    if (!data) throw new TenantStoreError(404, 'Archivo no encontrado');
    const asciiName = file.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Length', String(data.byteLength));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeRfc5987(file.name)}`
    );
    return res.end(data);
  });

  router.delete('/files/:id', authenticated, (req, res) => {
    store.deleteFile(String(req.params.id), authOf(res).tenantId);
    return res.status(204).end();
  });

  // Una ruta desconocida bajo /api/backend debe ser JSON, no el index.html de
  // la SPA: el cliente que la llame necesita saber que la ruta no existe.
  router.use((_req: Request, res: Response) => {
    res.status(404).json({ success: false, error: 'Ruta no encontrada' });
  });

  router.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof TenantStoreError) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    if (error?.type === 'entity.too.large' || error?.status === 413) {
      return res.status(413).json({ success: false, error: 'El archivo es demasiado grande' });
    }
    return res.status(500).json({ success: false, error: 'Error interno del backend' });
  });

  return router;
}

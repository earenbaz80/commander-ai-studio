import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.COMMANDER_DB_PATH || path.join(process.cwd(), '.commander', 'studio.db');

let db: DatabaseSync | null = null;

function migrate(d: DatabaseSync): void {
  // La tabla FTS nace en la primera migración que la crea, no en cada arranque:
  // sólo en ese caso hay que reconstruir el índice (una base vieja puede tener
  // mensajes sin indexar).
  const ftsExisted = !!d
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messages_fts'`)
    .get();

  d.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      root_path TEXT NOT NULL,
      default_branch TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      project_path TEXT,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      model TEXT,
      agent_mode TEXT NOT NULL DEFAULT 'build',
      execution_mode TEXT NOT NULL DEFAULT 'local',
      turn_state TEXT NOT NULL DEFAULT 'idle',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      request_id TEXT,
      input_id TEXT,
      origin TEXT,
      steering INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL,
      parts_json TEXT NOT NULL,
      attachments_json TEXT,
      metrics_json TEXT,
      ts INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ux_messages_thread_request
      ON messages(thread_id, request_id) WHERE request_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_messages_thread_input
      ON messages(thread_id, input_id) WHERE input_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS nono_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_nono_obs_project_ts ON nono_observations(project_id, ts DESC);

    -- Índice de texto completo del historial. Los triggers de abajo escriben
    -- aquí, y /api/search lo consulta: sin esta tabla virtual el INSERT de
    -- cualquier mensaje falla y la búsqueda responde «no such table».
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
      USING fts5(parts_json, content='messages', content_rowid='seq');

    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, parts_json) VALUES (new.seq, new.parts_json);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, parts_json) VALUES ('delete', old.seq, old.parts_json);
    END;
  `);
  if (!ftsExisted) d.exec(`INSERT INTO messages_fts(messages_fts) VALUES ('rebuild')`);
  // queue + receipts tables (separate exec for clarity)
  d.exec(`
    CREATE TABLE IF NOT EXISTS queue_items (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'prompt',
      prompt TEXT NOT NULL,
      label TEXT,
      chat_text TEXT,
      note TEXT,
      state TEXT NOT NULL DEFAULT 'pending',
      delivery TEXT NOT NULL DEFAULT 'queue',
      priority INTEGER NOT NULL DEFAULT 0,
      recovery_prompt TEXT,
      claimed_briefs TEXT,
      source TEXT,
      skill_name TEXT,
      attachments_json TEXT,
      position REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auto_run_receipts (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      campaign_started_at INTEGER NOT NULL,
      ordinal INTEGER NOT NULL,
      effort TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      queue_item_id TEXT,
      decision_json TEXT,
      manager_json TEXT,
      outcome_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_queue_thread_state ON queue_items(thread_id, state);
    CREATE INDEX IF NOT EXISTS ix_receipts_thread ON auto_run_receipts(thread_id, ordinal);
  `);

  const cols = (d.prepare("PRAGMA table_info(threads)").all() as any[]).map((c: any) => c.name);
  const addCol = (name: string, type: string) => {
    if (!cols.includes(name)) d.exec(`ALTER TABLE threads ADD COLUMN ${name} ${type}`);
  };
  addCol('worktree_path', 'TEXT');
  addCol('source_branch', 'TEXT');
  addCol('source_ref', 'TEXT');
  addCol('base_ref', 'TEXT');
  addCol('last_seen_head', 'TEXT');
  addCol('state_json', 'TEXT');
  addCol('pinned', 'INTEGER NOT NULL DEFAULT 0');
}

export function getDb(): DatabaseSync {
  if (db) return db;
  const dir = path.dirname(DB_PATH);
  fs.mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

export interface ProjectRow { id: string; root_path: string; default_branch: string | null; created_at: number; }
export interface ThreadRow {
  id: string; project_id: string | null; project_path: string | null; title: string | null;
  status: string; model: string | null; agent_mode: string; execution_mode: string; turn_state: string;
  worktree_path: string | null; source_branch: string | null; source_ref: string | null;
  base_ref: string | null; last_seen_head: string | null; state_json: string | null;
  created_at: number; updated_at: number;
  /** 1 = fijado en el sidebar; los fijados se listan primero. */
  pinned: number;
}
export interface MessageRow {
  seq: number; thread_id: string; request_id: string | null; input_id: string | null; origin: string | null;
  steering: number; role: string; parts_json: string; attachments_json: string | null; metrics_json: string | null; ts: number;
}

export function upsertProject(id: string, rootPath: string, defaultBranch?: string): void {
  const d = getDb();
  const now = Date.now();
  d.prepare(`INSERT INTO projects (id, root_path, default_branch, created_at) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET root_path=excluded.root_path, default_branch=COALESCE(excluded.default_branch, default_branch)`)
    .run(id, rootPath, defaultBranch ?? null, now);
}

export function createThread(t: { id: string; projectId?: string; projectPath?: string; title?: string; model?: string; agentMode?: string; executionMode?: string; worktreePath?: string; sourceBranch?: string; sourceRef?: string; baseRef?: string; lastSeenHead?: string; stateJson?: string; }): ThreadRow {
  const d = getDb();
  const now = Date.now();
  d.prepare(`INSERT OR IGNORE INTO threads (id, project_id, project_path, title, status, model, agent_mode, execution_mode, turn_state, worktree_path, source_branch, source_ref, base_ref, last_seen_head, state_json, created_at, updated_at)
    VALUES (?,?,?,?, 'idle', ?, ?, ?, 'idle', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(t.id, t.projectId ?? null, t.projectPath ?? null, t.title ?? null, t.model ?? null,
         t.agentMode ?? 'build', t.executionMode ?? 'local',
         t.worktreePath ?? null, t.sourceBranch ?? null, t.sourceRef ?? null, t.baseRef ?? null, t.lastSeenHead ?? null,
         t.stateJson ?? null, now, now);
  return getThread(t.id)!;
}

export function getThread(id: string): ThreadRow | null {
  const d = getDb();
  const r = d.prepare(`SELECT * FROM threads WHERE id = ?`).get(id) as ThreadRow | undefined;
  return r ?? null;
}

export function listThreads(projectId?: string, projectPath?: string): ThreadRow[] {
  const d = getDb();
  // El sidebar agrupa por ruta porque los hilos que nacen del agente sólo
  // tienen `project_path`; filtrar únicamente por `project_id` los ocultaba.
  const where: string[] = [];
  const vals: any[] = [];
  if (projectId) { where.push('project_id = ?'); vals.push(projectId); }
  if (projectPath) { where.push('project_path = ?'); vals.push(projectPath); }
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return d
    .prepare(`SELECT * FROM threads ${filter} ORDER BY pinned DESC, updated_at DESC`)
    .all(...vals) as unknown as ThreadRow[];
}

export function updateThread(id: string, patch: Partial<{ title: string; status: string; model: string; agent_mode: string; execution_mode: string; turn_state: string; worktree_path: string; source_branch: string; source_ref: string; base_ref: string; last_seen_head: string; state_json: string; pinned: number; }>): void {
  const d = getDb();
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  vals.push(Date.now());
  vals.push(id);
  d.prepare(`UPDATE threads SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export interface AppendMessageInput {
  threadId: string;
  requestId?: string;
  inputId?: string;
  origin?: string;
  steering?: boolean;
  role: string;
  parts: unknown;
  attachments?: unknown;
  metrics?: unknown;
  ts?: number;
}

export function appendMessage(m: AppendMessageInput): number | null {
  const d = getDb();
  const ts = m.ts ?? Date.now();
  try {
    const info = d.prepare(`INSERT INTO messages (thread_id, request_id, input_id, origin, steering, role, parts_json, attachments_json, metrics_json, ts)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(m.threadId, m.requestId ?? null, m.inputId ?? null, m.origin ?? null, m.steering ? 1 : 0,
           m.role, JSON.stringify(m.parts), m.attachments ? JSON.stringify(m.attachments) : null,
           m.metrics ? JSON.stringify(m.metrics) : null, ts);
    return Number(info.lastInsertRowid);
  } catch (e) {
    // Idempotent retry: duplicate request_id/input_id → skip.
    return null;
  }
}

export function loadMessages(threadId: string, limit = 200): MessageRow[] {
  const d = getDb();
  return d.prepare(`SELECT * FROM messages WHERE thread_id = ? ORDER BY seq ASC LIMIT ?`).all(threadId, limit) as unknown as MessageRow[];
}

export function searchConversations(query: string, limit = 20): { thread_id: string; seq: number; snippet: string }[] {
  const d = getDb();
  const rows = d.prepare(`
    SELECT m.thread_id, m.seq, snippet(messages_fts, 0, '<b>', '</b>', '…', 12) AS snippet
    FROM messages_fts f JOIN messages m ON m.seq = f.rowid
    WHERE messages_fts MATCH ? ORDER BY rank LIMIT ?`).all(query, limit) as any[];
  return rows.map((r) => ({ thread_id: r.thread_id, seq: r.seq, snippet: r.snippet }));
}

export interface NonoObservation { id: number; project_id: string | null; kind: string; content: string; ts: number; }

export function saveNonoObservation(projectId: string | null, kind: string, content: string, ts?: number): number {
  const d = getDb();
  if (projectId) upsertProject(projectId, projectId);
  const info = d.prepare(`INSERT INTO nono_observations (project_id, kind, content, ts) VALUES (?,?,?,?)`)
    .run(projectId, kind, content, ts ?? Date.now());
  return Number(info.lastInsertRowid);
}

export function listNonoObservations(projectId: string | null, limit = 50): NonoObservation[] {
  const d = getDb();
  if (projectId) {
    return d.prepare(`SELECT * FROM nono_observations WHERE project_id = ? ORDER BY ts DESC LIMIT ?`).all(projectId, limit) as unknown as NonoObservation[];
  }
  return d.prepare(`SELECT * FROM nono_observations ORDER BY ts DESC LIMIT ?`).all(limit) as unknown as NonoObservation[];
}

export function deleteThread(id: string): void {
  const d = getDb();
  d.prepare(`DELETE FROM threads WHERE id = ?`).run(id);
}
export function searchNonoObservations(projectId: string | null, query: string, limit = 20): NonoObservation[] {
  const d = getDb();
  const like = `%${query}%`;
  if (projectId) {
    return d.prepare(`SELECT * FROM nono_observations WHERE project_id = ? AND content LIKE ? ORDER BY ts DESC LIMIT ?`).all(projectId, like, limit) as unknown as NonoObservation[];
  }
  return d.prepare(`SELECT * FROM nono_observations WHERE content LIKE ? ORDER BY ts DESC LIMIT ?`).all(like, limit) as unknown as NonoObservation[];
}

// ── Queue items ──
export interface QueueItemRow {
  id: string; thread_id: string; kind: string; prompt: string; label: string | null;
  chat_text: string | null; note: string | null; state: string; delivery: string;
  priority: number; recovery_prompt: string | null; claimed_briefs: string | null;
  source: string | null; skill_name: string | null; attachments_json: string | null;
  position: number; created_at: number; updated_at: number;
}

export function enqueueItem(item: { id: string; threadId: string; prompt: string; label?: string; chatText?: string; note?: string; kind?: string; delivery?: string; priority?: number; position?: number; source?: string; skillName?: string; }): QueueItemRow {
  const d = getDb();
  const now = Date.now();
  const pos = item.position ?? now;
  // 15 columnas (con `state` fijo) para 14 valores ligados: un `?` de más
  // rompía el INSERT entero («16 values for 15 columns») y con él la cola.
  d.prepare(`INSERT INTO queue_items (id, thread_id, kind, prompt, label, chat_text, note, state, delivery, priority, source, skill_name, position, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,'pending',?,?,?,?,?,?,?)`)
    .run(item.id, item.threadId, item.kind ?? 'prompt', item.prompt, item.label ?? null, item.chatText ?? null, item.note ?? null,
         item.delivery ?? 'queue', item.priority ?? 0, item.source ?? null, item.skillName ?? null, pos, now, now);
  return getQueueItem(item.id)!;
}

export function getQueueItem(id: string): QueueItemRow | null {
  const d = getDb();
  const r = d.prepare(`SELECT * FROM queue_items WHERE id = ?`).get(id) as QueueItemRow | undefined;
  return r ?? null;
}

export function listQueue(threadId: string, state?: string): QueueItemRow[] {
  const d = getDb();
  if (state) {
    return d.prepare(`SELECT * FROM queue_items WHERE thread_id = ? AND state = ? ORDER BY position ASC, created_at ASC`).all(threadId, state) as unknown as QueueItemRow[];
  }
  return d.prepare(`SELECT * FROM queue_items WHERE thread_id = ? ORDER BY position ASC, created_at ASC`).all(threadId) as unknown as QueueItemRow[];
}

export function dequeueNext(threadId: string): QueueItemRow | null {
  const d = getDb();
  const r = d.prepare(`SELECT * FROM queue_items WHERE thread_id = ? AND state = 'pending' ORDER BY priority DESC, position ASC, created_at ASC LIMIT 1`).get(threadId) as QueueItemRow | undefined;
  if (!r) return null;
  d.prepare(`UPDATE queue_items SET state = 'claimed', updated_at = ? WHERE id = ?`).run(Date.now(), r.id);
  return { ...r, state: 'claimed' };
}

export function updateQueueItem(id: string, patch: Partial<{ state: string; note: string; recovery_prompt: string; claimed_briefs: string; }>): void {
  const d = getDb();
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries(patch)) {
    const col = k === 'recoveryPrompt' ? 'recovery_prompt' : k === 'claimedBriefs' ? 'claimed_briefs' : k;
    sets.push(`${col} = ?`);
    vals.push(v);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  vals.push(Date.now());
  vals.push(id);
  d.prepare(`UPDATE queue_items SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function recordReceipt(r: { id: string; threadId: string; campaignStartedAt: number; ordinal: number; effort?: string; status?: string; queueItemId?: string; decisionJson?: unknown; managerJson?: unknown; outcomeJson?: unknown; }): void {
  const d = getDb();
  d.prepare(`INSERT OR REPLACE INTO auto_run_receipts (id, thread_id, campaign_started_at, ordinal, effort, status, queue_item_id, decision_json, manager_json, outcome_json, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(r.id, r.threadId, r.campaignStartedAt, r.ordinal, r.effort ?? null, r.status ?? 'pending',
         r.queueItemId ?? null, r.decisionJson ? JSON.stringify(r.decisionJson) : null,
         r.managerJson ? JSON.stringify(r.managerJson) : null, r.outcomeJson ? JSON.stringify(r.outcomeJson) : null, Date.now());
}

export function listReceipts(threadId: string): any[] {
  const d = getDb();
  return d.prepare(`SELECT * FROM auto_run_receipts WHERE thread_id = ? ORDER BY ordinal ASC`).all(threadId) as any[];
}

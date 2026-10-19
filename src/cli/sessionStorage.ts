import fs from 'fs';
import path from 'path';
import { ChatMessage, StudioMode, ParameterConfig } from '../types/studio';

export interface SessionFile {
  id: string;
  title: string;
  mode: StudioMode;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  parameters: ParameterConfig;
  selectedModel: string;
  projectPath: string;
  tabId?: string;
}

const SESSIONS_DIR = '.commander/sessions';

function ensureSessionsDir(): void {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

export async function saveSession(session: SessionFile): Promise<string> {
  await ensureSessionsDir();
  const filePath = path.join(SESSIONS_DIR, `${session.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
  return filePath;
}

export async function loadSession(id: string): Promise<SessionFile | null> {
  const filePath = path.join(SESSIONS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

export async function listSessions(): Promise<{ id: string; title: string; updatedAt: string; messageCount: number }[]> {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
  const sessions = await Promise.all(
    files.map(async (f) => {
      const content = fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf-8');
      const session = JSON.parse(content) as SessionFile;
      return {
        id: session.id,
        title: session.title,
        updatedAt: session.updatedAt,
        messageCount: session.messages?.length || 0,
      };
    })
  );
  return sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function deleteSession(id: string): Promise<boolean> {
  const filePath = path.join(SESSIONS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

export function generateSessionId(): string {
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createSessionFile(
  title: string,
  mode: StudioMode,
  messages: ChatMessage[],
  parameters: ParameterConfig,
  selectedModel: string,
  projectPath: string,
  tabId?: string
): SessionFile {
  const now = new Date().toISOString();
  return {
    id: generateSessionId(),
    title,
    mode,
    createdAt: now,
    updatedAt: now,
    messages,
    parameters,
    selectedModel,
    projectPath,
    tabId,
  };
}
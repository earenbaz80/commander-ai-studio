/**
 * Unit tests del cliente MCP stdio (backend).
 *
 * Spawnea un servidor MCP falso real (JSON-RPC sobre stdio) y valida
 * initialize → tools/list → tools/call. Auto-contenido: escribe el servidor
 * fake en un tmpdir para no depender de rutas del repo.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resetConfig, writeConfig } from '../../src/config/index';
import { listServerTools, callServerTool } from '../../src/mcp/client';

const FAKE_SERVER = `
let buffer = '';
process.stdin.on('data', (d) => {
  buffer += d.toString();
  let idx;
  while ((idx = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (!line.trim()) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === 'initialize') {
      respond(msg.id, { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake', version: '1' } });
    } else if (msg.method === 'notifications/initialized') {
      // sin respuesta
    } else if (msg.method === 'tools/list') {
      respond(msg.id, { tools: [
        { name: 'echo', description: 'eco', inputSchema: { type: 'object' } },
        { name: 'add', description: 'suma', inputSchema: { type: 'object' } },
      ] });
    } else if (msg.method === 'tools/call') {
      respond(msg.id, handleCall(msg.params || {}));
    }
  }
});
function respond(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n'); }
function handleCall(p) {
  if (p.name === 'echo') return { content: [{ type: 'text', text: 'ECO:' + String(p.arguments?.text ?? '') }] };
  if (p.name === 'add') return { content: [{ type: 'text', text: String((p.arguments?.a ?? 0) + (p.arguments?.b ?? 0)) }] };
  return { isError: true, content: [{ type: 'text', text: 'desconocida' }] };
}
`;

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-client-'));
  originalCwd = process.cwd();
  fs.writeFileSync(path.join(tmpDir, 'fakeServer.mjs'), FAKE_SERVER);
  process.chdir(tmpDir);
  resetConfig();
  writeConfig({
    tools: {
      mcp: {
        enabled: true,
        servers: { faketest: { command: process.execPath, args: [path.join(tmpDir, 'fakeServer.mjs')] } },
      },
    },
  });
  resetConfig();
});

afterEach(() => {
  process.chdir(originalCwd);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignorar */ }
  resetConfig();
});

describe('MCP stdio client', () => {
  it('tools/list descubre las tools del servidor falso', async () => {
    const r = await listServerTools('faketest');
    expect(r.ok).toBe(true);
    const names = (r.data?.tools || []).map((t: any) => t.name);
    expect(names).toContain('echo');
    expect(names).toContain('add');
  });

  it('tools/call echo devuelve el texto', async () => {
    const r = await callServerTool('faketest', 'echo', { text: 'hola-mcp' });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.data)).toContain('ECO:hola-mcp');
  });

  it('tools/call add calcula la suma', async () => {
    const r = await callServerTool('faketest', 'add', { a: 2, b: 40 });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.data)).toContain('42');
  });

  it('servidor no configurado devuelve error', async () => {
    const r = await listServerTools('no-existe');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('no configurado');
  });
});

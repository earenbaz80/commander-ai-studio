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
import { listServerTools, callServerTool, spawnSpec, quoteForCmd } from '../../src/mcp/client';

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
  if (p.name === 'env') return { content: [{ type: 'text', text: String(process.env[p.arguments?.name] ?? '') }] };
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

  /**
   * El caso real: en Windows el intérprete está en `C:\Program Files\…` y los
   * servidores del registro viven bajo `C:\Users\<nombre con espacios>\…`. Con
   * el spawn anterior (`shell: true` sin comillas en los args) la ruta se
   * partía en el primer espacio y el hijo moría con `Cannot find module`.
   */
  it('arranca cuando el comando y los args traen espacios', async () => {
    const dir = path.join(tmpDir, 'carpeta con espacios');
    fs.mkdirSync(dir, { recursive: true });
    const script = path.join(dir, 'fake server.mjs');
    fs.copyFileSync(path.join(tmpDir, 'fakeServer.mjs'), script);

    writeConfig({
      tools: {
        mcp: {
          enabled: true,
          servers: { espacios: { command: process.execPath, args: [script] } },
        },
      },
    } as any);
    resetConfig();

    const r = await listServerTools('espacios');
    expect(r.ok, String(r.error || '')).toBe(true);
    expect((r.data?.tools || []).map((t: any) => t.name)).toContain('echo');
  });
});

/**
 * Cómo se lanza el hijo, sin depender de la plataforma donde corra la suite: el
 * fallo que se cierra aquí sólo se ve en Windows, y CI corre en Linux.
 */
describe('spawnSpec: quoting de comando y args', () => {
  it('un .exe con espacios va sin shell y con los args intactos', () => {
    const spec = spawnSpec(
      {
        command: 'C:\\Program Files\\nodejs\\node.exe',
        args: ['C:\\Users\\Edel Arencibia Baez\\AppData\\Roaming\\pixelforge-mcp\\dist\\index.js'],
      },
      'win32'
    );
    expect(spec.shell).toBe(false);
    expect(spec.command).toBe('C:\\Program Files\\nodejs\\node.exe');
    expect(spec.args).toEqual([
      'C:\\Users\\Edel Arencibia Baez\\AppData\\Roaming\\pixelforge-mcp\\dist\\index.js',
    ]);
  });

  it('un .cmd sí pasa por shell, y entonces se citan comando y args', () => {
    const spec = spawnSpec(
      {
        command: 'C:\\Program Files\\nodejs\\npx.cmd',
        args: ['-y', '@upstash/context7-mcp', 'C:\\mis docs\\script.js'],
      },
      'win32'
    );
    expect(spec.shell).toBe(true);
    expect(spec.command).toBe('"C:\\Program Files\\nodejs\\npx.cmd"');
    expect(spec.args).toEqual(['-y', '@upstash/context7-mcp', '"C:\\mis docs\\script.js"']);
  });

  it('un nombre suelto se trata como shim del PATH; una ruta con extensión, no', () => {
    expect(spawnSpec({ command: 'rea', args: ['--mcp'] }, 'win32').shell).toBe(true);
    expect(spawnSpec({ command: 'C:\\Tools\\rea\\launch-rea.mjs' }, 'win32').shell).toBe(false);
  });

  it('en POSIX nunca se usa shell', () => {
    expect(spawnSpec({ command: '/usr/bin/node', args: ['/tmp/a b.js'] }, 'linux')).toEqual({
      command: '/usr/bin/node',
      args: ['/tmp/a b.js'],
      shell: false,
    });
  });

  it('quoteForCmd sólo entrecomilla lo que lo necesita', () => {
    expect(quoteForCmd('--tools=agent')).toBe('--tools=agent');
    expect(quoteForCmd('')).toBe('""');
    expect(quoteForCmd('a"b c')).toBe('"a\\"b c"');
  });
});

#!/usr/bin/env node
import { program } from 'commander';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { loadConfig, writeConfig, getConfigPath, getProviderConfig } from '../src/config/index.js';
import { CommanderConfigSchema } from '../src/config/schema.js';
import { checkHealth, runAgent } from '../src/cli/agentClient.js';
import { AgentRenderer, Tui } from '../src/cli/tui.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_PATH = path.resolve(__dirname, '../package.json');
const PKG = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));

program
  .name('commander')
  .description('Commander AI Studio - CLI')
  .version(PKG.version);

program
  .command('serve')
  .description('Start the Commander AI Studio server')
  .option('-p, --port <number>', 'Port to listen on', '3280')
  .option('-h, --host <string>', 'Host to bind to', '127.0.0.1')
  .option('--no-open', 'Do not open browser')
  .option('--dev', 'Run in development mode (Vite dev server)')
  .action(async (opts) => {
    const config = loadConfig();
    const serverConfig = config.server;
    
    const port = Number(opts.port) || serverConfig.port;
    const host = opts.host || serverConfig.host;
    
    console.log(`[commander] Starting server on http://${host}:${port}`);
    
    if (opts.dev) {
      const { spawn } = await import('child_process');
      const vite = spawn('npm', ['run', 'dev'], { stdio: 'inherit', shell: true });
      vite.on('exit', (code) => process.exit(code ?? 0));
    } else {
      process.env.PORT = String(port);
      process.env.HOST = host;
      const { startServer } = await import('../server.js');
      await startServer();
    }
  });

program
  .command('build')
  .description('Build for production')
  .option('--electron', 'Build Electron app')
  .option('--pwa', 'Build PWA only')
  .action(async (opts) => {
    const { spawn } = await import('child_process');
    const args = ['run', 'build'];
    if (opts.electron) args.push('--', '--electron');
    const build = spawn('npm', args, { stdio: 'inherit', shell: true });
    build.on('exit', (code) => process.exit(code ?? 0));
  });

const configCmd = program
  .command('config')
  .description('Manage configuration');

configCmd
  .command('get')
  .description('Get a config value (dot notation)')
  .argument('<key>', 'Config key (e.g. providers.google.apiKey)')
  .option('-g, --global', 'Use global config')
  .action((key, _opts) => {
    const config = loadConfig();
    const value = key.split('.').reduce((obj: any, k: string) => obj?.[k], config);
    if (value === undefined) {
      console.error(`Key "${key}" not found`);
      process.exit(1);
    }
    console.log(JSON.stringify(value, null, 2));
  });

configCmd
  .command('set')
  .description('Set a config value (dot notation)')
  .argument('<key>', 'Config key')
  .argument('<value>', 'JSON value')
  .option('-g, --global', 'Write to global config')
  .action((key, value, opts) => {
    let parsed: any;
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = value;
    }
    const obj: any = {};
    const keys = key.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      current[keys[i]] = {};
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = parsed;
    
    const file = writeConfig(obj, opts.global ? 'global' : 'project');
    console.log(`Written to ${file}`);
  });

configCmd
  .command('list')
  .description('List all config (merged)')
  .option('-g, --global', 'Show only global')
  .option('-p, --project', 'Show only project')
  .action((_opts) => {
    const config = loadConfig();
    console.log(JSON.stringify(config, null, 2));
  });

configCmd
  .command('init')
  .description('Create a default config file')
  .option('-g, --global', 'Create global config')
  .option('-f, --force', 'Overwrite existing')
  .action((opts) => {
    const target = opts.global ? 'global' : 'project';
    const existingPath = target === 'global' 
      ? path.join(process.env.HOME || process.env.USERPROFILE || '', '.config', 'commander', 'config.json')
      : path.join(process.cwd(), 'commander.json');
    
    if (fs.existsSync(existingPath) && !opts.force) {
      console.error(`Config already exists at ${existingPath}. Use --force to overwrite.`);
      process.exit(1);
    }
    
    const defaultConfig = CommanderConfigSchema.parse({});
    fs.writeFileSync(existingPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    console.log(`Created ${target} config at ${existingPath}`);
  });

program
  .command('doctor')
  .description('Check environment and config health')
  .action(async () => {
    console.log('[commander] Doctor check\n');
    
    // Node version
    console.log(`Node: ${process.version}`);
    
    // Config
    try {
      loadConfig();
      console.log('✓ Config valid');
      console.log(`  Project config: ${getConfigPath() || 'none'}`);
      console.log(`  Global config: ${fs.existsSync(path.join(process.env.HOME || '', '.config', 'commander', 'config.json')) ? 'found' : 'none'}`);
    } catch (e) {
      console.error('✗ Config invalid:', e instanceof Error ? e.message : e);
      process.exit(1);
    }
    
    // Providers
    const providers = getProviderConfig();
    const configured = Object.entries(providers).filter(([, v]) => v && Object.keys(v).length > 0);
    console.log(`\nProviders configured: ${configured.length > 0 ? configured.map(([k]) => k).join(', ') : 'none (using localStorage/env)'}`);
    
    // Ollama
    if (providers.ollama?.host) {
      try {
        const res = await fetch(`${providers.ollama.host}/api/tags`, { signal: AbortSignal.timeout(2000) });
        console.log(`  Ollama: ${res.ok ? 'reachable' : 'unreachable'} at ${providers.ollama.host}`);
      } catch {
        console.log(`  Ollama: unreachable at ${providers.ollama.host}`);
      }
    }
    
    // Disk space
    try {
      const { spawnSync } = await import('child_process');
      const df = spawnSync('df', ['-h', '.'], { encoding: 'utf-8' });
      console.log(`\nDisk:\n${df.stdout.trim()}`);
    } catch {}
    
    console.log('\nAll checks passed.');
  });

const sessionCmd = program
  .command('session')
  .description('Session management');

sessionCmd
  .command('list')
  .description('List saved sessions')
  .action(() => {
    const sessionsDir = path.join(process.cwd(), '.commander', 'sessions');
    if (!fs.existsSync(sessionsDir)) {
      console.log('No sessions found');
      return;
    }
    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const content = fs.readFileSync(path.join(sessionsDir, f), 'utf-8');
      const session = JSON.parse(content);
      console.log(`${f}: ${session.title || 'untitled'} (${session.messages?.length || 0} msgs)`);
    }
  });

sessionCmd
  .command('export')
  .description('Export a session to file')
  .argument('<sessionId>', 'Session file name')
  .argument('<output>', 'Output file path')
  .action((sessionId, output) => {
    const sessionsDir = path.join(process.cwd(), '.commander', 'sessions');
    const src = path.join(sessionsDir, sessionId);
    if (!fs.existsSync(src)) {
      console.error(`Session ${sessionId} not found`);
      process.exit(1);
    }
    fs.copyFileSync(src, output);
    console.log(`Exported to ${output}`);
  });

const mcpCmd = program
  .command('mcp')
  .description('MCP server management');

mcpCmd
  .command('list')
  .description('List configured MCP servers')
  .action(() => {
    const config = loadConfig();
    const servers = config.tools?.mcp?.servers || {};
    if (Object.keys(servers).length === 0) {
      console.log('No MCP servers configured');
      return;
    }
    for (const [name, srv] of Object.entries(servers)) {
      console.log(`${name}: ${srv.command} ${srv.args.join(' ')}`);
    }
  });

mcpCmd
  .command('add')
  .description('Add an MCP server')
  .argument('<name>', 'Server name')
  .argument('<command>', 'Command to run')
  .argument('[args...]', 'Arguments')
  .option('-g, --global', 'Add to global config')
  .allowUnknownOption(true)
  .action((name, command, args, opts) => {
    const obj: any = { tools: { mcp: { enabled: true, servers: { [name]: { command, args } } } } };
    writeConfig(obj, opts.global ? 'global' : 'project');
    console.log(`Added MCP server "${name}"`);
  });

mcpCmd
  .command('remove')
  .description('Remove an MCP server')
  .argument('<name>', 'Server name')
  .option('-g, --global', 'Remove from global config')
  .action((name, opts) => {
    const config = loadConfig();
    const servers = { ...config.tools?.mcp?.servers };
    delete servers[name];
    writeConfig({ tools: { mcp: { enabled: true, servers } } }, opts.global ? 'global' : 'project');
    console.log(`Removed MCP server "${name}"`);
  });

program
  .command('agent')
  .description('Run the agent headless against the embedded server')
  .argument('<task>', 'Task description')
  .option('-m, --model <string>', 'Model to use')
  .option('-p, --provider <string>', 'Provider hint (informativo)')
  .option('-s, --server <url>', 'Commander server URL', process.env.COMMANDER_SERVER || 'http://127.0.0.1:3280')
  .option('--max-steps <number>', 'Max steps', '25')
  .option('--no-stream', 'Desactivar streaming de tokens (por defecto: activado)')
  .option('--json', 'Emitir eventos como NDJSON (para integraciones como la extensión VS Code)')
  .option('--no-approval', 'Disable approval prompts (no aplica en headless)')
  .action(async (task, opts) => {
    const serverUrl = String(opts.server);
    const health = await checkHealth(serverUrl);
    if (!health.ok) {
      console.error(`[commander] Servidor no disponible en ${serverUrl} (${health.detail || 'sin detalle'}).`);
      console.error('[commander] Arráncalo con: npm run dev   (o: commander serve)');
      process.exit(1);
    }

    const model = String(opts.model || 'gemini-2.5-flash');
    const maxSteps = Math.max(1, Number(opts.maxSteps) || 25);
    const stream = opts.stream !== false;

    // Modo máquina: NDJSON de eventos, sin TUI (lo consume la extensión VS Code).
    if (opts.json) {
      try {
        const result = await runAgent({
          serverUrl,
          task,
          cwd: process.cwd(),
          model,
          maxSteps,
          stream,
          onEvent: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
        });
        process.stdout.write(
          `${JSON.stringify({ type: 'done', answer: result.answer, steps: result.steps })}\n`
        );
        if (!result.answer) process.exit(1);
      } catch (e) {
        process.stdout.write(
          `${JSON.stringify({ type: 'error', text: e instanceof Error ? e.message : String(e) })}\n`
        );
        process.exit(1);
      }
      return;
    }

    const renderer = new AgentRenderer({
      task,
      model,
      maxSteps,
      serverUrl,
      tui: new Tui({ interactive: Boolean(process.stdout.isTTY) }),
    });

    let result: { answer: string; steps: number };
    try {
      result = await runAgent({
        serverUrl,
        task,
        cwd: process.cwd(),
        model,
        maxSteps,
        stream,
        onEvent: (event) => renderer.handle(event),
      });
    } catch (e) {
      renderer.handle({ type: 'error', text: e instanceof Error ? e.message : String(e) });
      renderer.finish('', 0);
      process.exit(1);
    }

    renderer.finish(result.answer, result.steps);
    if (!result.answer) process.exit(1);
  });

program
  .command('completion')
  .description('Generate shell completion')
  .argument('<shell>', 'Shell (bash|zsh|fish|powershell)')
  .action((shell) => {
    if (!['bash', 'zsh', 'fish', 'powershell'].includes(shell)) {
      console.error('Supported shells: bash, zsh, fish, powershell');
      process.exit(1);
    }
    // Use Commander's built-in completion (v13+)
    // This requires the user to have a shell that supports it
    console.error('Completion generation requires Commander.js v13+. Use manual setup for now.');
    process.exit(1);
  });

const skillsCmd = program
  .command('skills')
  .description('Manage local skills');

skillsCmd
  .command('import')
  .description('Import Markdown skills from an external directory into skills/commands')
  .argument('<dir>', 'Source directory containing skill Markdown files')
  .option('-o, --overwrite', 'Overwrite existing skill files')
  .action((sourceDir: string, opts: { overwrite?: boolean }) => {
    const src = path.resolve(process.cwd(), sourceDir);
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
      console.error(`Source directory not found: ${src}`);
      process.exit(1);
    }
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const next = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(next));
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(next);
      }
      return out;
    };

    const root = path.join(process.cwd(), 'skills', 'commands');
    fs.mkdirSync(root, { recursive: true });

    let imported = 0;
    for (const file of walk(src)) {
      const dest = path.join(root, path.basename(file));
      if (fs.existsSync(dest) && !opts.overwrite) {
        console.log(`skip: ${path.basename(file)} already exists`);
        continue;
      }
      fs.copyFileSync(file, dest);
      imported += 1;
      console.log(`imported: ${path.basename(file)}`);
    }
    console.log(`Imported ${imported} skill(s) under ${root}`);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
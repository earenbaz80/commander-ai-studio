#!/usr/bin/env node
import { program } from 'commander';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { loadConfig, writeConfig, getConfigPath, getProviderConfig } from '../src/config/index.js';
import { CommanderConfigSchema } from '../src/config/schema.js';
import { checkHealth, consumeSessionStream, forkServerSession, loadServerSession, respondApproval, runAgent } from '../src/cli/agentClient.js';
import { encodeEvent, makeEventV2, type QuestionV2, type SessionStateV2 } from '../src/agent/sessionTypes.js';
import { canPromptApprovals, AgentRenderer, promptApprovalDecision, promptQuestionAnswer, Tui } from '../src/cli/tui.js';
import { ApprovalQueue } from '../src/cli/approvals.js';
import { GEMINI_DEFAULT_MODEL } from '../src/config/geminiModels.js';

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
  .option('--resume <id>', 'Continuar una sesión persistida en el servidor')
  .option('--fork <id>', 'Bifurcar una sesión persistida en una sesión nueva')
  .option('--no-approval', 'Disable approval prompts (no aplica en headless)')
  .action(async (task, opts) => {
    const serverUrl = String(opts.server);
    const health = await checkHealth(serverUrl);
    if (!health.ok) {
      // `process.exitCode` deja que Node vacíe el pipe al salir; `process.exit`
      // dentro del callback de `write` aborta en Windows (libuv).
      process.exitCode = 1;
      process.stderr.write(
        `[commander] Servidor no disponible en ${serverUrl} (${health.detail || 'sin detalle'}).\n` +
          '[commander] Arráncalo con: npm run dev   (o: commander serve)\n'
      );
      return;
    }

    if (opts.resume && opts.fork) {
      const text = 'Usa --resume o --fork, no ambos a la vez.';
      process.exitCode = 1;
      if (opts.json) {
        process.stdout.write(`${encodeEvent(makeEventV2('cli', 1, { type: 'error', text }))}\n`);
      } else {
        process.stderr.write(`[commander] ${text}\n`);
      }
      return;
    }

    // La sesión se resuelve antes de crear la TUI para que el encabezado use
    // el modelo persistido cuando no se pasa --model.
    let resumeFrom: SessionStateV2 | undefined;
    try {
      if (opts.resume) resumeFrom = await loadServerSession(serverUrl, String(opts.resume));
      else if (opts.fork) resumeFrom = await forkServerSession(serverUrl, String(opts.fork));
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      process.exitCode = 1;
      if (opts.json) {
        process.stdout.write(`${encodeEvent(makeEventV2('cli', 1, { type: 'error', text }))}\n`);
      } else {
        process.stderr.write(`[commander] ${text}\n`);
      }
      return;
    }

    const model = String(opts.model || resumeFrom?.model || GEMINI_DEFAULT_MODEL);
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
          resumeFrom,
          goal: resumeFrom?.goal,
          persistSession: !resumeFrom,
          // Un único serializador para --json (F1-01): el mismo `encodeEvent`
          // que usan el SSE y la TUI, con sobre v2 y `seq` por sesión.
          onEvent: (event) => process.stdout.write(`${encodeEvent(event)}\n`),
        });
        // `process.exitCode` deja que Node vacíe stdout al salir; llamar a
        // `process.exit` desde el callback de `write` aborta en Windows.
        const done = makeEventV2(result.sessionId, result.seq + 1, {
          type: 'done',
          answer: result.answer,
          steps: result.steps,
        });
        process.stdout.write(`${encodeEvent(done)}\n`);
        process.exitCode = result.answer ? 0 : 1;
      } catch (e) {
        const error = makeEventV2('cli', 1, {
          type: 'error',
          text: e instanceof Error ? e.message : String(e),
        });
        process.stdout.write(`${encodeEvent(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    const tui = new Tui({ interactive: Boolean(process.stdout.isTTY) });
    const renderer = new AgentRenderer({
      task,
      model,
      maxSteps,
      serverUrl,
      tui,
    });
    // Con una terminal real respondemos en el cliente; con pipes o `--json` el
    // bucle recibe la pregunta como evento y la cancela sin bloquearse.
    const askUser = canPromptApprovals()
      ? (question: QuestionV2) => promptQuestionAnswer(question, { tui })
      : undefined;

    let result: { answer: string; steps: number };
    try {
      result = await runAgent({
        serverUrl,
        task,
        cwd: process.cwd(),
        model,
        maxSteps,
        stream,
        resumeFrom,
        goal: resumeFrom?.goal,
        persistSession: !resumeFrom,
        askUser,
        onEvent: (event) => renderer.handle(event),
      });
    } catch (e) {
      renderer.handle(
        makeEventV2('cli', 1, {
          type: 'error',
          text: e instanceof Error ? e.message : String(e),
        })
      );
      renderer.finish('', 0);
      process.exit(1);
    }

    renderer.finish(result.answer, result.steps);
    if (!result.answer) process.exit(1);
  });

program
  .command('attach')
  .description('Adjuntarse al stream de una sesión lanzada desde el escritorio')
  .argument('<sessionId>', 'Id de la sesión (visible en el escritorio)')
  .option('-s, --server <url>', 'Commander server URL', process.env.COMMANDER_SERVER || 'http://127.0.0.1:3280')
  .option('--json', 'Emitir los eventos del stream como NDJSON')
  .option('--after <seq>', 'Cursor inicial (seq)', '0')
  .action(async (sessionId, opts) => {
    const serverUrl = String(opts.server);
    const id = String(sessionId || '').trim();
    const json = Boolean(opts.json);
    const after = Number(opts.after);
    const fail = (text: string): void => {
      process.exitCode = 1;
      if (json) {
        process.stdout.write(
          `${encodeEvent(makeEventV2(id || 'cli', 1, { type: 'error', text }))}\n`
        );
      } else {
        process.stderr.write(`[commander] ${text}\n`);
      }
    };

    if (!id) return fail('sessionId requerido');
    if (!Number.isSafeInteger(after) || after < 0) {
      return fail('--after debe ser un entero >= 0');
    }

    const health = await checkHealth(serverUrl);
    if (!health.ok) {
      return fail(
        `Servidor no disponible en ${serverUrl} (${health.detail || 'sin detalle'}).\n` +
          '[commander] Arráncalo con: npm run dev   (o: commander serve)'
      );
    }

    let initial: SessionStateV2;
    try {
      // A diferencia de `--resume`, adjuntarse a una corrida del escritorio
      // requiere leer una sesión que está en ejecución.
      initial = await loadServerSession(serverUrl, id, { allowRunning: true });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }

    const controller = new AbortController();
    let interrupted = false;
    const onInterrupt = () => {
      interrupted = true;
      controller.abort();
    };
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onInterrupt);

    const tui = new Tui({ interactive: Boolean(process.stdout.isTTY) });
    const renderer = json
      ? null
      : new AgentRenderer({
          task: initial.goal,
          model: initial.model || GEMINI_DEFAULT_MODEL,
          maxSteps: 0,
          serverUrl,
          attach: true,
          sessionId: id,
          tui,
        });
    let answer = initial.answer || '';
    let steps = initial.steps.length;

    // Aprobaciones interactivas (F1-04): sólo con terminal real y sin --json.
    // Con pipes decide el escritorio, que era el comportamiento anterior.
    const promptCtrl = new AbortController();
    const offered = new Set<string>();
    const approvals = !json && canPromptApprovals()
      ? new ApprovalQueue(
          async (approval) => {
            const decision = await promptApprovalDecision(approval, {
              tui,
              signal: promptCtrl.signal,
              onInterrupt: () => {
                interrupted = true;
                controller.abort();
              },
            });
            if (!decision) {
              // Esc: la decisión sigue pendiente en el servidor.
              if (!promptCtrl.signal.aborted) {
                tui.line(tui.gray(`  aprobación ${approval.id} pendiente; decídela desde el escritorio`));
              }
              return null;
            }
            const sent = await respondApproval(serverUrl, id, approval.id, decision);
            if (!sent.ok) {
              tui.line(
                `${tui.red('✗')} ${tui.gray(`aprobación ${approval.id}: ${sent.error || `HTTP ${sent.status}`}`)}`
              );
            }
            return decision;
          },
          (error) => {
            const text = error instanceof Error ? error.message : String(error);
            tui.line(`${tui.red('✗')} ${tui.gray(text)}`);
          }
        )
      : null;

    const offerApproval = (approval: SessionStateV2['pendingApproval']): void => {
      if (!approvals || !approval || offered.has(approval.id)) return;
      offered.add(approval.id);
      approvals.push(approval);
    };
    // Al adjuntarse puede haber una esperando desde antes del stream.
    offerApproval(initial.pendingApproval);

    try {
      const stream = await consumeSessionStream({
        serverUrl,
        sessionId: id,
        after,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'answer') answer = event.text;
          if (event.type === 'done') {
            answer = event.answer;
            steps = event.steps;
          }
          if (event.type === 'approval_request') offerApproval(event.approval);
          if (json) {
            process.stdout.write(`${encodeEvent(event)}\n`);
            return;
          }
          // El menú interactivo ya muestra la petición; evita el renglón duplicado.
          if (event.type === 'approval_request' && approvals) return;
          renderer?.handle(event);
        },
        onResync: (state) => {
          answer = state.answer || answer;
          steps = state.steps.length;
          offerApproval(state.pendingApproval);
          if (!json) renderer?.renderState(state);
        },
      });

      // El `gone` no trae el estado: se relee para cerrar con la respuesta y el
      // número de pasos autoritativos, no con lo que alcanzó a ver el cliente.
      try {
        const finalState = await loadServerSession(serverUrl, id, { allowRunning: true });
        answer = finalState.answer || answer;
        steps = finalState.steps.length;
      } catch { /* la corrida ya terminó; queda lo que vimos */ }

      if (json) {
        const done = makeEventV2(id, stream.lastSeq + 1, {
          type: 'done',
          answer,
          steps,
        });
        process.stdout.write(`${encodeEvent(done)}\n`);
      } else {
        renderer?.finish(answer, steps);
      }
      process.exitCode = stream.gone === 'completed' ? 0 : 1;
    } catch (e) {
      if (interrupted) {
        process.exitCode = 130;
        return;
      }
      fail(e instanceof Error ? e.message : String(e));
    } finally {
      // Si el stream termina, ninguna pregunta pendiente debe colgar el proceso.
      approvals?.close();
      promptCtrl.abort();
      process.removeListener('SIGINT', onInterrupt);
      process.removeListener('SIGTERM', onInterrupt);
    }
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
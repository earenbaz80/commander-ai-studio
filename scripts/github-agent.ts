/**
 * Agente de GitHub Actions.
 *
 * No duplica el bucle del agente: arranca el servidor embebido, espera
 * `/api/health` y ejecuta `commander agent --json` contra él. El CLI y las tools
 * son exactamente los mismos que usa una persona en local; este script sólo
 * traduce el evento de GitHub, aísla los permisos y publica el resultado.
 *
 * Modos:
 *   • `/commander <tarea>`        → plan (sólo lectura), comenta la respuesta.
 *   • `/commander --write <tarea>` → build, commitea y abre un PR (sólo issues).
 *
 * Nunca pasa `GITHUB_TOKEN`/`GH_TOKEN` al servidor: el agente no debe poder
 * comentar ni tocar la API de GitHub por su cuenta. Los comentarios y el PR los
 * crea este proceso después de terminar.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  agentBranchName,
  buildAgentTask,
  extractAgentResult,
  isTrustedAssociation,
  parseCommanderCommand,
  renderAgentComment,
  renderPullRequestBody,
  type AgentMode,
  type AgentRunResult,
  type CommanderCommand,
  type GithubAgentContext,
} from '../src/github/agentCommand.js';
import { GEMINI_DEFAULT_MODEL } from '../src/config/geminiModels.js';

const ROOT = process.cwd();
const HEALTH_TIMEOUT_MS = 120_000;
const AGENT_TIMEOUT_MS = Math.max(60_000, Number(process.env.COMMANDER_AGENT_TIMEOUT_MS) || 15 * 60_000);
const MODEL = process.env.COMMANDER_MODEL?.trim() || GEMINI_DEFAULT_MODEL;

interface GithubEvent {
  issue?: {
    number?: number;
    title?: string;
    body?: string | null;
    html_url?: string;
    user?: { login?: string };
    pull_request?: unknown;
  };
  comment?: {
    body?: string;
    author_association?: string;
    user?: { login?: string; type?: string };
  };
  repository?: { full_name?: string; default_branch?: string };
  inputs?: { task?: string; issue_number?: string; write?: boolean | string };
}

interface RunningServer {
  child: ChildProcess;
  baseUrl: string;
  logs: () => string;
}

interface AgentProcessResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

function readEvent(): GithubEvent {
  const file = process.env.GITHUB_EVENT_PATH;
  if (!file) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as GithubEvent;
  } catch {
    return {};
  }
}

function tail(text: string, max = 4_000): string {
  const clean = text.trim();
  return clean.length > max ? `…${clean.slice(-max)}` : clean;
}

function redact(text: string): string {
  let out = text;
  const secrets = [
    process.env.GEMINI_API_KEY,
    process.env.OPENAI_API_KEY,
    process.env.ANTHROPIC_API_KEY,
    process.env.OPENROUTER_API_KEY,
    process.env.XAI_API_KEY,
    process.env.CUSTOM_API_KEY,
    process.env.GH_TOKEN,
    process.env.GITHUB_TOKEN,
  ].filter((value): value is string => Boolean(value && value.length >= 8));
  for (const secret of secrets) out = out.split(secret).join('[redacted]');
  return out;
}

function configurePermissions(mode: AgentMode): void {
  const dir = path.join(ROOT, '.commander');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'permissions.json'),
    JSON.stringify({ mode, allowedTools: null, deniedTools: [], files: { read: [], write: [] } }, null, 2),
    'utf8'
  );
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => {
        if (port > 0) resolve(port);
        else reject(new Error('no se pudo reservar un puerto libre'));
      });
    });
  });
}

function startServer(port: number, runId: string): RunningServer {
  const temp = path.join(os.tmpdir(), `commander-github-${runId.replace(/[^a-zA-Z0-9_-]/g, '')}`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    COMMANDER_DB_PATH: `${temp}.db`,
    COMMANDER_PUBLISH_DIR: `${temp}-publish`,
  };
  // El agente no recibe el token de GitHub: comenta el workflow, no el modelo.
  delete env.GITHUB_TOKEN;
  delete env.GH_TOKEN;

  let log = '';
  const append = (chunk: Buffer) => {
    log = `${log}${chunk.toString()}`.slice(-30_000);
  };
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  child.once('exit', (code, signal) => {
    log += `\n[server salió: code=${code} signal=${signal}]\n`;
  });

  return { child, baseUrl: `http://127.0.0.1:${port}`, logs: () => log };
}

async function waitForHealth(server: RunningServer): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`el servidor terminó antes de responder\n${tail(server.logs())}`);
    }
    try {
      const res = await fetch(`${server.baseUrl}/api/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (res.ok) return;
    } catch {
      /* todavía compilando o escuchando */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`el servidor no respondió en ${HEALTH_TIMEOUT_MS / 1000}s\n${tail(server.logs())}`);
}

async function stopServer(server: RunningServer): Promise<void> {
  if (server.child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try { server.child.kill('SIGKILL'); } catch { /* ya murió */ }
      resolve();
    }, 5_000);
    server.child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try { server.child.kill('SIGTERM'); } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

function runAgentProcess(task: string, serverUrl: string): Promise<AgentProcessResult> {
  const maxSteps = String(Math.max(1, Number(process.env.COMMANDER_MAX_STEPS) || 30));
  const args = [
    '--import', 'tsx',
    'bin/commander.ts', 'agent', task,
    '--json',
    '--server', serverUrl,
    '--max-steps', maxSteps,
  ];
  if (MODEL) args.push('--model', MODEL);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const env: NodeJS.ProcessEnv = { ...process.env };
    // El CLI sólo habla con el servidor local; no necesita el token de GitHub.
    delete env.GITHUB_TOKEN;
    delete env.GH_TOKEN;
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch { /* ya terminó */ }
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ya terminó */ }
      }, 5_000).unref();
    }, AGENT_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString()}`.slice(-8_000_000);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-30_000);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });
  });
}

function gh(args: string[]): string {
  return execFileSync('gh', args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function pullRequestDiff(number: number): string {
  if (!number) return '';
  try {
    return gh(['pr', 'diff', String(number)]).slice(0, 20_000);
  } catch {
    return '';
  }
}

function tempFile(name: string, content: string): string {
  const dir = process.env.RUNNER_TEMP || os.tmpdir();
  const file = path.join(dir, `commander-${name}-${process.pid}.md`);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

function commentOn(number: number, isPull: boolean, body: string): void {
  gh([isPull ? 'pr' : 'issue', 'comment', String(number), '--body-file', tempFile('comment', body)]);
}

function appendSummary(body: string): void {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) fs.appendFileSync(summary, `${body}\n`, 'utf8');
  else console.log(body);
}

function firstLine(text: string, max: number): string {
  const line = text.split('\n').map((part) => part.trim()).find(Boolean) || 'cambios';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function pushBranch(branch: string): void {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('falta GH_TOKEN para empujar la rama');
  // El token viaja por el entorno, no como argumento del proceso. El checkout
  // usa persist-credentials:false, así que el agente no puede reutilizarlo.
  git([
    '-c',
    'credential.helper=!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f',
    'push', 'origin', `HEAD:${branch}`,
  ]);
}

function commitAndOpenPullRequest(input: {
  task: string;
  answer: string;
  issueNumber?: number;
  runId: string;
  runUrl: string;
  base: string;
}): string {
  if (!git(['status', '--porcelain'])) return '';

  const branch = agentBranchName(input.issueNumber, input.runId);
  const title = `Commander: ${firstLine(input.task, 68)}`;
  git(['checkout', '-B', branch]);
  git(['add', '-A']);
  git([
    '-c', 'user.name=github-actions[bot]',
    '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'commit', '-m', title,
  ]);
  pushBranch(branch);

  const body = renderPullRequestBody({
    task: input.task,
    answer: input.answer,
    issueNumber: input.issueNumber,
    runUrl: input.runUrl,
  });
  return gh([
    'pr', 'create',
    '--base', input.base,
    '--head', branch,
    '--title', title,
    '--body-file', tempFile('pr', body),
  ]);
}

function issueContextFrom(number: number): { title: string; body: string; author: string; url: string; isPull: boolean } | null {
  for (const kind of ['pr', 'issue'] as const) {
    try {
      const data = JSON.parse(gh([kind, 'view', String(number), '--json', 'title,body,author,url'])) as {
        title?: string;
        body?: string;
        author?: { login?: string };
        url?: string;
      };
      return {
        title: data.title || '',
        body: data.body || '',
        author: data.author?.login || '',
        url: data.url || '',
        isPull: kind === 'pr',
      };
    } catch {
      /* el número puede ser un issue o un PR: se prueba la otra vista */
    }
  }
  return null;
}

async function main(): Promise<void> {
  const event = readEvent();
  const eventName = process.env.GITHUB_EVENT_NAME || '';
  const repository = process.env.GITHUB_REPOSITORY || event.repository?.full_name || '';
  const runId = process.env.GITHUB_RUN_ID || String(Date.now());
  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const runUrl = `${serverUrl}/${repository}/actions/runs/${runId}`;
  const base = event.repository?.default_branch || process.env.GITHUB_BASE_REF || 'main';

  let command: CommanderCommand | null = null;
  let issueNumber = Number(event.issue?.number || process.env.INPUT_ISSUE_NUMBER || 0);
  let isPull = Boolean(event.issue?.pull_request);
  let issueTitle = event.issue?.title || '';
  let issueBody = event.issue?.body || '';
  let issueAuthor = event.issue?.user?.login || '';
  let issueUrl = event.issue?.html_url || '';

  if (eventName === 'issue_comment') {
    if (!isTrustedAssociation(event.comment?.author_association)) {
      console.log('Comentario ignorado: el autor no es owner, miembro ni colaborador.');
      return;
    }
    command = parseCommanderCommand(event.comment?.body);
    if (!command) {
      console.log('Comentario ignorado: no contiene /commander <tarea>.');
      return;
    }
  } else {
    const task = (process.env.INPUT_TASK || event.inputs?.task || '').trim();
    const write = process.env.INPUT_WRITE === 'true' || event.inputs?.write === true || event.inputs?.write === 'true';
    command = task ? { task, write } : null;
    if (!command) {
      console.log('Workflow dispatch sin tarea.');
      return;
    }
    if (issueNumber && !issueTitle) {
      const loaded = issueContextFrom(issueNumber);
      if (loaded) {
        issueTitle = loaded.title;
        issueBody = loaded.body;
        issueAuthor = loaded.author;
        issueUrl = loaded.url;
        isPull = loaded.isPull;
      }
    }
  }

  if (!repository) throw new Error('no se pudo determinar GITHUB_REPOSITORY');
  if (issueNumber && isPull && command.write) {
    commentOn(issueNumber, true, 'El modo `--write` no está disponible en comentarios de pull requests: el checkout es de sólo lectura para forks y no se puede actualizar la rama de forma segura. Ejecuta el workflow con `write=true` sobre un issue.');
    return;
  }

  const mode: AgentMode = command.write ? 'build' : 'plan';
  const context: GithubAgentContext = {
    repository,
    kind: isPull ? 'pull_request' : 'issue',
    number: issueNumber,
    title: issueTitle,
    body: issueBody,
    author: issueAuthor,
    url: issueUrl,
  };
  const task = buildAgentTask(command, context, {
    runUrl,
    diff: isPull ? pullRequestDiff(issueNumber) : '',
  });

  configurePermissions(mode);

  let server: RunningServer | null = null;
  let result: AgentRunResult = { answer: '', steps: 0, tools: 0, errors: [] };
  let failure = '';
  try {
    const port = await findFreePort();
    server = startServer(port, runId);
    await waitForHealth(server);
    const ran = await runAgentProcess(task, server.baseUrl);
    result = extractAgentResult(ran.stdout);
    if (!result.answer) {
      const reason = result.errors.at(-1) || tail(ran.stderr) || tail(server.logs());
      failure = ran.timedOut
        ? `El agente superó el tiempo límite de ${AGENT_TIMEOUT_MS / 60_000} minutos.`
        : `El agente terminó sin respuesta final${reason ? `:\n\n${reason}` : '.'}`;
    }
  } catch (error) {
    failure = `No se pudo ejecutar el agente: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    if (server) await stopServer(server);
  }

  let pullRequestUrl = '';
  if (!failure && command.write) {
    try {
      pullRequestUrl = commitAndOpenPullRequest({
        task: command.task,
        answer: result.answer,
        issueNumber: issueNumber || undefined,
        runId,
        runUrl,
        base,
      });
    } catch (error) {
      failure = `El agente terminó, pero no se pudo abrir el PR: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const comment = redact(renderAgentComment({
    result,
    mode,
    model: MODEL,
    runUrl,
    pullRequestUrl: pullRequestUrl || undefined,
    failure: failure || undefined,
  }));

  if (issueNumber) commentOn(issueNumber, isPull, comment);
  else appendSummary(comment);

  if (failure) {
    console.error(redact(failure));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.stack || error.message : String(error)));
  process.exitCode = 1;
});

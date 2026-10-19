import * as vscode from 'vscode';
import { spawn, type ChildProcess } from 'child_process';

/**
 * Panel de chat (webview) de la extensión VS Code.
 *
 * La extensión es un cliente fino: al enviar una tarea lanza el CLI headless en
 * modo máquina (`commander agent "<tarea>" --json`), que emite NDJSON de
 * eventos, y los reenvía al webview para pintarlos como conversación. Así el
 * bucle del agente vive en un único sitio (el CLI/servidor).
 */

/** Evento NDJSON emitido por `commander agent --json`. */
interface CliAgentEvent {
  type: 'status' | 'chunk' | 'thought' | 'tool_call' | 'tool_result' | 'answer' | 'error' | 'done';
  text?: string;
  tool?: string;
  input?: unknown;
  ok?: boolean;
  summary?: string;
  answer?: string;
  steps?: number;
}

function serverUrl(): string {
  return (
    vscode.workspace.getConfiguration('commander').get<string>('serverUrl') ||
    'http://127.0.0.1:3280'
  );
}

function cliCommand(): string {
  return (
    vscode.workspace.getConfiguration('commander').get<string>('cliCommand') || 'npx commander'
  );
}

function workspaceCwd(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

export class CommanderChatPanel {
  public static current: CommanderChatPanel | undefined;
  public static readonly viewType = 'commander.chat';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private child: ChildProcess | undefined;

  static createOrShow(context: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (CommanderChatPanel.current) {
      CommanderChatPanel.current.panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      CommanderChatPanel.viewType,
      'Commander AI Studio — Chat',
      column,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    CommanderChatPanel.current = new CommanderChatPanel(panel, context);
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.panel.webview.html = this.render(this.panel.webview);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg), null, this.disposables);
    context.subscriptions.push(this);
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private onMessage(msg: { type?: string; task?: string } | undefined): void {
    switch (msg?.type) {
      case 'ready':
        this.post({ type: 'config', serverUrl: serverUrl(), cwd: workspaceCwd() });
        break;
      case 'submit':
        if (msg.task) void this.run(msg.task);
        break;
      case 'cancel':
        this.killChild();
        this.post({ type: 'busy', value: false });
        break;
    }
  }

  private killChild(): void {
    if (this.child && !this.child.killed) this.child.kill();
    this.child = undefined;
  }

  private async run(task: string): Promise<void> {
    if (this.child) {
      this.post({ type: 'event', event: { type: 'error', text: 'Ya hay una tarea en curso.' } });
      return;
    }
    this.post({ type: 'busy', value: true });

    const command = `${cliCommand()} agent ${JSON.stringify(task)} --json`;
    const child = spawn(command, {
      cwd: workspaceCwd(),
      env: { ...process.env },
      shell: true,
    });
    this.child = child;

    let buffer = '';
    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const event = JSON.parse(trimmed) as CliAgentEvent;
        this.post({ type: 'event', event });
      } catch {
        // Salida no-JSON (avisos del CLI, logs): la mostramos como nota.
        this.post({ type: 'event', event: { type: 'thought', text: trimmed } });
      }
    };

    child.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    });
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) this.post({ type: 'event', event: { type: 'error', text } });
    });
    child.on('close', () => {
      if (buffer.trim()) handleLine(buffer);
      buffer = '';
      this.child = undefined;
      this.post({ type: 'busy', value: false });
    });
    child.on('error', (err) => {
      this.post({ type: 'event', event: { type: 'error', text: err.message } });
      this.child = undefined;
      this.post({ type: 'busy', value: false });
    });
  }

  private dispose(): void {
    CommanderChatPanel.current = undefined;
    this.killChild();
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }

  private render(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const csp = [
      `default-src 'none'`,
      `style-src ${this.panel.webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    // Nota: el JS del webview evita plantillas `${}` para no chocar con este
    // template literal de TypeScript (usa concatenación).
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Commander AI Studio</title>
  <style>
    :root {
      --blue:#000080; --cyan:#00ffff; --yellow:#ffff55; --green:#7dff9e; --red:#ff5555;
    }
    * { box-sizing: border-box; }
    body {
      margin:0; padding:0; height:100vh; display:flex; flex-direction:column;
      background:#00060f; color:#9fe8ff;
      font-family: ui-monospace, Consolas, 'Courier New', monospace; font-size:12px;
    }
    header {
      display:flex; align-items:center; gap:8px; padding:6px 10px;
      background:var(--blue); color:#fff; border-bottom:2px solid var(--cyan);
    }
    header .dot { width:10px; height:10px; background:var(--cyan); }
    header .meta { color:var(--cyan); font-size:10px; margin-left:auto; }
    #log { flex:1; overflow-y:auto; padding:8px 10px; white-space:pre-wrap; word-break:break-word; }
    .msg { margin:6px 0; }
    .role { font-weight:bold; }
    .user .role { color:var(--yellow); }
    .assistant .role { color:var(--cyan); }
    .tool { color:var(--cyan); padding-left:12px; }
    .result { padding-left:24px; }
    .result.ok { color:var(--green); }
    .result.err { color:var(--red); }
    .err { color:var(--red); }
    .status { color:#6fb7d6; font-style:italic; padding-left:12px; }
    .note { color:#6fb7d6; padding-left:24px; font-style:italic; }
    footer { border-top:2px solid #004466; padding:8px 10px; display:flex; gap:8px; background:#000812; }
    textarea {
      flex:1; resize:none; height:54px; padding:6px;
      background:#00060f; color:#e6f7ff; border:1px solid #005577;
      font-family:inherit; font-size:12px;
    }
    button {
      background:var(--blue); color:#fff; border:1px solid var(--cyan);
      padding:0 12px; cursor:pointer; font-family:inherit; font-size:12px;
    }
    button:disabled { opacity:.45; cursor:not-allowed; }
    button.cancel { border-color:var(--red); color:var(--red); background:transparent; }
  </style>
</head>
<body>
  <header>
    <span class="dot"></span>
    <strong>COMMANDER AI STUDIO</strong>
    <span class="meta" id="meta"></span>
  </header>
  <div id="log"></div>
  <footer>
    <textarea id="input" placeholder="Describe la tarea… (Ctrl+Enter para enviar)"></textarea>
    <button id="send">Enviar</button>
    <button id="cancel" class="cancel" disabled>Cancelar</button>
  </footer>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const log = document.getElementById('log');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const cancelBtn = document.getElementById('cancel');
    const meta = document.getElementById('meta');

    let assistantBody = null;
    let assistantText = '';

    function scroll() { log.scrollTop = log.scrollHeight; }

    function appendLine(className, text) {
      const el = document.createElement('div');
      el.className = 'msg ' + className;
      el.textContent = text;
      log.appendChild(el);
      scroll();
      return el;
    }

    function addMessage(role, text) {
      const el = document.createElement('div');
      el.className = 'msg ' + role;
      const roleEl = document.createElement('span');
      roleEl.className = 'role';
      roleEl.textContent = role === 'user' ? 'TÚ › ' : 'COMMANDER › ';
      const body = document.createElement('span');
      body.textContent = text;
      el.appendChild(roleEl);
      el.appendChild(body);
      log.appendChild(el);
      scroll();
      return body;
    }

    function ensureAssistant() {
      if (!assistantBody) {
        assistantBody = addMessage('assistant', '');
        assistantText = '';
      }
      return assistantBody;
    }

    function finalizeAssistant() {
      assistantBody = null;
      assistantText = '';
    }

    function setBusy(busy) {
      sendBtn.disabled = busy;
      cancelBtn.disabled = !busy;
      input.disabled = busy;
    }

    function handleEvent(ev) {
      if (!ev || !ev.type) return;
      switch (ev.type) {
        case 'status':
          appendLine('status', '· ' + (ev.text || ''));
          break;
        case 'chunk':
          assistantText += ev.text || '';
          ensureAssistant().textContent = assistantText;
          scroll();
          break;
        case 'thought':
          if (!assistantText) appendLine('note', ev.text);
          break;
        case 'tool_call':
          if (assistantBody) { assistantBody = null; assistantText = ''; }
          appendLine('tool', '→ ' + ev.tool + ' ' + (ev.input ? JSON.stringify(ev.input) : ''));
          break;
        case 'tool_result':
          appendLine('result ' + (ev.ok ? 'ok' : 'err'), (ev.ok ? '✓ ' : '✗ ') + ev.summary);
          break;
        case 'answer':
          if (assistantBody && assistantText.trim()) { assistantBody = null; assistantText = ''; }
          else { addMessage('assistant', ev.text || ''); }
          break;
        case 'error':
          assistantBody = null; assistantText = '';
          appendLine('err', '✗ ' + ev.text);
          break;
        case 'done':
          assistantBody = null; assistantText = '';
          if (typeof ev.steps === 'number') {
            appendLine('note', '— Listo (' + ev.steps + ' paso/s) —');
          }
          break;
      }
    }

    function submit() {
      const task = input.value.trim();
      if (!task) return;
      addMessage('user', task);
      vscode.postMessage({ type: 'submit', task: task });
      input.value = '';
      input.focus();
    }

    sendBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', function () { vscode.postMessage({ type: 'cancel' }); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
    });

    window.addEventListener('message', function (e) {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === 'event') { handleEvent(msg.event); }
      else if (msg.type === 'busy') {
        sendBtn.disabled = !!msg.value;
        cancelBtn.disabled = !msg.value;
        input.disabled = !!msg.value;
      }
      else if (msg.type === 'config') {
        meta.textContent = msg.serverUrl + '  ·  ' + msg.cwd;
      }
    });

    vscode.postMessage({ type: 'ready' });
    input.focus();
  </script>
</body>
</html>`;
  }
}

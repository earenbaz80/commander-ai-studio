import * as vscode from 'vscode';
import * as path from 'path';
import { serverUrl, workspaceCwd } from './server';
import { AgentSession, type SessionEvent, type SessionState } from './session';

/**
 * Panel de chat de la extensión.
 *
 * Las tareas corren en una sesión **del servidor** (`POST
 * /api/agent/sessions` con `run: true`), se siguen por SSE y las aprobaciones
 * se resuelven por HTTP: un solo bucle y un solo motor de permisos, los del
 * escritorio. El webview sólo pinta eventos y decide.
 */

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

function command(): string {
  return 'Commander AI Studio — Chat';
}

export class CommanderChatPanel {
  public static current: CommanderChatPanel | undefined;
  public static readonly viewType = 'commander.chat';

  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly session: AgentSession;

  private running = false;
  private pendingPath: string | undefined;

  static createOrShow(context: vscode.ExtensionContext): CommanderChatPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (CommanderChatPanel.current) {
      CommanderChatPanel.current.panel.reveal(column);
      return CommanderChatPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      CommanderChatPanel.viewType,
      command(),
      column,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    CommanderChatPanel.current = new CommanderChatPanel(panel, context);
    return CommanderChatPanel.current;
  }

  /** Abre (o reutiliza) el panel y arranca una tarea de las de F4A. */
  static runTask(context: vscode.ExtensionContext, task: string): void {
    CommanderChatPanel.createOrShow(context).startTask(task);
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.context = context;
    this.panel.webview.html = this.render(this.panel.webview);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg), null, this.disposables);

    this.session = new AgentSession(serverUrl(), {
      onEvent: (event) => this.onEvent(event),
      onResync: (state) => this.onResync(state),
      onGone: (reason) => this.onGone(reason),
      onError: (message) => this.post({ type: 'stream.error', message }),
    });

    context.subscriptions.push(this);
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private onMessage(msg: { type?: string; task?: string; approvalId?: string; decision?: 'allow' | 'deny' } | undefined): void {
    switch (msg?.type) {
      case 'ready':
        this.post({ type: 'config', serverUrl: serverUrl(), cwd: workspaceCwd() });
        if (this.session.sessionId) this.post({ type: 'session', id: this.session.sessionId });
        break;
      case 'submit':
        if (msg.task) this.startTask(msg.task);
        break;
      case 'cancel':
        void this.session.cancel();
        break;
      case 'decision':
        if (msg.approvalId && msg.decision) void this.decide(msg.approvalId, msg.decision);
        break;
    }
  }

  private startTask(task: string): void {
    this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.One);
    this.post({ type: 'user', text: task });
    if (this.running) {
      this.post({ type: 'event', event: { type: 'error', text: 'Ya hay una tarea en curso.' } });
      return;
    }
    this.running = true;
    this.post({ type: 'busy', value: true });
    void this.run(task);
  }

  private async run(task: string): Promise<void> {
    try {
      if (this.session.sessionId) {
        await this.session.message(task);
        return;
      }
      const model = vscode.workspace.getConfiguration('commander').get<string>('model') ?? '';
      const id = await this.session.create(task, { cwd: workspaceCwd(), model });
      this.post({ type: 'session', id });
    } catch (error) {
      this.running = false;
      this.post({ type: 'busy', value: false });
      const message = error instanceof Error ? error.message : String(error);
      this.post({ type: 'event', event: { type: 'error', text: message } });
    }
  }

  private async decide(approvalId: string, decision: 'allow' | 'deny'): Promise<void> {
    const error = await this.session.decide(approvalId, decision);
    if (error) {
      this.post({ type: 'event', event: { type: 'error', text: error } });
      return;
    }
    this.post({ type: 'approval.answered', approvalId, decision });
  }

  private onEvent(event: SessionEvent): void {
    if (event.type === 'approval_request' && event.approval) {
      this.pendingPath = event.approval.input?.path;
      this.running = true;
      this.post({ type: 'busy', value: true });
    }
    if (event.type === 'approval_result') {
      if (event.decision === 'allow' && this.pendingPath) void this.reveal(this.pendingPath);
      this.pendingPath = undefined;
    }
    if (event.type === 'done' || event.type === 'error') {
      this.running = false;
      this.post({ type: 'busy', value: false });
    }
    this.post({ type: 'event', event });
  }

  private onResync(state: SessionState): void {
    this.running = state.status === 'running';
    this.post({ type: 'busy', value: this.running });
    this.post({ type: 'resync', state });
    if (state.pendingApproval) this.pendingPath = state.pendingApproval.input?.path;
  }

  private onGone(reason: string): void {
    this.running = false;
    this.post({ type: 'busy', value: false });
    this.post({ type: 'note', text: `sesión terminada (${reason})` });
  }

  /** Abre el archivo tocado para que se vea el cambio aplicado por el servidor. */
  private async reveal(file: string): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;
    const uri = path.isAbsolute(file) ? vscode.Uri.file(file) : vscode.Uri.joinPath(folder.uri, file);
    try {
      await vscode.window.showTextDocument(uri, { preview: false });
    } catch {
      // El archivo puede haberse borrado o quedar fuera del workspace: el
      // resultado de la tool ya se ve en el panel.
    }
  }

  dispose(): void {
    CommanderChatPanel.current = undefined;
    this.session.dispose();
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

    // El JS del webview evita plantillas `${}` para no chocar con este
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
    .approval { border:1px solid var(--yellow); background:#0a0a00; margin:8px 0; padding:8px; }
    .approval-head { color:var(--yellow); font-weight:bold; margin-bottom:4px; }
    .approval pre {
      max-height:260px; overflow:auto; background:#000; border:1px solid #334455;
      padding:6px; margin:6px 0; white-space:pre;
    }
    .approval .dline { white-space:pre; }
    .approval .add { color:var(--green); }
    .approval .del { color:#ff9d9d; }
    .approval .hunk { color:var(--cyan); }
    .approval-actions { display:flex; gap:8px; align-items:center; }
    .approval-actions .state { color:#6fb7d6; font-style:italic; }
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
    button.deny { border-color:var(--red); color:var(--red); background:transparent; }
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
    const approvalCards = {};

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

    function setBusy(busy) {
      sendBtn.disabled = busy;
      cancelBtn.disabled = !busy;
      input.disabled = busy;
    }

    function renderDiff(pre, diff) {
      if (!diff) {
        pre.textContent = '(sin diff: la tool no escribe un archivo)';
        return;
      }
      const lines = String(diff).split('\\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const row = document.createElement('div');
        row.className = 'dline' + (
          line.indexOf('+') === 0 ? ' add' :
          line.indexOf('-') === 0 ? ' del' :
          line.indexOf('@@') === 0 ? ' hunk' : ''
        );
        row.textContent = line || ' ';
        pre.appendChild(row);
      }
    }

    function markDecision(approvalId, decision, reason) {
      const card = approvalCards[approvalId];
      if (!card) return;
      card.disabled = true;
      const buttons = card.querySelectorAll('button');
      for (let i = 0; i < buttons.length; i++) buttons[i].disabled = true;
      const state = card.querySelector('.approval-actions .state');
      if (state) {
        state.textContent = decision === 'allow'
          ? 'permitido: el servidor aplica el cambio'
          : 'denegado' + (reason ? ' (' + reason + ')' : '');
      }
    }

    function renderApproval(approval) {
      if (!approval || !approval.id) return;
      if (approvalCards[approval.id]) return;
      const card = document.createElement('div');
      card.className = 'approval';

      const head = document.createElement('div');
      head.className = 'approval-head';
      const where = approval.input && approval.input.path ? ' · ' + approval.input.path : '';
      head.textContent = '⚠ Aprobación: ' + approval.tool + where;
      card.appendChild(head);

      const pre = document.createElement('pre');
      renderDiff(pre, approval.diff);
      card.appendChild(pre);

      const actions = document.createElement('div');
      actions.className = 'approval-actions';

      const allow = document.createElement('button');
      allow.textContent = 'Permitir';
      allow.addEventListener('click', function () {
        vscode.postMessage({ type: 'decision', approvalId: approval.id, decision: 'allow' });
        markDecision(approval.id, 'allow');
      });

      const deny = document.createElement('button');
      deny.className = 'deny';
      deny.textContent = 'Denegar';
      deny.addEventListener('click', function () {
        vscode.postMessage({ type: 'decision', approvalId: approval.id, decision: 'deny' });
        markDecision(approval.id, 'deny');
      });

      const state = document.createElement('span');
      state.className = 'state';

      actions.appendChild(allow);
      actions.appendChild(deny);
      actions.appendChild(state);
      card.appendChild(actions);

      approvalCards[approval.id] = card;
      log.appendChild(card);
      scroll();
    }

    function handleEvent(ev) {
      if (!ev || !ev.type) return;
      switch (ev.type) {
        case 'status':
          appendLine('status', '· ' + (ev.status || ev.text || ''));
          break;
        case 'chunk':
          assistantText += ev.text || '';
          ensureAssistant().textContent = assistantText;
          scroll();
          break;
        case 'thought':
          if (!assistantText) appendLine('note', ev.content || ev.text || '');
          break;
        case 'tool_call':
          if (assistantBody) { assistantBody = null; assistantText = ''; }
          appendLine('tool', '→ ' + ev.tool + ' ' + (ev.input ? JSON.stringify(ev.input) : ''));
          break;
        case 'tool_result':
          appendLine('result ' + (ev.ok ? 'ok' : 'err'), (ev.ok ? '✓ ' : '✗ ') + (ev.summary || ''));
          break;
        case 'approval_request':
          renderApproval(ev.approval);
          break;
        case 'approval_result':
          markDecision(ev.approvalId, ev.decision, ev.reason);
          break;
        case 'answer':
          if (assistantBody && assistantText.trim()) { assistantBody = null; assistantText = ''; }
          else { addMessage('assistant', ev.text || ''); }
          break;
        case 'error':
          assistantBody = null; assistantText = '';
          appendLine('err', '✗ ' + (ev.text || ev.error || 'error'));
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
      else if (msg.type === 'user') { addMessage('user', msg.text); }
      else if (msg.type === 'busy') { setBusy(!!msg.value); }
      else if (msg.type === 'session') { meta.textContent = msg.id; }
      else if (msg.type === 'approval.answered') { markDecision(msg.approvalId, msg.decision); }
      else if (msg.type === 'stream.error') { appendLine('err', '✗ ' + msg.message); }
      else if (msg.type === 'note') { appendLine('note', '— ' + msg.text + ' —'); }
      else if (msg.type === 'resync') {
        const state = msg.state || {};
        appendLine('note', 'sesión ' + (state.id || '') + ' · ' + (state.status || ''));
        if (state.pendingApproval) renderApproval(state.pendingApproval);
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

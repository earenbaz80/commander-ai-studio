import * as vscode from 'vscode';
import * as path from 'path';
import { chatHtml } from './chatHtml';
import { serverUrl, workspaceCwd } from './server';
import { AgentSession, type SessionEvent, type SessionState } from './session';

/**
 * Panel de chat de la extensión.
 *
 * Las tareas corren en una sesión **del servidor** (`POST
 * /api/agent/sessions` con `run: true`), se siguen por SSE y las aprobaciones
 * se resuelven por HTTP: un solo bucle y un solo motor de permisos, los del
 * escritorio. Los resultados que traen `refs` abren el archivo en su línea.
 */

/** Clave del id en `workspaceState`: sobrevive a cerrar el panel y al reinicio. */
const SESSION_KEY = 'commander.sessionId';

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
  private readonly context: vscode.ExtensionContext;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly session: AgentSession;
  /** Restauración del id guardado; `run` la espera antes de decidir. */
  private readonly restored: Promise<void>;

  private running = false;
  private disposed = false;
  private pendingPath: string | undefined;

  static createOrShow(context: vscode.ExtensionContext): CommanderChatPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (CommanderChatPanel.current) {
      CommanderChatPanel.current.panel.reveal(column);
      return CommanderChatPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      CommanderChatPanel.viewType,
      'Commander AI Studio — Chat',
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
    this.panel.webview.html = chatHtml(makeNonce(), this.panel.webview.cspSource);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg), null, this.disposables);

    this.session = new AgentSession(serverUrl(), {
      onEvent: (event) => this.onEvent(event),
      onResync: (state) => this.onResync(state),
      onGone: (reason) => this.onGone(reason),
      onError: (message) => this.post({ type: 'stream.error', message }),
    });

    this.restored = this.restoreSession();
    context.subscriptions.push(this);
  }

  /**
   * Reabre la sesión que quedó guardada al cerrar el panel. El servidor es el
   * dueño del estado: `attach` lo recupera y, si sigue corriendo, reengancha
   * el SSE. Si ya no existe se olvida y la próxima tarea crea otra.
   */
  private async restoreSession(): Promise<void> {
    const id = this.context.workspaceState.get<string>(SESSION_KEY);
    if (!id) return;
    try {
      await this.session.attach(id);
      this.post({ type: 'session', id });
    } catch {
      await this.context.workspaceState.update(SESSION_KEY, undefined);
      this.post({ type: 'note', text: 'la sesión anterior ya no está; la próxima tarea crea una nueva' });
    }
  }

  private post(message: unknown): void {
    if (this.disposed) return;
    void this.panel.webview.postMessage(message);
  }

  private onMessage(
    msg:
      | { type?: string; task?: string; approvalId?: string; decision?: 'allow' | 'deny' }
      | { type?: 'openLocation'; path?: string; line?: number; column?: number }
      | undefined
  ): void {
    switch (msg?.type) {
      case 'ready':
        this.post({ type: 'config', serverUrl: serverUrl(), cwd: workspaceCwd() });
        if (this.session.sessionId) this.post({ type: 'session', id: this.session.sessionId });
        break;
      case 'submit':
        if ('task' in msg && msg.task) this.startTask(msg.task);
        break;
      case 'cancel':
        void this.session.cancel();
        break;
      case 'decision':
        if ('approvalId' in msg && msg.approvalId && 'decision' in msg && msg.decision) {
          void this.decide(msg.approvalId, msg.decision);
        }
        break;
      case 'openLocation':
        if ('path' in msg && msg.path) void this.openLocation(msg.path, msg.line, msg.column);
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
      await this.restored;
      if (this.session.sessionId) {
        await this.session.message(task);
        return;
      }
      const model = vscode.workspace.getConfiguration('commander').get<string>('model') ?? '';
      const id = await this.session.create(task, { cwd: workspaceCwd(), model });
      try {
        await this.context.workspaceState.update(SESSION_KEY, id);
      } catch { /* sin almacenamiento: la sesión vive igual en el servidor */ }
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
      if (event.decision === 'allow' && this.pendingPath) void this.openLocation(this.pendingPath);
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

  /**
   * Abre el archivo en la línea/columna pedidas. Se usa tanto para el link de
   * un resultado como para mostrar el archivo que aplicó una aprobación.
   */
  private async openLocation(file: string, line?: number, column?: number): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const uri = path.isAbsolute(file)
      ? vscode.Uri.file(file)
      : folder
        ? vscode.Uri.joinPath(folder.uri, file)
        : null;
    if (!uri) return;
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document, { preview: false });
      const lastLine = Math.max(0, document.lineCount - 1);
      const targetLine = Math.min(Math.max(0, Math.trunc(Number(line) || 1) - 1), lastLine);
      const maxColumn = document.lineAt(targetLine).text.length;
      const targetColumn = Math.min(Math.max(0, Math.trunc(Number(column) || 1) - 1), maxColumn);
      const position = new vscode.Position(targetLine, targetColumn);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.post({ type: 'event', event: { type: 'error', text: `No se pudo abrir ${file}: ${message}` } });
    }
  }

  dispose(): void {
    this.disposed = true;
    CommanderChatPanel.current = undefined;
    this.session.dispose();
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }
}

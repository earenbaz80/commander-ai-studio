import * as vscode from 'vscode';
import { CommanderChatPanel } from './chatPanel';
import { clearApiKey, configureApiKey, ensureServer, serverUrl, stopServer } from './server';
import { buildTask, type EditorContext, type TaskKind } from './tasks';

/**
 * Extensión de VS Code para Commander AI Studio (F4A).
 *
 * La extensión es un cliente fino: no reimplementa el agente ni los permisos.
 *   • Las tareas (leer/editar/revisar) abren el panel de chat, que crea una
 *     sesión en el servidor y la sigue por SSE. El diff de una aprobación se
 *     ve en el webview y se decide ahí mismo.
 *   • El servidor embebido se arranca desde el `cli/` que viaja en el VSIX y
 *     se reutiliza si ya responde.
 *
 * El CLI y el servidor son los mismos del escritorio: una sola implementación
 * del bucle y del motor de permisos (criterio F4A-5).
 */

let extensionContext: vscode.ExtensionContext | undefined;

function activeContext(): EditorContext {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return {};
  const selection = editor.selection;
  const ctx: EditorContext = { file: vscode.workspace.asRelativePath(editor.document.uri, false) };
  if (!selection.isEmpty) {
    // VS Code es 0-based; el agente y el operador hablan en 1-based.
    ctx.startLine = selection.start.line + 1;
    ctx.endLine = selection.end.line + 1;
  }
  return ctx;
}

async function launchTask(task: string): Promise<void> {
  const context = extensionContext!;
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Commander: preparando el servidor…' },
      () => ensureServer(context)
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Commander: ${message}`);
    return;
  }
  CommanderChatPanel.runTask(context, task);
}

async function runPreset(kind: TaskKind): Promise<void> {
  const editorContext = activeContext();
  let instruction = '';

  if (kind === 'edit') {
    const value = await vscode.window.showInputBox({
      prompt: '¿Qué cambio querés en el archivo?',
      placeHolder: 'p. ej. valida el correo antes de guardar',
      ignoreFocusOut: true,
    });
    if (!value?.trim()) return;
    instruction = value;
  }

  if (kind === 'read' && !editorContext.file) {
    void vscode.window.showWarningMessage('Commander: abrí un archivo para leerlo.');
    return;
  }

  await launchTask(buildTask(kind, instruction, editorContext));
}

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  context.subscriptions.push({ dispose: stopServer });

  context.subscriptions.push(
    vscode.commands.registerCommand('commander.openChat', async () => {
      try {
        await ensureServer(context);
        CommanderChatPanel.createOrShow(context);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Commander: ${message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('commander.task.read', () => runPreset('read'))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('commander.task.edit', () => runPreset('edit'))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('commander.task.review', () => runPreset('review'))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('commander.openStudio', async () => {
      const url = serverUrl();
      try {
        await ensureServer(context);
        await vscode.commands.executeCommand('simpleBrowser.show', url);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Commander: ${message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('commander.runAgent', async () => {
      const task = await vscode.window.showInputBox({
        prompt: '¿Qué debe hacer el agente?',
        placeHolder: 'p. ej. añade tests para utils/lspProblems',
        ignoreFocusOut: true,
      });
      if (!task) return;
      await launchTask(task);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('commander.setApiKey', () => configureApiKey(context))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('commander.clearApiKey', () => clearApiKey(context))
  );
}

export function deactivate(): void {
  stopServer();
}

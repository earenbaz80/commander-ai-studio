import * as vscode from 'vscode';
import { CommanderChatPanel } from './chatPanel';

/**
 * Extensión de VS Code para Commander AI Studio (scaffold).
 *
 * Filosofía: la extensión es un cliente fino. No reimplementa el agente:
 *   • `commander.openStudio` abre la web del studio en el Simple Browser.
 *   • `commander.openChat` abre un webview de chat que lanza el CLI headless
 *     (`commander agent "<tarea>" --json`) y pinta sus eventos NDJSON.
 *   • `commander.runAgent` delega en el CLI dentro de una terminal.
 * Así la lógica del agente vive en un único sitio.
 *
 * Requisitos: el servidor debe estar corriendo (`npm run dev` o `commander serve`).
 */

const DEFAULT_URL = 'http://127.0.0.1:3280';

function serverUrl(): string {
  return (
    vscode.workspace.getConfiguration('commander').get<string>('serverUrl') || DEFAULT_URL
  );
}

function cliCommand(): string {
  return (
    vscode.workspace.getConfiguration('commander').get<string>('cliCommand') || 'npx commander'
  );
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('commander.openChat', () => {
      CommanderChatPanel.createOrShow(context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('commander.openStudio', async () => {
      const url = serverUrl();
      try {
        await vscode.commands.executeCommand('simpleBrowser.show', url);
      } catch {
        // `simpleBrowser` es built-in, pero por si acaso caemos a abrir externo.
        await vscode.env.openExternal(vscode.Uri.parse(url));
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

      const terminal =
        vscode.window.terminals.find((t) => t.name === 'Commander Agent') ??
        vscode.window.createTerminal('Commander Agent');
      terminal.show();
      // JSON.stringify → comillas seguras para el argumento.
      terminal.sendText(`${cliCommand()} agent ${JSON.stringify(task)}`);
    })
  );
}

export function deactivate(): void {
  // Nada que limpiar: VS Code se encarga de las suscripciones registradas.
}

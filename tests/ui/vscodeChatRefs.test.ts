import { beforeEach, describe, expect, it } from 'vitest';
import { chatScript } from '../../vscode-extension/src/chatHtml';

/**
 * F4A-3: el script real del webview convierte `refs` de un `tool_result` en
 * botones; el click pide `openLocation` con archivo y línea. Se evalúa el
 * script dentro de jsdom con un `acquireVsCodeApi` de prueba.
 */
let posted: Array<Record<string, unknown>> = [];

function mount(): void {
  document.body.innerHTML =
    '<div id="log"></div><textarea id="input"></textarea>' +
    '<button id="send"></button><button id="cancel"></button><span id="meta"></span>';
  posted = [];
  (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
    postMessage: (message: Record<string, unknown>) => posted.push(message),
  });
  // IIFE: el script declara consts de nivel superior y se monta más de una vez.
  window.eval('(function(){' + chatScript + '})()');
}

function send(data: unknown): void {
  window.dispatchEvent(new window.MessageEvent('message', { data }));
}

describe('webview: resultados navegables', () => {
  beforeEach(mount);

  it('pinta un botón por ref y el click pide abrir archivo y línea', () => {
    send({
      type: 'event',
      event: {
        type: 'tool_result',
        tool: 'fs.grep',
        ok: true,
        summary: '2 coincidencias',
        refs: [{ path: 'src/a.ts', line: 12, column: 3, text: 'hola' }],
      },
    });

    const chips = document.querySelectorAll('.ref');
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('src/a.ts:12');
    expect(chips[0].textContent).toContain('hola');

    (chips[0] as HTMLButtonElement).click();
    expect(posted).toContainEqual({ type: 'openLocation', path: 'src/a.ts', line: 12, column: 3 });
  });

  it('la cabecera muestra el id de sesión que envía el panel', () => {
    send({ type: 'session', id: 'sess_b64936f2' });
    expect(document.getElementById('meta')?.textContent).toBe('sess_b64936f2');
  });

  it('un resultado sin refs no pinta enlaces', () => {
    send({
      type: 'event',
      event: { type: 'tool_result', tool: 'fs.write', ok: true, summary: '{"ok":true}' },
    });
    expect(document.querySelectorAll('.ref')).toHaveLength(0);
  });

  it('el diff de una aprobación se pinta línea por línea', () => {
    send({
      type: 'event',
      event: {
        type: 'approval_request',
        approval: {
          id: 'apr_1',
          tool: 'fs.edit',
          input: { path: 'nota.txt' },
          diff: '--- a/nota.txt\n+++ b/nota.txt\n@@ -1 +1 @@\n-hola\n+adios',
        },
      },
    });
    expect(document.querySelectorAll('.approval .dline')).toHaveLength(5);
  });
});

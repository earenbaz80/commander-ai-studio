/**
 * Proveedor OpenAI-compatible local para los escenarios de la baseline.
 *
 * T6, T9 y T10 necesitan el camino real de sesiones del servidor, pero una
 * corrida de CI no puede depender de un modelo externo. Este stub recibe el
 * prompt que arma `AgentSession` y devuelve el siguiente paso de un guion: texto
 * final o tool_calls. No toca red externa ni necesita claves reales.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ScriptedToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export type ScriptedStep =
  | { text: string }
  | { tools: ScriptedToolCall[] };

export interface ScriptedProvider {
  baseUrl: string;
  requests: () => number;
  close: () => Promise<void>;
}

function toolCallsFor(step: ScriptedStep): ScriptedToolCall[] {
  return 'tools' in step ? step.tools : [];
}

/** Arranca un `/v1/chat/completions` local que responde con `respond`. */
export async function startScriptedProvider(
  respond: (prompt: string, request: number) => ScriptedStep,
  opts: { onRequest?: (prompt: string, request: number) => void } = {}
): Promise<ScriptedProvider> {
  let requests = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      requests += 1;
      let prompt = '';
      try {
        const body = JSON.parse(raw || '{}');
        // `/api/custom/generate` reenvía Chat Completions al proveedor: el
        // objetivo y el historial llegan en `messages`, no en `prompt`.
        const messages = Array.isArray(body.messages) ? body.messages : [];
        prompt = messages
          .map((message: any) =>
            typeof message?.content === 'string'
              ? message.content
              : Array.isArray(message?.content)
                ? message.content.map((part: any) => String(part?.text ?? '')).join('\n')
                : ''
          )
          .filter(Boolean)
          .join('\n\n') || String(body.prompt ?? body.contents ?? '');
      } catch {
        prompt = '';
      }
      opts.onRequest?.(prompt, requests);
      const step = respond(prompt, requests);
      const calls = toolCallsFor(step);
      const message: Record<string, unknown> = {
        role: 'assistant',
        content: calls.length > 0 ? '' : (step as { text?: string }).text ?? 'Listo.',
      };
      if (calls.length > 0) {
        message.tool_calls = calls.map((call, index) => ({
          id: `call_${requests}_${index}`,
          type: 'function',
          function: {
            name: call.tool.replace(/\./g, '_'),
            arguments: JSON.stringify(call.args),
          },
        }));
      }
      const body = JSON.stringify({
        id: `chatcmpl-eval-${requests}`,
        object: 'chat.completion',
        choices: [{
          index: 0,
          message,
          finish_reason: calls.length > 0 ? 'tool_calls' : 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
      });
      res.end(body);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests: () => requests,
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

import type { Request, Response } from 'express';
import { getProviderSecret } from './src/config/index';

export async function handleAnthropicGenerate(req: Request, res: Response) {
  try {
    const {
      prompt,
      contents,
      messages,
      systemInstruction = '',
      model = 'claude-3-7-sonnet-20250219',
      temperature = 0.7,
      maxTokens = 2048,
      anthropicApiKey,
      tools,
    } = req.body;

    const cookieKey = (req as any).apiKeys?.ANTHROPIC_API_KEY || '';
    const apiKey = anthropicApiKey || cookieKey || process.env.ANTHROPIC_API_KEY || getProviderSecret('anthropic', 'apiKey');
    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: 'No se encontró la ANTHROPIC_API_KEY. Por favor ingrésala en el panel de configuración.',
      });
    }

    const startTime = Date.now();

    let formattedMessages: any[] = [];
    if (Array.isArray(messages) && messages.length > 0) {
      formattedMessages = messages.map((m: any) => ({
        role: m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }));
    } else if (contents) {
      const text = typeof contents === 'string'
        ? contents
        : Array.isArray(contents)
        ? contents.map((c: any) => c.text || JSON.stringify(c)).join('\n')
        : JSON.stringify(contents);
      formattedMessages = [{ role: 'user', content: text }];
    } else {
      formattedMessages = [{ role: 'user', content: prompt || 'Hola' }];
    }

    const anthropicPayload: any = {
      model,
      max_tokens: maxTokens,
      temperature,
      messages: formattedMessages,
    };

    if (systemInstruction) {
      anthropicPayload.system = systemInstruction;
    }

    // Tool-use: reenvía tools en formato Anthropic si el caller las envía.
    if (Array.isArray(tools) && tools.length > 0) {
      anthropicPayload.tools = tools;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(anthropicPayload),
    });

    if (!response.ok) {
      const errData: any = await response.json().catch(() => ({}));
      throw new Error(errData?.error?.message || `Error de Anthropic API: HTTP ${response.status}`);
    }

    const data: any = await response.json();
    const latencyMs = Date.now() - startTime;
    const contentBlocks: any[] = Array.isArray(data.content) ? data.content : [];
    const textOutput = contentBlocks.map((c: any) => c.text || '').join('') || '';
    const toolCalls = contentBlocks
      .filter((c: any) => c?.type === 'tool_use' && c.name)
      .map((c: any) => ({ id: c.id, name: c.name, args: c.input || {} }));

    const promptTokens = data.usage?.input_tokens || Math.ceil(JSON.stringify(formattedMessages).length / 4);
    const responseTokens = data.usage?.output_tokens || Math.ceil(textOutput.length / 4);

    return res.json({
      success: true,
      text: textOutput,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      metrics: {
        promptTokens,
        responseTokens,
        totalTokens: promptTokens + responseTokens,
        latencyMs,
        costEstimate: model.includes('3-7') ? '$0.003 USD' : '$0.0015 USD',
      },
    });
  } catch (error: any) {
    console.error('Error en /api/anthropic/generate:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error al comunicarse con la API de Anthropic Claude',
    });
  }
}

export async function handleAnthropicStream(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  let sseClosed = false;
  // Mismo caso que en el stream de Gemini: `req.on('close')` se dispara al
  // consumirse el cuerpo de la petición, no al desconectarse el cliente, y dejaba
  // la respuesta truncada en el primer fragmento (o colgada si todo fallaba).
  res.on('close', () => {
    if (!res.writableEnded) sseClosed = true;
  });
  req.socket.setTimeout(5 * 60 * 1000);

  try {
    const {
      prompt,
      contents,
      messages,
      systemInstruction = '',
      model = 'claude-3-7-sonnet-20250219',
      temperature = 0.7,
      maxTokens = 2048,
      anthropicApiKey,
      tools,
    } = req.body;

    const apiKey = anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'No se encontró la ANTHROPIC_API_KEY. Por favor ingrésala en el panel de configuración.' })}\n\n`);
      res.end();
      return;
    }

    const startTime = Date.now();

    let formattedMessages: any[] = [];
    if (Array.isArray(messages) && messages.length > 0) {
      formattedMessages = messages.map((m: any) => ({
        role: m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }));
    } else if (contents) {
      const text = typeof contents === 'string'
        ? contents
        : Array.isArray(contents)
        ? contents.map((c: any) => c.text || JSON.stringify(c)).join('\n')
        : JSON.stringify(contents);
      formattedMessages = [{ role: 'user', content: text }];
    } else {
      formattedMessages = [{ role: 'user', content: prompt || 'Hola' }];
    }

    const anthropicPayload: any = {
      model,
      max_tokens: maxTokens,
      temperature,
      stream: true,
      messages: formattedMessages,
    };

    if (systemInstruction) {
      anthropicPayload.system = systemInstruction;
    }

    // Tool-use: reenvía tools en formato Anthropic si el caller las envía.
    if (Array.isArray(tools) && tools.length > 0) {
      anthropicPayload.tools = tools;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(anthropicPayload),
    });

    if (!response.ok || !response.body) {
      const errData: any = await response.json().catch(() => ({}));
      throw new Error(errData?.error?.message || `Error de Anthropic API: HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    while (true) {
      if (sseClosed) { try { await reader.cancel(); } catch { /* ignore */ } break; }
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          if (jsonStr === '[DONE]') continue;
          try {
            const event = JSON.parse(jsonStr);
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              const chunk = event.delta.text || '';
              fullText += chunk;
              res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
            } else if (event.type === 'message_delta' && event.usage) {
              outputTokens = event.usage.output_tokens || outputTokens;
            } else if (event.type === 'message_start' && event.message?.usage) {
              inputTokens = event.message.usage.input_tokens || inputTokens;
            }
          } catch (e) {
            // ignore parse error
          }
        }
      }
    }

    // El cliente se soltó a mitad: no hay a quién entregar el cierre.
    if (sseClosed) {
      try { res.end(); } catch { /* socket ya caído */ }
      return;
    }

    const latencyMs = Date.now() - startTime;
    const promptTokens = inputTokens || Math.ceil(JSON.stringify(formattedMessages).length / 4);
    const responseTokens = outputTokens || Math.ceil(fullText.length / 4);

    res.write(`data: ${JSON.stringify({
      type: 'done',
      fullText,
      metrics: {
        promptTokens,
        responseTokens,
        totalTokens: promptTokens + responseTokens,
        latencyMs,
        costEstimate: model.includes('3-7') ? '$0.003 USD' : '$0.0015 USD',
      }
    })}\n\n`);

    res.end();
  } catch (error: any) {
    console.error('Error en /api/anthropic/stream:', error);
    if (sseClosed) return;
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Error en streaming de Anthropic' })}\n\n`);
    } catch { /* cliente caído */ }
    res.end();
  }
}

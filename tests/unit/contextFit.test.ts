import { describe, test, expect, vi } from 'vitest';
import {
  countProviderTokens,
  decideContextFit,
  estimateContextTokens,
  estimateMessageTokens,
  fitDraft,
  shortenMessageToFit,
} from '../../src/lib/contextFit';

const messages = [
  { role: 'user', content: 'hola' },
  { role: 'model', content: 'qué tal' },
];

const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchStub = (body: unknown, status = 200) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init || {} });
    return response(body, status);
  }) as unknown as typeof fetch;
  return { impl, calls };
};

describe('contextFit', () => {
  test('la estimación suma sistema, mensajes y sobrecoste por mensaje', () => {
    expect(estimateMessageTokens('abcd')).toBe(5);
    expect(
      estimateContextTokens({
        messages,
        systemInstruction: 'sistema',
        examples: [{ input: 'a', output: 'b' }],
      })
    ).toBeGreaterThan(10);
  });

  test('Google usa su endpoint countTokens y el cuerpo con el historial', async () => {
    const { impl, calls } = fetchStub({ totalTokens: 123 });
    const result = await countProviderTokens({
      provider: 'google',
      model: 'gemini-3.5-flash',
      messages,
      systemInstruction: 'sé breve',
      apiKey: 'clave',
      baseUrl: 'https://gemini.test/v1beta',
      fetchImpl: impl,
    });

    expect(result).toMatchObject({ tokens: 123, source: 'provider', tokenizer: 'gemini' });
    expect(calls[0].url).toContain('/models/gemini-3.5-flash:countTokens');
    const body = JSON.parse(String(calls[0].init.body));
    // Gemini no tiene un rol system en countTokens: la instrucción se suma al
    // primer turno de usuario y los turnos contiguos se fusionan.
    expect(body.contents).toHaveLength(2);
    expect(body.contents[0].role).toBe('user');
    expect(JSON.stringify(body.contents)).toContain('sé breve');
    expect(JSON.stringify(body.contents)).toContain('hola');
  });

  test('Anthropic usa messages/count_tokens con system separado', async () => {
    const { impl, calls } = fetchStub({ input_tokens: 77 });
    const result = await countProviderTokens({
      provider: 'anthropic',
      model: 'claude-3-7-sonnet-20250219',
      messages,
      systemInstruction: 'sistema',
      apiKey: 'sk-ant-clave',
      baseUrl: 'https://anthropic.test',
      fetchImpl: impl,
    });

    expect(result).toMatchObject({ tokens: 77, source: 'provider', tokenizer: 'anthropic' });
    expect(calls[0].url).toBe('https://anthropic.test/v1/messages/count_tokens');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.system).toBe('sistema');
    expect(body.messages[1]).toEqual({ role: 'assistant', content: 'qué tal' });
  });

  test('OpenAI usa responses/input_tokens', async () => {
    const { impl, calls } = fetchStub({ input_tokens: 55 });
    const result = await countProviderTokens({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      messages,
      apiKey: 'sk-clave',
      baseUrl: 'https://openai.test/v1',
      fetchImpl: impl,
    });

    expect(result).toMatchObject({ tokens: 55, source: 'provider', tokenizer: 'openai' });
    expect(calls[0].url).toBe('https://openai.test/v1/responses/input_tokens');
  });

  test('Strata local usa el contador Anthropic de context-fit', async () => {
    const { impl, calls } = fetchStub({ input_tokens: 42 });
    const result = await countProviderTokens({
      provider: 'strata-local',
      model: 'strata-local/qwen',
      messages,
      apiKey: 'local',
      baseUrl: 'http://127.0.0.1:8080/v1',
      fetchImpl: impl,
    });

    expect(result).toMatchObject({ tokens: 42, source: 'provider', tokenizer: 'strata' });
    expect(calls[0].url).toBe('http://127.0.0.1:8080/v1/messages/count_tokens');
  });

  test('sin clave o sin endpoint cae a la estimación y no rompe el envío', async () => {
    const { impl } = fetchStub({ totalTokens: 1 });
    const noKey = await countProviderTokens({
      provider: 'google',
      model: 'gemini-3.5-flash',
      messages,
      fetchImpl: impl,
    });
    expect(noKey.source).toBe('estimate');
    expect(noKey.tokens).toBeGreaterThan(0);
    expect(noKey.error).toMatch(/API key/);

    const failed = await countProviderTokens({
      provider: 'anthropic',
      model: 'claude',
      messages,
      apiKey: 'sk-ant-x',
      baseUrl: 'https://anthropic.test',
      fetchImpl: fetchStub({ error: { message: 'sin cuota' } }, 503).impl,
    });
    expect(failed.source).toBe('estimate');
    expect(failed.error).toContain('sin cuota');
  });

  test('decide enviar, resumir/omitir historial, recortar o rechazar', () => {
    expect(
      decideContextFit({ windowTokens: 1000, systemTokens: 100, historyTokens: 700, messageTokens: 100, reservedTokens: 100 }).action
    ).toBe('send');

    expect(
      decideContextFit({ windowTokens: 1000, systemTokens: 100, historyTokens: 800, messageTokens: 100, reservedTokens: 100 }).action
    ).toBe('drop-history');

    const shorten = decideContextFit({
      windowTokens: 1000,
      systemTokens: 100,
      historyTokens: 0,
      messageTokens: 950,
      reservedTokens: 100,
    });
    expect(shorten.action).toBe('shorten');
    expect(shorten.availableForMessage).toBe(800);

    expect(
      decideContextFit({ windowTokens: 1000, systemTokens: 850, historyTokens: 0, messageTokens: 950, reservedTokens: 100 }).action
    ).toBe('too-large');
  });

  test('la reserva de herramientas se descuenta igual que la de salida', () => {
    const decision = decideContextFit({
      windowTokens: 1000,
      systemTokens: 100,
      historyTokens: 700,
      messageTokens: 100,
      reservedTokens: 100,
      toolTokens: 100,
    });
    expect(decision.action).toBe('drop-history');
    expect(decision.needs).toBe(1100);

    const shortened = fitDraft({
      windowTokens: 900,
      systemTokens: 100,
      historyTokens: 0,
      messageText: `CABEZA-${'z'.repeat(3000)}-COLA`,
      reservedTokens: 100,
      toolTokens: 100,
    });
    expect(shortened.action).toBe('shorten');
    expect(shortened.decision.availableForMessage).toBe(600);
  });

  test('el recorte conserva cabeza y cola y marca lo omitido', () => {
    const text = `INICIO-${'x'.repeat(5000)}-FIN`;
    const out = shortenMessageToFit(text, 300, 4);

    expect(out.changed).toBe(true);
    expect(out.text.startsWith('INICIO-')).toBe(true);
    expect(out.text.endsWith('-FIN')).toBe(true);
    expect(out.text).toContain('caracteres omitidos');
    expect(out.omittedChars).toBeGreaterThan(0);
  });

  test('fitDraft devuelve el texto recortado cuando no cabe', () => {
    const text = `CABEZA-${'z'.repeat(3000)}-COLA`;
    const result = fitDraft({
      windowTokens: 900,
      systemTokens: 100,
      historyTokens: 0,
      messageText: text,
      reservedTokens: 100,
    });

    expect(result.action).toBe('shorten');
    expect(result.text).toContain('CABEZA-');
    expect(result.text).toContain('-COLA');
    expect(result.text).toContain('caracteres omitidos');
  });

  test('un mensaje corto no se toca', () => {
    const result = fitDraft({
      windowTokens: 128000,
      systemTokens: 100,
      historyTokens: 1000,
      messageText: 'hola',
      reservedTokens: 1000,
    });
    expect(result.action).toBe('send');
    expect(result.text).toBe('hola');
    expect(result.omittedChars).toBe(0);
  });
});

import { useEffect, useMemo, useState } from 'react';
import type { AIModel, ChatMessage, ParameterConfig } from '../types/studio';
import { measureContextFromServer, type ContextMeasurement } from '../lib/contextFit';

/** Proveedores con contador real; el resto no paga una petición inútil. */
const MEASURABLE_PROVIDERS = new Set(['google', 'anthropic', 'openai', 'strata-local']);
const MEASURE_DEBOUNCE_MS = 350;

export function useContextMeasurement(opts: {
  model?: AIModel | null;
  messages: ChatMessage[];
  parameters?: ParameterConfig | null;
}): ContextMeasurement | null {
  const { model, messages, parameters } = opts;
  const [measurement, setMeasurement] = useState<ContextMeasurement | null>(null);

  const key = useMemo(
    () =>
      JSON.stringify({
        provider: model?.provider || '',
        model: model?.id || '',
        system: parameters?.systemInstruction || '',
        examples: parameters?.examples || [],
        messages: messages.map((message) => [message.role, message.content]),
      }),
    [model?.provider, model?.id, messages, parameters?.systemInstruction, parameters?.examples]
  );

  useEffect(() => {
    const provider = String(model?.provider || '');
    if (!model?.id || !MEASURABLE_PROVIDERS.has(provider)) {
      setMeasurement(null);
      return;
    }

    const parsed = JSON.parse(key) as {
      system: string;
      examples: Array<{ input: string; output: string }>;
      messages: Array<[string, string]>;
    };
    if (parsed.messages.length === 0 && !parsed.system.trim()) {
      setMeasurement(null);
      return;
    }

    let dead = false;
    const timer = setTimeout(async () => {
      const result = await measureContextFromServer({
        provider,
        model: model.id,
        messages: parsed.messages.map(([role, content]) => ({ role, content })),
        systemInstruction: parsed.system,
        examples: parsed.examples,
      });
      if (!dead) setMeasurement(result);
    }, MEASURE_DEBOUNCE_MS);

    return () => {
      dead = true;
      clearTimeout(timer);
    };
  }, [key, model?.id, model?.provider]);

  return measurement;
}

/**
 * Respuesta del mini-chat de Nono con el modelo real (Gemini) y fallback.
 *
 * Lógica híbrida: si hay clave Gemini (cookie httpOnly vía /api/keys) se llama
 * a `/api/gemini/generate` con una persona de Nono; ante cualquier error o la
 * ausencia de clave devuelve `null` y el llamador usa las plantillas locales.
 */
import { getApiKey } from '../lib/apiKeys';
import type { ParameterConfig } from '../types/studio';
import type { Language } from '../i18n/translations';
import { detectCodePatterns, type CodePatternResult } from './codePatternDetector';
import { GEMINI_DEFAULT_MODEL } from '../config/geminiModels';

export interface AskNonoOptions {
  selectedModel?: string;
  selectedProvider?: string;
  parameters?: ParameterConfig;
  lang?: Language;
  /** Información del proyecto actual (para contexto semántico profundo del LLM). */
  projectInfo?: {
    path?: string;
    files?: string[];
    hasPackageJson?: boolean;
    hasTsConfig?: boolean;
    hasGit?: boolean;
    framework?: string;
    mainLanguage?: string;
    goal?: string;
    mode?: 'chat' | 'freeform' | 'agent';
  };
  /** Código actual del editor/último mensaje con bloque de código. */
  codeContext?: string;
  /** Resultado de análisis de patrones del código (roadmap #1). */
  codePatterns?: CodePatternResult | null;
}

const NONO_SYSTEM_ES =
  'Eres Nono, el asistente robótico retro-Norton integrado en Commander AI Studio. ' +
  'Responde corto (2-3 frases), con personalidad amigable y toques de humor. ' +
  'Usa emojis con moderación. Si te piden ayuda con la app, orienta brevemente ' +
  'sobre modos, el Workbench, la búsqueda, compilar o exportar.';

const NONO_SYSTEM_EN =
  'You are Nono, the retro-Norton robot assistant inside Commander AI Studio. ' +
  'Answer briefly (2-3 sentences), with friendly personality and light humor. ' +
  'Use emojis sparingly. If asked for app help, give short guidance about modes, ' +
  'the Workbench, search, compiling or exporting.';

export async function askNono(text: string, opts: AskNonoOptions = {}): Promise<string | null> {
  try {
    const apiKey = await getApiKey('GEMINI_API_KEY');
    if (!apiKey) return null;

    const params = opts.parameters;

    // ---- Contexto profundo del proyecto/código (Roadmap #4) ----
    const deepContext: string[] = [];
    if (opts.projectInfo) {
      const p = opts.projectInfo;
      deepContext.push(`Modo: ${p.mode || 'chat'}${p.goal ? ` | Objetivo: ${p.goal}` : ''}`);
      if (p.framework) deepContext.push(`Framework: ${p.framework}`);
      if (p.mainLanguage) deepContext.push(`Lenguaje: ${p.mainLanguage}`);
      if (p.hasPackageJson) deepContext.push('Proyecto tiene package.json');
      if (p.hasTsConfig) deepContext.push('Proyecto tiene tsconfig');
      if (p.hasGit) deepContext.push('Proyecto tiene git');
    }
    // Análisis de patrones (si no vienen, inferir del código)
    let patterns = opts.codePatterns ?? null;
    if (!patterns && opts.codeContext) {
      try {
        patterns = detectCodePatterns(opts.codeContext);
      } catch {
        patterns = null;
      }
    }
    if (patterns && patterns.shouldTrigger) {
      deepContext.push(`Patrones detectados: ${patterns.patterns.join(', ')} (severidad: ${patterns.severity}, complexity: ${patterns.complexity}, coverage: ${patterns.coverage}, coupling: ${patterns.coupling})`);
    }
    if (opts.codeContext && opts.codeContext.trim()) {
      deepContext.push(`Código relevante (truncado):\n\`\`\`\n${opts.codeContext.slice(0, 800)}\n\`\`\``);
    }

    let ctxBlock = '';
    if (params?.systemInstruction) ctxBlock += params.systemInstruction.slice(0, 500) + '\n';
    if (deepContext.length > 0) ctxBlock += '\n' + deepContext.join('\n');
    ctxBlock = ctxBlock.trim().slice(0, 1800);

    const systemInstruction =
      (opts.lang === 'en' ? NONO_SYSTEM_EN : NONO_SYSTEM_ES) +
      (ctxBlock ? `\n\nContexto de la app:\n${ctxBlock}` : '');

    const res = await fetch('/api/gemini/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        model: opts.selectedModel || GEMINI_DEFAULT_MODEL,
        systemInstruction,
        contents: [String(text).slice(0, 2000)],
        temperature: params?.temperature ?? 0.8,
        maxTokens: 220,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error');
      throw new Error(`HTTP ${res.status}: ${errorText}`);
    }

    const data = await res.json();
    return data?.text ?? null;
  } catch (e) {
    console.error('Error en askNono:', e);
    return null;
  }
}
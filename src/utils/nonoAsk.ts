/**
 * Respuesta del mini-chat de Nono con el modelo real.
 *
 * Antes sólo hablaba con Gemini (`/api/gemini/generate`) aunque hubiera LM
 * Studio u Ollama configurados: Nono seguía contestando plantillas. Ahora usa
 * el proveedor activo, manda un historial corto (para recordar los turnos
 * anteriores) y distingue «no hay modelo» de «el modelo falló», que es lo que
 * permite a Nono poner cara de pena en vez de fingir que todo va bien.
 */
import { isApiKeyConfigured } from '../lib/apiKeyFlags';
import type { ParameterConfig } from '../types/studio';
import type { Language } from '../i18n/translations';
import { detectCodePatterns, type CodePatternResult } from './codePatternDetector';
import { GEMINI_DEFAULT_MODEL } from '../config/geminiModels';
import { LMSTUDIO_LOAD_TIMEOUT_MS } from '../lib/lmStudio';

export interface AskNonoHistoryTurn {
  fromUser: boolean;
  text: string;
}

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
  /** Turnos anteriores de la conversación, del más viejo al más nuevo. */
  history?: AskNonoHistoryTurn[];
}

export interface AskNonoResult {
  text: string | null;
  /** Motivo cuando el proveedor estaba configurado pero no respondió. */
  error?: string;
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

/**
 * Presupuesto normal de una respuesta de Nono. 25 s cubre el arranque de los
 * proveedores locales habituales.
 */
const NONO_TIMEOUT_MS = 25_000;

/**
 * LM Studio carga el modelo antes de responder. El servidor corta esa carga en
 * LMSTUDIO_LOAD_TIMEOUT_MS; el cliente espera el doble para que la generación
 * posterior también quepa, sin cortar a los 25 s de Nono.
 */
const LMSTUDIO_TIMEOUT_MS = LMSTUDIO_LOAD_TIMEOUT_MS * 2;

/** Endpoint del servidor para cada proveedor (`google` es el id del registro). */
const PROVIDER_ENDPOINTS: Record<string, string> = {
  google: '/api/gemini/generate',
  lmstudio: '/api/lmstudio/generate',
  ollama: '/api/ollama/generate',
  anthropic: '/api/anthropic/generate',
  xai: '/api/xai/generate',
  openrouter: '/api/openrouter/generate',
  openai: '/api/openai/generate',
  nvidia: '/api/nvidia/generate',
  custom: '/api/custom/generate',
  freebuff: '/api/freebuff/generate',
};

const providerOf = (id?: string): string => {
  const raw = (id || '').toLowerCase().trim();
  if (!raw || raw === 'gemini') return 'google';
  return PROVIDER_ENDPOINTS[raw] ? raw : 'google';
};

/** Quita el prefijo `<proveedor>/` que llevan los ids del selector. */
const modelOf = (model: string | undefined, provider: string): string => {
  const value = (model || (provider === 'google' ? GEMINI_DEFAULT_MODEL : '')).trim();
  return value.replace(new RegExp(`^${provider}/`), '').replace(/^gemini\//, '');
};

/** Contexto de app + código, recortado para no comerse la ventana del modelo. */
function buildSystemInstruction(text: string | undefined, opts: AskNonoOptions, lang: Language): string {
  const params = opts.parameters;
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
    deepContext.push(
      `Patrones detectados: ${patterns.patterns.join(', ')} (severidad: ${patterns.severity}, complexity: ${patterns.complexity}, coverage: ${patterns.coverage}, coupling: ${patterns.coupling})`
    );
  }
  if (opts.codeContext && opts.codeContext.trim()) {
    deepContext.push(`Código relevante (truncado):\n\`\`\`\n${opts.codeContext.slice(0, 800)}\n\`\`\``);
  }

  let ctxBlock = '';
  if (params?.systemInstruction) ctxBlock += params.systemInstruction.slice(0, 500) + '\n';
  if (deepContext.length > 0) ctxBlock += '\n' + deepContext.join('\n');
  ctxBlock = ctxBlock.trim().slice(0, 1800);

  const persona = lang === 'en' ? NONO_SYSTEM_EN : NONO_SYSTEM_ES;
  return persona + (ctxBlock ? `\n\nContexto de la app:\n${ctxBlock}` : '') + (text ? '' : '');
}

/** Convierte los turnos previos en un transcript legible para cualquier modelo. */
function buildPrompt(text: string, opts: AskNonoOptions): string {
  const userLabel = opts.lang === 'en' ? 'User' : 'Usuario';
  const turns = (opts.history ?? [])
    .filter((turn) => turn.text.trim().length > 0)
    .slice(-8)
    .map((turn) => `${turn.fromUser ? userLabel : 'Nono'}: ${turn.text.slice(0, 600)}`);
  return turns.length > 0 ? `${turns.join('\n')}\n${userLabel}: ${text}` : text;
}

export async function askNonoDetailed(text: string, opts: AskNonoOptions = {}): Promise<AskNonoResult> {
  const lang = opts.lang ?? 'es';
  const provider = providerOf(opts.selectedProvider);
  const endpoint = PROVIDER_ENDPOINTS[provider] ?? '/api/gemini/generate';
  const timeoutMs = provider === 'lmstudio' ? LMSTUDIO_TIMEOUT_MS : NONO_TIMEOUT_MS;
  const prompt = buildPrompt(String(text), opts);
  const systemInstruction = buildSystemInstruction(text, opts, lang);

  try {
    const body: Record<string, unknown> = {
      model: modelOf(opts.selectedModel, provider),
      prompt,
      systemInstruction,
      temperature: opts.parameters?.temperature ?? 0.8,
      maxTokens: 220,
    };

    if (provider === 'google') {
      // Sin clave no es un fallo: el llamador usa sus plantillas. El valor no
      // hace falta aquí: el servidor lo lee de la cookie httpOnly.
      if (!isApiKeyConfigured('GEMINI_API_KEY')) return { text: null };
      // El historial ya va dentro del prompt, así que `contents` sigue siendo
      // una cadena (mismo contrato que usaba antes este cliente).
      body.contents = prompt;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // LM Studio puede tardar minutos en cargar el modelo antes de generar.
      signal: AbortSignal.timeout(timeoutMs),
    });

    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) return { text: null, error: `HTTP ${res.status}` };
    if (data?.success === false || data?.ok === false) {
      return { text: null, error: typeof data?.error === 'string' ? data.error : 'sin respuesta del modelo' };
    }
    const reply = typeof data?.text === 'string' ? data.text.trim() : '';
    return reply ? { text: reply } : { text: null, error: 'respuesta vacía' };
  } catch (e) {
    return { text: null, error: e instanceof Error ? e.message : 'error de red' };
  }
}

/** Compatibilidad: sólo texto, como antes. */
export async function askNono(text: string, opts: AskNonoOptions = {}): Promise<string | null> {
  return (await askNonoDetailed(text, opts)).text;
}

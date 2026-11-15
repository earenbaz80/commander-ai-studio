/**
 * Requisitos de hardware y recomendación de modelo/contexto para Strata.
 *
 * La decisión es deliberadamente conservadora: el host puede arrancar un
 * contexto mayor, pero aquí se recomienda el que deja margen para el sistema y
 * para el propio modelo. Los umbrales son los mínimos conocidos del proyecto
 * (12 GB de VRAM y 32 GB de RAM; 48 GB de RAM recomendados).
 */

export type StrataHardwareLevel = 'ok' | 'warn' | 'fail' | 'unknown';

export interface StrataHardwareCheck {
  id: 'vram' | 'ram';
  level: StrataHardwareLevel;
  actualGb?: number;
  minimumGb: number;
}

export interface StrataModelInfo {
  id: string;
  contextWindow?: number;
}

export interface StrataRecommendation {
  model?: string;
  contextTokens?: number;
}

export interface StrataAssessment {
  overall: StrataHardwareLevel;
  checks: StrataHardwareCheck[];
  recommendation: StrataRecommendation;
}

export interface StrataAssessmentInput {
  vramTotalGb?: number | null;
  ramTotalGb?: number | null;
  models?: StrataModelInfo[];
  loadedModel?: string | null;
}

const VRAM_MIN_GB = 12;
const VRAM_RECOMMENDED_GB = 16;
const RAM_MIN_GB = 32;
const RAM_RECOMMENDED_GB = 48;
const CONTEXT_TIERS = [32_768, 65_536, 131_072] as const;

function positive(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function check(
  id: StrataHardwareCheck['id'],
  value: number | undefined,
  minimumGb: number,
  recommendedGb: number
): StrataHardwareCheck {
  const level: StrataHardwareLevel =
    value === undefined
      ? 'unknown'
      : value < minimumGb
        ? 'fail'
        : value < recommendedGb
          ? 'warn'
          : 'ok';
  return {
    id,
    level,
    ...(value !== undefined ? { actualGb: value } : {}),
    minimumGb,
  };
}

function pickModel(
  models: StrataModelInfo[],
  loadedModel: string | undefined,
  highTier: boolean
): StrataModelInfo | undefined {
  const loaded = loadedModel ? models.find((model) => model.id === loadedModel) : undefined;
  // Un modelo ya cargado manda, salvo que sea el grande en un equipo que no
  // llega al mínimo de RAM recomendado.
  if (loaded && (highTier || !/qwen3\.8/i.test(loaded.id))) return loaded;
  const family = highTier ? /qwen3\.8/i : /qwen3\.6/i;
  const match = models.find((model) => family.test(model.id));
  if (match) return match;
  return highTier ? models[0] : undefined;
}

function contextFor(vramTotalGb: number, ramTotalGb: number, cap?: number): number {
  const desired = vramTotalGb >= 24 ? 131_072 : vramTotalGb >= 16 ? 65_536 : 32_768;
  const memoryCap = ramTotalGb < RAM_RECOMMENDED_GB ? 32_768 : desired;
  const limit = Math.min(memoryCap, positive(cap) || memoryCap);
  const supported = CONTEXT_TIERS.filter((tier) => tier <= limit);
  return supported.at(-1) ?? Math.min(limit, CONTEXT_TIERS[0]);
}

/**
 * Evalúa la telemetría del host y devuelve una recomendación estable para el
 * panel. Sin datos de VRAM y RAM no inventa un modelo: el panel debe pedir la
 * telemetría antes de arrancar.
 */
export function assessStrataHardware(input: StrataAssessmentInput): StrataAssessment {
  const vram = positive(input.vramTotalGb);
  const ram = positive(input.ramTotalGb);
  const checks = [
    check('vram', vram, VRAM_MIN_GB, VRAM_RECOMMENDED_GB),
    check('ram', ram, RAM_MIN_GB, RAM_RECOMMENDED_GB),
  ];

  if (checks.some((item) => item.level === 'fail')) {
    return { overall: 'fail', checks, recommendation: {} };
  }
  if (vram === undefined || ram === undefined) {
    return { overall: 'unknown', checks, recommendation: {} };
  }

  const overall: StrataHardwareLevel = checks.some((item) => item.level === 'warn') ? 'warn' : 'ok';
  const highTier = vram >= VRAM_MIN_GB && ram >= RAM_RECOMMENDED_GB;
  const model = pickModel(Array.isArray(input.models) ? input.models : [], input.loadedModel || undefined, highTier);
  const contextTokens = contextFor(vram, ram, model?.contextWindow);
  return {
    overall,
    checks,
    recommendation: {
      model: model?.id || (highTier ? 'Qwen3.8-Flash-Next' : 'Qwen3.6-35B-A3B'),
      contextTokens,
    },
  };
}

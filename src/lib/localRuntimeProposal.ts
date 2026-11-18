/**
 * Propuesta de ajustes para el runtime nativo de llama.cpp.
 *
 * Combina el perfil del GGUF (capas, expertos, ventana) con la memoria real de
 * la máquina para derivar `--n-cpu-moe`, el contexto, las capas en GPU y la
 * caché KV. Es una propuesta editable: el panel la muestra antes de arrancar y
 * el usuario puede cambiarla.
 */
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import type { GgufProfile } from './ggufProfile';
import type { LocalRuntimeTuning } from './localLlamaRuntime';
import { sanitizeLocalRuntimeTuning } from './localRuntimeSettings';

export interface LocalHardwareSnapshot {
  ramTotalGb?: number;
  vramTotalMb?: number;
  vramFreeMb?: number;
  gpuName?: string;
  gpuCount: number;
}

export interface LocalHardwareDeps {
  exec?: (file: string, args: string[]) => string;
  totalmem?: () => number;
}

export interface LocalRuntimeProposedTuning {
  context: number;
  gpuLayers: number;
  jinja: boolean;
  flashAttention: boolean;
  cpuMoeLayers?: number;
  cacheTypeK?: string;
  cacheTypeV?: string;
  tensorSplit?: string;
}

export interface LocalRuntimeProposal {
  proposed: LocalRuntimeProposedTuning;
  notes: string[];
}

/** Reserva de VRAM para buffers de cómputo y del sistema. */
const VRAM_RESERVE_RATIO = 0.15;
const VRAM_RESERVE_MB = 768;
const CONTEXT_TIERS = [8_192, 16_384, 32_768, 65_536, 131_072] as const;

const roundGb = (value: number): number => Number(value.toFixed(1));
const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
const mb = (bytes: number): number => Math.round(bytes / 1024 ** 2);

function parseNvidiaSmi(output: string): Pick<LocalHardwareSnapshot, 'vramTotalMb' | 'vramFreeMb' | 'gpuName' | 'gpuCount'> {
  let vramTotalMb = 0;
  let vramFreeMb = 0;
  let gpuCount = 0;
  let gpuName: string | undefined;
  for (const line of output.split(/\r?\n/)) {
    const parts = line.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 3) continue;
    const free = Number(parts[parts.length - 1]);
    const total = Number(parts[parts.length - 2]);
    if (!Number.isFinite(free) || !Number.isFinite(total) || total <= 0) continue;
    vramTotalMb += total;
    vramFreeMb += free;
    gpuCount += 1;
    if (!gpuName) gpuName = parts.slice(0, parts.length - 2).join(', ');
  }
  return { vramTotalMb, vramFreeMb, ...(gpuName ? { gpuName } : {}), gpuCount };
}

/**
 * Memoria de la máquina. La VRAM se pregunta a `nvidia-smi`; si no existe (o
 * falla) queda sin datos y la propuesta no inventa el reparto de expertos.
 */
export function detectLocalHardware(deps: LocalHardwareDeps = {}): LocalHardwareSnapshot {
  const exec =
    deps.exec ??
    ((file: string, args: string[]) =>
      String(
        execFileSync(file, args, {
          encoding: 'utf8',
          timeout: 2_500,
          windowsHide: true,
        })
      ));
  const totalmem = deps.totalmem ?? (() => os.totalmem());

  const hardware: LocalHardwareSnapshot = { gpuCount: 0 };
  try {
    hardware.ramTotalGb = roundGb(totalmem() / 1024 ** 3);
  } catch {
    /* sin datos de RAM: se sigue con la propuesta por defecto */
  }
  try {
    const output = exec('nvidia-smi', [
      '--query-gpu=name,memory.total,memory.free',
      '--format=csv,noheader,nounits',
    ]);
    const gpus = parseNvidiaSmi(output);
    if (gpus.gpuCount > 0) Object.assign(hardware, gpus);
  } catch {
    /* sin nvidia-smi: GPU desconocida */
  }
  return hardware;
}

/**
 * Ajustes de un arranque automático (el modelo se eligió en el selector y el
 * usuario no pasó por el panel). Lo específico del modelo —reparto MoE, caché
 * KV y split— sale de la propuesta del GGUF; los gustos guardados (jinja,
 * flash-attn) mandan. Se sanea para no pedir caché KV cuantizada con
 * flash-attn apagado ni valores fuera de rango.
 */
export function mergeProposedTuning(
  saved: LocalRuntimeTuning,
  proposed: LocalRuntimeProposedTuning
): LocalRuntimeTuning {
  const cpuMoeLayers = proposed.cpuMoeLayers ?? saved.cpuMoeLayers;
  const cacheTypeK = proposed.cacheTypeK ?? saved.cacheTypeK;
  const cacheTypeV = proposed.cacheTypeV ?? saved.cacheTypeV;
  const tensorSplit = proposed.tensorSplit ?? saved.tensorSplit;
  return sanitizeLocalRuntimeTuning({
    jinja: saved.jinja ?? proposed.jinja,
    flashAttention: saved.flashAttention ?? proposed.flashAttention,
    ...(cpuMoeLayers ? { cpuMoeLayers } : {}),
    ...(cacheTypeK ? { cacheTypeK } : {}),
    ...(cacheTypeV ? { cacheTypeV } : {}),
    ...(tensorSplit ? { tensorSplit } : {}),
  });
}

function contextFor(vramMb: number | undefined, ramTotalGb: number | undefined): number {
  const vramGb = vramMb ? vramMb / 1024 : 0;
  const desired =
    vramGb >= 24
      ? CONTEXT_TIERS[4]
      : vramGb >= 16
        ? CONTEXT_TIERS[3]
        : vramGb >= 10
          ? CONTEXT_TIERS[2]
          : vramGb >= 6
            ? CONTEXT_TIERS[1]
            : CONTEXT_TIERS[0];
  const memoryCap = ramTotalGb !== undefined && ramTotalGb < 32 ? CONTEXT_TIERS[1] : desired;
  return Math.min(desired, memoryCap);
}

/**
 * Deriva los ajustes del modelo y del hardware:
 *
 * - MoE: cada capa con expertos ocupa `expertBytes / expertLayerCount`. La VRAM
 *   útil (85 % menos 768 MB) paga primero las capas densas y después tantas
 *   capas de expertos como quepan; el resto va a RAM con `--n-cpu-moe`.
 * - Denso: si el GGUF no entra en VRAM, se reparten proporcionalmente las capas
 *   con `-ngl`.
 * - Sin VRAM detectada no se inventa el reparto: quedan los valores por defecto.
 */
export function proposeLocalRuntimeTuning(input: {
  profile: GgufProfile | null;
  hardware: LocalHardwareSnapshot;
}): LocalRuntimeProposal {
  const { profile, hardware } = input;
  const notes: string[] = [];
  const vramMb = hardware.vramFreeMb ?? hardware.vramTotalMb;
  const usableVramMb =
    vramMb && vramMb > 0
      ? Math.max(0, vramMb * (1 - VRAM_RESERVE_RATIO) - VRAM_RESERVE_MB)
      : undefined;

  let context = contextFor(vramMb, hardware.ramTotalGb);
  if (profile?.contextLength && context > profile.contextLength) {
    context = profile.contextLength;
    notes.push(`Contexto acotado a ${profile.contextLength} tokens, el máximo que declara el GGUF.`);
  }

  let gpuLayers = 99;
  let cpuMoeLayers: number | undefined;

  if (!profile) {
    notes.push('No se pudo leer la cabecera del GGUF: se mantienen los valores por defecto.');
  } else if (profile.moe && profile.expertLayerCount > 0) {
    const expertLayers = profile.expertLayerCount;
    notes.push(
      `MoE ${profile.architecture ?? ''}: ${profile.blockCount ?? expertLayers} capas, ${
        profile.expertCount ?? '?'
      } expertos${profile.expertsUsed ? ` (${profile.expertsUsed} activos)` : ''}.`.trim()
    );
    notes.push(`Expertos ${gb(profile.expertBytes)}; capas densas ${gb(profile.denseBytes)}.`);
    if (usableVramMb !== undefined) {
      gpuLayers = profile.blockCount ?? 99;
      const denseMb = mb(profile.denseBytes);
      const perLayerMb = mb(profile.expertBytes) / expertLayers;
      const gpuExpertLayers =
        perLayerMb > 0
          ? Math.max(
              0,
              Math.min(expertLayers, Math.floor(Math.max(0, usableVramMb - denseMb) / perLayerMb))
            )
          : expertLayers;
      cpuMoeLayers = Math.max(0, expertLayers - gpuExpertLayers);
      if (cpuMoeLayers > 0) {
        notes.push(
          `Con ${Math.round(vramMb!)} MB de VRAM (${Math.round(usableVramMb)} MB útiles) entran ` +
            `${gpuExpertLayers} de ${expertLayers} capas con expertos en GPU: se proponen ` +
            `${cpuMoeLayers} en RAM (--n-cpu-moe ${cpuMoeLayers}).`
        );
      } else {
        notes.push(
          `El modelo entra completo en ${Math.round(usableVramMb)} MB de VRAM: no hace falta --n-cpu-moe.`
        );
      }
    } else {
      notes.push(
        'No se detectó VRAM (sin nvidia-smi): el reparto de expertos queda a mano; los valores por defecto no lo inventan.'
      );
    }
  } else if (usableVramMb !== undefined) {
    const layers = profile.blockCount ?? 99;
    const tensorMb = mb(profile.tensorBytes);
    if (tensorMb > usableVramMb) {
      gpuLayers = Math.max(0, Math.min(layers, Math.floor(layers * (usableVramMb / tensorMb))));
      notes.push(
        `El GGUF ocupa ${gb(profile.tensorBytes)} y hay ${Math.round(usableVramMb)} MB de VRAM: ` +
          `se proponen ${gpuLayers} de ${layers} capas en GPU.`
      );
    } else {
      notes.push(`El GGUF entra en VRAM (${gb(profile.tensorBytes)}): todas las capas a GPU.`);
    }
  }

  const proposed: LocalRuntimeProposedTuning = {
    context,
    gpuLayers,
    jinja: true,
    flashAttention: true,
    ...(cpuMoeLayers && cpuMoeLayers > 0 ? { cpuMoeLayers } : {}),
  };
  if (cpuMoeLayers && cpuMoeLayers > 0) {
    proposed.cacheTypeK = 'q8_0';
    proposed.cacheTypeV = 'q8_0';
    notes.push('Caché KV en q8_0: con expertos en RAM es lo que sostiene el contexto propuesto.');
  }
  if (hardware.gpuCount > 1) {
    proposed.tensorSplit = Array.from({ length: hardware.gpuCount }, () => '1').join(',');
    notes.push(`${hardware.gpuCount} GPU detectadas: reparto tensor-split ${proposed.tensorSplit}.`);
  }
  if (hardware.ramTotalGb !== undefined && profile && profile.tensorBytes / 1024 ** 3 > hardware.ramTotalGb) {
    notes.push(
      `El GGUF ocupa ${gb(profile.tensorBytes)} y la máquina tiene ${hardware.ramTotalGb} GB de RAM: puede no entrar completa.`
    );
  }

  return { proposed, notes };
}

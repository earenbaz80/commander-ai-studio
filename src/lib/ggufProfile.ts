/**
 * Lectura de metadatos de un GGUF para proponer ajustes del runtime.
 *
 * Sólo se lee la cabecera (metadatos + descriptores de tensores), nunca los
 * pesos: interesa la arquitectura, el número de capas y de expertos, la ventana
 * que declara el modelo y cuántos bytes ocupan los expertos frente al resto.
 * Con eso Commander puede derivar `--n-cpu-moe` sin que el usuario adivine el
 * número.
 */
import fs from 'node:fs';

export const GGUF_MAGIC = 0x46554747;

export interface GgufProfile {
  architecture?: string;
  blockCount?: number;
  expertCount?: number;
  expertsUsed?: number;
  contextLength?: number;
  /** Bytes de todos los tensores, sumados con la tabla de tipos de ggml. */
  tensorBytes: number;
  /** Bytes de los tensores de expertos (`*_exps`). */
  expertBytes: number;
  /** Bytes que no pertenecen a expertos (atención, densas, embeddings). */
  denseBytes: number;
  /** Capas distintas que contienen tensores de expertos. */
  expertLayerCount: number;
  moe: boolean;
  /**
   * El GGUF declara `tokenizer.chat_template`, así que con `--jinja` el motor
   * puede aplicar la plantilla y emitir llamadas a tools.
   */
  hasChatTemplate: boolean;
}

interface TensorSpec {
  block: number;
  bytes: number;
}

/**
 * Tamaño de bloque de los tipos de ggml. Las variantes de repack (Q4_0_4_4…)
 * no cambian el total, así que se resuelven con el tipo base cuando aparece.
 */
const GGML_TYPE_SIZES: Record<number, TensorSpec> = {
  0: { block: 1, bytes: 4 }, // F32
  1: { block: 1, bytes: 2 }, // F16
  2: { block: 32, bytes: 18 }, // Q4_0
  3: { block: 32, bytes: 20 }, // Q4_1
  6: { block: 32, bytes: 22 }, // Q5_0
  7: { block: 32, bytes: 24 }, // Q5_1
  8: { block: 32, bytes: 34 }, // Q8_0
  9: { block: 32, bytes: 36 }, // Q8_1
  10: { block: 256, bytes: 84 }, // Q2_K
  11: { block: 256, bytes: 110 }, // Q3_K
  12: { block: 256, bytes: 144 }, // Q4_K
  13: { block: 256, bytes: 176 }, // Q5_K
  14: { block: 256, bytes: 210 }, // Q6_K
  15: { block: 256, bytes: 292 }, // Q8_K
  16: { block: 256, bytes: 66 }, // IQ2_XXS
  17: { block: 256, bytes: 74 }, // IQ2_XS
  18: { block: 256, bytes: 98 }, // IQ3_XXS
  19: { block: 256, bytes: 50 }, // IQ1_S
  20: { block: 32, bytes: 18 }, // IQ4_NL
  21: { block: 256, bytes: 110 }, // IQ3_S
  22: { block: 256, bytes: 82 }, // IQ2_S
  23: { block: 256, bytes: 136 }, // IQ4_XS
  24: { block: 1, bytes: 1 }, // I8
  25: { block: 1, bytes: 2 }, // I16
  26: { block: 1, bytes: 4 }, // I32
  27: { block: 1, bytes: 8 }, // I64
  28: { block: 1, bytes: 8 }, // F64
  29: { block: 256, bytes: 56 }, // IQ1_M
  30: { block: 1, bytes: 2 }, // BF16
  34: { block: 256, bytes: 54 }, // TQ1_0
  35: { block: 256, bytes: 66 }, // TQ2_0
};

/** Bytes de un tensor; un tipo desconocido se estima como fp16 (peor caso usual). */
export function ggmlTensorBytes(type: number, elements: number): number {
  if (!Number.isFinite(elements) || elements <= 0) return 0;
  const spec = GGML_TYPE_SIZES[type];
  if (!spec) return elements * 2;
  return Math.ceil(elements / spec.block) * spec.bytes;
}

const FIXED_VALUE_SIZES: Record<number, number> = {
  0: 1,
  1: 1,
  2: 2,
  3: 2,
  4: 4,
  5: 4,
  6: 4,
  7: 1,
  10: 8,
  11: 8,
  12: 8,
};

const NUMERIC_VALUE_TYPES = new Set([0, 1, 2, 3, 4, 5, 6, 10, 11, 12]);

const MAX_METADATA_BYTES = 64 * 1024 * 1024;

/** Cursor con buffer propio sobre un descriptor: los GGUF pesan GB y sólo se lee la cabecera. */
class GgufCursor {
  private buffer = Buffer.alloc(0);
  private bufferStart = 0;
  private offset = 0;

  constructor(
    private readonly fd: number,
    private readonly size: number,
    private readonly maxBytes = MAX_METADATA_BYTES
  ) {}

  private ensure(bytes: number): void {
    const end = this.offset + bytes;
    if (end <= this.bufferStart + this.buffer.length) return;
    const limit = Math.min(this.size, this.maxBytes);
    if (this.offset >= limit) throw new Error('Metadatos GGUF demasiado grandes');
    const available = limit - this.offset;
    if (available < bytes) throw new Error('GGUF truncado');
    const chunkSize = Math.min(available, Math.max(1 << 20, end - this.offset));
    const chunk = Buffer.alloc(chunkSize);
    const read = fs.readSync(this.fd, chunk, 0, chunkSize, this.offset);
    if (read < bytes) throw new Error('GGUF truncado');
    this.buffer = chunk.subarray(0, read);
    this.bufferStart = this.offset;
  }

  private at(): number {
    return this.offset - this.bufferStart;
  }

  u8(): number {
    this.ensure(1);
    const value = this.buffer.readUInt8(this.at());
    this.offset += 1;
    return value;
  }

  u16(): number {
    this.ensure(2);
    const value = this.buffer.readUInt16LE(this.at());
    this.offset += 2;
    return value;
  }

  u32(): number {
    this.ensure(4);
    const value = this.buffer.readUInt32LE(this.at());
    this.offset += 4;
    return value;
  }

  u64(): number {
    this.ensure(8);
    const value = this.buffer.readBigUInt64LE(this.at());
    this.offset += 8;
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Entero GGUF fuera de rango');
    return Number(value);
  }

  f32(): number {
    this.ensure(4);
    const value = this.buffer.readFloatLE(this.at());
    this.offset += 4;
    return value;
  }

  f64(): number {
    this.ensure(8);
    const value = this.buffer.readDoubleLE(this.at());
    this.offset += 8;
    return value;
  }

  string(): string {
    const length = this.u64();
    if (length > 16 * 1024 * 1024) throw new Error('Cadena GGUF fuera de rango');
    this.ensure(length);
    const start = this.at();
    const value = this.buffer.toString('utf8', start, start + length);
    this.offset += length;
    return value;
  }

  skip(bytes: number): void {
    if (!Number.isFinite(bytes) || bytes < 0) throw new Error('Longitud GGUF inválida');
    const limit = Math.min(this.size, this.maxBytes);
    if (this.offset + bytes > limit) throw new Error('GGUF truncado');
    this.offset += bytes;
  }
}

function readNumberValue(cursor: GgufCursor, type: number): number {
  switch (type) {
    case 0:
      return cursor.u8();
    case 1:
      cursor.u8();
      return 0;
    case 2:
      return cursor.u16();
    case 3:
      cursor.u16();
      return 0;
    case 4:
      return cursor.u32();
    case 5:
      return cursor.u32();
    case 6:
      return cursor.f32();
    case 10:
    case 11:
      return cursor.u64();
    case 12:
      return cursor.f64();
    default:
      return 0;
  }
}

function skipValue(cursor: GgufCursor, type: number): void {
  const fixed = FIXED_VALUE_SIZES[type];
  if (fixed !== undefined) {
    cursor.skip(fixed);
    return;
  }
  if (type === 8) {
    cursor.string();
    return;
  }
  if (type !== 9) throw new Error(`Tipo GGUF ${type} desconocido`);
  const itemType = cursor.u32();
  const length = cursor.u64();
  if (length > 200_000_000) throw new Error('Array GGUF fuera de rango');
  if (itemType === 8) {
    for (let index = 0; index < length; index += 1) cursor.string();
    return;
  }
  const itemSize = FIXED_VALUE_SIZES[itemType];
  if (itemSize === undefined) throw new Error(`Tipo GGUF ${itemType} desconocido`);
  cursor.skip(length * itemSize);
}

const EXPERT_TENSOR_RE = /(^|\.)(ffn_(gate|up|down)_exps|.*_exps|.*expert.*)(\.|$)/i;

function isExpertTensor(name: string): boolean {
  return EXPERT_TENSOR_RE.test(name);
}

function parseGguf(cursor: GgufCursor): GgufProfile {
  if (cursor.u32() !== GGUF_MAGIC) throw new Error('El archivo no es GGUF');
  const version = cursor.u32();
  if (version < 2) throw new Error(`Versión GGUF ${version} no compatible`);
  const tensorCount = cursor.u64();
  const kvCount = cursor.u64();
  if (kvCount > 1_000_000 || tensorCount > 1_000_000) throw new Error('Cabecera GGUF fuera de rango');

  const meta = new Map<string, string | number>();
  let hasChatTemplate = false;
  for (let index = 0; index < kvCount; index += 1) {
    const key = cursor.string();
    const type = cursor.u32();
    // La plantilla completa puede ocupar kilobytes: basta con saber si existe.
    if (key === 'tokenizer.chat_template') {
      if (type === 8) {
        hasChatTemplate = cursor.string().trim().length > 0;
      } else {
        skipValue(cursor, type);
      }
      continue;
    }
    const wanted =
      key === 'general.architecture' ||
      /\.(block_count|expert_count|expert_used_count|context_length)$/.test(key);
    if (wanted && type === 8) {
      meta.set(key, cursor.string());
      continue;
    }
    if (wanted && NUMERIC_VALUE_TYPES.has(type)) {
      meta.set(key, readNumberValue(cursor, type));
      continue;
    }
    skipValue(cursor, type);
  }

  let tensorBytes = 0;
  let expertBytes = 0;
  const expertLayers = new Set<number>();
  for (let index = 0; index < tensorCount; index += 1) {
    const name = cursor.string();
    const dimensions = cursor.u32();
    if (dimensions > 8) throw new Error('Tensor GGUF con demasiadas dimensiones');
    let elements = 1;
    for (let dim = 0; dim < dimensions; dim += 1) elements *= cursor.u64();
    const type = cursor.u32();
    cursor.u64(); // offset dentro de la sección de datos: no se necesita
    const bytes = ggmlTensorBytes(type, elements);
    tensorBytes += bytes;
    if (isExpertTensor(name)) {
      expertBytes += bytes;
      const layer = /^blk\.(\d+)\./.exec(name);
      if (layer) expertLayers.add(Number(layer[1]));
    }
  }

  const architectureValue = meta.get('general.architecture');
  const architecture = typeof architectureValue === 'string' ? architectureValue : undefined;
  const metaNumber = (suffix: string): number | undefined => {
    const value = architecture ? meta.get(`${architecture}.${suffix}`) : undefined;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
    for (const [key, candidate] of meta) {
      if (!key.endsWith(`.${suffix}`)) continue;
      if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
        return Math.round(candidate);
      }
    }
    return undefined;
  };

  const blockCount = metaNumber('block_count');
  const expertCount = metaNumber('expert_count');
  const expertsUsed = metaNumber('expert_used_count');
  const contextLength = metaNumber('context_length');
  const moe = expertBytes > 0 && (expertCount === undefined || expertCount > 1);
  const expertLayerCount = expertLayers.size || (moe ? blockCount || 0 : 0);
  const denseBytes = Math.max(0, tensorBytes - expertBytes);

  return {
    ...(architecture ? { architecture } : {}),
    ...(blockCount ? { blockCount } : {}),
    ...(expertCount ? { expertCount } : {}),
    ...(expertsUsed ? { expertsUsed } : {}),
    ...(contextLength ? { contextLength } : {}),
    tensorBytes,
    expertBytes,
    denseBytes,
    expertLayerCount,
    moe,
    hasChatTemplate,
  };
}

interface CacheEntry {
  key: string;
  profile: GgufProfile | null;
}

const profileCache = new Map<string, CacheEntry>();

/**
 * Perfil del GGUF o `null` si no se puede leer (versión vieja, archivo ajeno o
 * corrupto). Quien llama debe proponer valores por defecto en ese caso.
 */
export function readGgufProfile(filePath: string): GgufProfile | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  const key = `${stat.size}:${stat.mtimeMs}`;
  const cached = profileCache.get(filePath);
  if (cached && cached.key === key) return cached.profile;

  let profile: GgufProfile | null = null;
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    profile = parseGguf(new GgufCursor(fd, stat.size));
  } catch {
    profile = null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* descriptor ya cerrado */
      }
    }
  }

  if (profileCache.size >= 8) profileCache.clear();
  profileCache.set(filePath, { key, profile });
  return profile;
}

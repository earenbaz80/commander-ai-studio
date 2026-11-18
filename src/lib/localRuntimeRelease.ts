/**
 * Elección del asset de llama.cpp que descarga Commander.
 *
 * Sin GPU conviene la build de CPU (24 MB frente a ~200 MB del binario CUDA
 * más ~400 MB de las DLLs de cudart). Con GPU, la CUDA: si no, el runtime
 * arranca sin dispositivos y el `-ngl` de la propuesta no offloadea nada.
 */

export interface RuntimeAssetScoreOptions {
  /** `true` si `nvidia-smi` listó al menos una GPU. */
  hasGpu: boolean;
}

/**
 * Puntaje de un asset del release; gana el mayor. Los nombres siguen el patrón
 * `llama-<build>-bin-<win|ubuntu|macos>-<variante>-<arch>.zip` y las DLLs de
 * CUDA van aparte como `cudart-llama-bin-win-cuda-<version>-x64.zip`.
 */
export function scoreRuntimeAsset(name: string, { hasGpu }: RuntimeAssetScoreOptions): number {
  const asset = name.toLowerCase();
  let score = 0;
  // cudart es un complemento del binario CUDA, nunca el runtime en sí.
  if (asset.includes('cudart')) score -= 100;
  if (asset.includes('cuda')) score += hasGpu ? 80 : -80;
  // Blackwell (RTX 50xx) necesita CUDA 12.8+; los builds 12.4 no la detectan.
  if (hasGpu && asset.includes('cuda-13')) score += 15;
  if (hasGpu && asset.includes('cuda-12')) score -= 20;
  if (asset.includes('-cpu-')) score += hasGpu ? 0 : 50;
  if (asset.includes('vulkan')) score += 20;
  if (asset.includes('rocm') || asset.includes('sycl') || asset.includes('openvino')) score -= 30;
  if (asset.startsWith('llama-')) score += 10;
  return score;
}

/**
 * DLLs de CUDA que acompañan al binario elegido: misma versión de CUDA y misma
 * plataforma. Sin ellas `llama-server.exe` no arranca en un equipo que sólo
 * tiene el driver NVIDIA.
 */
export function selectCudartAsset<T extends { name: string }>(
  assets: readonly T[],
  picked: { name: string }
): T | undefined {
  if (!/cuda/i.test(picked.name)) return undefined;
  const version = /cuda-(\d+\.\d+)/i.exec(picked.name)?.[1]?.toLowerCase();
  return assets.find((asset) => {
    const name = asset.name.toLowerCase();
    if (!name.includes('cudart') || !name.includes('cuda')) return false;
    return version ? name.includes(`cuda-${version}`) : true;
  });
}

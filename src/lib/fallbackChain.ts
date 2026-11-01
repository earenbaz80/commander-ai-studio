/**
 * Operaciones del editor de la cadena de respaldo (`RightPanel`).
 *
 * Viven fuera del componente para poder probar el orden sin montar el panel:
 * el orden ES la prioridad (el primero que responde gana), así que un «subir»
 * que mueva el modelo equivocado cambia qué modelo contesta en producción.
 *
 * Devuelven listas nuevas y nunca mutan la recibida: el estado de React se
 * actualiza por comparación de referencias.
 */

/** Mueve una posición un modelo; fuera de los extremos no cambia nada. */
export function moveModel(rows: string[], index: number, delta: number): string[] {
  if (index < 0 || index >= rows.length) return rows;
  const target = index + delta;
  if (target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export interface AddModelResult {
  rows: string[];
  /** Motivo legible cuando se rechaza; `undefined` si se añadió. */
  error?: string;
}

/**
 * Añade un modelo al final.
 *
 * Se niega a duplicar porque el servidor rechaza la lista entera si repite: es
 * preferible decirlo aquí que fallar al guardar por un detalle invisible.
 */
export function addModel(rows: string[], raw: string, maxModels: number): AddModelResult {
  const id = raw.trim();
  if (!id) return { rows };
  if (id.length > 80) {
    return { rows, error: 'El identificador no puede pasar de 80 caracteres.' };
  }
  if (rows.includes(id)) {
    return { rows, error: `«${id}» ya está en la cadena.` };
  }
  if (rows.length >= maxModels) {
    return { rows, error: `La cadena admite como máximo ${maxModels} modelos.` };
  }
  return { rows: [...rows, id] };
}

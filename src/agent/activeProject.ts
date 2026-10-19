/**
 * Proyecto (root) activo para las tools del agente.
 *
 * Las tools viven en módulos sueltos y hacen fetch a /api/agent/run-tool.
 * En vez de atravesar props por toda la app, el root vigente se registra aquí
 * y `callServer` lo adjunta a cada petición como `input.root`.
 */

let activeRoot = '';

export function setActiveProjectRoot(path: string): void {
  activeRoot = path || '';
}

export function getActiveProjectRoot(): string {
  return activeRoot;
}

/** Adjunta el root activo al input de una tool (no muta el original). */
export function withActiveRoot<T extends Record<string, unknown>>(input: T): T & { root?: string } {
  return activeRoot ? { ...input, root: activeRoot } : input;
}

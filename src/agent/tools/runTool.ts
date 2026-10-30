import { withActiveRoot } from '../activeProject';

/**
 * Puente cliente → servidor para las tools que se ejecutan en el servidor.
 *
 * El orquestador corre `tool.run` en el cliente, así que una tool cuyo trabajo
 * vive en el servidor (leer un skill del disco, lanzar subagentes, formatear un
 * archivo) tiene que hacer la petición aquí. Devolver a mano un
 * `{ ok: false, error: '… se ejecuta en el servidor' }` no es «delegar»: el
 * modelo recibe un fallo que el servidor nunca dio y no puede hacer nada con él.
 *
 * El root activo viaja como `input.root` para que el servidor resuelva rutas y
 * permisos contra el proyecto abierto y no contra su propio cwd.
 */
export async function callAgentTool<I extends object>(
  toolId: string,
  input: I,
  opts: { withRoot?: boolean } = {}
): Promise<any> {
  const payload = opts.withRoot === false ? input : withActiveRoot(input as Record<string, unknown>);
  try {
    const res = await fetch('/api/agent/run-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId, input: payload }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      // El servidor manda `{ ok:false, error }` con el motivo real (permisos,
      // ruta fuera del proyecto, sesión inexistente): se reenvía tal cual.
      return { ok: false, error: body.error || `HTTP ${res.status}` };
    }
    return body;
  } catch (e: any) {
    return { ok: false, error: `No se pudo contactar al servidor: ${e?.message || String(e)}` };
  }
}

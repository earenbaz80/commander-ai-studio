/**
 * Destino provisional de las credenciales rotadas (PL3).
 *
 * Hasta que G3 elija proveedor no hay entorno de despliegue donde inyectarlas,
 * así que el valor rotado se guarda en memoria del proceso bajo el proyecto
 * dueño: es exactamente el recorte que leerá el paso de despliegue cuando
 * exista. El valor nunca se serializa en una respuesta HTTP ni se escribe en
 * logs; `status` sólo conoce los nombres de las credenciales emitidas.
 */
import type { BackendSecretSink } from './types';

const pending = new Map<string, string>();

function key(projectId: string, name: string): string {
  return `${projectId}\u0000${name}`;
}

/** Sink que el router entrega al adaptador cuando el llamador no da uno. */
export function createPendingDeploymentSink(projectId: string): BackendSecretSink {
  return {
    write(name, value) {
      pending.set(key(projectId, name), value);
    },
  };
}

/**
 * Lectura del valor pendiente. La usa el paso de despliegue (G3) para inyectar
 * la credencial en el entorno de la app; jamás se expone por HTTP.
 */
export function readPendingDeploymentSecret(
  projectId: string,
  name: string
): string | undefined {
  return pending.get(key(projectId, name));
}

/** Vacía el destino; útil en tests y al cerrar un proyecto. */
export function clearPendingDeploymentSecrets(): void {
  pending.clear();
}

/**
 * Persistencia del estado remoto.
 *
 * El adaptador recibe este almacén en vez de conocer `publisher.ts`: así el
 * contrato sigue siendo independiente del publicador local y los tests pueden
 * usar memoria sin tocar disco.
 */
import { getRemoteDeploymentState, saveRemoteDeploymentState } from '../publisher';
import type { ProjectDescriptor, RemoteDeploymentState } from './types';

export interface RemoteStateStore {
  read(project: ProjectDescriptor): Promise<RemoteDeploymentState | null>;
  write(project: ProjectDescriptor, state: RemoteDeploymentState): Promise<void>;
}

/** Guarda el bloque `remote` de `.commander/publish/<slug>/state.json`. */
export class PublisherRemoteStateStore implements RemoteStateStore {
  async read(project: ProjectDescriptor): Promise<RemoteDeploymentState | null> {
    return (await getRemoteDeploymentState(project.root)) ?? null;
  }

  async write(project: ProjectDescriptor, state: RemoteDeploymentState): Promise<void> {
    await saveRemoteDeploymentState(project.root, state);
  }
}

/** Implementación para tests y para ejecuciones sin persistencia. */
export class MemoryRemoteStateStore implements RemoteStateStore {
  private readonly states = new Map<string, RemoteDeploymentState>();

  async read(project: ProjectDescriptor): Promise<RemoteDeploymentState | null> {
    const state = this.states.get(project.id);
    return state ? clone(state) : null;
  }

  async write(project: ProjectDescriptor, state: RemoteDeploymentState): Promise<void> {
    this.states.set(project.id, clone(state));
  }
}

function clone(state: RemoteDeploymentState): RemoteDeploymentState {
  return JSON.parse(JSON.stringify(state)) as RemoteDeploymentState;
}

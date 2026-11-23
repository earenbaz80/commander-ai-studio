/**
 * Selección del adaptador de backend gestionado (PL3).
 *
 * Todavía no hay proveedor elegido —eso se decide en G3—, así que el único
 * backend disponible es el doble en memoria y sólo si se pide explícitamente
 * con `COMMANDER_BACKEND_FAKE=1`. Sin la bandera se devuelve `null`: la ruta
 * responde «deshabilitado», no se finge un backend real y no se lee ninguna
 * credencial.
 */
import { FakeBackendAdapter } from './fakeAdapter';
import type { BackendAdapter } from './types';

export const BACKEND_FAKE_FLAG = 'COMMANDER_BACKEND_FAKE';

export function createConfiguredBackendAdapter(
  env: NodeJS.ProcessEnv = process.env
): BackendAdapter | null {
  const flag = String(env[BACKEND_FAKE_FLAG] ?? '')
    .trim()
    .toLowerCase();
  if (flag !== '1' && flag !== 'true') return null;
  return new FakeBackendAdapter();
}

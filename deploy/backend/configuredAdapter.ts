/**
 * Selección del adaptador de backend gestionado (PL3).
 *
 * Hoy no hay proveedor elegido: G3 sigue sin iniciar. El único adaptador que
 * se puede encender es el doble en memoria, de modo que la suite y el arnés
 * HTTP prueban el contrato sin cuenta y sin red.
 *
 * Orden de selección, explícito en los dos casos:
 *
 *  1. `COMMANDER_BACKEND_FAKE=1` devuelve el doble en memoria.
 *  2. Sin bandera se devuelve `null`: la ruta responde «deshabilitado» y no se
 *     finge un backend.
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
  if (flag === '1' || flag === 'true') return new FakeBackendAdapter();

  return null;
}

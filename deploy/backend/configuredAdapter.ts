/**
 * Selección del adaptador de backend gestionado (PL3).
 *
 * Orden de selección, explícito en los dos casos:
 *
 *  1. `COMMANDER_BACKEND_FAKE=1` enciende el doble en memoria. Va primero para
 *     que la suite y el arnés HTTP no dependan de una cuenta real aunque el
 *     entorno tenga credenciales.
 *  2. `COMMANDER_BACKEND_PROVIDER=supabase` selecciona el adaptador real. Sin
 *     `SUPABASE_ACCESS_TOKEN`, `SUPABASE_ORG_ID` y `SUPABASE_REGION` el
 *     adaptador existe pero queda `configured: false`: la UI desactiva
 *     aprovisionar y nada llama a la red.
 *  3. Sin bandera ni proveedor se devuelve `null`: la ruta responde
 *     «deshabilitado» y no se finge un backend.
 */
import { FakeBackendAdapter } from './fakeAdapter';
import { SupabaseBackendAdapter } from './supabase';
import type { BackendAdapter } from './types';

export const BACKEND_FAKE_FLAG = 'COMMANDER_BACKEND_FAKE';
export const BACKEND_PROVIDER_ENV = 'COMMANDER_BACKEND_PROVIDER';
export const BACKEND_PROVIDER = 'supabase';

/** Variables que el adaptador real necesita además del selector. */
export const BACKEND_PROVIDER_ENV_VARS = [
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_ORG_ID',
  'SUPABASE_REGION',
] as const;

export function createConfiguredBackendAdapter(
  env: NodeJS.ProcessEnv = process.env
): BackendAdapter | null {
  const flag = String(env[BACKEND_FAKE_FLAG] ?? '')
    .trim()
    .toLowerCase();
  if (flag === '1' || flag === 'true') return new FakeBackendAdapter();

  const provider = String(env[BACKEND_PROVIDER_ENV] ?? '')
    .trim()
    .toLowerCase();
  if (provider === BACKEND_PROVIDER) {
    return new SupabaseBackendAdapter({
      token: env.SUPABASE_ACCESS_TOKEN,
      organizationId: env.SUPABASE_ORG_ID,
      region: env.SUPABASE_REGION,
    });
  }

  return null;
}

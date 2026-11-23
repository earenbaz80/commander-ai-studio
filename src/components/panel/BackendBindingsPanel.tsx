/**
 * Panel de bindings del backend gestionado (PL3) dentro de Publicar.
 *
 * Muestra lo que el adaptador puede decir sin exponer secretos: proveedor,
 * bindings aprovisionados, migraciones aplicadas/pendientes y **nombres** de las
 * credenciales emitidas. El botón de aprovisionar sólo pide los tres bindings;
 * no elige proveedor: eso sigue siendo G3 y hasta entonces la ruta responde
 * «deshabilitado» salvo que se encienda el doble (`COMMANDER_BACKEND_FAKE=1`).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Database,
  HardDrive,
  KeyRound,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { BackendBindingKind, BackendStatus } from '../../../deploy/backend/types';
import type { Language } from '../../i18n/translations';

interface BackendBindingsPanelProps {
  /** Id estable del proyecto para el adaptador; vacío deshabilita el panel. */
  projectId: string;
  lang?: Language;
}

interface BackendManageResponse {
  success?: boolean;
  provider?: string;
  configured?: boolean;
  enabled?: boolean;
  status?: BackendStatus | null;
  error?: string;
}

const BINDINGS: { kind: BackendBindingKind; es: string; en: string; de: string; icon: typeof Database }[] = [
  { kind: 'database', es: 'Base de datos', en: 'Database', de: 'Datenbank', icon: Database },
  { kind: 'storage', es: 'Storage', en: 'Storage', de: 'Storage', icon: HardDrive },
  { kind: 'auth', es: 'Auth', en: 'Auth', de: 'Auth', icon: KeyRound },
];

export function BackendBindingsPanel({ projectId, lang = 'es' }: BackendBindingsPanelProps) {
  const t = useCallback(
    (es: string, en: string, de: string) => (lang === 'es' ? es : lang === 'de' ? de : en),
    [lang]
  );
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!projectId) {
      setStatus(null);
      setEnabled(false);
      setProvider('');
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `/api/backend/manage/status?projectId=${encodeURIComponent(projectId)}`,
        { credentials: 'include' }
      );
      const data = (await res.json().catch(() => ({}))) as BackendManageResponse;
      if (!res.ok || data.success === false) {
        throw new Error(data.error || t('No se pudo leer el backend', 'Could not read the backend', 'Backend konnte nicht gelesen werden'));
      }
      setEnabled(data.enabled === true);
      setConfigured(data.configured === true);
      setProvider(typeof data.provider === 'string' ? data.provider : '');
      setStatus((data.status as BackendStatus | null) ?? null);
    } catch (e: any) {
      setStatus(null);
      setEnabled(false);
      setError(
        e?.message ||
          t('No se pudo leer el backend', 'Could not read the backend', 'Backend konnte nicht gelesen werden')
      );
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const provision = async () => {
    if (!projectId) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/backend/manage/provision', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          bindings: BINDINGS.map((binding) => binding.kind),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as BackendManageResponse;
      if (!res.ok || data.success === false) {
        throw new Error(
          data.error ||
            t('No se pudo aprovisionar', 'Could not provision', 'Bereitstellung fehlgeschlagen')
        );
      }
      setEnabled(true);
      setConfigured(true);
      setProvider(typeof data.provider === 'string' ? data.provider : provider);
      setStatus((data.status as BackendStatus | null) ?? null);
    } catch (e: any) {
      setError(
        e?.message ||
          t('No se pudo aprovisionar', 'Could not provision', 'Bereitstellung fehlgeschlagen')
      );
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    if (!projectId) return;
    setRotating(true);
    setError('');
    try {
      const res = await fetch('/api/backend/manage/rotate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = (await res.json().catch(() => ({}))) as BackendManageResponse;
      if (!res.ok || data.success === false) {
        throw new Error(
          data.error ||
            t('No se pudieron rotar', 'Could not rotate', 'Rotation fehlgeschlagen')
        );
      }
      // La rotación no devuelve valores: el panel relee el estado para mostrar
      // los nombres de las credenciales que el adaptador acaba de emitir.
      await load();
    } catch (e: any) {
      setError(
        e?.message ||
          t('No se pudieron rotar', 'Could not rotate', 'Rotation fehlgeschlagen')
      );
    } finally {
      setRotating(false);
    }
  };

  const bindingState = (kind: BackendBindingKind) =>
    status?.bindings.find((binding) => binding.kind === kind) ?? null;
  const applied = status?.migrations.applied.length ?? 0;
  const pending = status?.migrations.pending.length ?? 0;

  return (
    <div
      data-testid="backend-bindings"
      className="border-2 border-[var(--nc-border-dark)] bg-[var(--nc-bg-panel)] p-2 flex flex-col gap-1.5"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-[var(--nc-text-accent)] flex items-center gap-1.5">
            <Database className="w-4 h-4" />
            {t('Backend de la app', 'App backend', 'App-Backend')}
            <span className="text-[9px] px-1 bg-[var(--nc-active-bg)] text-black font-bold">
              {provider || t('sin proveedor', 'no provider', 'kein Anbieter')}
            </span>
            {status?.ready && (
              <span className="text-[9px] px-1 bg-[var(--nc-text-accent)] text-black font-bold flex items-center gap-0.5">
                <ShieldCheck className="w-3 h-3" />
                {t('LISTO', 'READY', 'BEREIT')}
              </span>
            )}
          </div>
          <div className="text-[9px] text-[var(--nc-text-dim)]">
            {t(
              'Base de datos, storage y auth por app; las credenciales viven sólo en el servidor.',
              'Database, storage and auth per app; credentials live only on the server.',
              'Datenbank, Storage und Auth pro App; Zugangsdaten bleiben auf dem Server.'
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || busy || !projectId}
          className="nc-button !px-2 !py-1 text-[10px] disabled:opacity-50"
          title={t('Actualizar backend', 'Refresh backend', 'Backend aktualisieren')}
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="border border-[var(--nc-danger)] px-2 py-1 text-[9px] text-[var(--nc-danger)] flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          {error}
        </div>
      )}

      {!enabled && !error && (
        <div className="text-[9px] text-[var(--nc-text-dim)]">
          {t(
            'Sin backend configurado: define COMMANDER_BACKEND_PROVIDER=supabase con sus credenciales, o COMMANDER_BACKEND_FAKE=1 para probar el contrato.',
            'No backend configured: set COMMANDER_BACKEND_PROVIDER=supabase with its credentials, or COMMANDER_BACKEND_FAKE=1 to exercise the contract.',
            'Kein Backend konfiguriert: COMMANDER_BACKEND_PROVIDER=supabase mit Zugangsdaten setzen oder COMMANDER_BACKEND_FAKE=1 zum Testen des Vertrags.'
          )}
        </div>
      )}

      {enabled && (
        <>
          <div className="flex flex-wrap gap-1">
            {BINDINGS.map((binding) => {
              const current = bindingState(binding.kind);
              const Icon = binding.icon;
              const state = current?.state ?? 'pending';
              return (
                <span
                  key={binding.kind}
                  data-testid={`backend-binding-${binding.kind}`}
                  data-state={current ? state : 'missing'}
                  className={`text-[9px] px-1 py-0.5 border flex items-center gap-1 ${
                    current
                      ? 'border-[var(--nc-text-accent)] text-[var(--nc-text)]'
                      : 'border-[var(--nc-border-dark)] text-[var(--nc-text-dim)]'
                  }`}
                  title={current ? current.resourceId : undefined}
                >
                  <Icon className="w-3 h-3" />
                  {binding[lang]}
                  <span className="text-[8px] uppercase">{current ? state : t('falta', 'missing', 'fehlt')}</span>
                </span>
              );
            })}
          </div>
          <div className="text-[9px] text-[var(--nc-text-dim)]">
            {t('Migraciones', 'Migrations', 'Migrationen')}: {applied}{' '}
            {t('aplicadas', 'applied', 'angewendet')}
            {pending > 0 ? ` · ${pending} ${t('pendientes', 'pending', 'ausstehend')}` : ''}
            {' · '}
            {t('credenciales', 'credentials', 'Zugangsdaten')}:{' '}
            {status && status.secretNames.length > 0
              ? status.secretNames.join(', ')
              : t('ninguna emitida', 'none issued', 'keine ausgegeben')}
          </div>
          {!configured && (
            <div className="text-[9px] text-[var(--nc-text-dim)]">
              {t(
                'El adaptador está deshabilitado: faltan credenciales del proveedor.',
                'The adapter is disabled: provider credentials are missing.',
                'Der Adapter ist deaktiviert: Anbieter-Zugangsdaten fehlen.'
              )}
            </div>
          )}
          <button
            type="button"
            data-testid="backend-provision"
            onClick={() => void provision()}
            disabled={busy || !configured}
            className="nc-button !py-1 text-[9px] flex items-center justify-center gap-1 disabled:opacity-50"
          >
            <Database className="w-3 h-3" />
            {busy
              ? t('Aprovisionando…', 'Provisioning…', 'Wird bereitgestellt…')
              : t('Aprovisionar DB, storage y auth', 'Provision DB, storage and auth', 'DB, Storage und Auth bereitstellen')}
          </button>
          <button
            type="button"
            data-testid="backend-rotate"
            onClick={() => void rotate()}
            disabled={busy || rotating || !configured || !status || status.bindings.length === 0}
            className="nc-button !py-1 text-[9px] flex items-center justify-center gap-1 disabled:opacity-50"
          >
            <KeyRound className="w-3 h-3" />
            {rotating
              ? t('Rotando…', 'Rotating…', 'Wird rotiert…')
              : t('Rotar credenciales', 'Rotate credentials', 'Zugangsdaten rotieren')}
          </button>
        </>
      )}
    </div>
  );
}

export default BackendBindingsPanel;

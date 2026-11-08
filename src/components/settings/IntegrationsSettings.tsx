import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Link2, Loader2, RefreshCw, Unplug } from 'lucide-react';
import type { Language } from '../../i18n/translations';

interface ProviderStatus {
  id: string;
  label: string;
  configured: boolean;
  connected: boolean;
  account?: { id: string; name: string; email?: string };
  expiresAt?: number;
  scopes?: string[];
  redirectUri?: string;
  missingConfig?: string;
  clientIdEnv?: string;
  clientSecretEnv?: string;
  requiresClientSecret?: boolean;
  setupUrl?: string;
  revoked?: boolean;
  warning?: string;
}

const btnClass =
  'nc-button !px-2 !py-0.5 !mx-0 text-[10px] font-bold flex items-center gap-1 shrink-0 disabled:opacity-40';

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Conectores nativos (Linear y GitHub). El flujo abre el OAuth del proveedor
 * en una ventana y sondea el estado: el token lo guarda el servidor cifrado,
 * nunca el navegador.
 */
export const IntegrationsSettings: React.FC<{ lang?: Language }> = ({ lang = 'es' }) => {
  const t = useCallback(
    (es: string, en: string, de: string) => (lang === 'es' ? es : lang === 'de' ? de : en),
    [lang],
  );
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (spinner = true) => {
    if (spinner) setLoading(true);
    try {
      const res = await fetch('/api/integrations');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setProviders(Array.isArray(data.providers) ? data.providers : []);
      setError('');
    } catch (e: any) {
      setError(e?.message || t('No se pudieron leer los conectores.', 'Could not read integrations.', 'Integrationen konnten nicht gelesen werden.'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = async (provider: ProviderStatus) => {
    setBusy(provider.id);
    setError('');
    setNotice('');
    let popup: Window | null = null;
    try {
      const res = await fetch(`/api/integrations/${encodeURIComponent(provider.id)}/authorize`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);

      popup = window.open(data.authorizeUrl, `commander-oauth-${provider.id}`, 'width=640,height=760');
      if (!popup) {
        throw new Error(
          t(
            'El navegador bloqueó la ventana de OAuth. Permite ventanas emergentes para Commander.',
            'The browser blocked the OAuth window. Allow popups for Commander.',
            'Der Browser hat das OAuth-Fenster blockiert. Erlaube Popups für Commander.',
          ),
        );
      }

      for (let i = 0; i < 60; i += 1) {
        await sleep(2_000);
        const statusRes = await fetch(`/api/integrations/${encodeURIComponent(provider.id)}/status`);
        const status = await statusRes.json().catch(() => ({}));
        if (statusRes.ok && status.connected) {
          await load(false);
          setNotice(
            t(
              `${provider.label} conectado.`,
              `${provider.label} connected.`,
              `${provider.label} verbunden.`,
            ),
          );
          popup?.close();
          return;
        }
        if (popup.closed) {
          const finalRes = await fetch(`/api/integrations/${encodeURIComponent(provider.id)}/status`);
          const finalStatus = await finalRes.json().catch(() => ({}));
          if (finalStatus.connected) {
            await load(false);
            setNotice(`${provider.label} ${t('conectado.', 'connected.', 'verbunden.')}`);
            return;
          }
          throw new Error(
            t(
              'La ventana se cerró antes de autorizar. Inténtalo de nuevo.',
              'The window closed before authorization. Try again.',
              'Das Fenster wurde vor der Autorisierung geschlossen. Versuche es erneut.',
            ),
          );
        }
      }

      throw new Error(
        t(
          'OAuth tardó demasiado. Si ya autorizaste, pulsa Recargar.',
          'OAuth took too long. If you already authorized, click Reload.',
          'OAuth hat zu lange gedauert. Wenn du bereits autorisiert hast, klicke Neu laden.',
        ),
      );
    } catch (e: any) {
      setError(e?.message || t('No se pudo conectar.', 'Could not connect.', 'Verbindung fehlgeschlagen.'));
    } finally {
      setBusy('');
    }
  };

  const disconnect = async (provider: ProviderStatus) => {
    if (!window.confirm(t(`¿Desconectar ${provider.label}?`, `Disconnect ${provider.label}?`, `${provider.label} trennen?`))) {
      return;
    }
    setBusy(provider.id);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/integrations/${encodeURIComponent(provider.id)}/disconnect`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setProviders((current) => current.map((p) => (p.id === provider.id ? { ...p, ...data } : p)));
      if (data.warning) {
        setError(
          t(
            `Token local eliminado, pero ${provider.label} no confirmó la revocación remota: ${data.warning}`,
            `Local token deleted, but ${provider.label} did not confirm remote revocation: ${data.warning}`,
            `Lokales Token gelöscht, aber ${provider.label} hat die Remote-Revokation nicht bestätigt: ${data.warning}`,
          ),
        );
      } else {
        setNotice(
          t(
            `${provider.label} desconectado${data.revoked ? ' y token revocado' : ''}.`,
            `${provider.label} disconnected${data.revoked ? ' and token revoked' : ''}.`,
            `${provider.label} getrennt${data.revoked ? ' und Token widerrufen' : ''}.`,
          ),
        );
      }
    } catch (e: any) {
      setError(e?.message || t('No se pudo desconectar.', 'Could not disconnect.', 'Trennen fehlgeschlagen.'));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-2">
      <div className="border border-[var(--nc-border-dark)] bg-[var(--nc-bg-panel)] px-2 py-1.5">
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-[var(--nc-text-accent)]">
          <Link2 className="w-3 h-3 shrink-0" />
          {t('Conectores OAuth', 'OAuth integrations', 'OAuth-Integrationen')}
          <span className="ml-auto text-[9px] font-normal opacity-60">
            {t('tokens cifrados en el servidor', 'tokens encrypted server-side', 'Token serverseitig verschlüsselt')}
          </span>
        </div>
        <p className="mt-1 text-[9px] opacity-70">
          {t(
            'El agente puede consultar Linear y GitHub, y crear issues o comentarios con aprobación. El access token nunca llega al navegador ni al modelo.',
            'The agent can read Linear and GitHub, and create issues or comments with approval. The access token never reaches the browser or the model.',
            'Der Agent kann Linear und GitHub lesen und mit Bestätigung Issues oder Kommentare erstellen. Das Access-Token erreicht weder Browser noch Modell.',
          )}
        </p>
      </div>

      {error && (
        <p role="alert" className="text-[10px] text-[var(--nc-danger)] border border-[var(--nc-danger)]/50 px-2 py-1">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-[10px] text-[var(--nc-text-accent)] border border-[var(--nc-text-accent)]/40 px-2 py-1">
          {notice}
        </p>
      )}

      {loading && (
        <p className="flex items-center gap-1 text-[10px] opacity-70">
          <Loader2 className="w-3 h-3 animate-spin" />
          {t('Leyendo conectores…', 'Loading integrations…', 'Integrationen werden geladen…')}
        </p>
      )}

      {providers.map((provider) => (
        <div
          key={provider.id}
          className="border border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)] px-2 py-1.5 space-y-1.5"
        >
          <div className="flex items-start gap-2">
            <Link2 className="w-3.5 h-3.5 mt-0.5 text-[var(--nc-text-accent)] shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold">{provider.label}</span>
                <span
                  className={`text-[9px] px-1 border ${
                    provider.connected
                      ? 'border-[var(--nc-text-accent)] text-[var(--nc-text-accent)]'
                      : 'border-[var(--nc-border-light)]/40 opacity-70'
                  }`}
                >
                  {provider.connected
                    ? t('Conectado', 'Connected', 'Verbunden')
                    : t('Sin conectar', 'Not connected', 'Nicht verbunden')}
                </span>
                {!provider.configured && (
                  <span className="text-[9px] px-1 border border-[var(--nc-danger)]/50 text-[var(--nc-danger)]">
                    {t('Falta configurar', 'Not configured', 'Nicht konfiguriert')}
                  </span>
                )}
              </div>
              {provider.account && (
                <div className="text-[9px] opacity-75 truncate">
                  {provider.account.name}
                  {provider.account.email ? ` · ${provider.account.email}` : ''}
                </div>
              )}
              {provider.connected && provider.expiresAt && (
                <div className="text-[9px] opacity-55">
                  {t('Token expira', 'Token expires', 'Token läuft ab')}: {new Date(provider.expiresAt).toLocaleString()}
                  {provider.scopes?.length ? ` · ${provider.scopes.join(', ')}` : ''}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => void connect(provider)}
                disabled={!provider.configured || busy === provider.id}
                className={btnClass}
                title={
                  provider.connected
                    ? t('Volver a autorizar', 'Authorize again', 'Erneut autorisieren')
                    : t('Abrir OAuth', 'Open OAuth', 'OAuth öffnen')
                }
              >
                {busy === provider.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
                {provider.connected
                  ? t('Reconectar', 'Reconnect', 'Neu verbinden')
                  : t('Conectar', 'Connect', 'Verbinden')}
              </button>
              {provider.connected && (
                <button
                  type="button"
                  onClick={() => void disconnect(provider)}
                  disabled={busy === provider.id}
                  className="p-1 text-[var(--nc-danger)] hover:text-red-300 disabled:opacity-40"
                  title={t('Desconectar y borrar el token', 'Disconnect and delete token', 'Trennen und Token löschen')}
                  aria-label={t('Desconectar', 'Disconnect', 'Trennen')}
                >
                  <Unplug className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {!provider.configured && (
            <div className="border border-[var(--nc-border-light)]/30 px-2 py-1.5 text-[9px] space-y-1">
              <p className="font-bold text-[var(--nc-text-accent)]">
                {t(
                  `Configura la app OAuth de ${provider.label}`,
                  `Configure the ${provider.label} OAuth app`,
                  `${provider.label}-OAuth-App konfigurieren`,
                )}
              </p>
              <p className="opacity-75">
                1.{' '}
                {t(
                  `Crea una OAuth app en ${provider.label} y registra el callback.`,
                  `Create an OAuth app in ${provider.label} and register the callback.`,
                  `Erstelle eine OAuth-App in ${provider.label} und registriere den Callback.`,
                )}{' '}
                <a
                  href={provider.setupUrl || '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="underline text-[var(--nc-text-accent)]"
                >
                  {t('Abrir', 'Open', 'Öffnen')}
                </a>
              </p>
              <p className="opacity-75">
                2. {t('Callback URL', 'Callback URL', 'Callback-URL')}:{' '}
                <code className="select-all break-all">{provider.redirectUri || '—'}</code>
              </p>
              <p className="opacity-75">
                3. {t('Añade', 'Add', 'Füge')}{' '}
                <code>{provider.clientIdEnv || `${provider.id.toUpperCase()}_CLIENT_ID`}</code>
                {provider.requiresClientSecret ? (
                  <>
                    {' '}{t('y', 'and', 'und')}{' '}
                    <code>{provider.clientSecretEnv || `${provider.id.toUpperCase()}_CLIENT_SECRET`}</code>
                  </>
                ) : null}{' '}
                {t(
                  'al .env y reinicia Commander.',
                  'to .env and restart Commander.',
                  'zur .env hinzu und starte Commander neu.',
                )}
              </p>
            </div>
          )}
        </div>
      ))}

      {!loading && providers.length === 0 && (
        <p className="text-[10px] opacity-70 px-1 py-2">
          {t('No hay conectores disponibles.', 'No integrations available.', 'Keine Integrationen verfügbar.')}
        </p>
      )}

      <button type="button" onClick={() => void load()} className={btnClass} disabled={loading}>
        <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        {t('Recargar', 'Reload', 'Neu laden')}
      </button>
    </div>
  );
};

export default IntegrationsSettings;

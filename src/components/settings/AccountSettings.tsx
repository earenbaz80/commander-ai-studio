import React, { useEffect, useState } from 'react';
import {
  ExternalLink,
  GitBranch,
  Link2,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  ShieldCheck,
  Unplug,
  User as UserIcon,
} from 'lucide-react';
import type { Language } from '../../i18n/translations';

/**
 * Cuenta de usuario dentro de Configuración.
 *
 * El componente no habla con Firebase: App le pasa el usuario actual y las
 * acciones de vincular/desvincular. Así el panel se puede probar sin red y la
 * lógica de autenticación queda en un solo sitio (`src/lib/firebase.ts`).
 */

export interface AccountProvider {
  providerId: string;
  displayName?: string | null;
  email?: string | null;
  photoURL?: string | null;
}

export interface AccountUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  providerData: AccountProvider[];
}

export type LinkableProvider = 'google.com' | 'github.com';

export interface AccountSettingsProps {
  lang?: Language;
  currentUser: AccountUser | null;
  guestName?: string;
  onOpenAuth: () => void;
  onLogout: () => void | Promise<void>;
  onLinkProvider: (providerId: LinkableProvider) => Promise<AccountUser>;
  onLinkPassword: (email: string, password: string) => Promise<AccountUser>;
  onUnlinkProvider: (providerId: string) => Promise<AccountUser>;
  onOpenIntegrations: () => void;
}

const GoogleIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12.24 10.285V13.4h6.887c-.58 2.319-2.72 4.041-5.647 4.041-3.393 0-6.142-2.749-6.142-6.142s2.749-6.142 6.142-6.142c1.55 0 2.96.577 4.04 1.528l2.42-2.42C18.45 2.82 15.52 2 12.24 2 6.58 2 2 6.58 2 12.24s4.58 10.24 10.24 10.24c6.14 0 10.12-4.32 10.12-10.3 0-.69-.07-1.37-.19-2.022H12.24z" />
  </svg>
);

const btnClass =
  'nc-button !px-2 !py-0.5 !mx-0 text-[10px] font-bold flex items-center gap-1 shrink-0 disabled:opacity-40';
const inputClass =
  'w-full bg-[var(--nc-bg-main)] text-[var(--nc-text)] p-1.5 text-[10px] border border-[var(--nc-border-light)] outline-none font-mono focus:border-[var(--nc-text-accent)]';

export const AccountSettings: React.FC<AccountSettingsProps> = ({
  lang = 'es',
  currentUser,
  guestName,
  onOpenAuth,
  onLogout,
  onLinkProvider,
  onLinkPassword,
  onUnlinkProvider,
  onOpenIntegrations,
}) => {
  const t = (es: string, en: string, de: string) => (lang === 'es' ? es : lang === 'de' ? de : en);
  const [linked, setLinked] = useState<string[]>(
    () => currentUser?.providerData.map((p) => p.providerId) ?? [],
  );
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [passwordFormOpen, setPasswordFormOpen] = useState(false);
  const [passwordEmail, setPasswordEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');

  useEffect(() => {
    setLinked(currentUser?.providerData.map((p) => p.providerId) ?? []);
    if (!currentUser) {
      setError('');
      setNotice('');
      setPasswordFormOpen(false);
      setPasswordEmail('');
      setPassword('');
      setPasswordConfirm('');
    }
  }, [currentUser]);

  const profileName =
    currentUser?.displayName ||
    currentUser?.email?.split('@')[0] ||
    guestName?.trim() ||
    t('Invitado', 'Guest', 'Gast');
  const profileEmail = currentUser?.email || '';
  const initial = (profileName || '?').charAt(0).toUpperCase();
  const signedIn = !!currentUser;

  const describeError = (e: any, providerLabel: string) => {
    const code = e?.code || '';
    if (code === 'auth/operation-not-allowed') {
      return t(
        `${providerLabel} no está habilitado en Firebase. Actívalo en Authentication → Sign-in method.`,
        `${providerLabel} is not enabled in Firebase. Enable it in Authentication → Sign-in method.`,
        `${providerLabel} ist in Firebase nicht aktiviert. Aktiviere es unter Authentication → Sign-in method.`
      );
    }
    if (code === 'auth/popup-closed-by-user') {
      return t(
        'Cerraste la ventana de autorización.',
        'You closed the authorization window.',
        'Du hast das Autorisierungsfenster geschlossen.'
      );
    }
    if (code === 'auth/popup-blocked') {
      return t(
        'El navegador bloqueó la ventana emergente. Permite ventanas para Commander e inténtalo de nuevo.',
        'The browser blocked the popup. Allow popups for Commander and try again.',
        'Der Browser hat das Popup blockiert. Erlaube Popups für Commander und versuche es erneut.'
      );
    }
    if (code === 'auth/invalid-email') {
      return t('El correo no es válido.', 'The email is not valid.', 'Die E-Mail ist ungültig.');
    }
    if (code === 'auth/email-already-in-use') {
      return t(
        'Ese correo ya está en uso por otra cuenta.',
        'That email is already in use by another account.',
        'Diese E-Mail wird bereits von einem anderen Konto verwendet.'
      );
    }
    if (code === 'auth/weak-password') {
      return t(
        'La contraseña es demasiado débil. Usa al menos 6 caracteres.',
        'The password is too weak. Use at least 6 characters.',
        'Das Passwort ist zu schwach. Verwende mindestens 6 Zeichen.'
      );
    }
    if (code === 'auth/credential-already-in-use') {
      return t(
        'Ese correo o cuenta ya está vinculado a otro usuario.',
        'That email or account is already linked to another user.',
        'Diese E-Mail oder dieses Konto ist bereits mit einem anderen Benutzer verknüpft.'
      );
    }
    if (code === 'auth/provider-already-linked') {
      return t(
        'Ese método ya está conectado.',
        'That method is already connected.',
        'Diese Methode ist bereits verbunden.'
      );
    }
    if (code === 'auth/requires-recent-login') {
      return t(
        'Por seguridad, vuelve a iniciar sesión antes de cambiar los métodos de acceso.',
        'For security, sign in again before changing sign-in methods.',
        'Melde dich aus Sicherheitsgründen erneut an, bevor du die Anmeldemethoden änderst.'
      );
    }
    if (code === 'auth/no-such-provider') {
      return t(
        'Ese método no está vinculado a la cuenta.',
        'That method is not linked to the account.',
        'Diese Methode ist nicht mit dem Konto verknüpft.'
      );
    }
    return (
      e?.message ||
      t('No se pudo completar la operación.', 'Could not complete the operation.', 'Der Vorgang konnte nicht abgeschlossen werden.')
    );
  };

  const closePasswordForm = () => {
    setPasswordFormOpen(false);
    setPasswordEmail('');
    setPassword('');
    setPasswordConfirm('');
  };

  const togglePasswordForm = () => {
    if (passwordFormOpen) {
      closePasswordForm();
      return;
    }
    setPasswordEmail((current) => current || currentUser?.email || '');
    setError('');
    setPasswordFormOpen(true);
  };

  const handleLinkPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    const email = passwordEmail.trim();
    if (!email || !email.includes('@')) {
      setError(t('Introduce un correo válido.', 'Enter a valid email.', 'Gib eine gültige E-Mail ein.'));
      return;
    }
    if (password.length < 6) {
      setError(
        t(
          'La contraseña debe tener al menos 6 caracteres.',
          'The password must be at least 6 characters.',
          'Das Passwort muss mindestens 6 Zeichen haben.'
        )
      );
      return;
    }
    if (password !== passwordConfirm) {
      setError(
        t('Las contraseñas no coinciden.', 'Passwords do not match.', 'Die Passwörter stimmen nicht überein.')
      );
      return;
    }
    setBusy('password');
    setError('');
    setNotice('');
    try {
      const user = await onLinkPassword(email, password);
      setLinked(user.providerData.map((p) => p.providerId));
      closePasswordForm();
      setNotice(
        t(
          'Correo y contraseña conectados.',
          'Email and password connected.',
          'E-Mail und Passwort verbunden.'
        )
      );
    } catch (e: any) {
      setError(describeError(e, t('Correo y contraseña', 'Email & password', 'E-Mail & Passwort')));
    } finally {
      setBusy('');
    }
  };

  const handleLink = async (providerId: LinkableProvider, providerLabel: string) => {
    setBusy(providerId);
    setError('');
    setNotice('');
    try {
      const user = await onLinkProvider(providerId);
      setLinked(user.providerData.map((p) => p.providerId));
      setNotice(
        t(`${providerLabel} conectado.`, `${providerLabel} connected.`, `${providerLabel} verbunden.`)
      );
    } catch (e: any) {
      setError(describeError(e, providerLabel));
    } finally {
      setBusy('');
    }
  };

  const handleUnlink = async (providerId: string, providerLabel: string) => {
    if (linked.length <= 1) {
      setError(
        t(
          'Debe quedar al menos un método de acceso conectado.',
          'At least one sign-in method must remain connected.',
          'Mindestens eine Anmeldemethode muss verbunden bleiben.'
        )
      );
      return;
    }
    if (
      !window.confirm(
        t(`¿Desconectar ${providerLabel}?`, `Disconnect ${providerLabel}?`, `${providerLabel} trennen?`)
      )
    ) {
      return;
    }
    setBusy(providerId);
    setError('');
    setNotice('');
    try {
      const user = await onUnlinkProvider(providerId);
      setLinked(user.providerData.map((p) => p.providerId));
      setNotice(
        t(`${providerLabel} desconectado.`, `${providerLabel} disconnected.`, `${providerLabel} getrennt.`)
      );
    } catch (e: any) {
      setError(describeError(e, providerLabel));
    } finally {
      setBusy('');
    }
  };

  const handleLogout = async () => {
    setBusy('logout');
    setError('');
    setNotice('');
    try {
      await onLogout();
    } catch (e: any) {
      setError(
        e?.message || t('No se pudo cerrar la sesión.', 'Could not sign out.', 'Abmelden fehlgeschlagen.')
      );
    } finally {
      setBusy('');
    }
  };

  const providerMeta: Record<
    string,
    { label: string; description: string; icon: React.ReactNode; linkable: boolean }
  > = {
    'google.com': {
      label: 'Google',
      description: t('Inicio de sesión con Google.', 'Sign in with Google.', 'Anmeldung mit Google.'),
      icon: <GoogleIcon className="w-3.5 h-3.5" />,
      linkable: true,
    },
    'github.com': {
      label: 'GitHub',
      description: t('Inicio de sesión con GitHub.', 'Sign in with GitHub.', 'Anmeldung mit GitHub.'),
      icon: <GitBranch className="w-3.5 h-3.5" />,
      linkable: true,
    },
    password: {
      label: t('Correo y contraseña', 'Email & password', 'E-Mail & Passwort'),
      description: t(
        'Acceso con el correo de la cuenta.',
        'Sign in with the account email.',
        'Anmeldung mit der Konto-E-Mail.'
      ),
      icon: <Mail className="w-3.5 h-3.5" />,
      linkable: false,
    },
  };

  const known = ['google.com', 'github.com', 'password'];
  const providerIds = [...known, ...linked.filter((id) => !known.includes(id))];
  const canUnlink = linked.length > 1;

  return (
    <div className="space-y-2" data-testid="account-settings">
      {signedIn ? (
        <div
          className="flex items-center gap-2 border border-[var(--nc-border-light)] bg-[var(--nc-bg-main)] px-2 py-2"
          data-testid="account-profile"
        >
          {currentUser?.photoURL ? (
            <img
              src={currentUser.photoURL}
              alt=""
              className="w-9 h-9 rounded-full border border-[var(--nc-border-light)] object-cover"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-[var(--nc-highlight-bg)] text-black font-bold text-sm flex items-center justify-center">
              {initial}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold text-[var(--nc-text-accent)] truncate">{profileName}</div>
            {profileEmail && <div className="text-[9px] font-mono truncate opacity-80">{profileEmail}</div>}
            <div className="text-[8px] font-mono opacity-45 truncate">UID: {currentUser?.uid}</div>
          </div>
          <span className="text-[8px] px-1 border border-[var(--nc-text-accent)]/50 text-[var(--nc-text-accent)] shrink-0">
            {currentUser?.emailVerified
              ? t('Verificado', 'Verified', 'Verifiziert')
              : t('Sesión activa', 'Signed in', 'Angemeldet')}
          </span>
        </div>
      ) : (
        <div className="border border-[var(--nc-border-light)] bg-[var(--nc-bg-main)] px-2 py-2 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-[var(--nc-bg-deep)] border border-[var(--nc-border-light)] flex items-center justify-center">
              <UserIcon className="w-4 h-4 opacity-70" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-[var(--nc-text-accent)] truncate">{profileName}</div>
              <div className="text-[9px] opacity-70">
                {t('Sesión local sin cuenta', 'Local session without an account', 'Lokale Sitzung ohne Konto')}
              </div>
            </div>
          </div>
          <p className="text-[9px] opacity-70 leading-relaxed">
            {t(
              'Inicia sesión para sincronizar tu perfil y conectar métodos de acceso como Google, GitHub o correo.',
              'Sign in to sync your profile and connect sign-in methods such as Google, GitHub or email.',
              'Melde dich an, um dein Profil zu synchronisieren und Anmeldemethoden wie Google, GitHub oder E-Mail zu verbinden.'
            )}
          </p>
          <button
            type="button"
            onClick={onOpenAuth}
            className={`${btnClass} w-full justify-center py-1.5`}
            data-testid="account-open-auth"
          >
            <LogIn className="w-3.5 h-3.5" />
            {t('Iniciar sesión o crear cuenta', 'Sign in or create account', 'Anmelden oder Konto erstellen')}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-[10px] text-[var(--nc-danger)] border border-[var(--nc-danger)]/50 px-2 py-1">
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="text-[10px] text-[var(--nc-text-accent)] border border-[var(--nc-text-accent)]/40 px-2 py-1"
        >
          {notice}
        </p>
      )}

      {signedIn && (
        <div className="border border-[var(--nc-border-dark)] bg-[var(--nc-bg-panel)]">
          <div className="px-2 py-1.5 border-b border-[var(--nc-border-dark)] flex items-center gap-1.5 text-[10px] font-bold text-[var(--nc-text-accent)]">
            <ShieldCheck className="w-3 h-3" />
            {t('Métodos de acceso', 'Sign-in methods', 'Anmeldemethoden')}
            <span className="ml-auto text-[9px] font-normal opacity-60">
              {t('Cuenta', 'Account', 'Konto')}
            </span>
          </div>
          <div className="p-1.5 space-y-1.5">
            {providerIds.map((providerId) => {
              const meta = providerMeta[providerId] ?? {
                label: providerId,
                description: t('Método adicional.', 'Additional method.', 'Zusätzliche Methode.'),
                icon: <Link2 className="w-3.5 h-3.5" />,
                linkable: false,
              };
              const isLinked = linked.includes(providerId);
              const isBusy = busy === providerId;
              return (
                <div
                  key={providerId}
                  data-testid={`account-provider-${providerId}`}
                  className="flex items-center gap-2 border border-[var(--nc-border-light)]/50 bg-[var(--nc-bg-main)] px-2 py-1.5"
                >
                  <span className="text-[var(--nc-text-accent)] shrink-0">{meta.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold truncate">{meta.label}</span>
                      <span
                        className={`text-[8px] px-1 border shrink-0 ${
                          isLinked
                            ? 'border-[var(--nc-text-accent)] text-[var(--nc-text-accent)]'
                            : 'border-[var(--nc-border-light)]/40 opacity-60'
                        }`}
                      >
                        {isLinked
                          ? t('Conectado', 'Connected', 'Verbunden')
                          : t('Sin conectar', 'Not connected', 'Nicht verbunden')}
                      </span>
                    </div>
                    <div className="text-[8px] opacity-60 truncate">{meta.description}</div>
                  </div>
                  {isLinked && (
                    <button
                      type="button"
                      onClick={() => void handleUnlink(providerId, meta.label)}
                      disabled={isBusy || !canUnlink}
                      className="p-1 text-[var(--nc-danger)] hover:text-red-300 disabled:opacity-30 shrink-0"
                      title={
                        canUnlink
                          ? t('Desconectar método', 'Disconnect method', 'Methode trennen')
                          : t(
                              'Debe quedar al menos un método',
                              'At least one method must remain',
                              'Mindestens eine Methode muss bleiben'
                            )
                      }
                      aria-label={t(
                        `Desconectar ${meta.label}`,
                        `Disconnect ${meta.label}`,
                        `${meta.label} trennen`
                      )}
                    >
                      {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unplug className="w-3 h-3" />}
                    </button>
                  )}
                  {!isLinked && meta.linkable && (
                    <button
                      type="button"
                      onClick={() => void handleLink(providerId as LinkableProvider, meta.label)}
                      disabled={isBusy}
                      className={btnClass}
                    >
                      {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                      {t('Conectar', 'Connect', 'Verbinden')}
                    </button>
                  )}
                  {!isLinked && providerId === 'password' && (
                    <button
                      type="button"
                      onClick={togglePasswordForm}
                      disabled={busy === 'password'}
                      className={btnClass}
                      data-testid="account-add-password"
                    >
                      <Mail className="w-3 h-3" />
                      {passwordFormOpen
                        ? t('Cerrar', 'Close', 'Schließen')
                        : t('Añadir contraseña', 'Add password', 'Passwort hinzufügen')}
                    </button>
                  )}
                  {!isLinked && !meta.linkable && providerId !== 'password' && (
                    <span className="text-[8px] opacity-45 shrink-0">
                      {t('Gestionado por Firebase', 'Managed by Firebase', 'Von Firebase verwaltet')}
                    </span>
                  )}
                </div>
              );
            })}
            {!canUnlink && (
              <p className="text-[8px] opacity-55 px-1">
                {t(
                  'Debe quedar al menos un método de acceso conectado.',
                  'At least one sign-in method must remain connected.',
                  'Mindestens eine Anmeldemethode muss verbunden bleiben.'
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {signedIn && !linked.includes('password') && passwordFormOpen && (
        <form
          onSubmit={(event) => void handleLinkPassword(event)}
          className="border border-[var(--nc-border-dark)] bg-[var(--nc-bg-panel)] p-2 space-y-2"
          data-testid="account-password-form"
        >
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-[var(--nc-text-accent)]">
            <Mail className="w-3 h-3" />
            {t('Añadir correo y contraseña', 'Add email and password', 'E-Mail und Passwort hinzufügen')}
          </div>
          <p className="text-[9px] opacity-65 leading-relaxed">
            {t(
              'Podrás entrar con este correo y contraseña además de tus métodos actuales.',
              'You can sign in with this email and password in addition to your current methods.',
              'Du kannst dich zusätzlich zu deinen aktuellen Methoden mit dieser E-Mail und diesem Passwort anmelden.'
            )}
          </p>
          <label className="flex flex-col gap-0.5 text-[9px]">
            <span className="font-bold">{t('Correo', 'Email', 'E-Mail')}</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={passwordEmail}
              onChange={(event) => setPasswordEmail(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[9px]">
            <span className="font-bold">{t('Contraseña', 'Password', 'Passwort')}</span>
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[9px]">
            <span className="font-bold">
              {t('Repite la contraseña', 'Repeat password', 'Passwort wiederholen')}
            </span>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
              className={inputClass}
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy === 'password'}
              className={btnClass}
              data-testid="account-link-password"
            >
              {busy === 'password' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Link2 className="w-3 h-3" />
              )}
              {t('Vincular', 'Link', 'Verknüpfen')}
            </button>
            <button
              type="button"
              onClick={closePasswordForm}
              disabled={busy === 'password'}
              className={btnClass}
            >
              {t('Cancelar', 'Cancel', 'Abbrechen')}
            </button>
          </div>
        </form>
      )}

      <div className="border border-[var(--nc-border-dark)] bg-[var(--nc-bg-panel)] px-2 py-1.5 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-[var(--nc-text-accent)]">
          <GitBranch className="w-3 h-3 shrink-0" />
          {t('GitHub para el agente', 'GitHub for the agent', 'GitHub für den Agenten')}
          <span className="ml-auto text-[8px] font-normal opacity-55">
            {t('Conector OAuth', 'OAuth connector', 'OAuth-Konnektor')}
          </span>
        </div>
        <p className="text-[9px] opacity-65 leading-relaxed">
          {t(
            'Conecta una cuenta de GitHub para que el agente lea repositorios e issues y cree cambios con aprobación. Es independiente del inicio de sesión.',
            'Connect a GitHub account so the agent can read repositories and issues and create changes with approval. It is independent of sign-in.',
            'Verbinde ein GitHub-Konto, damit der Agent Repositories und Issues lesen und Änderungen mit Genehmigung erstellen kann. Unabhängig von der Anmeldung.'
          )}
        </p>
        <button
          type="button"
          onClick={onOpenIntegrations}
          className={btnClass}
          data-testid="account-open-integrations"
        >
          <ExternalLink className="w-3 h-3" />
          {t('Abrir Integraciones', 'Open Integrations', 'Integrationen öffnen')}
        </button>
      </div>

      {signedIn && (
        <button
          type="button"
          onClick={() => void handleLogout()}
          disabled={busy === 'logout'}
          className={`${btnClass} w-full justify-center py-1.5`}
          data-testid="account-logout"
        >
          {busy === 'logout' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <LogOut className="w-3.5 h-3.5" />
          )}
          {t('Cerrar sesión', 'Sign out', 'Abmelden')}
        </button>
      )}
    </div>
  );
};

export default AccountSettings;

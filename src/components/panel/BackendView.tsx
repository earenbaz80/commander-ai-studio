import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Database,
  Download,
  FileText,
  HardDrive,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import type { Language } from '../../i18n/translations';
import {
  BackendApiError,
  createRecord,
  deleteFile,
  deleteRecord,
  downloadFile,
  listFiles,
  listRecords,
  login,
  logout,
  me,
  register,
  updateRecord,
  uploadFile,
  type BackendFile,
  type BackendRecord,
  type BackendSession,
} from '../../lib/backendApi';

interface BackendViewProps {
  lang?: Language;
}

type BackendTab = 'account' | 'records' | 'files';
type AuthMode = 'login' | 'register';

interface RecordDraft {
  id: string | null;
  title: string;
  body: string;
}

interface ConfirmDelete {
  type: 'record' | 'file';
  id: string;
}

const TOKEN_KEY = 'commander_backend_token';
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function writeToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* sessionStorage puede estar bloqueado; la sesión sigue en memoria */
  }
}

function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nada que limpiar */
  }
}

function fmtDate(value: string, lang: Language): string {
  try {
    return new Date(value).toLocaleString(
      lang === 'es' ? 'es-ES' : lang === 'de' ? 'de-DE' : 'en-US',
      { dateStyle: 'short', timeStyle: 'short' }
    );
  } catch {
    return value;
  }
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function BackendView({ lang = 'es' }: BackendViewProps) {
  const t = useCallback(
    (es: string, en: string, de: string) => (lang === 'es' ? es : lang === 'de' ? de : en),
    [lang]
  );
  const [session, setSession] = useState<BackendSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<BackendTab>('account');
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [records, setRecords] = useState<BackendRecord[]>([]);
  const [files, setFiles] = useState<BackendFile[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [recordDraft, setRecordDraft] = useState<RecordDraft>({ id: null, title: '', body: '' });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDelete | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dropSession = useCallback((message = '') => {
    clearToken();
    setSession(null);
    setRecords([]);
    setFiles([]);
    setTab('account');
    setPassword('');
    setError(message);
  }, []);

  const handleUnauthorized = useCallback(
    (reason: unknown, fallback: string): boolean => {
      if (reason instanceof BackendApiError && reason.status === 401) {
        dropSession(t('La sesión caducó. Vuelve a entrar.', 'Session expired. Sign in again.', 'Sitzung abgelaufen. Bitte erneut anmelden.'));
        return true;
      }
      setError(readableError(reason, fallback));
      return false;
    },
    [dropSession, t]
  );

  const loadData = useCallback(
    async (token: string) => {
      setLoadingData(true);
      setError('');
      try {
        const [recordsResult, filesResult] = await Promise.allSettled([
          listRecords(token),
          listFiles(token),
        ]);

        if (recordsResult.status === 'fulfilled') {
          setRecords(recordsResult.value);
        } else if (
          handleUnauthorized(
            recordsResult.reason,
            t('No se pudieron cargar los registros', 'Could not load records', 'Datensätze konnten nicht geladen werden')
          )
        ) {
          return;
        }

        if (filesResult.status === 'fulfilled') {
          setFiles(filesResult.value);
        } else {
          handleUnauthorized(
            filesResult.reason,
            t('No se pudieron cargar los archivos', 'Could not load files', 'Dateien konnten nicht geladen werden')
          );
        }
      } finally {
        setLoadingData(false);
      }
    },
    [handleUnauthorized, t]
  );

  useEffect(() => {
    let alive = true;
    const token = readToken();
    if (!token) {
      setChecking(false);
      return () => {
        alive = false;
      };
    }

    void me(token)
      .then(({ user, tenant }) => {
        if (!alive) return;
        setSession({ token, user, tenant });
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        clearToken();
        setError(
          readableError(
            reason,
            t('No se pudo recuperar la sesión', 'Could not restore session', 'Sitzung konnte nicht wiederhergestellt werden')
          )
        );
      })
      .finally(() => {
        if (alive) setChecking(false);
      });

    return () => {
      alive = false;
    };
  }, [t]);

  useEffect(() => {
    if (!session) return;
    void loadData(session.token);
  }, [session, loadData]);

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault();
    if (authBusy) return;
    setError('');
    setNotice('');

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setError(t('Email y contraseña son obligatorios', 'Email and password are required', 'E-Mail und Passwort sind erforderlich'));
      return;
    }
    if (authMode === 'register' && !name.trim()) {
      setError(t('El nombre es obligatorio', 'Name is required', 'Name ist erforderlich'));
      return;
    }

    setAuthBusy(true);
    try {
      const next =
        authMode === 'login'
          ? await login({ email: cleanEmail, password })
          : await register({
              email: cleanEmail,
              password,
              name: name.trim(),
              tenantName: tenantName.trim() || undefined,
            });
      writeToken(next.token);
      setSession(next);
      setPassword('');
      setTab('records');
      setNotice(
        authMode === 'login'
          ? t('Sesión iniciada', 'Signed in', 'Angemeldet')
          : t('Cuenta creada', 'Account created', 'Konto erstellt')
      );
    } catch (reason: unknown) {
      setError(readableError(reason, t('No se pudo iniciar sesión', 'Could not sign in', 'Anmeldung fehlgeschlagen')));
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    const token = session?.token;
    if (token) {
      try {
        await logout(token);
      } catch {
        /* el token local se borra igualmente */
      }
    }
    dropSession();
    setNotice(t('Sesión cerrada', 'Signed out', 'Abgemeldet'));
  };

  const refresh = () => {
    if (session) void loadData(session.token);
  };

  const startNewRecord = () => {
    setRecordDraft({ id: null, title: '', body: '' });
    setConfirmDelete(null);
    setError('');
  };

  const editRecord = (record: BackendRecord) => {
    setRecordDraft({ id: record.id, title: record.title, body: record.body });
    setConfirmDelete(null);
    setError('');
  };

  const saveRecord = async () => {
    if (!session || busy) return;
    const title = recordDraft.title.trim();
    if (!title) {
      setError(t('El título es obligatorio', 'Title is required', 'Titel ist erforderlich'));
      return;
    }

    setBusy('record-save');
    setError('');
    try {
      const saved = recordDraft.id
        ? await updateRecord(session.token, recordDraft.id, { title, body: recordDraft.body })
        : await createRecord(session.token, { title, body: recordDraft.body });
      setRecords((current) =>
        recordDraft.id
          ? current.map((record) => (record.id === saved.id ? saved : record))
          : [saved, ...current]
      );
      setRecordDraft({ id: null, title: '', body: '' });
      setNotice(recordDraft.id ? t('Registro actualizado', 'Record updated', 'Datensatz aktualisiert') : t('Registro creado', 'Record created', 'Datensatz erstellt'));
    } catch (reason: unknown) {
      handleUnauthorized(reason, t('No se pudo guardar el registro', 'Could not save record', 'Datensatz konnte nicht gespeichert werden'));
    } finally {
      setBusy('');
    }
  };

  const removeRecord = async (id: string) => {
    if (!session || busy) return;
    setBusy(`record-delete:${id}`);
    setError('');
    try {
      await deleteRecord(session.token, id);
      setRecords((current) => current.filter((record) => record.id !== id));
      if (recordDraft.id === id) setRecordDraft({ id: null, title: '', body: '' });
      setConfirmDelete(null);
      setNotice(t('Registro borrado', 'Record deleted', 'Datensatz gelöscht'));
    } catch (reason: unknown) {
      handleUnauthorized(reason, t('No se pudo borrar el registro', 'Could not delete record', 'Datensatz konnte nicht gelöscht werden'));
    } finally {
      setBusy('');
    }
  };

  const chooseFile = (file: File | null) => {
    setSelectedFile(file);
    setError('');
    setNotice('');
  };

  const uploadSelectedFile = async () => {
    if (!session || !selectedFile || busy) return;
    if (selectedFile.size > MAX_FILE_BYTES) {
      setError(t('El archivo supera 10 MiB', 'File exceeds 10 MiB', 'Datei überschreitet 10 MiB'));
      return;
    }
    if (selectedFile.size === 0) {
      setError(t('El archivo está vacío', 'File is empty', 'Datei ist leer'));
      return;
    }

    setBusy('file-upload');
    setError('');
    try {
      const saved = await uploadFile(session.token, selectedFile);
      setFiles((current) => [saved, ...current]);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setNotice(t('Archivo subido', 'File uploaded', 'Datei hochgeladen'));
    } catch (reason: unknown) {
      handleUnauthorized(reason, t('No se pudo subir el archivo', 'Could not upload file', 'Datei konnte nicht hochgeladen werden'));
    } finally {
      setBusy('');
    }
  };

  const download = async (file: BackendFile) => {
    if (!session || busy) return;
    setBusy(`file-download:${file.id}`);
    setError('');
    try {
      const blob = await downloadFile(session.token, file.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (reason: unknown) {
      handleUnauthorized(reason, t('No se pudo descargar el archivo', 'Could not download file', 'Datei konnte nicht heruntergeladen werden'));
    } finally {
      setBusy('');
    }
  };

  const removeFile = async (id: string) => {
    if (!session || busy) return;
    setBusy(`file-delete:${id}`);
    setError('');
    try {
      await deleteFile(session.token, id);
      setFiles((current) => current.filter((file) => file.id !== id));
      setConfirmDelete(null);
      setNotice(t('Archivo borrado', 'File deleted', 'Datei gelöscht'));
    } catch (reason: unknown) {
      handleUnauthorized(reason, t('No se pudo borrar el archivo', 'Could not delete file', 'Datei konnte nicht gelöscht werden'));
    } finally {
      setBusy('');
    }
  };

  const tabs: Array<{ id: BackendTab; label: string; icon: ReactNode }> = [
    { id: 'account', label: t('Cuentas', 'Accounts', 'Konten'), icon: <Users className="w-3.5 h-3.5" /> },
    { id: 'records', label: t('Registros', 'Records', 'Datensätze'), icon: <FileText className="w-3.5 h-3.5" /> },
    { id: 'files', label: t('Archivos', 'Files', 'Dateien'), icon: <HardDrive className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="h-full min-h-0 flex flex-col text-[11px] font-mono" data-testid="backend-view">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--nc-border-dark)] bg-[var(--nc-bg-deep)] shrink-0">
        <Database className="w-3.5 h-3.5 text-[var(--nc-text-accent)]" />
        <span className="font-bold text-[var(--nc-text)]">Backend</span>
        {session && (
          <span className="text-[9px] px-1 border border-[var(--nc-border-light)]/40 text-[var(--nc-text)]/70 truncate max-w-[130px]" title={session.tenant.name}>
            {session.tenant.name}
          </span>
        )}
        <button
          type="button"
          onClick={refresh}
          disabled={!session || loadingData}
          aria-label={t('Refrescar backend', 'Refresh backend', 'Backend aktualisieren')}
          title={t('Refrescar backend', 'Refresh backend', 'Backend aktualisieren')}
          className="ml-auto p-1 text-[var(--nc-text)]/70 hover:text-[var(--nc-text-accent)] disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingData ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div role="alert" className="px-2 py-1 text-[10px] text-red-300 border-b border-[var(--nc-border-dark)] bg-[#220000]/50 shrink-0">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="px-2 py-1 text-[10px] text-green-300 border-b border-[var(--nc-border-dark)] bg-[#002200]/50 shrink-0">
          {notice}
        </div>
      )}

      {checking ? (
        <div className="flex-1 flex items-center justify-center text-[var(--nc-text)]/60">
          {t('Comprobando sesión…', 'Checking session…', 'Sitzung wird geprüft…')}
        </div>
      ) : !session ? (
        <div className="flex-1 overflow-y-auto p-3">
          <div className="max-w-sm mx-auto border border-[var(--nc-border-light)]/40 bg-[var(--nc-bg-deep)] p-3">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-4 h-4 text-[var(--nc-text-accent)]" />
              <span className="font-bold text-[var(--nc-text)]">
                {t('Backend local', 'Local backend', 'Lokales Backend')}
              </span>
            </div>
            <p className="text-[10px] leading-relaxed text-[var(--nc-text)]/60 mb-3">
              {t(
                'Cada cuenta tiene su propio inquilino. Los registros y archivos nunca se comparten entre cuentas.',
                'Each account owns its tenant. Records and files are never shared across accounts.',
                'Jedes Konto besitzt seinen eigenen Mandanten. Datensätze und Dateien werden nie zwischen Konten geteilt.'
              )}
            </p>

            <div className="grid grid-cols-2 gap-1 mb-3" role="tablist" aria-label={t('Acceso', 'Access', 'Zugang')}>
              <button
                type="button"
                role="tab"
                aria-selected={authMode === 'login'}
                onClick={() => { setAuthMode('login'); setError(''); }}
                className={`px-2 py-1 text-[10px] font-bold border ${authMode === 'login' ? 'bg-[var(--nc-active-bg)] text-black border-[var(--nc-border-light)]' : 'text-[var(--nc-text)] border-[var(--nc-border-dark)] hover:border-[var(--nc-border-light)]'}`}
              >
                {t('Iniciar sesión', 'Sign in', 'Anmelden')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={authMode === 'register'}
                onClick={() => { setAuthMode('register'); setError(''); }}
                className={`px-2 py-1 text-[10px] font-bold border ${authMode === 'register' ? 'bg-[var(--nc-active-bg)] text-black border-[var(--nc-border-light)]' : 'text-[var(--nc-text)] border-[var(--nc-border-dark)] hover:border-[var(--nc-border-light)]'}`}
              >
                {t('Registro', 'Register', 'Registrieren')}
              </button>
            </div>

            <form onSubmit={submitAuth} className="space-y-2" data-testid="backend-auth-form">
              <label className="block text-[9px] uppercase text-[var(--nc-text)]/60" htmlFor="backend-email">
                Email
                <input
                  id="backend-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-0.5 w-full bg-[var(--nc-bg-main)] text-white border border-[var(--nc-border-light)]/50 px-2 py-1 text-[11px] outline-none focus:border-[var(--nc-text-accent)]"
                  placeholder="ana@example.com"
                />
              </label>
              <label className="block text-[9px] uppercase text-[var(--nc-text)]/60" htmlFor="backend-password">
                {t('Contraseña', 'Password', 'Passwort')}
                <input
                  id="backend-password"
                  type="password"
                  autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-0.5 w-full bg-[var(--nc-bg-main)] text-white border border-[var(--nc-border-light)]/50 px-2 py-1 text-[11px] outline-none focus:border-[var(--nc-text-accent)]"
                  placeholder="••••••••"
                />
              </label>
              {authMode === 'register' && (
                <>
                  <label className="block text-[9px] uppercase text-[var(--nc-text)]/60" htmlFor="backend-name">
                    {t('Nombre', 'Name', 'Name')}
                    <input
                      id="backend-name"
                      type="text"
                      autoComplete="name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="mt-0.5 w-full bg-[var(--nc-bg-main)] text-white border border-[var(--nc-border-light)]/50 px-2 py-1 text-[11px] outline-none focus:border-[var(--nc-text-accent)]"
                    />
                  </label>
                  <label className="block text-[9px] uppercase text-[var(--nc-text)]/60" htmlFor="backend-tenant">
                    {t('Inquilino (opcional)', 'Tenant (optional)', 'Mandant (optional)')}
                    <input
                      id="backend-tenant"
                      type="text"
                      value={tenantName}
                      onChange={(event) => setTenantName(event.target.value)}
                      className="mt-0.5 w-full bg-[var(--nc-bg-main)] text-white border border-[var(--nc-border-light)]/50 px-2 py-1 text-[11px] outline-none focus:border-[var(--nc-text-accent)]"
                    />
                  </label>
                </>
              )}
              <button
                type="submit"
                disabled={authBusy}
                className="nc-button w-full !py-1.5 text-[10px] flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {authMode === 'login' ? <LogIn className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                {authBusy
                  ? t('Conectando…', 'Connecting…', 'Verbinden…')
                  : authMode === 'login'
                    ? t('Entrar', 'Sign in', 'Anmelden')
                    : t('Crear cuenta', 'Create account', 'Konto erstellen')}
              </button>
            </form>
            <p className="mt-2 text-[9px] text-[var(--nc-text)]/40">
              {t('La contraseña debe tener al menos 8 caracteres.', 'Password must be at least 8 characters.', 'Das Passwort muss mindestens 8 Zeichen haben.')}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex border-b border-[var(--nc-border-dark)] shrink-0" role="tablist" aria-label={t('Secciones del backend', 'Backend sections', 'Backend-Bereiche')}>
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => { setTab(item.id); setConfirmDelete(null); }}
                className={`flex items-center gap-1 px-2 py-1 text-[10px] font-bold border-b-2 ${tab === item.id ? 'border-[var(--nc-text-accent)] text-[var(--nc-text-accent)]' : 'border-transparent text-[var(--nc-text)]/60 hover:text-[var(--nc-text)]'}`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            {tab === 'account' && (
              <div className="space-y-2" data-testid="backend-account">
                <div className="border border-[var(--nc-border-light)]/40 bg-[var(--nc-bg-deep)] p-2.5">
                  <div className="flex items-center gap-2 text-[var(--nc-text-accent)] font-bold">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {t('Cuenta activa', 'Active account', 'Aktives Konto')}
                  </div>
                  <dl className="mt-2 space-y-1 text-[10px]">
                    <div className="flex gap-2">
                      <dt className="w-20 text-[var(--nc-text)]/50">{t('Nombre', 'Name', 'Name')}</dt>
                      <dd className="text-[var(--nc-text)]" data-testid="backend-account-name">{session.user.name}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 text-[var(--nc-text)]/50">Email</dt>
                      <dd className="text-[var(--nc-text)]" data-testid="backend-account-email">{session.user.email}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 text-[var(--nc-text)]/50">{t('Inquilino', 'Tenant', 'Mandant')}</dt>
                      <dd className="text-[var(--nc-text)]" data-testid="backend-account-tenant">{session.tenant.name}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 text-[var(--nc-text)]/50">ID</dt>
                      <dd className="text-[var(--nc-text)]/60 truncate" title={session.user.id}>{session.user.id}</dd>
                    </div>
                    {session.expiresAt && (
                      <div className="flex gap-2">
                        <dt className="w-20 text-[var(--nc-text)]/50">{t('Caduca', 'Expires', 'Läuft ab')}</dt>
                        <dd className="text-[var(--nc-text)]/60">{fmtDate(new Date(session.expiresAt).toISOString(), lang)}</dd>
                      </div>
                    )}
                  </dl>
                  <p className="mt-2 text-[9px] leading-relaxed text-[var(--nc-text)]/50">
                    {t(
                      'Los datos se guardan en el backend local de Commander y se aíslan por inquilino. Cierra sesión para entrar con otra cuenta.',
                      'Data is stored in Commander’s local backend and isolated per tenant. Sign out to use another account.',
                      'Daten werden im lokalen Commander-Backend gespeichert und pro Mandant isoliert. Melde dich ab, um ein anderes Konto zu verwenden.'
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => void signOut()}
                    className="nc-button mt-2 !px-2 !py-1 text-[10px] flex items-center gap-1"
                  >
                    <LogOut className="w-3 h-3" />
                    {t('Cerrar sesión', 'Sign out', 'Abmelden')}
                  </button>
                </div>
              </div>
            )}

            {tab === 'records' && (
              <div className="space-y-2" data-testid="backend-records">
                <div className="border border-[var(--nc-border-light)]/40 bg-[var(--nc-bg-deep)] p-2">
                  <div className="flex items-center gap-1.5 text-[var(--nc-text-accent)] font-bold">
                    {recordDraft.id ? <Pencil className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                    {recordDraft.id ? t('Editar registro', 'Edit record', 'Datensatz bearbeiten') : t('Nuevo registro', 'New record', 'Neuer Datensatz')}
                  </div>
                  <label className="mt-2 block text-[9px] uppercase text-[var(--nc-text)]/60" htmlFor="backend-record-title">
                    {t('Título', 'Title', 'Titel')}
                    <input
                      id="backend-record-title"
                      value={recordDraft.title}
                      maxLength={200}
                      onChange={(event) => setRecordDraft((current) => ({ ...current, title: event.target.value }))}
                      className="mt-0.5 w-full bg-[var(--nc-bg-main)] text-white border border-[var(--nc-border-light)]/50 px-2 py-1 text-[11px] outline-none focus:border-[var(--nc-text-accent)]"
                    />
                  </label>
                  <label className="mt-1.5 block text-[9px] uppercase text-[var(--nc-text)]/60" htmlFor="backend-record-body">
                    {t('Contenido', 'Body', 'Inhalt')}
                    <textarea
                      id="backend-record-body"
                      value={recordDraft.body}
                      maxLength={100000}
                      rows={3}
                      onChange={(event) => setRecordDraft((current) => ({ ...current, body: event.target.value }))}
                      className="mt-0.5 w-full resize-y bg-[var(--nc-bg-main)] text-white border border-[var(--nc-border-light)]/50 px-2 py-1 text-[11px] outline-none focus:border-[var(--nc-text-accent)]"
                    />
                  </label>
                  <div className="mt-1.5 flex gap-1">
                    <button
                      type="button"
                      onClick={() => void saveRecord()}
                      disabled={Boolean(busy)}
                      className="nc-button !px-2 !py-1 text-[10px] disabled:opacity-50"
                    >
                      {recordDraft.id ? t('Guardar cambios', 'Save changes', 'Änderungen speichern') : t('Guardar registro', 'Save record', 'Datensatz speichern')}
                    </button>
                    {recordDraft.id && (
                      <button type="button" onClick={startNewRecord} className="nc-button !px-2 !py-1 text-[10px]">
                        {t('Cancelar', 'Cancel', 'Abbrechen')}
                      </button>
                    )}
                  </div>
                </div>

                {loadingData && <div className="text-[var(--nc-text)]/50">{t('Cargando registros…', 'Loading records…', 'Datensätze werden geladen…')}</div>}
                {!loadingData && records.length === 0 && (
                  <div className="text-[10px] text-[var(--nc-text)]/50 leading-relaxed">
                    {t('No hay registros todavía. Crea el primero arriba.', 'No records yet. Create the first one above.', 'Noch keine Datensätze. Erstelle den ersten oben.')}
                  </div>
                )}
                {records.map((record) => (
                  <div key={record.id} className="border border-[var(--nc-border-dark)] bg-[var(--nc-bg-deep)] p-2" data-testid={`backend-record-${record.id}`}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[var(--nc-text-accent)] font-bold truncate" title={record.title}>{record.title}</div>
                        <div className="text-[9px] text-[var(--nc-text)]/40">{fmtDate(record.updatedAt, lang)}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => editRecord(record)}
                        aria-label={t('Editar registro', 'Edit record', 'Datensatz bearbeiten')}
                        title={t('Editar', 'Edit', 'Bearbeiten')}
                        className="p-1 text-[var(--nc-text)]/60 hover:text-[var(--nc-text-accent)]"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      {confirmDelete?.type === 'record' && confirmDelete.id === record.id ? (
                        <span className="flex items-center gap-1 text-[9px]">
                          <button type="button" onClick={() => void removeRecord(record.id)} className="text-red-300 hover:text-red-200">
                            {t('Sí', 'Yes', 'Ja')}
                          </button>
                          <button type="button" onClick={() => setConfirmDelete(null)} className="text-[var(--nc-text)]/50">
                            {t('No', 'No', 'Nein')}
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete({ type: 'record', id: record.id })}
                          aria-label={t('Borrar registro', 'Delete record', 'Datensatz löschen')}
                          title={t('Borrar', 'Delete', 'Löschen')}
                          className="p-1 text-[var(--nc-text)]/60 hover:text-red-300"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {record.body && <p className="mt-1 text-[10px] whitespace-pre-wrap break-words text-[var(--nc-text)]/70">{record.body}</p>}
                  </div>
                ))}
              </div>
            )}

            {tab === 'files' && (
              <div className="space-y-2" data-testid="backend-files">
                <div className="border border-[var(--nc-border-light)]/40 bg-[var(--nc-bg-deep)] p-2">
                  <div className="flex items-center gap-1.5 text-[var(--nc-text-accent)] font-bold">
                    <Upload className="w-3.5 h-3.5" />
                    {t('Subir archivo', 'Upload file', 'Datei hochladen')}
                  </div>
                  <input
                    ref={fileInputRef}
                    data-testid="backend-file-input"
                    type="file"
                    onChange={(event) => chooseFile(event.target.files?.[0] || null)}
                    className="mt-2 block w-full text-[10px] text-[var(--nc-text)]/70 file:mr-2 file:border file:border-[var(--nc-border-light)]/50 file:bg-[var(--nc-bg-panel)] file:px-2 file:py-1 file:text-[10px] file:text-[var(--nc-text)]"
                  />
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[9px] text-[var(--nc-text)]/40">
                      {t('Máximo 10 MiB. El binario se envía tal cual.', 'Max 10 MiB. The binary is sent as-is.', 'Maximal 10 MiB. Die Binärdatei wird unverändert gesendet.')}
                    </span>
                    <button
                      type="button"
                      onClick={() => void uploadSelectedFile()}
                      disabled={!selectedFile || Boolean(busy)}
                      className="nc-button ml-auto !px-2 !py-1 text-[10px] disabled:opacity-50"
                    >
                      {t('Subir', 'Upload', 'Hochladen')}
                    </button>
                  </div>
                </div>

                {loadingData && <div className="text-[var(--nc-text)]/50">{t('Cargando archivos…', 'Loading files…', 'Dateien werden geladen…')}</div>}
                {!loadingData && files.length === 0 && (
                  <div className="text-[10px] text-[var(--nc-text)]/50 leading-relaxed">
                    {t('No hay archivos todavía.', 'No files yet.', 'Noch keine Dateien.')}
                  </div>
                )}
                {files.map((file) => (
                  <div key={file.id} className="flex items-center gap-2 border border-[var(--nc-border-dark)] bg-[var(--nc-bg-deep)] p-1.5" data-testid={`backend-file-${file.id}`}>
                    <FileText className="w-3.5 h-3.5 shrink-0 text-[var(--nc-text-accent)]" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] text-[var(--nc-text)] truncate" title={file.name}>{file.name}</div>
                      <div className="text-[9px] text-[var(--nc-text)]/40">
                        {fmtBytes(file.size)} · {file.mime} · {fmtDate(file.createdAt, lang)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void download(file)}
                      disabled={busy === `file-download:${file.id}`}
                      aria-label={t('Descargar archivo', 'Download file', 'Datei herunterladen')}
                      title={t('Descargar', 'Download', 'Herunterladen')}
                      className="p-1 text-[var(--nc-text)]/60 hover:text-[var(--nc-text-accent)] disabled:opacity-40"
                    >
                      <Download className="w-3 h-3" />
                    </button>
                    {confirmDelete?.type === 'file' && confirmDelete.id === file.id ? (
                      <span className="flex items-center gap-1 text-[9px]">
                        <button type="button" onClick={() => void removeFile(file.id)} className="text-red-300 hover:text-red-200">
                          {t('Sí', 'Yes', 'Ja')}
                        </button>
                        <button type="button" onClick={() => setConfirmDelete(null)} className="text-[var(--nc-text)]/50">
                          {t('No', 'No', 'Nein')}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete({ type: 'file', id: file.id })}
                        aria-label={t('Borrar archivo', 'Delete file', 'Datei löschen')}
                        title={t('Borrar', 'Delete', 'Löschen')}
                        className="p-1 text-[var(--nc-text)]/60 hover:text-red-300"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default BackendView;

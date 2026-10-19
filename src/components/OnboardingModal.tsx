import React, { useState } from 'react';
import { User, Lock, LogIn, UserPlus, ShieldCheck, Rocket, X } from 'lucide-react';
import {
  loginWithEmailPassword,
  registerWithEmailPassword,
  signInWithGoogle,
} from '../lib/firebase';
import type { Language } from '../i18n/translations';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Invitado: se guarda el nombre y se cierra. */
  onContinueAsGuest: (name: string) => void;
  /** Usuario registrado con éxito. */
  onAuthenticated: () => void;
  lang?: Language;
  /** Modo "cambiar usuario": muestra también el botón de cerrar. */
  isSwitching?: boolean;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onClose,
  onContinueAsGuest,
  onAuthenticated,
  lang = 'es',
  isSwitching = false,
}) => {
  const [view, setView] = useState<'welcome' | 'login' | 'register'>('welcome');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [guestName, setGuestName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const es = lang === 'es';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (view === 'register') {
        if (!name.trim()) {
          setError(es ? 'El nombre de usuario es obligatorio.' : lang === 'de' ? 'Benutzername ist erforderlich.' : 'Username is required.');
          setLoading(false);
          return;
        }
        if (password.length < 6) {
          setError(es ? 'La contraseña debe tener al menos 6 caracteres.' : lang === 'de' ? 'Das Passwort muss mindestens 6 Zeichen lang sein.' : 'Password must be at least 6 characters.');
          setLoading(false);
          return;
        }
        await registerWithEmailPassword(email, password, name);
      } else {
        await loginWithEmailPassword(email, password);
      }
      onAuthenticated();
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        setError(es ? 'Ese correo ya está registrado.' : lang === 'de' ? 'Diese E-Mail ist bereits registriert.' : 'That email is already registered.');
      } else if (['auth/wrong-password', 'auth/user-not-found', 'auth/invalid-credential'].includes(err.code)) {
        setError(es ? 'Usuario o contraseña incorrectos.' : lang === 'de' ? 'Falscher Benutzer oder falsches Passwort.' : 'Wrong user or password.');
      } else if (err.code === 'auth/weak-password') {
        setError(es ? 'La contraseña es demasiado débil (mínimo 6 caracteres).' : lang === 'de' ? 'Passwort zu schwach (mind. 6 Zeichen).' : 'Password too weak (min 6 chars).');
      } else {
        setError(err.message || (es ? 'Error al autenticar.' : lang === 'de' ? 'Authentifizierungsfehler.' : 'Auth error.'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithGoogle();
      onAuthenticated();
    } catch {
      setError(es ? 'Error al iniciar sesión con Google.' : lang === 'de' ? 'Anmeldung mit Google fehlgeschlagen.' : 'Google sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4 overflow-y-auto">
      <div className="nc-panel w-full max-w-md border-2 border-[#00ffff] bg-[#000080] shadow-[8px_8px_0px_#000055]">
        {/* Cabecera */}
        <div className="flex items-center justify-between nc-header p-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-black" />
            <span className="font-bold text-black tracking-wide text-sm">
              {es ? 'COMMANDER AI STUDIO' : lang === 'de' ? 'COMMANDER AI STUDIO' : 'COMMANDER AI STUDIO'}
            </span>
          </div>
          {isSwitching && (
            <button onClick={onClose} className="nc-button text-xs px-2 py-0.5" title={es ? 'Cerrar' : lang === 'de' ? 'Schließen' : 'Close'}>
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-4 flex flex-col gap-4">
          {view === 'welcome' ? (
            /* ---------- Bienvenida ---------- */
            <>
              <div className="text-center space-y-3">
                {/* Icono de usuario vectorial */}
                <div className="mx-auto w-20 h-20 flex items-center justify-center">
                  <svg
                    viewBox="0 0 24 24"
                    className="w-16 h-16 text-[#ffff55]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <h2 className="text-cyan-400 text-lg font-bold">
                  {es ? '¿Cómo quieres entrar?' : lang === 'de' ? 'Wie möchtest du dich anmelden?' : 'How do you want to sign in?'}
                </h2>
                <p className="text-[11px] text-yellow-500/80">
                  {es
                    ? 'Regístrate para sincronizar tu historial y proyectos, o continúa como invitado para trabajar en este dispositivo.'
                    : 'Register to sync your history and projects, or continue as a guest to work on this device.'}
                </p>
              </div>

              <button
                onClick={() => { setView('register'); setError(null); }}
                className="nc-button py-2.5 text-sm flex items-center justify-center gap-2 bg-[#ffff55] text-black font-bold hover:bg-white"
              >
                <UserPlus className="w-4 h-4" />
                <span>{es ? 'CREAR MI CUENTA' : lang === 'de' ? 'MEIN KONTO ERSTELLEN' : 'CREATE MY ACCOUNT'}</span>
              </button>

              <button
                onClick={() => { setView('login'); setError(null); }}
                className="nc-button py-2.5 text-sm flex items-center justify-center gap-2"
              >
                <LogIn className="w-4 h-4" />
                <span>{es ? 'YA TENGO CUENTA' : lang === 'de' ? 'ICH HABE BEREITS EIN KONTO' : 'I ALREADY HAVE AN ACCOUNT'}</span>
              </button>

              <div className="relative my-1 text-center">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#00ffff]/40"></div></div>
                <span className="relative bg-[#000080] px-2 text-[10px] text-[#00ffff]">{es ? 'O' : lang === 'de' ? 'ODER' : 'OR'}</span>
              </div>

              {/* Invitado */}
              <div className="bg-[#000044] border-2 border-[#00ffff]/50 p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-[#ffff55] text-xs font-bold">
                  <Rocket className="w-4 h-4" />
                  <span>{es ? 'CONTINUAR COMO INVITADO' : lang === 'de' ? 'ALS GAST FORTFAHREN' : 'CONTINUE AS GUEST'}</span>
                </div>
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder={es ? 'Elige un nombre (opcional)' : lang === 'de' ? 'Wähle einen Namen (optional)' : 'Pick a name (optional)'}
                  className="bg-[#0000aa] text-[#ffff55] p-2 text-xs border-2 border-[#00ffff] outline-none font-mono"
                />
                <button
                  onClick={() => onContinueAsGuest(guestName)}
                  className="nc-button py-2 text-xs flex items-center justify-center gap-2 bg-[#00aaaa] text-black font-bold hover:bg-[#00ffff]"
                >
                  <Rocket className="w-4 h-4" />
                  <span>{es ? 'ENTRAR COMO INVITADO' : lang === 'de' ? 'ALS GAST EINTRETEN' : 'ENTER AS GUEST'}</span>
                </button>
                <p className="text-[9px] text-cyan-500/70 text-center">
                  {es ? 'Sin cuenta. Todo se guarda en este navegador.' : lang === 'de' ? 'Kein Konto. Alles wird in diesem Browser gespeichert.' : 'No account. Everything is saved in this browser.'}
                </p>
              </div>
            </>
          ) : (
            /* ---------- Login / Registro ---------- */
            <>
              <div className="flex items-center justify-between">
                <button
                  onClick={() => { setView('welcome'); setError(null); }}
                  className="text-[10px] text-cyan-400 hover:text-white flex items-center gap-1"
                >
                  ← {es ? 'Volver' : lang === 'de' ? 'Zurück' : 'Back'}
                </button>
                <div className="flex gap-1">
                  <button
                    onClick={() => { setView('login'); setError(null); }}
                    className={`nc-button px-2 py-0.5 text-[10px] ${view === 'login' ? 'nc-active' : ''}`}
                  >
                    {es ? 'INGRESAR' : lang === 'de' ? 'ANMELDEN' : 'LOGIN'}
                  </button>
                  <button
                    onClick={() => { setView('register'); setError(null); }}
                    className={`nc-button px-2 py-0.5 text-[10px] ${view === 'register' ? 'nc-active' : ''}`}
                  >
                    {es ? 'REGISTRO' : lang === 'de' ? 'REGISTRIEREN' : 'REGISTER'}
                  </button>
                </div>
              </div>

              {error && (
                <div className="bg-[#aa0000] text-white p-2 text-xs border border-red-400 font-mono">
                  ⚠️ {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                {view === 'register' && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-[#00ffff] font-bold flex items-center gap-1">
                      <User className="w-3.5 h-3.5" /> {es ? 'NOMBRE' : lang === 'de' ? 'NAME' : 'NAME'}
                    </label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={es ? 'Ej. CommanderDev' : lang === 'de' ? 'z. B. CommanderDev' : 'e.g. CommanderDev'}
                      className="bg-[#0000aa] text-[#ffff55] p-2 text-xs border-2 border-[#00ffff] outline-none font-mono"
                    />
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-[#00ffff] font-bold flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-[#ffff55]" /> {es ? 'USUARIO O CORREO' : lang === 'de' ? 'BENUTZER ODER E-MAIL' : 'USER OR EMAIL'}
                  </label>
                  <input
                    type="text"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={es ? 'usuario o correo@ejemplo.com' : lang === 'de' ? 'benutzer oder mail@beispiel.de' : 'user or mail@example.com'}
                    className="bg-[#0000aa] text-[#ffff55] p-2 text-xs border-2 border-[#00ffff] outline-none font-mono"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-[#00ffff] font-bold flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5" /> {es ? 'CONTRASEÑA' : lang === 'de' ? 'PASSWORT' : 'PASSWORD'}
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="bg-[#0000aa] text-[#ffff55] p-2 text-xs border-2 border-[#00ffff] outline-none font-mono"
                  />
                </div>

                <button type="submit" disabled={loading} className="nc-button py-2 text-sm flex items-center justify-center gap-2">
                  {view === 'register' ? <UserPlus className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
                  <span>
                    {loading
                      ? (es ? 'PROCESANDO...' : lang === 'de' ? 'VERARBEITE...' : 'PROCESSING...')
                      : view === 'register'
                        ? (es ? 'CREAR CUENTA' : lang === 'de' ? 'KONTO ERSTELLEN' : 'CREATE ACCOUNT')
                        : (es ? 'ENTRAR' : lang === 'de' ? 'ANMELDEN' : 'SIGN IN')}
                  </span>
                </button>
              </form>

              <div className="relative my-1 text-center">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#00ffff]/40"></div></div>
                <span className="relative bg-[#000080] px-2 text-[10px] text-[#00ffff]">{es ? 'O TAMBIÉN' : lang === 'de' ? 'ODER' : 'OR'}</span>
              </div>

              <button
                onClick={handleGoogle}
                disabled={loading}
                className="nc-button py-2 text-xs flex items-center justify-center gap-2 bg-[#0000aa] hover:bg-[#00aaaa]"
              >
                <svg className="w-4 h-4 fill-current text-[#ffff55]" viewBox="0 0 24 24">
                  <path d="M12.24 10.285V13.4h6.887c-.58 2.319-2.72 4.041-5.647 4.041-3.393 0-6.142-2.749-6.142-6.142s2.749-6.142 6.142-6.142c1.55 0 2.96.577 4.04 1.528l2.42-2.42C18.45 2.82 15.52 2 12.24 2 6.58 2 2 6.58 2 12.24s4.58 10.24 10.24 10.24c6.14 0 10.12-4.32 10.12-10.3 0-.69-.07-1.37-.19-2.022H12.24z" />
                </svg>
                <span>{es ? 'CONTINUAR CON GOOGLE' : lang === 'de' ? 'MIT GOOGLE FORTFAHREN' : 'CONTINUE WITH GOOGLE'}</span>
              </button>

              <button
                onClick={() => { setView('welcome'); setError(null); }}
                className="text-[10px] text-cyan-500/70 hover:text-cyan-300 text-center"
              >
                {es ? 'Prefiero continuar como invitado' : lang === 'de' ? 'Ich möchte lieber als Gast fortfahren' : "I'd rather continue as guest"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default OnboardingModal;

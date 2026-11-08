import React, { useState } from 'react';
import { X, User, Lock, LogIn, UserPlus, LogOut, ShieldCheck, GitBranch } from 'lucide-react';
import { 
  loginWithEmailPassword, 
  registerWithEmailPassword, 
  signInWithGoogle, 
  signInWithGitHub,
  logoutUser
} from '../lib/firebase';
import { User as FirebaseUser } from 'firebase/auth';
import type { Language } from '../i18n/translations';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: FirebaseUser | null;
  lang?: Language;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, currentUser, lang = 'es' }) => {
  const t = (es: string, en: string, de: string) =>
    lang === 'es' ? es : lang === 'de' ? de : en;
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isRegistering) {
        if (!name.trim()) {
          setError('El nombre de usuario es obligatorio.');
          setLoading(false);
          return;
        }
        if (password.length < 6) {
          setError('La contraseña debe tener al menos 6 caracteres.');
          setLoading(false);
          return;
        }
        await registerWithEmailPassword(email, password, name);
      } else {
        await loginWithEmailPassword(email, password);
      }
      onClose();
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        setError('El nombre de usuario o correo ya está registrado.');
      } else if (err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        setError('Usuario o contraseña incorrectos.');
      } else if (err.code === 'auth/weak-password') {
        setError('La contraseña es demasiado débil (mínimo 6 caracteres).');
      } else {
        setError(err.message || 'Error al autenticar.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithGoogle();
      onClose();
    } catch (_err: any) {
      setError('Error al iniciar sesión con Google.');
    } finally {
      setLoading(false);
    }
  };

  const handleGitHubLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithGitHub();
      onClose();
    } catch (err: any) {
      if (err?.code === 'auth/operation-not-allowed') {
        setError('GitHub no está habilitado en Firebase. Actívalo en Authentication → Sign-in method.');
      } else if (err?.code === 'auth/popup-closed-by-user') {
        setError('Cerraste la ventana de GitHub.');
      } else if (err?.code === 'auth/account-exists-with-different-credential') {
        setError(
          'Ese correo ya tiene una cuenta con otro método. Inicia sesión y conéctalo desde Configuración → Cuenta.'
        );
      } else {
        setError('Error al iniciar sesión con GitHub.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logoutUser();
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 cursor-pointer"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className="nc-panel w-full max-w-md p-4 flex flex-col gap-4 border-2 border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] shadow-[8px_8px_0px_var(--nc-shadow)] cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between nc-header p-2 -mx-4 -mt-4 mb-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-black" />
            <span className="font-bold text-black tracking-wide">
              {currentUser ? 'PERFIL DE USUARIO NC' : isRegistering ? 'NUEVO USUARIO (NC AUTH)' : 'ACCESO USUARIO COMMANDER'}
            </span>
          </div>
          <button onClick={onClose} className="nc-button text-xs px-2 py-0.5">
            <X className="w-4 h-4" />
          </button>
        </div>

        {currentUser ? (
          /* Logged In View */
          <div className="flex flex-col gap-4 text-center p-2">
            <div className="bg-[var(--nc-bg-main)] p-3 border-2 border-[var(--nc-border-light)] rounded flex flex-col items-center gap-2">
              <div className="w-12 h-12 bg-[var(--nc-highlight-bg)] text-black font-bold text-xl rounded-full flex items-center justify-center">
                {currentUser.displayName?.charAt(0).toUpperCase() || currentUser.email?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="text-[var(--nc-text-accent)] font-bold text-lg">{currentUser.displayName || 'Usuario Commander'}</div>
              <div className="text-[var(--nc-text)] text-xs font-mono">{currentUser.email}</div>
            </div>

            <button onClick={handleLogout} className="nc-button flex items-center justify-center gap-2 py-2">
              <LogOut className="w-4 h-4" />
              <span>CERRAR SESIÓN</span>
            </button>
          </div>
        ) : (
          /* Auth Form View */
          <div className="flex flex-col gap-3">
            {/* Tabs */}
            <div className="flex gap-2 border-b-2 border-[var(--nc-border-light)] pb-2">
              <button
                type="button"
                onClick={() => { setIsRegistering(false); setError(null); }}
                className={`nc-button flex-1 py-1 text-xs flex items-center justify-center gap-1 ${!isRegistering ? 'nc-active' : ''}`}
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>INGRESAR</span>
              </button>
              <button
                type="button"
                onClick={() => { setIsRegistering(true); setError(null); }}
                className={`nc-button flex-1 py-1 text-xs flex items-center justify-center gap-1 ${isRegistering ? 'nc-active' : ''}`}
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>REGISTRARSE</span>
              </button>
            </div>

            {error && (
              <div className="bg-[#aa0000] text-white p-2 text-xs border border-red-400 font-mono">
                ⚠️ {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              {isRegistering && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-[var(--nc-text)] font-bold flex items-center gap-1">
                    <User className="w-3.5 h-3.5" /> NOMBRE DE USUARIO
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ej. CommanderDev"
                    className="bg-[var(--nc-bg-main)] text-[var(--nc-text-accent)] p-2 text-xs border-2 border-[var(--nc-border-light)] outline-none font-mono"
                  />
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-xs text-[var(--nc-text)] font-bold flex items-center gap-1">
                  <User className="w-3.5 h-3.5 text-[var(--nc-text-accent)]" /> USUARIO O CORREO ELECTRÓNICO
                </label>
                <input
                  type="text"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Ej: usuario_dev o correo@ejemplo.com"
                  className="bg-[var(--nc-bg-main)] text-[var(--nc-text-accent)] p-2 text-xs border-2 border-[var(--nc-border-light)] outline-none font-mono"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-[var(--nc-text)] font-bold flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5" /> CONTRASEÑA
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="bg-[var(--nc-bg-main)] text-[var(--nc-text-accent)] p-2 text-xs border-2 border-[var(--nc-border-light)] outline-none font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="nc-button py-2 text-sm flex items-center justify-center gap-2 mt-2"
              >
                {isRegistering ? <UserPlus className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
                <span>{loading ? 'PROCESANDO...' : isRegistering ? 'CREAR MI CUENTA' : 'INICIAR SESIÓN'}</span>
              </button>
            </form>

            <div className="relative my-2 text-center">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[var(--nc-border-light)]/40"></div></div>
              <span className="relative bg-[var(--nc-bg-panel)] px-2 text-[10px] text-[var(--nc-text)]">O TAMBIÉN</span>
            </div>

            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={loading}
              className="nc-button py-2 text-xs flex items-center justify-center gap-2 bg-[var(--nc-bg-main)] hover:bg-[var(--nc-header-bg)]"
            >
              <svg className="w-4 h-4 fill-current text-[var(--nc-text-accent)]" viewBox="0 0 24 24">
                <path d="M12.24 10.285V13.4h6.887c-.58 2.319-2.72 4.041-5.647 4.041-3.393 0-6.142-2.749-6.142-6.142s2.749-6.142 6.142-6.142c1.55 0 2.96.577 4.04 1.528l2.42-2.42C18.45 2.82 15.52 2 12.24 2 6.58 2 2 6.58 2 12.24s4.58 10.24 10.24 10.24c6.14 0 10.12-4.32 10.12-10.3 0-.69-.07-1.37-.19-2.022H12.24z"/>
              </svg>
              <span>INICIAR SESIÓN CON GOOGLE</span>
            </button>

            <button
              type="button"
              onClick={handleGitHubLogin}
              disabled={loading}
              className="nc-button py-2 text-xs flex items-center justify-center gap-2 bg-[var(--nc-bg-main)] hover:bg-[var(--nc-header-bg)]"
            >
              <GitBranch className="w-4 h-4 text-[var(--nc-text-accent)]" />
              <span>{t('INICIAR SESIÓN CON GITHUB', 'SIGN IN WITH GITHUB', 'MIT GITHUB ANMELDEN')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
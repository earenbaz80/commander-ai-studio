import React from 'react';
import {
  X,
  Settings,
  PanelLeft,
  PanelRight,
  User,
  Search,
  Minus,
  Square,
  Eye,
  EyeOff,
  ChevronDown,
  LogIn,
  LogOut,
} from 'lucide-react';
import { StudioMode } from '../types/studio';
import { Language } from '../i18n/translations';

export type ConsoleTheme = 'norton' | 'matrix' | 'amber' | 'dos' | 'light' | 'solarized';


interface HeaderProps {
  mode: StudioMode;
  setMode: (mode: StudioMode) => void;
  selectedModel: string;
  onToggleSidebar: () => void;
  /** Abre/cierra el panel Workbench (derecho). */
  onToggleWorkbench: () => void;
  /** true si el Workbench está visible (para marcar el botón). */
  isWorkbenchOpen?: boolean;
  onOpenAuth: () => void;
  /** Cierra la sesión de la cuenta; sin él el menú no muestra esa acción. */
  onLogout?: () => void | Promise<void>;
  currentUser: any;
  guestName?: string;
  promptTitle: string;
  lang?: Language;
  /** Abre la paleta de comandos (Ctrl+K). */
  onOpenCommandPalette?: () => void;
  /** Abre el modal de preferencias de la aplicación (apariencia, energía, rutas…). */
  onOpenPreferences?: () => void;
  /** Muestra u oculta Nono flotante. */
  onToggleNono?: () => void;
  /** Si Nono está visible. */
  isNonoVisible?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleSidebar,
  onToggleWorkbench,
  isWorkbenchOpen = false,
  onOpenAuth,
  onLogout,
  currentUser,
  guestName,
  lang = 'es',
  onOpenCommandPalette,
  onOpenPreferences,
  onToggleNono,
  isNonoVisible = true,
}) => {
  // Aplica el tamaño de texto guardado al montar (el control vive en Configuración).
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('commander_font_scale');
      const scale = saved === 'lg' || saved === 'xl' ? saved : 'normal';
      document.documentElement.classList.remove('font-scale-normal', 'font-scale-lg', 'font-scale-xl');
      document.documentElement.classList.add(`font-scale-${scale}`);
    } catch {}
  }, []);

  const [userMenuOpen, setUserMenuOpen] = React.useState(false);
  const userMenuRef = React.useRef<HTMLDivElement>(null);
  const userMenuButtonRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!userMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) setUserMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setUserMenuOpen(false);
        userMenuButtonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [userMenuOpen]);

  const profileName = currentUser
    ? (currentUser.displayName || currentUser.email?.split('@')[0] || 'Usuario')
    : (guestName || (lang === 'es' ? 'Invitado' : lang === 'de' ? 'Gast' : 'Guest'));
  const profileDetail = currentUser
    ? (currentUser.email || (lang === 'es' ? 'Cuenta sin correo' : lang === 'de' ? 'Konto ohne E-Mail' : 'Account without email'))
    : (lang === 'es' ? 'Los datos se guardan en este equipo' : lang === 'de' ? 'Daten bleiben auf diesem Gerät' : 'Data stays on this device');
  const profileInitial = (profileName || 'U').charAt(0).toUpperCase();

  const handleMinimize = () => {
    if ((window as any).electronAPI?.minimize) {
      (window as any).electronAPI.minimize();
    } else {
      console.log('[Window] Minimizar solicitado.');
    }
  };

  const handleMaximize = () => {
    if ((window as any).electronAPI?.maximize) {
      (window as any).electronAPI.maximize();
    } else {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    }
  };

  const handleClose = () => {
    if ((window as any).electronAPI?.close) {
      (window as any).electronAPI.close();
    } else {
      if (window.confirm('¿Deseas reiniciar la sesión o cerrar el proyecto actual?')) {
        window.location.reload();
      }
    }
  };

  return (
    <header 
      onDoubleClick={handleMaximize}
      className="nc-header px-1 py-1 flex items-center justify-between border-b-2 border-black relative shrink-0 z-20 select-none app-drag cursor-default"
    >
      <div className="flex items-center gap-0.5 min-w-0 app-no-drag">
        <button 
          onClick={onToggleSidebar} 
          className="nc-button !px-1 !py-0.5 !mx-0 shrink-0" 
          data-tooltip="Alternar Barra Lateral"
          data-tooltip-sub="Oculta o muestra el menú de navegación e historial"
          aria-label={lang === 'es' ? 'Alternar barra lateral' : lang === 'de' ? 'Seitenleiste umschalten' : 'Toggle sidebar'}
        >
            <PanelLeft className="w-4 h-4" />
        </button>
        <button
          onClick={onToggleWorkbench}
          className={`nc-button !px-1 !py-0.5 !mx-0 shrink-0 ${isWorkbenchOpen ? 'bg-[var(--nc-bg-panel)] text-[var(--nc-text)]' : ''}`}
          data-tooltip="Workbench (Panel Derecho)"
          data-tooltip-sub="Archivos, pestañas, terminal y navegador integrados"
          aria-label={lang === 'es' ? 'Alternar panel Workbench' : lang === 'de' ? 'Workbench-Panel umschalten' : 'Toggle workbench panel'}
        >
          <PanelRight className="w-4 h-4" />
        </button>
        {onToggleNono && (
          <button
            onClick={onToggleNono}
            className={`nc-button !px-1 !py-0.5 !mx-0 shrink-0 ${isNonoVisible ? 'bg-[var(--nc-bg-panel)] text-[var(--nc-text)]' : ''}`}
            data-tooltip={isNonoVisible ? 'Ocultar asistente Nono' : 'Mostrar asistente Nono'}
            data-tooltip-sub="Activa o desactiva el flotante en pantalla"
            aria-label={
              lang === 'es'
                ? isNonoVisible ? 'Ocultar asistente Nono' : 'Mostrar asistente Nono'
                : lang === 'de'
                  ? isNonoVisible ? 'Nono-Assistent ausblenden' : 'Nono-Assistent einblenden'
                  : isNonoVisible ? 'Hide Nono assistant' : 'Show Nono assistant'
            }
          >
            {isNonoVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
        )}
        {onOpenCommandPalette && (
          <button
            onClick={onOpenCommandPalette}
            className="nc-button !px-1 !py-0.5 !mx-0 shrink-0 flex items-center gap-1"
            data-tooltip="Paleta de comandos"
            data-tooltip-sub="Busca y ejecuta acciones y modos rápidamente (Ctrl+K)"
            aria-label="Abrir paleta de comandos"
          >
            <Search className="w-4 h-4" />
            <kbd className="hidden lg:inline text-[9px] border border-[var(--nc-border-light)]/50 px-1 text-[var(--nc-text)] rounded-sm">
              Ctrl K
            </kbd>
          </button>
        )}
        <span className="font-bold text-xs shrink-0 hidden md:inline ml-1">COMMANDER AI STUDIO</span>
      </div>

      <div className="flex items-center gap-0.5 shrink-0 app-no-drag">
        {/* Menú de usuario: perfil, cuenta y cierre de sesión. */}
        <div ref={userMenuRef} className="relative shrink-0">
          <button
            ref={userMenuButtonRef}
            type="button"
            onClick={() => setUserMenuOpen((value) => !value)}
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            aria-controls="header-user-menu"
            className="nc-button text-xs !px-1 !py-0.5 !mx-0 flex items-center gap-1"
            data-tooltip={currentUser ? "Cuenta de Usuario & Perfil" : "Iniciar Sesión / Registro"}
            aria-label={lang === 'es' ? 'Cuenta de usuario' : lang === 'de' ? 'Benutzerkonto' : 'User account'}
            data-tooltip-sub={
              currentUser
                ? `Conectado como ${currentUser.email || currentUser.displayName}`
                : "Clic para iniciar sesión, registrarse o continuar como invitado"
            }
          >
            <User className="w-3.5 h-3.5 text-[var(--nc-text-accent)] user-led-blink" />
            <span className="max-w-[100px] truncate font-bold hidden sm:inline">
              {currentUser
                ? (currentUser.displayName || currentUser.email?.split('@')[0])
                : 'INVITADO'}
            </span>
            <ChevronDown
              className={`h-3 w-3 text-[var(--nc-text-accent)] transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </button>

          {userMenuOpen && (
            <div
              id="header-user-menu"
              role="menu"
              aria-label={lang === 'es' ? 'Menú de usuario' : lang === 'de' ? 'Benutzermenü' : 'User menu'}
              className="absolute right-0 top-full z-50 mt-1 w-64 max-w-[85vw] border-2 border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] text-[var(--nc-text)] shadow-[4px_4px_0_var(--nc-shadow)]"
            >
              <div className="border-b border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)] px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <div
                    aria-hidden
                    className="flex h-8 w-8 shrink-0 items-center justify-center border border-[var(--nc-border-light)] bg-[var(--nc-highlight-bg)] text-sm font-bold text-black"
                  >
                    {profileInitial}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-bold text-[var(--nc-text-accent)]">{profileName}</div>
                    <div className="truncate text-[10px] text-[var(--nc-text)]" title={profileDetail}>
                      {profileDetail}
                    </div>
                  </div>
                </div>
                <div className="mt-1 text-[9px] font-bold uppercase tracking-wide opacity-70">
                  {currentUser
                    ? (lang === 'es' ? 'Cuenta conectada' : lang === 'de' ? 'Angemeldet' : 'Signed in')
                    : (lang === 'es' ? 'Sesión de invitado' : lang === 'de' ? 'Gastsitzung' : 'Guest session')}
                </div>
              </div>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setUserMenuOpen(false);
                  onOpenAuth();
                }}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] font-bold text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)] focus-visible:outline-2 focus-visible:outline-[var(--nc-text-accent)]"
              >
                {currentUser ? (
                  <User className="h-3.5 w-3.5 text-[var(--nc-text-accent)]" aria-hidden />
                ) : (
                  <LogIn className="h-3.5 w-3.5 text-[var(--nc-text-accent)]" aria-hidden />
                )}
                <span>
                  {currentUser
                    ? (lang === 'es' ? 'Cuenta' : lang === 'de' ? 'Konto' : 'Account')
                    : (lang === 'es' ? 'Iniciar sesión o registrarse' : lang === 'de' ? 'Anmelden oder registrieren' : 'Sign in or register')}
                </span>
              </button>

              {currentUser && onLogout && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setUserMenuOpen(false);
                    void onLogout();
                  }}
                  className="flex w-full items-center gap-2 border-t border-[var(--nc-border-dark)] px-2 py-1.5 text-left text-[11px] font-bold text-[var(--nc-danger)] hover:bg-[var(--nc-bg-hover)] focus-visible:outline-2 focus-visible:outline-[var(--nc-danger)]"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden />
                  <span>{lang === 'es' ? 'Cerrar sesión' : lang === 'de' ? 'Abmelden' : 'Sign out'}</span>
                </button>
              )}
            </div>
          )}
        </div>

        {onOpenPreferences && (
          <>
            {/* Aire entre la cuenta y Configuración: iban prácticamente juntos. */}
            <span aria-hidden className="w-1.5 shrink-0" />
            <button
              type="button"
              onClick={onOpenPreferences}
            className="nc-button !px-1 !py-0.5 !mx-0 flex items-center gap-1"
            data-tooltip="Configuración"
            data-tooltip-sub="Modelo, proveedores, apariencia, agente, extensiones, ayuda y rutas (Ctrl+,)"
            aria-label={lang === 'es' ? 'Abrir configuración' : lang === 'de' ? 'Konfiguration öffnen' : 'Open settings'}
          >
              <Settings className="w-4 h-4 text-[var(--nc-text-accent)]" />
            </button>
          </>
        )}

        {/* Botones de ventana nativa Electron (Minimizar, Maximizar, Cerrar) */}
        <div className="flex items-center border-l border-black pl-0.5 ml-0.5 gap-0.5">
          <button
            type="button"
            onClick={handleMinimize}
            className="nc-button !px-1 !py-0.5 !mx-0 text-xs hover:bg-[var(--nc-highlight-bg)] hover:text-black font-bold"
            data-tooltip="Minimizar Ventana"
            aria-label={lang === 'es' ? 'Minimizar ventana' : lang === 'de' ? 'Fenster minimieren' : 'Minimize window'}
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleMaximize}
            className="nc-button !px-1 !py-0.5 !mx-0 text-xs hover:bg-[var(--nc-active-bg)] hover:text-black font-bold"
            data-tooltip="Pantalla Completa / Maximizar"
            aria-label={lang === 'es' ? 'Pantalla completa' : lang === 'de' ? 'Vollbild' : 'Full screen'}
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="nc-button group !px-1 !py-0.5 !mx-0 text-xs hover:bg-red-600 font-bold"
            data-tooltip="Cerrar Aplicación"
            aria-label={lang === 'es' ? 'Cerrar aplicación' : lang === 'de' ? 'Anwendung schließen' : 'Close application'}
          >
            <X className="w-3.5 h-3.5 text-red-500 group-hover:text-white" />
          </button>
        </div>
      </div>

    </header>
  );
};

export default Header;
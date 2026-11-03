import React, { useState } from 'react';
import { Menu, X, RefreshCw, Maximize2, Minimize2, Settings, PanelLeft, PanelRight, User, Search, ShieldCheck, Minus, Square, Palette, HelpCircle, Info, Eye, EyeOff } from 'lucide-react';
import { StudioMode } from '../types/studio';
import { Language, TRANSLATIONS } from '../i18n/translations';

export type ConsoleTheme = 'norton' | 'matrix' | 'amber' | 'dos' | 'light' | 'solarized';

/** Encabezado de sección dentro del menú hamburguesa. */
const MenuSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mb-1">
    <div className="text-[10px] font-bold text-[#ffff55] uppercase tracking-wider px-2 pt-2 pb-1 border-b border-[#00ffff]/25 mt-1">
      {title}
    </div>
    <div className="flex flex-col">{children}</div>
  </div>
);

/** Botón de acción del menú (ancho completo, icono vectorial + etiqueta). */
const MenuButton: React.FC<{
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
  /** Línea descriptiva secundaria (opcional). */
  desc?: string;
  /** Atajo de teclado mostrado a la derecha (opcional). */
  kbd?: string;
  accent?: boolean;
}> = ({ icon, onClick, children, desc, kbd, accent }) => (
  <button
    type="button"
    onClick={onClick}
    className={`nc-button w-full text-left my-0.5 flex items-start gap-2 text-xs ${
      accent ? 'bg-[#ffff55] text-black hover:bg-white font-bold' : ''
    }`}
  >
    <span className="mt-0.5 shrink-0">{icon}</span>
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-2">
        <span className="truncate">{children}</span>
        {kbd && (
          <kbd className="ml-auto shrink-0 text-[9px] font-mono px-1 py-0.5 border border-[#00ffff]/40 text-[#00ffff]/70 rounded-sm">
            {kbd}
          </kbd>
        )}
      </span>
      {desc && <span className="block text-[10px] text-[#00ffff]/50 truncate">{desc}</span>}
    </span>
  </button>
);


interface HeaderProps {
  mode: StudioMode;
  setMode: (mode: StudioMode) => void;
  selectedModel: string;
  onOpenInspector: () => void;
  onToggleSidebar: () => void;
  /** Abre/cierra el panel Workbench (derecho). */
  onToggleWorkbench: () => void;
  /** true si el Workbench está visible (para marcar el botón). */
  isWorkbenchOpen?: boolean;
  onOpenAuth: () => void;
  currentUser: any;
  guestName?: string;
  promptTitle: string;
  lang?: Language;
  onOpenHelp?: () => void;
  onOpenAbout?: () => void;
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
  onOpenInspector,
  onToggleSidebar,
  onToggleWorkbench,
  isWorkbenchOpen = false,
  onOpenAuth,
  currentUser,
  lang = 'es',
  onOpenHelp,
  onOpenAbout,
  onOpenCommandPalette,
  onOpenPreferences,
  onToggleNono,
  isNonoVisible = true,
}) => {
  const t = TRANSLATIONS[lang];
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const menuBtnRef = React.useRef<HTMLButtonElement>(null);

  // Aplica el tamaño de texto guardado al montar (el control vive en Preferencias).
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('commander_font_scale');
      const scale = saved === 'lg' || saved === 'xl' ? saved : 'normal';
      document.documentElement.classList.remove('font-scale-normal', 'font-scale-lg', 'font-scale-xl');
      document.documentElement.classList.add(`font-scale-${scale}`);
    } catch {}
  }, []);

  // Estado real de pantalla completa (para la sección Consola del menú).
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => {
    try {
      return !!document.fullscreenElement;
    } catch {
      return false;
    }
  });

  React.useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const handleToggleFullscreen = () => {
    try {
      const request = document.fullscreenElement
        ? document.exitFullscreen?.()
        : document.documentElement.requestFullscreen?.();
      request?.catch?.(() => {});
    } catch {
      /* pantalla completa no disponible en este entorno */
    }
  };

  const handleReloadConsole = () => {
    setMenuOpen(false);
    window.location.reload();
  };

  React.useEffect(() => {
    if (!menuOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!target) return;
      if (
        menuRef.current && 
        !menuRef.current.contains(target) &&
        menuBtnRef.current &&
        !menuBtnRef.current.contains(target)
      ) {
        setMenuOpen(false);
      }
    };

    const timer = setTimeout(() => {
      window.addEventListener('click', handleOutsideClick);
      window.addEventListener('keydown', handleKeyDown);
    }, 20);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

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
        >
            <PanelLeft className="w-4 h-4" />
        </button>
        <button
          onClick={onToggleWorkbench}
          className={`nc-button !px-1 !py-0.5 !mx-0 shrink-0 ${isWorkbenchOpen ? 'bg-[#000080] text-[#00ffff]' : ''}`}
          data-tooltip="Workbench (Panel Derecho)"
          data-tooltip-sub="Archivos, pestañas, terminal y navegador integrados"
        >
          <PanelRight className="w-4 h-4" />
        </button>
        {onToggleNono && (
          <button
            onClick={onToggleNono}
            className={`nc-button !px-1 !py-0.5 !mx-0 shrink-0 ${isNonoVisible ? 'bg-[#000080] text-[#00ffff]' : ''}`}
            data-tooltip={isNonoVisible ? 'Ocultar asistente Nono' : 'Mostrar asistente Nono'}
            data-tooltip-sub="Activa o desactiva el flotante en pantalla"
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
            <kbd className="hidden lg:inline text-[9px] border border-[#00ffff]/50 px-1 text-[#00ffff] rounded-sm">
              Ctrl K
            </kbd>
          </button>
        )}
        <span className="font-bold text-xs shrink-0 hidden md:inline ml-1">COMMANDER AI STUDIO</span>
      </div>

      <div className="flex items-center gap-0.5 shrink-0 app-no-drag">
        {/* Botón de usuario con nombre y LED parpadeante - abre modal de auth */}
        <button
          onClick={onOpenAuth}
          className="nc-button text-xs !px-1 !py-0.5 !mx-0 flex items-center gap-1"
          data-tooltip={currentUser ? "Cuenta de Usuario & Perfil" : "Iniciar Sesión / Registro"}
          data-tooltip-sub={
            currentUser
              ? `Conectado como ${currentUser.email || currentUser.displayName}`
              : "Clic para iniciar sesión, registrarse o continuar como invitado"
          }
        >
          <User className="w-3.5 h-3.5 text-[#ffff55] user-led-blink" />
          <span className="max-w-[100px] truncate font-bold hidden sm:inline">
            {currentUser
              ? (currentUser.displayName || currentUser.email?.split('@')[0])
              : 'INVITADO'}
          </span>
        </button>

        <button 
          ref={menuBtnRef}
          onClick={() => setMenuOpen((prev) => !prev)} 
          className={`nc-button !px-1 !py-0.5 !mx-0 ${menuOpen ? 'nc-active' : ''}`} 
          data-tooltip="Menú de Configuración & Utilidades"
          data-tooltip-sub="Acceso a compilador nativo, temas visuales, idioma y parámetros"
        >
          {menuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
        </button>

        {/* Botones de ventana nativa Electron (Minimizar, Maximizar, Cerrar) */}
        <div className="flex items-center border-l border-black pl-0.5 ml-0.5 gap-0.5">
          <button
            type="button"
            onClick={handleMinimize}
            className="nc-button !px-1 !py-0.5 !mx-0 text-xs hover:bg-[#00ffff] hover:text-black font-bold"
            data-tooltip="Minimizar Ventana"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleMaximize}
            className="nc-button !px-1 !py-0.5 !mx-0 text-xs hover:bg-[#ffff55] hover:text-black font-bold"
            data-tooltip="Pantalla Completa / Maximizar"
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="nc-button group !px-1 !py-0.5 !mx-0 text-xs hover:bg-red-600 font-bold"
            data-tooltip="Cerrar Aplicación"
          >
            <X className="w-3.5 h-3.5 text-red-500 group-hover:text-white" />
          </button>
        </div>
      </div>

      {menuOpen && (
        <div ref={menuRef} className="absolute top-12 right-2 nc-panel p-2 w-80 z-50 shadow-2xl border-2 border-[#00ffff] bg-[#000080] app-no-drag max-h-[85vh] overflow-y-auto">
          {/* Cabecera del menú */}
          <div className="flex items-center justify-between text-[11px] font-bold text-[#ffff55] px-2 py-1 border-b-2 border-[#00ffff]/40 mb-1 uppercase tracking-wider bg-[#0000aa]">
            <span>── {t.setupMenu} ──</span>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label={lang === 'es' ? 'Cerrar menú' : lang === 'de' ? 'Menü schließen' : 'Close menu'}
              title={lang === 'es' ? 'Cerrar menú (Escape)' : lang === 'de' ? 'Menü schließen (Escape)' : 'Close menu (Escape)'}
              className="text-white hover:text-black hover:bg-red-500 p-0.5 border border-transparent hover:border-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* ── AJUSTES ── */}
          <MenuSection title={lang === 'es' ? 'Ajustes' : lang === 'de' ? 'Einstellungen' : 'Settings'}>
            <MenuButton
              icon={<Settings className="w-4 h-4 text-[#ffff55]" />}
              onClick={() => { onOpenInspector(); setMenuOpen(false); }}
              desc={lang === 'es' ? 'Modelo, temperatura, tokens y exportación' : lang === 'de' ? 'Modell, Temperatur, Token & Export' : 'Model, temperature, tokens & export'}
              kbd="Ctrl ,"
            >
              {lang === 'es' ? 'Configuración / Parámetros' : lang === 'de' ? 'Einstellungen / Parameter' : 'Settings / Parameters'}
            </MenuButton>
            {onOpenPreferences && (
              <MenuButton
                icon={<Palette className="w-4 h-4 text-[#ffff55]" />}
                onClick={() => { onOpenPreferences(); setMenuOpen(false); }}
                desc={lang === 'es' ? 'Tema, idioma, tamaño de texto, energía y carpetas' : lang === 'de' ? 'Design, Sprache, Textgröße, Energie & Ordner' : 'Theme, language, text size, power & folders'}
              >
                {lang === 'es' ? 'Preferencias' : lang === 'de' ? 'Einstellungen' : 'Preferences'}
              </MenuButton>
            )}
          </MenuSection>

          {/* ── CONSOLA ── */}
          <MenuSection title={lang === 'es' ? 'Consola' : lang === 'de' ? 'Konsole' : 'Console'}>
            <MenuButton
              icon={<RefreshCw className="w-4 h-4 text-[#00ffff]" />}
              onClick={handleReloadConsole}
              desc={lang === 'es' ? 'Recarga la interfaz y reinicia el estado' : lang === 'de' ? 'Lädt die Oberfläche neu und setzt den Zustand zurück' : 'Reloads the UI and resets state'}
            >
              {lang === 'es' ? 'Refrescar consola' : lang === 'de' ? 'Konsole neu laden' : 'Reload console'}
            </MenuButton>
            <MenuButton
              icon={
                isFullscreen
                  ? <Minimize2 className="w-4 h-4 text-[#00ffff]" />
                  : <Maximize2 className="w-4 h-4 text-[#00ffff]" />
              }
              onClick={() => { handleToggleFullscreen(); setMenuOpen(false); }}
              desc={lang === 'es' ? 'Alterna la pantalla completa del navegador' : lang === 'de' ? 'Vollbild im Browser umschalten' : 'Toggle browser fullscreen'}
            >
              {isFullscreen
                ? (lang === 'es' ? 'Salir de pantalla completa' : lang === 'de' ? 'Vollbild beenden' : 'Exit fullscreen')
                : (lang === 'es' ? 'Pantalla completa' : lang === 'de' ? 'Vollbild' : 'Fullscreen')}
            </MenuButton>
          </MenuSection>

          {/* ── CUENTA ── */}
          <MenuSection title={lang === 'es' ? 'Cuenta' : lang === 'de' ? 'Konto' : 'Account'}>
            <MenuButton
              icon={<ShieldCheck className="w-4 h-4 text-[#ffff55]" />}
              onClick={() => { onOpenAuth(); setMenuOpen(false); }}
            >
              {t.loginRegister}
            </MenuButton>
          </MenuSection>

          {/* ── AYUDA ── */}
          <MenuSection title={lang === 'es' ? 'Ayuda' : lang === 'de' ? 'Hilfe' : 'Help'}>
            {onOpenHelp && (
              <MenuButton
                icon={<HelpCircle className="w-4 h-4 text-[#00ffff]" />}
                onClick={() => { onOpenHelp(); setMenuOpen(false); }}
              >
                {t.helpManual}
              </MenuButton>
            )}
            {onOpenAbout && (
              <MenuButton
                icon={<Info className="w-4 h-4 text-[#00ffff]" />}
                onClick={() => { onOpenAbout(); setMenuOpen(false); }}
              >
                {t.aboutApp}
              </MenuButton>
            )}
          </MenuSection>
        </div>
      )}

    </header>
  );
};

export default Header;
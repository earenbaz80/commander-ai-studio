import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Cpu, Terminal } from 'lucide-react';
import { Language } from '../i18n/translations';

interface RetroBiosBootProps {
  onComplete: () => void;
  lang?: Language;
  theme?: 'norton' | 'matrix' | 'amber' | 'dos' | 'light' | 'solarized';
}

export const RetroBiosBoot: React.FC<RetroBiosBootProps> = ({
  onComplete,
  lang = 'es',
  theme = 'norton',
}) => {
  // `onComplete` suele llegar como flecha inline: su identidad cambia en
  // cada render del padre. Guardarlo en una ref y depender sólo de `lang`
  // evita que cada re-render reinicie la secuencia (y el failsafe) a cero.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [bootFinished, setBootFinished] = useState(false);

  const themeColors = {
    norton: { bg: 'bg-[var(--nc-bg-panel)]', text: 'text-white', primary: 'text-[var(--nc-text-accent)]', border: 'border-[var(--nc-border-light)]' },
    matrix: { bg: 'bg-black', text: 'text-[var(--nc-success)]', primary: 'text-[var(--nc-success)]', border: 'border-[var(--nc-success)]' },
    amber: { bg: 'bg-black', text: 'text-[#ffb000]', primary: 'text-[#ffb000]', border: 'border-[#ffb000]' },
    dos: { bg: 'bg-black', text: 'text-gray-300', primary: 'text-white', border: 'border-white' },
    // Los temas nuevos se pintan con los tokens para no repetir literales.
    light: {
      bg: 'bg-[var(--nc-bg-main)]',
      text: 'text-[var(--nc-text)]',
      primary: 'text-[var(--nc-text-accent)]',
      border: 'border-[var(--nc-border-light)]',
    },
    solarized: {
      bg: 'bg-[var(--nc-bg-main)]',
      text: 'text-[var(--nc-text)]',
      primary: 'text-[var(--nc-text-accent)]',
      border: 'border-[var(--nc-border-light)]',
    },
  }[theme] || { bg: 'bg-black', text: 'text-white', primary: 'text-[var(--nc-text)]', border: 'border-[var(--nc-border-light)]' };

  const stepsToUse = useMemo(() => {
  const bootSteps = [
    { text: 'COMMANDER AI BIOS V1.09.26 (C) 1986-2026 COMMANDER CORP', wait: 200 },
    { text: 'CPU: INTEL DUAL-STREAM COPROCESSOR AT 4.77MHz ... OK', wait: 350 },
    { text: 'SYSTEM TESTING: 640KB BASE RAM ... OK', wait: 300 },
    { text: 'EXTENDED RAM: 16,384KB EXPANDED EXPANSION LOADED ... OK', wait: 250 },
    { text: 'DETECTING PERIPHERALS: RETRO SOUND CARD BLASTER-16 FOUND', wait: 300 },
    { text: 'MOUNTING FILE SYSTEM (DRIVE C: WORKSPACE SESSIONS) ... OK', wait: 200 },
    { text: 'ESTABLISHING SECURE FIRESTORE HOST TUNNEL ... CONNECTED', wait: 400 },
    { text: 'BOOTLOADER: LOADING HUGGING FACE NATIVE WEB REPO CLIENTS ... OK', wait: 350 },
    { text: 'POLISHING HIGH-CONTRAST MONOCHROME CRT SHADERS ... READY', wait: 250 },
    { text: 'COMMANDER AI STUDIO KERNEL LOADED SUCCESSFULLY. READY.', wait: 150 },
  ];

  const bootStepsEn = [
    { text: 'COMMANDER AI BIOS V1.09.26 (C) 1986-2026 COMMANDER CORP', wait: 200 },
    { text: 'CPU: INTEL DUAL-STREAM COPROCESSOR AT 4.77MHz ... OK', wait: 350 },
    { text: 'SYSTEM TESTING: 640KB BASE RAM ... OK', wait: 300 },
    { text: 'EXTENDED RAM: 16,384KB EXPANDED EXPANSION LOADED ... OK', wait: 250 },
    { text: 'DETECTING PERIPHERALS: RETRO SOUND CARD BLASTER-16 FOUND', wait: 300 },
    { text: 'MOUNTING FILE SYSTEM (DRIVE C: WORKSPACE SESSIONS) ... OK', wait: 200 },
    { text: 'ESTABLISHING SECURE FIRESTORE HOST TUNNEL ... CONNECTED', wait: 400 },
    { text: 'BOOTLOADER: LOADING HUGGING FACE NATIVE WEB REPO CLIENTS ... OK', wait: 350 },
    { text: 'POLISHING HIGH-CONTRAST MONOCHROME CRT SHADERS ... READY', wait: 250 },
    { text: 'COMMANDER AI STUDIO KERNEL LOADED SUCCESSFULLY. READY.', wait: 150 },
  ];

  return lang === 'es' ? bootSteps : bootStepsEn;
  }, [lang]);

  // Los 10 pasos suman 2.750 ms y, con los 200 ms de entrada y los 600 ms de
  // salida, la secuencia completa dura ~3,55 s: el failsafe de 3.200 ms la
  // cortaba y el último paso no llegaba a verse nunca. Con el ritmo a la mitad
  // entra entera en ~1,75 s y el usuario llega antes al estudio. Un valor más
  // alto la vuelve a truncar.
  const BOOT_STEP_SCALE = 0.5;

  useEffect(() => {
    let currentStep = 0;
    const loadNextStep = () => {
      if (currentStep < stepsToUse.length) {
        const step = stepsToUse[currentStep];
        setLogs((prev) => [...prev, step.text]);
        setProgress(Math.round(((currentStep + 1) / stepsToUse.length) * 100));
        currentStep++;
        setTimeout(loadNextStep, step.wait * BOOT_STEP_SCALE);
      } else {
        setBootFinished(true);
        // Play small retro click
        try {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'square';
          osc.frequency.setValueAtTime(600, ctx.currentTime);
          gain.gain.setValueAtTime(0.08, ctx.currentTime);
          osc.start();
          osc.stop(ctx.currentTime + 0.1);
        } catch {}
        
        // Auto transition into the studio
        setTimeout(() => {
          onCompleteRef.current();
        }, 600);
      }
    };

    // Play initial start beep
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch {}

    // Safety failsafe: never block the user for more than 3.2 seconds
    const safetyTimer = setTimeout(() => {
      onCompleteRef.current();
    }, 3200);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        onCompleteRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const timer = setTimeout(loadNextStep, 200);
    return () => {
      clearTimeout(timer);
      clearTimeout(safetyTimer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [stepsToUse]);

  return (
    <div 
      onClick={() => onComplete()}
      className={`fixed inset-0 ${themeColors.bg} ${themeColors.text} flex flex-col p-8 font-mono select-none z-50 overflow-hidden cursor-pointer`}
      title="Haz clic o presiona ESC para entrar directamente al Studio"
    >
      {/* BIOS Header */}
      <div className="flex justify-between items-start border-b border-[var(--nc-border-light)]/30 pb-4 mb-6">
        <div>
          <h1 className={`text-base font-bold ${themeColors.primary} flex items-center gap-2`}>
            <Terminal className="w-5 h-5 animate-pulse" />
            COMMANDER AI SYSTEMS INC.
          </h1>
          <p className="text-[10px] opacity-70">
            RELEASE DATE: OCTOBER 2026 / CHIPSET REV-D9
          </p>
        </div>
        <div className="text-right text-[10px] opacity-90 flex flex-col items-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onComplete();
            }}
            className="bg-[var(--nc-header-bg)] text-black px-2 py-0.5 font-bold text-[10px] hover:bg-[var(--nc-highlight-bg)] transition-colors"
          >
            [ SALTAR INICIO - ESC ]
          </button>
          <p className="opacity-70">PORT: 3000 // EMULATOR: OFF</p>
        </div>
      </div>

      {/* Diagnostic Logs Screen */}
      <div className="flex-1 overflow-y-auto space-y-2 text-xs bg-black/30 p-4 border border-[var(--nc-border-light)]/10 leading-relaxed font-mono">
        {logs.map((log, idx) => (
          <div key={idx} className="flex items-center gap-2 animate-in fade-in slide-in-from-bottom-1 duration-100">
            <span className="text-[var(--nc-text)]/50 shrink-0">&gt;&gt;</span>
            <span className={idx === logs.length - 1 ? 'font-bold' : ''}>{log}</span>
          </div>
        ))}
        {!bootFinished && (
          <div className="flex items-center gap-2 text-white">
            <span className="text-[var(--nc-text)]/50 shrink-0">&gt;&gt;</span>
            <span className="bg-white/80 w-2 h-4 animate-pulse" />
          </div>
        )}
      </div>

      {/* Progress & Setup Status Bar */}
      <div className="mt-6 space-y-3">
        <div className="flex justify-between items-center text-xs font-mono">
          <span className="font-bold flex items-center gap-1.5 uppercase">
            <Cpu className="w-4 h-4 text-[var(--nc-text-accent)] animate-spin" style={{ animationDuration: '3s' }} />
            {lang === 'es' ? 'Inicializando Componentes de Interfaz...' : lang === 'de' ? 'Benutzeroberflächen-Module werden initialisiert...' : 'Initializing User Interface Modules...'}
          </span>
          <span className="font-bold text-[var(--nc-text-accent)]">{progress}%</span>
        </div>

        {/* Outer Retro Loading Bar */}
        <div className="w-full bg-black/40 border-2 border-[var(--nc-border-light)]/40 p-0.5">
          <div 
            className="h-4 bg-[var(--nc-active-bg)] transition-all duration-150 ease-out relative"
            style={{ width: `${progress}%` }}
          >
            {/* Glossy terminal scanline inside the loading bar */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-pulse" />
          </div>
        </div>

        <div className="flex justify-between text-[10px] opacity-60">
          <span>COOPERATING STACK: GEMINI FLASH &amp; HF COMPILER</span>
          <span>STATUS: {bootFinished ? 'COMPLETE / BOOTING' : 'CALIBRATING MEMORY'}</span>
        </div>
      </div>
    </div>
  );
};

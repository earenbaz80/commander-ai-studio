/**
 * Terminal integrada del Workbench.
 *
 * Ejecuta comandos reales en el servidor vía la tool `shell.run` — la MISMA
 * que usan los modelos — así que cualquier cosa que un modelo pueda ejecutar,
 * el usuario también la tiene aquí, con el mismo motor de seguridad.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Terminal, Trash2, Loader2, CornerDownLeft, ShieldAlert } from 'lucide-react';
import { runShellCommand } from '../../utils/agentToolsApi';

interface TerminalLine {
  id: string;
  kind: 'prompt' | 'stdout' | 'stderr' | 'info' | 'error';
  text: string;
  meta?: string;
}

export const TerminalView: React.FC<{ projectPath: string }> = ({ projectPath }) => {
  const [lines, setLines] = useState<TerminalLine[]>([
    {
      id: 'boot',
      kind: 'info',
      text: projectPath
        ? `Terminal integrada — directorio: ${projectPath}`
        : 'Terminal integrada — sin proyecto activo (se usa el directorio del servidor)',
    },
  ]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll al fondo
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [lines]);

  const push = useCallback((kind: TerminalLine['kind'], text: string, meta?: string) => {
    setLines((prev) => [
      ...prev.slice(-300),
      { id: `l-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind, text, meta },
    ]);
  }, []);

  const execute = async (command: string) => {
    const trimmed = command.trim();
    if (!trimmed || running) return;

    push('prompt', trimmed);
    setHistory((prev) => [trimmed, ...prev].slice(0, 50));
    setHistoryIdx(-1);
    setInput('');
    setRunning(true);

    const res = await runShellCommand(trimmed, 30_000, projectPath || undefined);
    setRunning(false);

    if (!res.ok || !res.data) {
      push('error', res.error || 'Ejecución fallida');
      return;
    }
    if (res.data.stdout) push('stdout', res.data.stdout.replace(/\n$/, ''));
    if (res.data.stderr) push('stderr', res.data.stderr.replace(/\n$/, ''));
    if (!res.data.stdout && !res.data.stderr) {
      push('info', 'Comando ejecutado sin salida');
    }
    push('info', '', `exit=${res.data.exitCode} · ${res.data.durationMs}ms`);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      execute(input);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const idx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(idx);
      setInput(history[idx]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const idx = historyIdx - 1;
      if (idx < 0) {
        setHistoryIdx(-1);
        setInput('');
      } else {
        setHistoryIdx(idx);
        setInput(history[idx]);
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
    }
  };

  const quickCommands = ['ls', 'pwd', 'git status', 'node -v', 'npm run lint'];

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#000d1a]">
      {/* Salida */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed">
        {lines.map((line) => (
          <div key={line.id} className="whitespace-pre-wrap break-all">
            {line.kind === 'prompt' && (
              <div className="flex gap-1.5 text-[#00ffff]">
                <span className="text-[#ffff55] shrink-0">❯</span>
                <span className="text-white">{line.text}</span>
              </div>
            )}
            {line.kind === 'stdout' && <div className="text-[#00ffff]/90 pl-4">{line.text}</div>}
            {line.kind === 'stderr' && <div className="text-[#ff9966] pl-4">{line.text}</div>}
            {line.kind === 'error' && (
              <div className="flex gap-1.5 text-[#ff5555] pl-4">
                <ShieldAlert className="w-3 h-3 shrink-0 mt-[3px]" />
                <span>{line.text}</span>
              </div>
            )}
            {line.kind === 'info' && (
              <div className={`pl-4 ${line.meta ? 'text-[#00ffff]/35 text-[10px]' : 'text-[#ffff55]/50 italic'}`}>
                {line.text}{line.meta ? ` ${line.meta}` : ''}
              </div>
            )}
          </div>
        ))}
        {running && (
          <div className="flex items-center gap-2 text-[#ffff55] pl-4 py-1">
            <Loader2 className="w-3 h-3 animate-spin" /> ejecutando...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Comandos rápidos */}
      <div className="flex flex-wrap gap-1 px-2 pt-1 border-t border-[#004466] shrink-0">
        {quickCommands.map((cmd) => (
          <button
            key={cmd}
            onClick={() => execute(cmd)}
            disabled={running}
            className="text-[10px] font-mono px-1.5 py-0.5 bg-[#00243e] text-[#00ffff] border border-[#004466] rounded hover:bg-[#0000aa] disabled:opacity-40"
          >
            {cmd}
          </button>
        ))}
        <button
          onClick={() => setLines([])}
          className="text-[10px] font-mono px-1.5 py-0.5 text-[#ff5555] border border-[#004466] rounded hover:bg-[#330000] ml-auto"
          title="Limpiar (Ctrl+L)"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Input */}
      <div className="flex items-center gap-1.5 p-2 border-t border-[#004466] bg-[#00243e] shrink-0">
        <Terminal className="w-3.5 h-3.5 text-[#ffff55] shrink-0" />
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={running}
          placeholder="Escribe un comando y pulsa Enter (↑ historial)"
          spellCheck={false}
          autoComplete="off"
          className="flex-1 bg-transparent text-[11px] font-mono text-[#00ffff] outline-none placeholder:text-[#00ffff]/30 disabled:opacity-50"
        />
        <button
          onClick={() => execute(input)}
          disabled={running || !input.trim()}
          className="p-1 text-[#00ffff] hover:bg-[#0000aa] rounded disabled:opacity-30"
          title="Ejecutar"
        >
          <CornerDownLeft className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export default TerminalView;

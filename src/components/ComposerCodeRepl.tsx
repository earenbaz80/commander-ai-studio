import React, { useState } from 'react';
import { ProjectFile } from './ComposerPlayground';
import { 
  Play, 
  Terminal, 
  Trash2, 
  Clock, 
  CheckCircle, 
  AlertCircle, 
  Cpu
} from 'lucide-react';
import { Language } from '../i18n/translations';

interface ComposerCodeReplProps {
  files: ProjectFile[];
  lang?: Language;
}

interface ExecutionResult {
  id: string;
  code: string;
  output: string;
  returnVal?: string;
  latencyMs: number;
  isError: boolean;
  timestamp: string;
}

export const ComposerCodeRepl: React.FC<ComposerCodeReplProps> = ({
  files,
  lang = 'es',
}) => {
  const [code, setCode] = useState(`// Ejecuta código JavaScript / TypeScript real con acceso a los archivos del workspace
console.log("Archivos disponibles:", workspace.files.map(f => f.name));

const totalBytes = workspace.files.reduce((acc, f) => acc + (f.content || '').length, 0);
console.log("Tamaño total del código fuente:", totalBytes, "bytes");

return {
  status: "OK",
  filesCount: workspace.files.length,
  totalBytes,
  timestamp: Date.now()
};`);

  const [history, setHistory] = useState<ExecutionResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  // Real execution engine
  const handleExecute = async () => {
    if (!code.trim() || isRunning) return;
    setIsRunning(true);

    const startTime = performance.now();
    const capturedLogs: string[] = [];

    // Custom console to capture real outputs
    const customConsole = {
      log: (...args: any[]) => {
        capturedLogs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' '));
      },
      warn: (...args: any[]) => {
        capturedLogs.push('[WARN] ' + args.map((a) => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' '));
      },
      error: (...args: any[]) => {
        capturedLogs.push('[ERROR] ' + args.map((a) => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' '));
      },
    };

    // Workspace context bridge with real file data
    const workspace = {
      files: files.map((f) => ({
        name: f.name,
        content: f.proposedContent !== undefined ? f.proposedContent : f.originalContent,
      })),
      getFile: (name: string) => {
        const file = files.find((f) => f.name === name);
        if (!file) return null;
        return file.proposedContent !== undefined ? file.proposedContent : file.originalContent;
      },
    };

    try {
      // Create async function wrapper for real dynamic execution
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const fn = new AsyncFunction('workspace', 'console', code);
      const result = await fn(workspace, customConsole);

      const endTime = performance.now();
      const latency = Math.round((endTime - startTime) * 100) / 100;

      setHistory((prev) => [
        {
          id: Math.random().toString(),
          code,
          output: capturedLogs.join('\n'),
          returnVal: result !== undefined ? (typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)) : undefined,
          latencyMs: latency,
          isError: false,
          timestamp: new Date().toLocaleTimeString(),
        },
        ...prev,
      ]);
    } catch (err: any) {
      const endTime = performance.now();
      const latency = Math.round((endTime - startTime) * 100) / 100;

      setHistory((prev) => [
        {
          id: Math.random().toString(),
          code,
          output: capturedLogs.join('\n'),
          returnVal: 'Error de ejecución: ' + err.message,
          latencyMs: latency,
          isError: true,
          timestamp: new Date().toLocaleTimeString(),
        },
        ...prev,
      ]);
    } finally {
      setIsRunning(false);
    }
  };

  const handleSetPreset = (presetCode: string) => {
    setCode(presetCode);
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row min-h-0 bg-[var(--nc-bg-deep)] font-mono select-none overflow-hidden p-2 gap-2">
      {/* Left Code Editor & Controls */}
      <div className="flex-1 bg-[var(--nc-bg-main)] border-2 border-[var(--nc-border-light)] flex flex-col min-h-0">
        {/* REPL Header */}
        <div className="bg-[var(--nc-header-bg)] text-black px-2 py-1 font-bold flex items-center justify-between border-b border-black shrink-0">
          <div className="flex items-center gap-1.5 text-xs">
            <Cpu className="w-4 h-4 text-black" />
            <span>{lang === 'es' ? 'MOTOR REPL DE EJECUCIÓN REAL (JS/TS)' : lang === 'de' ? 'ECHTE CODEAUSFÜHRUNG-REPL (JS/TS)' : 'REAL CODE EXECUTION REPL (JS/TS)'}</span>
          </div>
          <span className="bg-[var(--nc-bg-main)] text-[var(--nc-text-accent)] px-1.5 py-0.5 text-[10px] font-bold border border-black">
            ASYNC RUNTIME
          </span>
        </div>

        {/* Preset Task Buttons */}
        <div className="p-1.5 bg-[var(--nc-bg-panel)] border-b border-[var(--nc-border-light)] flex items-center gap-1 overflow-x-auto shrink-0">
          <span className="text-[10px] text-[var(--nc-text-accent)] font-bold shrink-0">SNIPPETS:</span>
          <button
            type="button"
            onClick={() =>
              handleSetPreset(`// Valida sintaxis JSON / Estructura en los archivos
workspace.files.forEach(f => {
  if (f.name.endsWith('.json')) {
    try {
      JSON.parse(f.content);
      console.log("✓ JSON válido:", f.name);
    } catch(e) {
      console.error("✗ Error en JSON:", f.name, e.message);
    }
  }
});
return "Validación completada";`)
            }
            className="nc-button !py-0.5 !px-1.5 text-[9px] text-[var(--nc-text)] hover:text-white shrink-0"
          >
            Validar JSONs
          </button>
          <button
            type="button"
            onClick={() =>
              handleSetPreset(`// Benchmark de procesamiento de texto en memoria
const start = performance.now();
let lines = 0;
workspace.files.forEach(f => {
  lines += (f.content.match(/\\n/g) || []).length;
});
const time = performance.now() - start;
console.log(\`Total de líneas analizadas: \${lines} en \${time.toFixed(3)} ms\`);
return { lines, executionTimeMs: time };`)
            }
            className="nc-button !py-0.5 !px-1.5 text-[9px] text-[var(--nc-text)] hover:text-white shrink-0"
          >
            Contador de Líneas & Benchmark
          </button>
          <button
            type="button"
            onClick={() =>
              handleSetPreset(`// Test de llamada HTTP Fetch real
const res = await fetch('https://api.github.com/zen');
const text = await res.text();
console.log("Zen recibido de GitHub:", text);
return { zen: text };`)
            }
            className="nc-button !py-0.5 !px-1.5 text-[9px] text-[var(--nc-text)] hover:text-white shrink-0"
          >
            Prueba HTTP Fetch
          </button>
        </div>

        {/* Textarea */}
        <div className="flex-1 p-2 min-h-0 bg-[var(--nc-bg-deep)]">
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleExecute();
              }
            }}
            placeholder="// Escribe código JavaScript asíncrono para ejecutar en tiempo real..."
            className="w-full h-full bg-[var(--nc-bg-deep)] border border-[var(--nc-border-light)] p-2 text-xs text-white font-mono outline-none resize-none leading-relaxed"
            spellCheck={false}
          />
        </div>

        {/* Action Button */}
        <div className="p-2 bg-[var(--nc-bg-panel)] border-t border-[var(--nc-border-light)] flex items-center justify-between shrink-0">
          <span className="text-[10px] text-[var(--nc-text)]">
            Presiona <kbd className="bg-[var(--nc-bg-main)] px-1 border border-white">Ctrl + Enter</kbd> para ejecutar.
          </span>
          <button
            type="button"
            onClick={handleExecute}
            disabled={isRunning || !code.trim()}
            className="bg-[var(--nc-highlight-bg)] text-black font-bold px-4 py-1.5 text-xs hover:bg-white transition-colors flex items-center gap-1.5 border border-black shadow"
          >
            <Play className="w-3.5 h-3.5 fill-black" />
            <span>{isRunning ? 'EJECUTANDO...' : 'EJECUTAR CÓDIGO REAL'}</span>
          </button>
        </div>
      </div>

      {/* Right Execution Output Log */}
      <div className="w-full md:w-96 bg-[var(--nc-bg-main)] border-2 border-[var(--nc-border-light)] flex flex-col min-h-0">
        <div className="bg-[var(--nc-header-bg)] text-black px-2 py-1 font-bold flex items-center justify-between border-b border-black shrink-0">
          <div className="flex items-center gap-1.5 text-xs">
            <Terminal className="w-4 h-4 text-black" />
            <span>RESULTADOS DE EJECUCIÓN</span>
          </div>
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setHistory([])}
              className="text-black hover:text-red-700 p-0.5 text-[10px] flex items-center gap-0.5 font-bold"
              title="Limpiar historial"
            >
              <Trash2 className="w-3 h-3" />
              <span>LIMPIAR</span>
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2 bg-[var(--nc-bg-deep)]">
          {history.length === 0 ? (
            <div className="text-center p-6 text-[#5555aa] italic text-xs">
              No hay ejecuciones recientes. Haz clic en "EJECUTAR CÓDIGO REAL" para procesar datos.
            </div>
          ) : (
            history.map((item) => (
              <div
                key={item.id}
                className={`p-2 border text-xs font-mono space-y-1 ${
                  item.isError ? 'bg-[#330000] border-red-500' : 'bg-[var(--nc-bg-deep)] border-[var(--nc-border-light)]'
                }`}
              >
                <div className="flex items-center justify-between text-[10px]">
                  <div className="flex items-center gap-1">
                    {item.isError ? (
                      <AlertCircle className="w-3 h-3 text-red-400" />
                    ) : (
                      <CheckCircle className="w-3 h-3 text-[var(--nc-success)]" />
                    )}
                    <span className={item.isError ? 'text-red-400 font-bold' : 'text-[var(--nc-success)] font-bold'}>
                      {item.isError ? 'ERROR' : 'ÉXITO'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[var(--nc-text-accent)]">
                    <Clock className="w-3 h-3" />
                    <span>{item.latencyMs} ms</span>
                    <span className="text-[#888888]">[{item.timestamp}]</span>
                  </div>
                </div>

                {item.output && (
                  <div>
                    <span className="text-[9px] text-[var(--nc-text-accent)] font-bold">SALIDA DE CONSOLA:</span>
                    <pre className="bg-[var(--nc-bg-deep)] p-1.5 text-[var(--nc-text)] text-[10px] overflow-x-auto whitespace-pre-wrap border border-black">
                      {item.output}
                    </pre>
                  </div>
                )}

                {item.returnVal && (
                  <div>
                    <span className="text-[9px] text-[var(--nc-success)] font-bold">VALOR DE RETORNO:</span>
                    <pre className="bg-[var(--nc-bg-deep)] p-1.5 text-[var(--nc-success)] text-[10px] overflow-x-auto whitespace-pre-wrap border border-black">
                      {item.returnVal}
                    </pre>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

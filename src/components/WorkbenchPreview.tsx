import React, { useState, useEffect, useRef } from 'react';
import type { ParameterConfig } from '../types/studio';

/**
 * Vistas del banco de trabajo: preview, consola y monitor de red.
 *
 * Vivían en `RightPanel.tsx` junto al panel de ajustes. Ese panel ya no se
 * monta (toda la configuración está en `PreferencesModal`), así que aquí sólo
 * quedan las tres vistas que consume `WorkbenchPanel`.
 */

const PREVIEW_EMPTY_HINT = 'Enter a URL or load local HTML';
const COMMAND_PLACEHOLDER = 'Enter command...';

export const LivePreview: React.FC<{
  projectPath: string;
  selectedModel: string;
  parameters: ParameterConfig;
}> = () => {
  const [previewUrl, setPreviewUrl] = useState<string>('http://localhost:3001');
  const [, setIsLoading] = useState(false);
  const [previewContent] = useState<string>('');
  const [mode, setMode] = useState<'iframe' | 'local'>('iframe');
  const reloadKey = useRef(0);

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center gap-2 p-2 border-b border-[var(--nc-border-dark)] bg-[var(--nc-bg-deep)]">
        <span className="text-[10px] font-mono text-[var(--nc-text)] flex-1 truncate">{mode === 'iframe' ? 'Iframe Preview' : 'Local HTML Preview'}</span>
        <input
          type="text"
          value={previewUrl}
          onChange={(e) => setPreviewUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setMode('iframe')}
          placeholder="http://localhost:3001"
          className="flex-1 bg-[var(--nc-bg-deep)] text-[10px] font-mono text-[var(--nc-text)] px-2 py-1 rounded border border-[var(--nc-border-dark)] outline-none focus:border-[var(--nc-border-light)]"
        />
        <button
          onClick={() => { setMode(mode === 'iframe' ? 'local' : 'iframe'); reloadKey.current += 1; }}
          className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-panel)] rounded"
          title={mode === 'iframe' ? 'Switch to Local HTML' : 'Switch to Iframe'}
        >
          {mode === 'iframe' ? '📁' : '🌐'}
        </button>
        <button
          onClick={() => { reloadKey.current += 1; }}
          className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-panel)] rounded"
          title="Reload"
        >
          ↻
        </button>
      </div>
      <div className="flex-1 relative bg-white">
        {mode === 'local' && previewContent ? (
          <iframe
            key={`local-${reloadKey.current}`}
            srcDoc={previewContent}
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
            className="w-full h-full border-0 bg-white"
          />
        ) : previewUrl ? (
          <iframe
            key={`iframe-${previewUrl}-${reloadKey.current}`}
            src={previewUrl}
            className="w-full h-full border-0 bg-white"
            onLoad={() => setIsLoading(false)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-4 text-[var(--nc-text)]/50">
            <span className="text-[11px] font-mono">{PREVIEW_EMPTY_HINT}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export const LiveConsole: React.FC<{
  projectPath: string;
  selectedModel: string;
}> = ({ selectedModel }) => {
  const [logs, setLogs] = useState<Array<{type: 'log' | 'error' | 'warn' | 'info', message: string, time: string}>>([]);
  const [command, setCommand] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (type: 'log' | 'error' | 'warn' | 'info', message: string) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [...prev.slice(-99), { type, message, time }]);
  };

  const handleCommand = (cmd: string) => {
    addLog('log', `> ${cmd}`);
    setCommand('');
    // Simulate command execution
    setTimeout(() => {
      addLog('info', `Executing: ${cmd}`);
      setTimeout(() => {
        addLog('log', `Command completed: ${cmd}`);
      }, 500);
    }, 100);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && command.trim()) {
      handleCommand(command.trim());
    }
  };

  // Demo logs
  useEffect(() => {
    if (!isConnected) {
      setIsConnected(true);
      addLog('info', 'Console connected to project');
      addLog('log', 'Type commands to execute in the project context');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const typeClasses: Record<'log' | 'error' | 'warn' | 'info', string> = {
    log: 'text-[var(--nc-text)]',
    error: 'text-red-300',
    warn: 'text-[var(--nc-text-accent)]',
    info: 'text-emerald-300',
  };

  return (
    <div className="flex flex-col h-full bg-[var(--nc-bg-panel)]">
      <div className="flex items-center gap-2 p-2 border-b border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)]">
        <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-red-400'}`} />
        <span className="text-[10px] font-mono text-[var(--nc-text)]">{`Live Console - ${selectedModel}`}</span>
        <div className="flex-1" />
        <button
          onClick={() => setLogs([])}
          className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-panel)] rounded text-[10px]"
          title="Clear"
        >
          🗑
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-[10px]">
        {logs.map((log, i) => (
          <div key={i} className="flex gap-2 text-[var(--nc-text)]">
            <span className="shrink-0">{log.time}</span>
            <span className={`shrink-0 ${typeClasses[log.type]}`}>
              {log.type === 'error' ? '✗' : log.type === 'warn' ? '⚠' : log.type === 'info' ? 'ℹ' : '▶'}
            </span>
            <span className={typeClasses[log.type]}>{log.message}</span>
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>
      <div className="flex gap-1 p-2 border-t border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)]">
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={COMMAND_PLACEHOLDER}
          className="flex-1 bg-[var(--nc-bg-panel)] text-[var(--nc-text)] text-[10px] px-2 py-1 rounded border border-[var(--nc-border-dark)] outline-none"
        />
        <button
          onClick={() => command.trim() && handleCommand(command.trim())}
          className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-panel)] rounded"
        >
          ▶
        </button>
      </div>
    </div>
  );
};

export const NetworkMonitor: React.FC<{ projectPath: string }> = () => {
  const [requests, setRequests] = useState<Array<{
    id: string;
    method: string;
    url: string;
    status: number | 'pending';
    time: string;
    duration: number;
  }>>([]);
  const [filter, setFilter] = useState<'all' | 'xhr' | 'fetch' | 'ws'>('all');

  const addRequest = (req: { method: string; url: string }) => {
    const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const newReq = { ...req, id, status: 'pending' as const, time, duration: 0 };
    setRequests(prev => [...prev.slice(-49), newReq]);
    
    // Simulate response
    setTimeout(() => {
      setRequests(prev => prev.map(r => 
        r.id === id ? { 
          ...r, 
          status: Math.random() > 0.1 ? 200 : 500, 
          duration: Math.floor(Math.random() * 500) + 50 
        } : r
      ));
    }, Math.random() * 1000 + 200);
  };

  // Demo requests
  useEffect(() => {
    const demoRequests = [
      { method: 'POST', url: '/api/models/live' },
      { method: 'GET', url: '/api/agent/session/123/stream' },
      { method: 'POST', url: '/api/tools/execute' },
      { method: 'GET', url: '/api/files?path=src' },
    ];
    demoRequests.forEach((req, i) => setTimeout(() => addRequest(req), i * 300));
  }, []);

  return (
    <div className="flex flex-col h-full bg-[var(--nc-bg-panel)]">
      <div className="flex items-center gap-2 p-2 border-b border-[var(--nc-border-dark)] bg-[var(--nc-bg-main)]">
        <span className="text-[10px] font-mono text-[var(--nc-text-accent)]">{'Network Monitor'}</span>
        <div className="flex-1" />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as any)}
          className="bg-[var(--nc-bg-panel)] text-[var(--nc-text)] text-[9px] px-1 py-0.5 rounded border border-[var(--nc-border-dark)] outline-none"
        >
          <option value="all">All</option>
          <option value="xhr">XHR</option>
          <option value="fetch">Fetch</option>
          <option value="ws">WebSocket</option>
        </select>
        <button
          onClick={() => setRequests([])}
          className="p-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-panel)] rounded text-[10px]"
          title="Clear"
        >
          🗑
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-[9px]">
        {requests.length === 0 ? (
          <div className="text-center text-[var(--nc-text)] py-8">{'No requests captured'}</div>
        ) : (
          requests.slice().reverse().map((req) => (
            <div key={req.id} className="flex gap-2 px-1 py-0.5 bg-[var(--nc-bg-panel)] rounded border border-[var(--nc-border-dark)] hover:border-[var(--nc-border-light)] transition-colors">
              <span className={`shrink-0 px-1.5 py-0.5 rounded text-[8px] font-bold ${req.method === 'GET' ? 'bg-emerald-400/20 text-emerald-300' : req.method === 'POST' ? 'bg-cyan-400/20 text-cyan-300' : req.method === 'DELETE' ? 'bg-red-400/20 text-red-300' : 'bg-yellow-400/20 text-yellow-300'}`}>
                {req.method}
              </span>
              <span className="flex-1 truncate text-[var(--nc-text)]">{req.url}</span>
              <span className={`shrink-0 font-bold ${req.status === 'pending' ? 'text-[var(--nc-text-accent)]' : req.status === 200 ? 'text-emerald-300' : 'text-red-300'}`}>
                {req.status === 'pending' ? '⏳' : req.status}
              </span>
              <span className="shrink-0 text-[var(--nc-text)]">{req.duration}ms</span>
              <span className="shrink-0 text-[var(--nc-text)]">{req.time}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

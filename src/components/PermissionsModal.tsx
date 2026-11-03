/**
 * Configuración avanzada del agente (P1 #5).
 *
 * Permite configurar, por proyecto:
 *   • Lista blanca de tools (allowedTools).
 *   • Globs de lectura y escritura (files.read / files.write).
 *
 * El modo (Build/Plan/Read-only) se controla desde el toggle rápido de la barra inferior.
 * Se sincroniza con el servidor vía GET/PUT /api/permissions.
 */
import React, { useEffect, useState } from 'react';
import { X, Save, Settings } from 'lucide-react';
import { getActiveProjectRoot } from '../agent/activeProject';
import { AGENT_TOOLS } from '../../security';
import { Language } from '../i18n/translations';

export interface PermissionsData {
  allowedTools: string[] | null;
  deniedTools: string[];
  files: { read: string[]; write: string[] };
}

/**
 * Ids de todas las tools del agente: el borrador de la lista blanca cuando el
 * proyecto no tiene ninguna (allowedTools = null).
 *
 * Se deriva de AGENT_TOOLS —la lista contra la que el servidor valida cada
 * llamada— en lugar de repetirla aquí. La copia manual se había quedado sin
 * `shell.job`, `browser`, `preview` ni las git avanzadas, de modo que guardar
 * el modal con esa lista aparentemente completa las desactivaba en silencio.
 */
const ALL_TOOLS: string[] = [...AGENT_TOOLS];

interface Props {
  lang: Language;
  onClose: () => void;
  onSaved?: () => void;
}

export const PermissionsModal: React.FC<Props> = ({ lang, onClose, onSaved }) => {
  const [allowedTools, setAllowedTools] = useState('');
  const [readGlobs, setReadGlobs] = useState('');
  const [writeGlobs, setWriteGlobs] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  

  
  const root = getActiveProjectRoot() || undefined;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const q = root ? `?root=${encodeURIComponent(root)}` : '';
        const res = await fetch(`/api/permissions${q}`);
        const json = await res.json();
        if (!alive) return;
        if (json.success && json.permissions) {
          const p = json.permissions;
          setAllowedTools((p.allowedTools || ALL_TOOLS).join(', '));
          setReadGlobs((p.files?.read || []).join('\n'));
          setWriteGlobs((p.files?.write || []).join('\n'));
        }
      } catch {
        /* best-effort */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [root]);

  const splitList = (s: string) =>
    s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        allowedTools: splitList(allowedTools),
        files: { read: splitList(readGlobs), write: splitList(writeGlobs) },
      };
      const res = await fetch('/api/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(root ? { root, permissions: body } : { permissions: body }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Error');
      onSaved?.();
      onClose();
    } catch (e: any) {
      setError(e?.message || (lang === 'de' ? 'Speichern fehlgeschlagen' : lang === 'es' ? 'No se pudo guardar' : 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg border-2 border-[var(--nc-border-light)] bg-[var(--nc-bg-panel)] shadow-[0_0_30px_rgba(0,255,255,0.4)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-[var(--nc-border-light)]/40 px-4 py-2">
          <div className="flex items-center gap-2 text-[var(--nc-text-accent)] text-sm font-bold">
            <Settings className="w-4 h-4" />
            {lang === 'es' ? 'Configuración avanzada' : lang === 'de' ? 'Erweiterte Einstellungen' : 'Advanced settings'}
          </div>
          <button onClick={onClose} className="text-[var(--nc-text)] hover:text-white" aria-label={lang === 'de' ? 'Schließen' : lang === 'es' ? 'Cerrar' : 'Close'}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4 text-xs">
          {loading ? (
            <p className="text-[var(--nc-text)]/70">{lang === 'es' ? 'Cargando…' : lang === 'de' ? 'Wird geladen…' : 'Loading…'}</p>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-[var(--nc-text)] font-bold">
                  {lang === 'es' ? 'Tools permitidas (lista blanca, separadas por comas)' : lang === 'de' ? 'Erlaubte Tools (Positivliste, durch Kommas getrennt)' : 'Allowed tools (whitelist, comma-separated)'}
                </label>
                <textarea
                  value={allowedTools}
                  onChange={(e) => setAllowedTools(e.target.value)}
                  rows={3}
                  className="w-full border border-[var(--nc-border-light)]/40 bg-[var(--nc-bg-deep)] px-2 py-1 font-mono text-[11px] text-white focus:border-[var(--nc-text-accent)] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[var(--nc-text)] font-bold">
                    {lang === 'es' ? 'Globs de lectura' : lang === 'de' ? 'Lese-Globs' : 'Read globs'}
                  </label>
                  <textarea
                    value={readGlobs}
                    onChange={(e) => setReadGlobs(e.target.value)}
                    rows={3}
                    placeholder="src/**"
                    className="w-full border border-[var(--nc-border-light)]/40 bg-[var(--nc-bg-deep)] px-2 py-1 font-mono text-[11px] text-white focus:border-[var(--nc-text-accent)] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[var(--nc-text)] font-bold">
                    {lang === 'es' ? 'Globs de escritura' : lang === 'de' ? 'Schreib-Globs' : 'Write globs'}
                  </label>
                  <textarea
                    value={writeGlobs}
                    onChange={(e) => setWriteGlobs(e.target.value)}
                    rows={3}
                    placeholder="tests/**"
                    className="w-full border border-[var(--nc-border-light)]/40 bg-[var(--nc-bg-deep)] px-2 py-1 font-mono text-[11px] text-white focus:border-[var(--nc-text-accent)] focus:outline-none"
                  />
                </div>
              </div>

              {error && <p className="text-red-400">{error}</p>}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--nc-border-light)]/40 px-4 py-2">
          <button
            onClick={onClose}
            className="border border-[var(--nc-border-light)]/40 bg-[var(--nc-bg-deep)] px-3 py-1 text-[var(--nc-text)] hover:bg-[var(--nc-bg-hover)]"
          >
            {lang === 'es' ? 'Cancelar' : lang === 'de' ? 'Abbrechen' : 'Cancel'}
          </button>
          <button
            onClick={save}
            disabled={saving || loading}
            className="flex items-center gap-1 border border-[var(--nc-text-accent)] bg-[var(--nc-active-bg)] px-3 py-1 font-bold text-black disabled:opacity-50"
          >
            <Save className="w-3 h-3" />
            {saving ? (lang === 'es' ? 'Guardando…' : lang === 'de' ? 'Wird gespeichert…' : 'Saving…') : (lang === 'es' ? 'Guardar' : lang === 'de' ? 'Speichern' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PermissionsModal;

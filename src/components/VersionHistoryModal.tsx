import React, { useState, useEffect } from 'react';
import { X, History, Eye } from 'lucide-react';
import { PromptVersion } from '../types/studio';
import { fetchPromptVersions } from '../lib/firebase';
import { computeLineDiff } from '../utils/diffUtils';

interface VersionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  currentInstruction?: string;
  onLoadVersion: (version: PromptVersion) => void;
}

export const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
  isOpen,
  onClose,
  projectId,
  currentInstruction = '',
  onLoadVersion,
}) => {
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [diffVersionId, setDiffVersionId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && projectId) {
      setLoading(true);
      fetchPromptVersions(projectId).then(setVersions).finally(() => setLoading(false));
    }
  }, [isOpen, projectId]);

  if (!isOpen) return null;

  // LCS line-by-line diff calculation
  const renderLineDiff = (current: string, old: string) => {
    const { lines, stats } = computeLineDiff(old, current);

    return (
      <div className="bg-[#000080] border border-[#00ffff] p-2 text-[10px] font-mono space-y-1 max-h-48 overflow-y-auto">
        <div className="text-[#ffff55] font-bold border-b border-[#00aaaa] pb-1 flex justify-between items-center">
          <span>📊 COMPARATIVA DE DIFERENCIAS (PROMPT DIFF):</span>
          <span className="text-[9px]">
            <span className="text-green-400">+{stats.addedCount}</span>{' '}
            <span className="text-red-400">-{stats.removedCount}</span>
          </span>
        </div>
        
        {lines.map((line, idx) => {
          if (line.type === 'removed') {
            return (
              <div key={`rem-${idx}`} className="bg-red-900/60 text-red-200 px-1 py-0.5 border-l-2 border-red-500">
                - {line.content || '(Línea vacía)'}
              </div>
            );
          }
          if (line.type === 'added') {
            return (
              <div key={`add-${idx}`} className="bg-green-900/60 text-green-200 px-1 py-0.5 border-l-2 border-green-500">
                + {line.content || '(Línea vacía)'}
              </div>
            );
          }
          return (
            <div key={`eq-${idx}`} className="text-white/60 px-1 py-0.5">
              &nbsp; {line.content}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2 sm:p-4 font-mono select-none cursor-pointer"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className="nc-panel w-full max-w-2xl flex flex-col border-2 border-[#00ffff] bg-[#000080] shadow-[10px_10px_0px_#000055] cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between nc-header p-2 border-b-2 border-black">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-black" />
            <span className="font-bold text-black text-xs sm:text-sm">HISTORIAL DE VERSIONES & COMPARADOR DE CAMBIOS (DIFF)</span>
          </div>
          <button type="button" onClick={onClose} className="nc-button p-1 hover:bg-red-600 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 flex-1 overflow-y-auto max-h-[80vh] space-y-3">
          {loading ? (
            <div className="p-4 text-[#ffff55] text-center text-xs animate-pulse">Cargando versiones desde Firestore...</div>
          ) : versions.length === 0 ? (
            <div className="p-4 text-[#00ffff] text-center text-xs italic">
              No se han guardado versiones anteriores aún. Puedes guardar versiones desde el panel lateral derecho.
            </div>
          ) : (
            versions.map((v) => {
              const isShowingDiff = diffVersionId === v.id;
              const versionText = v.parameters?.systemInstruction || '';

              return (
                <div key={v.id} className="border-2 border-[#00ffff] p-2.5 bg-[#0000aa] space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-[#ffff55] text-xs">{v.title}</div>
                      <div className="text-[9px] text-[#00ffff]">{new Date(v.timestamp).toLocaleString()}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setDiffVersionId(isShowingDiff ? null : v.id)}
                        className={`nc-button text-[10px] px-2 py-1 flex items-center gap-1 ${
                          isShowingDiff ? 'bg-[#ffff55] text-black font-bold' : ''
                        }`}
                      >
                        <Eye className="w-3 h-3" />
                        <span>{isShowingDiff ? 'Ocultar Diff' : 'Ver Diff'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onLoadVersion(v);
                          onClose();
                        }}
                        className="nc-button text-[10px] px-2.5 py-1 bg-[#00aaaa] text-black font-bold border-white"
                      >
                        CARGAR
                      </button>
                    </div>
                  </div>

                  {/* Diff View */}
                  {isShowingDiff && renderLineDiff(currentInstruction, versionText)}
                </div>
              );
            })
          )}
        </div>

        <div className="bg-[#00aaaa] p-2 flex items-center justify-between border-t-2 border-black text-[10px] text-black font-bold">
          <span>{versions.length} versiones registradas</span>
          <button type="button" onClick={onClose} className="nc-button text-xs">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

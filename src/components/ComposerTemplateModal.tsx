import React, { useState } from 'react';
import { COMPOSER_TEMPLATES, ComposerTemplate } from '../data/composerTemplates';
import { ProjectFile } from './ComposerPlayground';
import { X, Layers, FileCode, FolderOpen } from 'lucide-react';
import { Language } from '../i18n/translations';

interface ComposerTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (files: ProjectFile[], templateTitle: string) => void;
  lang?: Language;
}

export const ComposerTemplateModal: React.FC<ComposerTemplateModalProps> = ({
  isOpen,
  onClose,
  onSelectTemplate,
  lang = 'es',
}) => {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(COMPOSER_TEMPLATES[0].id);

  if (!isOpen) return null;

  const currentTemplate = COMPOSER_TEMPLATES.find((t) => t.id === selectedTemplateId) || COMPOSER_TEMPLATES[0];

  const handleApply = (template: ComposerTemplate) => {
    if (confirm(lang === 'es' ? `¿Cargar la plantilla "${template.title}" en el espacio de trabajo? Se reemplazarán los archivos actuales.` : lang === 'de' ? `Vorlage "${template.title}" laden? Die aktuellen Dateien werden ersetzt.` : `Load template "${template.title}"? Current files will be replaced.`)) {
      onSelectTemplate(template.files, template.title);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 font-mono select-none">
      <div className="w-full max-w-4xl bg-[var(--nc-bg-panel)] border-4 border-[var(--nc-border-light)] shadow-[8px_8px_0px_#000000] flex flex-col max-h-[85vh] overflow-hidden text-xs text-white">
        {/* Modal Header */}
        <div className="bg-[var(--nc-header-bg)] text-black px-3 py-1.5 font-bold flex items-center justify-between border-b-2 border-black shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-black" />
            <span className="text-sm uppercase tracking-wider">
              {lang === 'es' ? 'PLANTILLAS Y STARTERS DE PROYECTO (COMPOSER)' : lang === 'de' ? 'PROJEKT-STARTER & VORLAGEN (COMPOSER)' : 'PROJECT STARTERS & TEMPLATES (COMPOSER)'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="nc-button !py-0.5 !px-2 bg-red-600 text-white hover:bg-red-500 font-bold"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body: Left list of templates & Right preview */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden p-2 gap-2">
          {/* Templates Grid List */}
          <div className="w-full md:w-80 overflow-y-auto space-y-1.5 p-1 bg-[var(--nc-bg-main)] border-2 border-[var(--nc-border-light)] shrink-0">
            <div className="text-[10px] font-bold text-[var(--nc-text-accent)] px-1 pb-1 border-b border-[var(--nc-border-dark)]">
              ── {lang === 'es' ? 'SELECCIONA UNA ARQUITECTURA' : lang === 'de' ? 'ARCHITEKTUR AUSWÄHLEN' : 'SELECT AN ARCHITECTURE'} ──
            </div>

            {COMPOSER_TEMPLATES.map((tmpl) => {
              const isSelected = tmpl.id === selectedTemplateId;
              return (
                <div
                  key={tmpl.id}
                  onClick={() => setSelectedTemplateId(tmpl.id)}
                  className={`p-2 cursor-pointer border flex flex-col gap-1 transition-colors ${
                    isSelected
                      ? 'bg-[var(--nc-highlight-bg)] text-black border-white font-bold'
                      : 'bg-[var(--nc-bg-panel)] text-[var(--nc-text)] border-[var(--nc-border-mid)] hover:bg-[var(--nc-bg-deep)]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">{tmpl.icon}</span>
                      <span className="truncate">{tmpl.title}</span>
                    </div>
                    <span className="text-[9px] bg-[var(--nc-bg-main)] text-[var(--nc-text-accent)] px-1 py-0.2 border border-black font-bold">
                      {tmpl.badge}
                    </span>
                  </div>
                  <p className={`text-[10px] line-clamp-2 ${isSelected ? 'text-[var(--nc-active-text)]' : 'text-[var(--nc-text)]'}`}>
                    {tmpl.description}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Template Details & File List Preview */}
          <div className="flex-1 bg-[var(--nc-bg-main)] border-2 border-[var(--nc-border-light)] p-3 flex flex-col min-h-0 overflow-hidden">
            <div className="flex items-start justify-between border-b border-[var(--nc-border-light)] pb-2 mb-2 shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">{currentTemplate.icon}</span>
                  <h2 className="text-sm font-bold text-[var(--nc-text-accent)]">{currentTemplate.title}</h2>
                  <span className="bg-[var(--nc-highlight-bg)] text-black px-1.5 py-0.5 text-[10px] font-bold">
                    {currentTemplate.badge}
                  </span>
                </div>
                <p className="text-xs text-[var(--nc-text)] mt-1">{currentTemplate.description}</p>
              </div>

              <button
                type="button"
                onClick={() => handleApply(currentTemplate)}
                className="bg-[var(--nc-active-bg)] text-black hover:bg-white font-bold px-3 py-1.5 text-xs flex items-center gap-1.5 border border-black shadow shrink-0"
              >
                <FolderOpen className="w-4 h-4 text-[var(--nc-active-text)]" />
                <span>{lang === 'es' ? 'CARGAR EN COMPOSER' : lang === 'de' ? 'IM COMPOSER LADEN' : 'LOAD IN COMPOSER'}</span>
              </button>
            </div>

            <div className="text-[11px] font-bold text-[var(--nc-text-accent)] mb-1 flex items-center justify-between">
              <span>{lang === 'es' ? 'ARCHIVOS INCLUIDOS EN ESTA PLANTILLA:' : lang === 'de' ? 'IN DER VORLAGE ENTHALTENE DATEIEN:' : 'FILES INCLUDED IN TEMPLATE:'}</span>
              <span className="text-[10px] text-[var(--nc-text)]">{currentTemplate.files.length} archivos</span>
            </div>

            {/* Files List Preview */}
            <div className="flex-1 overflow-y-auto space-y-1.5 p-1 bg-[var(--nc-bg-deep)] border border-[var(--nc-border-light)]">
              {currentTemplate.files.map((file) => (
                <div key={file.name} className="bg-[var(--nc-bg-panel)] border border-[var(--nc-border-mid)] p-2 space-y-1">
                  <div className="flex items-center justify-between text-[var(--nc-text-accent)] font-bold">
                    <div className="flex items-center gap-1.5">
                      <FileCode className="w-3.5 h-3.5 text-[var(--nc-text)]" />
                      <span>{file.name}</span>
                    </div>
                    <span className="text-[9px] text-[var(--nc-text)]">
                      {file.originalContent.split('\n').length} líneas
                    </span>
                  </div>
                  <pre className="text-[10px] text-[var(--nc-text)] bg-[var(--nc-bg-deep)] p-1.5 overflow-x-auto max-h-24 border border-black">
                    <code>{file.originalContent.slice(0, 300)}...</code>
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="bg-[var(--nc-bg-panel)] border-t-2 border-[var(--nc-border-light)] p-2 flex items-center justify-between shrink-0">
          <span className="text-[10px] text-[var(--nc-text)]">
            {lang === 'es'
              ? '💡 Tip: Una vez cargada la plantilla, puedes usar el Composer con Claude 3.7 o Gemini para modificarla y luego descargar el .ZIP.'
              : lang === 'de' ? '💡 Tipp: Nach dem Laden kannst du mit Composer und Claude 3.7 oder Gemini die Dateien anpassen und als .ZIP exportieren.' : '💡 Tip: Once loaded, use Composer with Claude 3.7 or Gemini to customize files and export as .ZIP.'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="nc-button !py-1 !px-3 font-bold"
          >
            {lang === 'es' ? 'CERRAR' : lang === 'de' ? 'SCHLIESSEN' : 'CLOSE'}
          </button>
        </div>
      </div>
    </div>
  );
};

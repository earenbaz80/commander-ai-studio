import React from 'react';
import { X, BookOpen, ArrowRight } from 'lucide-react';
import { PromptTemplate } from '../types/studio';
import { PROMPT_TEMPLATES } from '../data/templates';
import { Language } from '../i18n/translations';

export interface PromptLibraryContentProps {
  onSelectTemplate: (template: PromptTemplate) => void;
  onClose: () => void;
  lang?: Language;
}

/** Contenido de la librería de plantillas (sin marco de modal). Usado por
 *  PromptLibraryModal y por la Biblioteca unificada. */
export const PromptLibraryContent: React.FC<PromptLibraryContentProps> = ({
  onSelectTemplate,
  onClose,
  lang = 'es',
}) => {
  return (
    <>
      {/* Subheader banner */}
      <div className="bg-[#0000aa] border-b-2 border-[#00ffff] px-3 py-1.5 text-xs flex justify-between items-center text-[#ffff55] shrink-0">
        <span>{lang === 'es' ? '[!] Selecciona una plantilla preconfigurada para cargar su System Instruction y Prompt.' : lang === 'de' ? '[!] Wähle eine Vorlage, um ihre Systemanweisung und ihren Prompt zu laden.' : '[!] Select a preset template to load its System Instruction and Prompt.'}</span>
        <span className="text-[10px] bg-[#00aaaa] text-black font-bold px-2 py-0.5 uppercase">
          {PROMPT_TEMPLATES.length} {lang === 'es' ? 'PLANTILLAS' : lang === 'de' ? 'VORLAGEN' : 'TEMPLATES'}
        </span>
      </div>

      {/* Templates Grid */}
      <div className="p-3 sm:p-4 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-3 flex-1 min-h-0">
        {PROMPT_TEMPLATES.map((tmpl) => (
          <div
            key={tmpl.id}
            onClick={() => {
              onSelectTemplate(tmpl);
              onClose();
            }}
            className="p-3 bg-[#0000aa] hover:bg-[#00aaaa] hover:text-black border-2 border-[#00ffff] cursor-pointer space-y-2 flex flex-col justify-between transition-colors shadow-[4px_4px_0px_#000055] group"
          >
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-1">
                <span className="font-bold text-xs sm:text-sm text-[#ffff55] group-hover:text-black uppercase">
                  {tmpl.title}
                </span>
                <span className="text-[9px] font-bold bg-[#000080] group-hover:bg-black text-[#00ffff] group-hover:text-[#ffff55] border border-[#00ffff] px-1.5 py-0.5 uppercase">
                  {tmpl.category}
                </span>
              </div>
              <p className="text-[11px] text-[#00ffff] group-hover:text-black leading-tight">
                {tmpl.description}
              </p>
            </div>

            <div className="p-2 bg-[#000055] group-hover:bg-[#000080] border border-[#00ffff] font-mono text-[10px] text-[#ffff55] line-clamp-2">
              "{tmpl.defaultPrompt}"
            </div>

            <div className="flex items-center justify-between text-[10px] font-bold text-[#ffff55] group-hover:text-black pt-1 border-t border-[#00ffff]/30">
              <span>MODELO: {tmpl.recommendedModel}</span>
              <span className="flex items-center gap-1 bg-[#000080] group-hover:bg-black text-[#00ffff] group-hover:text-[#ffff55] px-2 py-0.5 border border-[#00ffff]">
                CARGAR <ArrowRight className="w-3 h-3" />
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Footer Bar */}
      <div className="bg-[#0000aa] border-t-2 border-[#00ffff] p-2 flex justify-between items-center text-xs shrink-0">
        <span className="text-[10px] text-[#00aaaa] italic font-mono">
          Commander AI Studio - Plantillas optimizadas para Gemini, DeepSeek y HuggingFace
        </span>
        <button
          type="button"
          onClick={onClose}
          className="nc-button text-xs px-3 py-1 bg-red-600 text-white hover:bg-red-500"
        >
          Cerrar [ESC]
        </button>
      </div>
    </>
  );
};

interface PromptLibraryModalProps extends PromptLibraryContentProps {
  isOpen: boolean;
}

export const PromptLibraryModal: React.FC<PromptLibraryModalProps> = ({
  isOpen,
  onClose,
  onSelectTemplate,
  lang = 'es',
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2 sm:p-4 font-mono select-none cursor-pointer"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="nc-panel w-full max-w-4xl max-h-[88vh] flex flex-col bg-[#000080] border-2 border-[#00ffff] shadow-[10px_10px_0px_#000055] cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Retro Title Bar */}
        <div className="nc-header p-2 flex items-center justify-between border-b-2 border-black shrink-0">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-black" />
            <span className="font-bold text-black text-xs sm:text-sm tracking-wider">
              {lang === 'es' ? '╔═ LIBRERÍA DE PLANTILLAS & PROMPTS PRECONFIGURADOS ═╗' : lang === 'de' ? '╔═ BIBLIOTHEK FÜR PROMPT-VORLAGEN & VOREINSTELLUNGEN ═╗' : '╔═ PROMPT TEMPLATES & PRESETS LIBRARY ═╗'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="nc-button !px-2 !py-0.5 text-xs bg-red-600 text-white hover:bg-red-500 font-bold"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <PromptLibraryContent onSelectTemplate={onSelectTemplate} onClose={onClose} lang={lang} />
      </div>
    </div>
  );
};

export default PromptLibraryModal;
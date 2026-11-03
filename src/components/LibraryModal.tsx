import React, { useState, useEffect } from 'react';
import { X, BookOpen, Globe, Sparkles } from 'lucide-react';
import { GalleryProject } from '../lib/firebase';
import { PromptTemplate, ParameterConfig } from '../types/studio';
import { Language } from '../i18n/translations';
import { ProjectGalleryContent } from './ProjectGalleryModal';
import { PromptLibraryContent } from './PromptLibraryModal';

export type LibraryTab = 'gallery' | 'templates';

export interface LibraryModalProps {
  isOpen: boolean;
  /** Pestaña inicial: 'gallery' (Galería) o 'templates' (Plantillas de Prompts). */
  initialTab?: LibraryTab;
  onClose: () => void;
  onSelectProject: (project: GalleryProject) => void;
  onSelectTemplate: (template: PromptTemplate) => void;
  currentPromptTitle: string;
  currentSystemInstruction: string;
  currentSelectedModel: string;
  parameters: ParameterConfig;
  lang?: Language;
}

/** Biblioteca única: Galería de Proyectos + Librería de Plantillas en un solo modal
 *  con pestañas superiores. Sustituye a ProjectGalleryModal y PromptLibraryModal. */
export const LibraryModal: React.FC<LibraryModalProps> = ({
  isOpen,
  initialTab = 'gallery',
  onClose,
  onSelectProject,
  onSelectTemplate,
  currentPromptTitle,
  currentSystemInstruction,
  currentSelectedModel,
  parameters,
  lang = 'es',
}) => {
  const [tab, setTab] = useState<LibraryTab>(initialTab);

  useEffect(() => {
    if (isOpen) setTab(initialTab);
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2 sm:p-4 font-mono select-none cursor-pointer"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="nc-panel w-full max-w-5xl h-[88vh] flex flex-col bg-[var(--nc-bg-panel)] border-2 border-[var(--nc-border-light)] shadow-[10px_10px_0px_var(--nc-shadow)] cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Retro Title Bar */}
        <div className="nc-header p-2 flex items-center justify-between border-b-2 border-black shrink-0">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-black" />
            <span className="font-bold text-black text-xs sm:text-sm tracking-wider">
              {lang === 'es'
                ? '╔═ BIBLIOTECA: GALERÍA & PLANTILLAS ═╗'
                : lang === 'de' ? '╔═ BIBLIOTHEK: GALERIE & VORLAGEN ═╗' : '╔═ LIBRARY: GALLERY & TEMPLATES ═╗'}
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

        {/* Top-level tabs: Galería / Plantillas */}
        <div className="flex items-center gap-2 p-2 bg-[var(--nc-bg-main)] border-b-2 border-[var(--nc-border-light)] shrink-0">
          <button
            onClick={() => setTab('gallery')}
            className={`nc-button flex items-center gap-1.5 text-xs ${tab === 'gallery' ? 'nc-active' : ''}`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{lang === 'es' ? 'GALERÍA DE PROYECTOS' : lang === 'de' ? 'PROJEKTGALERIE' : 'PROJECT GALLERY'}</span>
          </button>
          <button
            onClick={() => setTab('templates')}
            className={`nc-button flex items-center gap-1.5 text-xs ${tab === 'templates' ? 'nc-active' : ''}`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{lang === 'es' ? 'PLANTILLAS DE PROMPTS' : lang === 'de' ? 'PROMPT-VORLAGEN' : 'PROMPT TEMPLATES'}</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {tab === 'gallery' ? (
            <ProjectGalleryContent
              onSelectProject={onSelectProject}
              onClose={onClose}
              currentPromptTitle={currentPromptTitle}
              currentSystemInstruction={currentSystemInstruction}
              currentSelectedModel={currentSelectedModel}
              parameters={parameters}
            />
          ) : (
            <PromptLibraryContent onSelectTemplate={onSelectTemplate} onClose={onClose} lang={lang} />
          )}
        </div>
      </div>
    </div>
  );
};

export default LibraryModal;
import React from 'react';
import { X, Cpu, Calendar, User, Code, Award } from 'lucide-react';
import { Language, TRANSLATIONS } from '../i18n/translations';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
}

export const AboutModal: React.FC<AboutModalProps> = ({
  isOpen,
  onClose,
  lang,
}) => {
  if (!isOpen) return null;

  const t = TRANSLATIONS[lang];

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 font-mono select-none cursor-pointer"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className="nc-panel w-full max-w-2xl bg-[var(--nc-bg-panel)] border-2 border-[var(--nc-border-light)] shadow-[10px_10px_0px_var(--nc-shadow)] cursor-default text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title Bar */}
        <div className="nc-header p-2 flex items-center justify-between border-b-2 border-black">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-black" />
            <span className="font-bold text-black text-xs sm:text-sm tracking-wider">
              {t.aboutTitle}
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

        {/* Content Box */}
        <div className="p-4 sm:p-6 space-y-4 text-[var(--nc-text)]">
          {/* Header Banner */}
          <div className="bg-[var(--nc-bg-main)] border-2 border-[var(--nc-border-light)] p-3 text-center space-y-2 shadow-[4px_4px_0px_var(--nc-shadow)] flex flex-col items-center justify-center">
            <img 
              src="/app-icon.svg" 
              alt="Commander AI Icon" 
              className="w-16 h-16 rounded-xl border-2 border-[var(--nc-border-light)] shadow-[0_0_15px_var(--nc-border-light)]" 
            />
            <h2 className="text-base sm:text-lg font-bold text-[var(--nc-text-accent)] tracking-wider uppercase">
              COMMANDER AI STUDIO
            </h2>
            <p className="text-[11px] text-[var(--nc-text-dim)]">
              {t.subtitle}
            </p>
          </div>

          {/* Details Table */}
          <div className="bg-[var(--nc-bg-main)] border-2 border-[var(--nc-border-light)] p-3 space-y-2.5">
            <div className="flex items-center gap-2 border-b border-[var(--nc-border-dark)] pb-1.5">
              <User className="w-4 h-4 text-[var(--nc-text-accent)] shrink-0" />
              <span className="text-[var(--nc-text-dim)] w-40 shrink-0 font-bold">{t.creatorLabel}</span>
              <span className="text-[var(--nc-text-accent)] font-bold text-sm tracking-wide">{t.creatorName}</span>
            </div>

            <div className="flex items-center gap-2 border-b border-[var(--nc-border-dark)] pb-1.5">
              <Calendar className="w-4 h-4 text-[var(--nc-text-accent)] shrink-0" />
              <span className="text-[var(--nc-text-dim)] w-40 shrink-0 font-bold">{t.createdDateLabel}</span>
              <span className="text-[var(--nc-text)] font-bold">{t.createdDateValue}</span>
            </div>

            <div className="flex items-center gap-2 border-b border-[var(--nc-border-dark)] pb-1.5">
              <Award className="w-4 h-4 text-[var(--nc-text-accent)] shrink-0" />
              <span className="text-[var(--nc-text-dim)] w-40 shrink-0 font-bold">{t.versionLabel}</span>
              <span className="text-[var(--nc-text-accent)] bg-[var(--nc-bg-panel)] px-2 py-0.5 border border-[var(--nc-border-light)] font-bold">
                {t.versionValue}
              </span>
            </div>

            <div className="flex items-start gap-2 border-b border-[var(--nc-border-dark)] pb-1.5">
              <Code className="w-4 h-4 text-[var(--nc-text-accent)] shrink-0 mt-0.5" />
              <span className="text-[var(--nc-text-dim)] w-40 shrink-0 font-bold">{t.techStackLabel}</span>
              <span className="text-[var(--nc-text)] leading-relaxed text-[11px]">{t.techStackValue}</span>
            </div>
          </div>

          {/* License & Credits Footer */}
          <div className="bg-[var(--nc-bg-deep)] border border-[var(--nc-border-light)] p-2.5 text-[10px] text-[var(--nc-text-dim)] italic leading-normal text-center">
            {t.licenseNotice}
          </div>
        </div>

        {/* Footer */}
        <div className="bg-[var(--nc-header-bg)] p-2 flex justify-end border-t-2 border-black">
          <button 
            type="button" 
            onClick={onClose} 
            className="nc-button bg-red-600 text-white hover:bg-red-500 font-bold text-xs px-4 py-1"
          >
            {t.close} [ESC]
          </button>
        </div>
      </div>
    </div>
  );
};

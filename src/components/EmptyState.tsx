import React from 'react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  titleClassName?: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  lang?: 'es' | 'de' | 'en';
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, titleClassName, description, action }) => {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6 py-8 space-y-3">
      {icon && <div className="text-[var(--nc-text)]/70">{icon}</div>}
      <h2 className={`text-lg font-bold text-[var(--nc-text-accent)] ${titleClassName || ''}`}>{title}</h2>
      {description && <p className="text-xs text-[var(--nc-text)]/80 max-w-md">{description}</p>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 px-4 py-1.5 bg-[var(--nc-highlight-bg)] text-black font-bold text-xs border-2 border-black hover:bg-[var(--nc-active-bg)] transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
};

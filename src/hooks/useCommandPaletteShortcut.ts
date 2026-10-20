import { useEffect } from 'react';

export function useCommandPaletteShortcut(setIsPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setIsPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setIsPaletteOpen]);
}

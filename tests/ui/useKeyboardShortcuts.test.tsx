/**
 * Atajos globales nuevos: Ctrl+Shift+P abre la paleta de comandos y Ctrl+`
 * abre el Workbench en la terminal.
 */
import { describe, test, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useKeyboardShortcuts } from '../../src/hooks/useKeyboardShortcuts';

interface ProbeProps {
  onPalette?: (v: any) => void;
  onWorkbench?: (v: any) => void;
  onSymbol?: (v: any) => void;
}

const Probe = ({ onPalette, onWorkbench, onSymbol }: ProbeProps) => {
  useKeyboardShortcuts({
    lang: 'es',
    promptTitle: '',
    parameters: {},
    tabs: { newTab: () => {}, closeTab: () => {}, tabs: { length: 1 }, activeId: 'a' },
    setIsShortcutsModalOpen: () => {},
    setIsPreferencesModalOpen: () => {},
    setIsSidebarOpen: () => {},
    setIsWorkbenchOpen: (onWorkbench ?? (() => {})) as any,
    setIsCompilerModalOpen: () => {},
    setIsSymbolSearchOpen: (onSymbol ?? (() => {})) as any,
    setIsPaletteOpen: (onPalette ?? (() => {})) as any,
    handleNewChat: () => {},
    handleSaveVersion: () => {},
    handleGeneralAudit: () => {},
    sendBrowserNotification: () => {},
  });
  return null;
};

describe('useKeyboardShortcuts', () => {
  test('Ctrl+Shift+P abre la paleta de comandos', () => {
    const onPalette = vi.fn();
    render(<Probe onPalette={onPalette} />);

    fireEvent.keyDown(window, { key: 'P', ctrlKey: true, shiftKey: true });

    expect(onPalette).toHaveBeenCalledWith(true);
  });

  test('Ctrl+P sin Shift sigue yendo al símbolo del workspace', () => {
    const onPalette = vi.fn();
    const onSymbol = vi.fn();
    render(<Probe onPalette={onPalette} onSymbol={onSymbol} />);

    fireEvent.keyDown(window, { key: 'p', ctrlKey: true });

    expect(onSymbol).toHaveBeenCalledWith(true);
    expect(onPalette).not.toHaveBeenCalled();
  });

  test('Ctrl+` abre el Workbench y le pide la terminal', () => {
    const onWorkbench = vi.fn();
    const details: any[] = [];
    const listener = (e: Event) => details.push((e as CustomEvent).detail);
    window.addEventListener('commander:open-workbench-tab', listener);
    render(<Probe onWorkbench={onWorkbench} />);

    fireEvent.keyDown(window, { key: '`', ctrlKey: true });

    window.removeEventListener('commander:open-workbench-tab', listener);
    expect(onWorkbench).toHaveBeenCalledWith(true);
    expect(details).toEqual([{ tab: 'terminal' }]);
  });
});

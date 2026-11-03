import { describe, expect, test, vi } from 'vitest';
import { buildPaletteCommands, type PaletteCommandsOptions } from '../../src/components/paletteCommands';

const base = (lang: 'es' | 'en' = 'es'): PaletteCommandsOptions => ({
  lang,
  mode: 'chat',
  setMode: vi.fn(),
  handleNewChat: vi.fn(),
  setIsGalleryModalOpen: vi.fn(),
  setIsLibraryModalOpen: vi.fn(),
  setIsInspectorOpen: vi.fn(),
  setIsSymbolSearchOpen: vi.fn(),
  setIsPreferencesModalOpen: vi.fn(),
  setIsLocalLlmModalOpen: vi.fn(),
  setIsExtensionsOpen: vi.fn(),
  setIsCompilerModalOpen: vi.fn(),
  setIsHelpModalOpen: vi.fn(),
  setIsAboutModalOpen: vi.fn(),
  setIsWorkbenchOpen: vi.fn(),
  setIsSidebarOpen: vi.fn(),
});

describe('buildPaletteCommands · fuentes universales', () => {
  test('añade archivos, sesiones, tools y agentes con sus grupos', () => {
    const commands = buildPaletteCommands({
      ...base(),
      files: [{ path: 'src/App.tsx', projectPath: '/repo/demo' }],
      onOpenFile: vi.fn(),
      sessions: [{ id: 's1', title: 'Arreglo del visor', project_path: '/repo/demo' }],
      onSelectSession: vi.fn(),
      tools: [{ name: 'fs_read', description: 'Leer archivo del workspace' }],
      onUseTool: vi.fn(),
      agents: [{ name: 'reviewer', description: 'Revisa cambios', role: 'reviewer' }],
      onUseAgent: vi.fn(),
    });

    const groups = new Set(commands.map((c) => c.group));
    expect(groups).toContain('Archivos');
    expect(groups).toContain('Sesiones');
    expect(groups).toContain('Herramientas del agente');
    expect(groups).toContain('Subagentes');
    expect(commands.find((c) => c.id === 'file:src/App.tsx')?.hint).toBe('demo');
  });

  test('ejecutar cada fuente llama a su callback', () => {
    const onOpenFile = vi.fn();
    const onSelectSession = vi.fn();
    const onUseTool = vi.fn();
    const onUseAgent = vi.fn();
    const commands = buildPaletteCommands({
      ...base(),
      files: [{ path: 'src/App.tsx' }],
      onOpenFile,
      sessions: [{ id: 's1', title: 'Sesión' }],
      onSelectSession,
      tools: [{ name: 'fs_read' }],
      onUseTool,
      agents: [{ name: 'reviewer' }],
      onUseAgent,
    });

    commands.find((c) => c.id === 'file:src/App.tsx')?.run();
    commands.find((c) => c.id === 'session:s1')?.run();
    commands.find((c) => c.id === 'tool:fs_read')?.run();
    commands.find((c) => c.id === 'agent:reviewer')?.run();

    expect(onOpenFile).toHaveBeenCalledWith('src/App.tsx');
    expect(onSelectSession).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
    expect(onUseTool).toHaveBeenCalledWith('fs_read');
    expect(onUseAgent).toHaveBeenCalledWith('reviewer');
  });

  test('sin callbacks no añade fuentes y traduce los grupos', () => {
    const commands = buildPaletteCommands({
      ...base('en'),
      files: [{ path: 'src/App.tsx' }],
    });
    expect(commands.some((c) => c.id.startsWith('file:'))).toBe(false);
    expect(commands.every((c) => c.group !== 'Archivos')).toBe(true);
  });

  test('en inglés los grupos de fuentes también se traducen', () => {
    const commands = buildPaletteCommands({
      ...base('en'),
      files: [{ path: 'src/App.tsx' }],
      onOpenFile: vi.fn(),
      sessions: [{ id: 's1', title: 'Sesión' }],
      onSelectSession: vi.fn(),
      tools: [{ name: 'fs_read' }],
      onUseTool: vi.fn(),
      agents: [{ name: 'reviewer' }],
      onUseAgent: vi.fn(),
    });
    const groups = new Set(commands.map((c) => c.group));
    expect(groups).toContain('Files');
    expect(groups).toContain('Sessions');
    expect(groups).toContain('Agent tools');
    expect(groups).toContain('Subagents');
  });
});

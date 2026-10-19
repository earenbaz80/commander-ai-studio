import { describe, test, expect, vi, beforeEach } from 'vitest';
import { extractFileMentions, resolveMentionsForPrompt } from '../../src/utils/mentionResolver';
import { readProjectFile } from '../../src/utils/agentToolsApi';

vi.mock('../../src/utils/agentToolsApi', () => ({ readProjectFile: vi.fn() }));

const mockRead = readProjectFile as unknown as ReturnType<typeof vi.fn>;

describe('extractFileMentions', () => {
  test('extrae rutas con extensión', () => {
    expect(extractFileMentions('mira @src/App.tsx y @package.json')).toEqual([
      'src/App.tsx',
      'package.json',
    ]);
  });

  test('ignora ids estáticos sin extensión', () => {
    expect(extractFileMentions('@model @docs:tauri @git:diff @system')).toEqual([]);
  });

  test('deduplica rutas repetidas', () => {
    expect(extractFileMentions('@a/b.ts y otra vez @a/b.ts')).toEqual(['a/b.ts']);
  });
});

describe('resolveMentionsForPrompt', () => {
  beforeEach(() => {
    mockRead.mockReset();
  });

  test('adjunta los archivos reales mencionados', async () => {
    mockRead.mockResolvedValue({ content: 'export const x = 1;' });

    const r = await resolveMentionsForPrompt('revisa @src/a.ts', { root: 'P' });

    expect(mockRead).toHaveBeenCalledWith('src/a.ts', 40000, 'P');
    expect(r.files).toEqual(['src/a.ts']);
    expect(r.context).toContain('=== CONTEXT: @src/a.ts ===');
    expect(r.context).toContain('export const x = 1;');
  });

  test('incluye las menciones estáticas que no son de archivo', async () => {
    const r = await resolveMentionsForPrompt('usa @docs:tauri', {});
    expect(r.context).toContain('TAURI');
    expect(mockRead).not.toHaveBeenCalled();
  });

  test('un archivo ilegible no añade contexto', async () => {
    mockRead.mockResolvedValue({ error: 'El archivo no existe' });

    const r = await resolveMentionsForPrompt('@src/nope.ts', {});

    expect(r.files).toEqual([]);
    expect(r.context).toBe('');
  });
});

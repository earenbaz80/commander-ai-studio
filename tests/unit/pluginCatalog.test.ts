import { describe, test, expect } from 'vitest';
import {
  classifyPluginFile,
  filterPlugins,
  normalizeMarketplacePlugins,
  normalizePluginSource,
} from '../../src/plugins/catalog';

const marketplace = {
  name: 'claude-plugins-official',
  plugins: [
    {
      name: 'commit-commands',
      description: 'Flujos de git para commit, push y PR',
      version: '1.0.0',
      category: 'productivity',
      author: { name: 'Anthropic' },
      source: './plugins/commit-commands',
    },
    {
      name: 'external-tool',
      description: 'Vive en su propio repo',
      source: { source: 'github', repo: 'acme/external-tool' },
    },
    {
      name: 'subdir-tool',
      description: 'Carpeta concreta de otro repo',
      source: {
        source: 'git-subdir',
        url: 'https://github.com/acme/tools.git',
        path: 'plugins/subdir-tool',
        ref: 'v1.2.0',
      },
    },
    {
      name: 'sin-fuente',
      source: 42,
    },
    { description: 'sin nombre válido', source: './plugins/x' },
  ],
};

describe('catálogo de plugins', () => {
  test('normaliza las entradas del marketplace.json', () => {
    const entries = normalizeMarketplacePlugins('anthropics/claude-plugins-official', marketplace);

    // La entrada sin nombre válido se descarta.
    expect(entries).toHaveLength(4);

    const local = entries.find((entry) => entry.name === 'commit-commands')!;
    expect(local).toMatchObject({
      id: 'commit-commands@claude-plugins-official',
      marketplace: 'anthropics/claude-plugins-official',
      sourceKind: 'path',
      sourcePath: 'plugins/commit-commands',
      installable: true,
      author: 'Anthropic',
      category: 'productivity',
    });

    const external = entries.find((entry) => entry.name === 'external-tool')!;
    expect(external.installable).toBe(false);
    expect(external.repo).toBe('acme/external-tool');
    expect(external.reason).toContain('otro repositorio');

    const subdir = entries.find((entry) => entry.name === 'subdir-tool')!;
    expect(subdir).toMatchObject({
      sourceKind: 'git-subdir',
      sourcePath: 'plugins/subdir-tool',
      repo: 'acme/tools',
      ref: 'v1.2.0',
      installable: true,
    });

    expect(entries.find((entry) => entry.name === 'sin-fuente')!.installable).toBe(false);
  });

  test('entiende las formas de `source`', () => {
    expect(normalizePluginSource('./plugins/x')).toEqual({ kind: 'path', sourcePath: 'plugins/x' });
    expect(normalizePluginSource('owner/repo')).toEqual({ kind: 'github', repo: 'owner/repo' });
    expect(normalizePluginSource({ source: 'git', url: 'https://git.example/x.git' })).toEqual({ kind: 'git' });
    expect(normalizePluginSource({ source: 'github', repo: 'a/b' })).toEqual({ kind: 'github', repo: 'a/b' });
    expect(
      normalizePluginSource({ source: 'git-subdir', url: 'https://github.com/a/b', path: './p/x', ref: 'main' })
    ).toEqual({ kind: 'git-subdir', sourcePath: 'p/x', repo: 'a/b', ref: 'main' });
    // Sin carpeta no hay nada que traerse: no es instalable.
    expect(normalizePluginSource({ source: 'git-subdir', url: 'https://github.com/a/b' })).toEqual({
      kind: 'unknown',
    });
    expect(normalizePluginSource(null)).toEqual({ kind: 'unknown' });
  });

  test('clasifica los archivos del plugin por lo que aportan', () => {
    expect(classifyPluginFile('skills/pdf/SKILL.md')).toEqual({ kind: 'skill', slug: 'pdf' });
    expect(classifyPluginFile('agents/reviewer.md')).toEqual({ kind: 'agent', slug: 'reviewer' });
    expect(classifyPluginFile('commands/commit.md')).toEqual({ kind: 'command', slug: 'commit' });
    expect(classifyPluginFile('.mcp.json')).toEqual({ kind: 'mcp' });
    expect(classifyPluginFile('README.md')).toEqual({ kind: 'other' });
  });

  test('filtra por nombre, descripción o categoría y respeta el límite', () => {
    const entries = normalizeMarketplacePlugins('anthropics/claude-plugins-official', marketplace);
    expect(filterPlugins(entries, 'git', 10).map((entry) => entry.name)).toEqual(['commit-commands']);
    expect(filterPlugins(entries, 'productivity', 10).map((entry) => entry.name)).toEqual(['commit-commands']);
    expect(filterPlugins(entries, '', 2)).toHaveLength(2);
    expect(filterPlugins(entries, 'subdir', 10).map((entry) => entry.name)).toEqual(['subdir-tool']);
    expect(filterPlugins(entries, 'nada-que-ver', 10)).toEqual([]);
  });
});

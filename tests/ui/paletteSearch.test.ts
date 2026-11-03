import { describe, expect, test } from 'vitest';
import { normalizeForSearch, rankCommands } from '../../src/components/paletteSearch';
import type { CommandItem } from '../../src/components/CommandPalette';

const make = (id: string, label: string, group: string, keywords = '', hint?: string): CommandItem => ({
  id,
  label,
  group,
  keywords,
  hint,
  run: () => {},
});

const commands: CommandItem[] = [
  make('chat', 'Chat conversacional', 'Modos', 'dialogo'),
  make('composer', 'Composer multi-archivo', 'Modos', 'codigo diffs'),
  make('telemetry', 'Telemetría y rendimiento', 'Modos', 'metricas tokens'),
  make('config', 'Configuración / Parámetros', 'Herramientas', 'ajustes'),
  make('file', 'src/components/CommandPalette.tsx', 'Archivos', 'archivo file'),
];

const labels = (query: string) => rankCommands(commands, query).map((c) => c.label);

describe('paletteSearch', () => {
  test('normaliza mayúsculas y acentos', () => {
    expect(normalizeForSearch('Telemetría')).toBe('telemetria');
  });

  test('sin consulta conserva el orden original', () => {
    expect(labels('')).toEqual(commands.map((c) => c.label));
  });

  test('encuentra por subcadena y sin acentos', () => {
    expect(labels('telemetria')).toEqual(['Telemetría y rendimiento']);
  });

  test('acepta subsecuencias (cmpsr → Composer)', () => {
    expect(labels('cmpsr')).toContain('Composer multi-archivo');
  });

  test('acepta subsecuencias en rutas (cpalt → CommandPalette)', () => {
    expect(labels('cpalt')).toContain('src/components/CommandPalette.tsx');
  });

  test('exige que todos los tokens coincidan y busca en palabras clave', () => {
    expect(labels('ajustes config')).toEqual(['Configuración / Parámetros']);
    expect(labels('config metricas')).toEqual([]);
  });

  test('prioriza la etiqueta sobre las palabras clave', () => {
    const ranked = rankCommands(
      [
        make('keyword', 'Otra cosa', 'Herramientas', 'composer'),
        make('label', 'Composer multi-archivo', 'Modos'),
      ],
      'composer'
    );
    expect(ranked[0]?.id).toBe('label');
  });

  test('descarta una coincidencia de una sola letra que no sea subcadena', () => {
    expect(labels('z')).toEqual([]);
  });
});

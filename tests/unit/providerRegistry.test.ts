import { describe, expect, test } from 'vitest';
import {
  PROVIDER_SPECS,
  buildProviderList,
  describeProvider,
  parseModelsDev,
} from '../../src/providers/registry';
import { filterModelIds, isProviderEnabled, matchesModelPattern, parseFilterList } from '../../src/lib/providerFilters';

/**
 * El registro es lo que decide qué proveedores se pueden configurar y qué
 * modelos trae cada uno. Lo que se prueba aquí es el contrato con models.dev
 * (mapa proveedor → models, no lista plana) y el estado real de cada uno.
 */

const payload = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    env: ['ANTHROPIC_API_KEY'],
    models: {
      'claude-sonnet-4': {
        name: 'Claude Sonnet 4',
        tool_call: true,
        context_window: 200_000,
        input_modalities: ['text', 'image'],
      },
      'claude-viejo': { name: 'Claude viejo', deprecated: true },
    },
  },
  google: {
    id: 'google',
    name: 'Google',
    env: ['GEMINI_API_KEY'],
    models: {
      'gemini-3.5-flash': { name: 'Gemini 3.5 Flash', tool_call: true, context_window: 1_000_000 },
    },
  },
  desconocido: {
    name: 'Proveedor sin ruta',
    models: { 'foo-1': { name: 'Foo 1' } },
  },
  sinModelos: { name: 'Vacío' },
};

const specOf = (id: string) => {
  const spec = PROVIDER_SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`Falta la spec de ${id}`);
  return spec;
};

describe('parseModelsDev', () => {
  test('aplana proveedor → models y marca el proveedor en cada modelo', () => {
    const parsed = parseModelsDev(payload);
    const anthropic = parsed.find((p) => p.id === 'anthropic');
    expect(anthropic).toBeTruthy();
    expect(anthropic!.models.map((m) => m.id)).toEqual(['claude-sonnet-4']);
    expect(anthropic!.models[0].provider).toBe('anthropic');
    expect(anthropic!.models[0].contextWindow).toBe('200K tokens');
    expect(anthropic!.models[0].supportsTools).toBe(true);
    expect(anthropic!.models[0].supportsImage).toBe(true);
    expect(anthropic!.env).toEqual(['ANTHROPIC_API_KEY']);
  });

  test('descarta modelos retirados y proveedores sin modelos', () => {
    const parsed = parseModelsDev(payload);
    expect(parsed.some((p) => p.id === 'sinModelos')).toBe(false);
    expect(parsed.flatMap((p) => p.models).some((m) => m.id === 'claude-viejo')).toBe(false);
  });

  test('tolera basura sin lanzar', () => {
    expect(parseModelsDev(null)).toEqual([]);
    expect(parseModelsDev('nope')).toEqual([]);
    expect(parseModelsDev({ x: { models: { a: null } } })).toEqual([]);
  });
});

describe('describeProvider', () => {
  test('sin credenciales queda sin configurar y dice qué falta', () => {
    const status = describeProvider(specOf('anthropic'), {}, new Set());
    expect(status.configured).toBe(false);
    expect(status.missing).toEqual(['apiKey']);
    expect(status.source).toBe('none');
  });

  test('con apiKey guardada queda configurado desde fichero', () => {
    const status = describeProvider(specOf('anthropic'), { anthropic: { apiKey: 'sk-ant' } }, new Set());
    expect(status.configured).toBe(true);
    expect(status.source).toBe('file');
  });

  test('con variable de entorno gana «env» aunque no haya fichero', () => {
    const status = describeProvider(specOf('xai'), {}, new Set(['xai']));
    expect(status.configured).toBe(true);
    expect(status.source).toBe('env');
  });

  test('ollama está configurado de fábrica en local', () => {
    const status = describeProvider(specOf('ollama'), {}, new Set());
    expect(status.configured).toBe(true);
    expect(status.source).toBe('local');
  });
});

describe('buildProviderList', () => {
  test('incluye todos los proveedores soportados, con modelos y estado', () => {
    const list = buildProviderList({}, new Set(), parseModelsDev(payload));
    expect(list).toHaveLength(PROVIDER_SPECS.length);

    const anthropic = list.find((p) => p.id === 'anthropic')!;
    expect(anthropic.configured).toBe(false);
    expect(anthropic.modelCount).toBe(1);

    // HF no viene en models.dev: sus modelos salen del catálogo base.
    const hf = list.find((p) => p.id === 'huggingface')!;
    expect(hf.modelCount).toBeGreaterThan(0);
  });

  test('pone los configurados primero', () => {
    const list = buildProviderList({ anthropic: { apiKey: 'k' } }, new Set(), []);
    expect(list[0].id).toBe('anthropic');
    expect(list[0].configured).toBe(true);
    expect(list.every((p, i) => i === 0 || list[i - 1].configured || !p.configured)).toBe(true);
  });

  test('OpenAI y NVIDIA se configuran con clave y tienen catálogo de respaldo', () => {
    const list = buildProviderList({}, new Set(), []);
    for (const id of ['openai', 'nvidia']) {
      const provider = list.find((p) => p.id === id);
      expect(provider, `falta ${id}`).toBeTruthy();
      expect(provider!.fields.map((f) => f.name)).toContain('apiKey');
      expect(provider!.modelCount).toBeGreaterThan(0);
      expect(provider!.configured).toBe(false);
    }
  });

  test('une las variables de entorno del catálogo con las de la spec', () => {
    const list = buildProviderList({}, new Set(), parseModelsDev(payload));
    const anthropic = list.find((p) => p.id === 'anthropic')!;
    expect(anthropic.env).toContain('ANTHROPIC_API_KEY');
    expect(new Set(anthropic.env).size).toBe(anthropic.env.length);
  });

  test('aplica whitelist y blacklist y conserva el total', () => {
    const config = {
      anthropic: {
        apiKey: 'k',
        whitelist: ['claude-*'],
        blacklist: ['claude-viejo*'],
      },
    };
    const list = buildProviderList(config, new Set(), parseModelsDev(payload));
    const anthropic = list.find((p) => p.id === 'anthropic')!;
    expect(anthropic.modelCount).toBe(1);
    expect(anthropic.totalModels).toBe(1);
    expect(anthropic.models.map((m) => m.id)).toEqual(['claude-sonnet-4']);
    expect(anthropic.whitelist).toEqual(['claude-*']);
  });

  test('un proveedor apagado sigue listado pero se marca y va detrás', () => {
    const config = { anthropic: { apiKey: 'k', enabled: false } };
    const list = buildProviderList(config, new Set(), parseModelsDev(payload));
    const anthropic = list.find((p) => p.id === 'anthropic')!;
    expect(anthropic.enabled).toBe(false);
    expect(anthropic.configured).toBe(true);
    const first = list.findIndex((p) => p.id === 'anthropic');
    const firstEnabled = list.findIndex((p) => p.enabled);
    expect(firstEnabled).toBeLessThan(first);
  });
});

describe('filtros de proveedor', () => {
  const models = [{ id: 'claude-sonnet-4' }, { id: 'claude-opus-4' }, { id: 'gemini-3.5-flash' }];

  test('sin listas devuelve lo mismo', () => {
    expect(filterModelIds(models, undefined)).toBe(models);
    expect(filterModelIds(models, { whitelist: [], blacklist: [] })).toHaveLength(3);
  });

  test('la whitelist acepta ids exactos y prefijos con *', () => {
    expect(filterModelIds(models, { whitelist: ['claude-opus-4'], blacklist: [] }).map((m) => m.id)).toEqual(['claude-opus-4']);
    expect(filterModelIds(models, { whitelist: ['claude-*'], blacklist: [] })).toHaveLength(2);
  });

  test('la blacklist gana sobre la whitelist', () => {
    const out = filterModelIds(models, { whitelist: ['claude-*'], blacklist: ['claude-opus-*'] });
    expect(out.map((m) => m.id)).toEqual(['claude-sonnet-4']);
  });

  test('el patrón compara el id, no el nombre', () => {
    expect(matchesModelPattern('gemini-3.5-flash', 'gemini-3.5-*')).toBe(true);
    expect(matchesModelPattern('gemini-3.5-flash', 'Gemini')).toBe(false);
  });

  test('enabled es true salvo apagado explícito', () => {
    expect(isProviderEnabled({}, 'google')).toBe(true);
    expect(isProviderEnabled({ google: { apiKey: 'k' } }, 'google')).toBe(true);
    expect(isProviderEnabled({ google: { enabled: false } }, 'google')).toBe(false);
  });

  test('parseFilterList limpia, separa y deduplica vacíos', () => {
    expect(parseFilterList(' a-1, b-*,  , c\nd ')).toEqual(['a-1', 'b-*', 'c', 'd']);
    expect(parseFilterList('   ')).toEqual([]);
  });
});

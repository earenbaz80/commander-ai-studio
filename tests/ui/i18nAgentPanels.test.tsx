/**
 * Cobertura de idiomas del panel de subagentes y del modo agente.
 *
 * Los textos de estas dos vistas estaban en castellano fijo y se fueron
 * traduciendo a mano; este test es la red que evita que vuelvan a colarse. No
 * comprueba cada frase (eso ya lo hacen los tests de cada panel): recorre las
 * tres lenguas, junta todo el texto renderizado y falla si en `en`/`de` queda
 * castellano, o si en `de` sobrevive alguna etiqueta en inglés.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { ServerSubAgents } from '../../src/components/ServerSubAgents';
import {
  closeSubAgentsSession,
  setSubAgentsSession,
} from '../../src/agent/subAgentsStream';
import { AgentMode } from '../../src/components/AgentMode';
import type { Language } from '../../src/i18n/translations';

/** Marcas que sólo aparecen en castellano; no hay datos de prueba con ellas. */
const MARCAS_ES =
  /\b(corriendo|terminados|respuesta|subagentes|sesión|sesiones|reconectando|conectando|falló|aún|todavía|ocultar|campaña|objetivo|bloque|archivo|conflicto|planificando|interrumpida|continuar|guardadas|métricas|servidor|sin conexión)\b/i;

/** Etiquetas inglesas del panel que en alemán tienen traducción propia. */
const ETIQUETAS_EN_DEL_PANEL = [
  'Server subagents',
  'No subagents yet…',
  'hide answer',
  'show answer',
  'show the rest',
  'show less',
  'failed only',
  'show all',
];

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  closed = false;
  private listeners = new Map<string, ((ev: MessageEvent) => void)[]>();

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, fn: (ev: MessageEvent) => void) {
    const list = this.listeners.get(name) ?? [];
    list.push(fn);
    this.listeners.set(name, list);
  }
  close() { this.closed = true; this.readyState = 2; }
  open() {
    this.readyState = 1;
    for (const fn of this.listeners.get('open') ?? []) fn({} as MessageEvent);
  }
  emit(name: string, payload: unknown) {
    for (const fn of this.listeners.get(name) ?? []) fn({ data: JSON.stringify(payload) } as MessageEvent);
  }
}

const fila = (
  id: string,
  goal: string,
  status: 'running' | 'completed' | 'failed',
  extra: Record<string, unknown> = {},
) => ({ id, parentSessionId: 'sess-i18n', goal, model: 'm', status, startedAt: 1, endedAt: 2, steps: 0, ...extra });

/** Monta el panel con datos que cubren todos sus estados y devuelve su texto. */
function textoDelPanel(lang: Language): string {
  // Se monta una vez por idioma dentro del mismo test.
  cleanup();
  closeSubAgentsSession();
  FakeEventSource.instances = [];
  render(<ServerSubAgents lang={lang} />);

  act(() => setSubAgentsSession('sess-i18n'));
  act(() => FakeEventSource.instances[0].open());
  act(() => FakeEventSource.instances[0].emit('subagents', {
    subagents: [
      fila('s1', 'task-a', 'running', { steps: 2 }),
      fila('s2', 'task-b', 'completed', { steps: 4, answer: 'x'.repeat(450) }),
      fila('s3', 'task-c', 'failed', { steps: 1, error: 'boom' }),
    ],
  }));

  return screen.getByTestId('server-subagents').textContent ?? '';
}

const emptyState = { task: null, plan: [], steps: [], thinking: false, running: false };

/** Abre todas las pestañas del modo agente y devuelve el texto acumulado. */
function textoDelModoAgente(lang: Language): string {
  const tabs: Record<Language, string[]> = {
    es: ['PLAN', 'LÍNEA TIEMPO', 'SUB-AGENTES', 'MCP', 'PLUGINS', 'CONFLICTO', 'MÉTRICAS', 'SESIONES'],
    en: ['PLAN', 'TIMELINE', 'SUB-AGENTS', 'MCP', 'PLUGINS', 'CONFLICT', 'METRICS', 'SESSIONS'],
    de: ['PLAN', 'ZEITLEISTE', 'UNTERAGENTEN', 'MCP', 'PLUGINS', 'KONFLIKT', 'METRIKEN', 'SITZUNGEN'],
  };

  cleanup();
  const { container } = render(
    <AgentMode
      cwd="."
      onStartTask={vi.fn()}
      onStop={vi.fn()}
      state={emptyState as any}
      onRunTool={vi.fn(async () => ({ ok: true }))}
      lang={lang}
    />,
  );

  let texto = container.textContent ?? '';
  for (const tab of tabs[lang]) {
    const boton = screen.getAllByRole('button').find((b) => b.textContent === tab);
    if (!boton) continue;
    act(() => { fireEvent.click(boton); });
    texto += '\n' + (container.textContent ?? '');
  }
  return texto;
}

beforeEach(() => {
  localStorage.clear();
  (globalThis as any).EventSource = FakeEventSource;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});

afterEach(() => {
  closeSubAgentsSession();
  vi.unstubAllGlobals();
});

describe('i18n · panel de subagentes', () => {
  test('en inglés y alemán no queda castellano', () => {
    for (const lang of ['en', 'de'] as const) {
      const texto = textoDelPanel(lang);
      expect(texto, `${lang} dejó castellano: ${texto}`).not.toMatch(MARCAS_ES);
    }
  });

  test('en alemán las etiquetas del panel no se quedan en inglés', () => {
    const texto = textoDelPanel('de');

    expect(texto).toContain('Server-Unteragenten');
    expect(texto).toContain('laufen');
    for (const etiqueta of ETIQUETAS_EN_DEL_PANEL) {
      expect(texto, `«${etiqueta}» sin traducir al alemán`).not.toContain(etiqueta);
    }
  });

  test('en español el panel sigue en castellano', () => {
    // Control: si el test de arriba pasara por un panel vacío, esto lo delata.
    const texto = textoDelPanel('es');
    expect(texto).toContain('Subagentes del servidor');
    expect(texto).toMatch(/corriendo/);
    expect(texto).toContain('ocultar respuesta');
  });
});

describe('i18n · modo agente', () => {
  test('en inglés y alemán no queda castellano en ninguna pestaña', () => {
    for (const lang of ['en', 'de'] as const) {
      const texto = textoDelModoAgente(lang);
      expect(texto, `${lang} dejó castellano: ${texto}`).not.toMatch(MARCAS_ES);
    }
  });

  test('en alemán las pestañas y acciones salen del diccionario', () => {
    const texto = textoDelModoAgente('de');

    expect(texto).toContain('SITZUNGEN');
    expect(texto).toContain('METRIKEN');
    expect(texto).toContain('Keine gespeicherten Sitzungen.');
    expect(texto).toContain('Noch keine Metriken.');
    expect(texto).not.toContain('No saved sessions.');
    expect(texto).not.toContain('No metrics yet.');
  });
});

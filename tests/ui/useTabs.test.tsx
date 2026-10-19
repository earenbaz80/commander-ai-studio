/**
 * Tests del hook useTabs: multi-pestaña, renombrado, proyectos y auto-títulos.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTabs, basename, createTab, DEFAULT_PARAMETERS, type WorkspaceTab } from '../../src/hooks/useTabs';

beforeEach(() => {
  localStorage.clear();
});

describe('basename', () => {
  test('maneja rutas POSIX', () => {
    expect(basename('/home/user/proyecto')).toBe('proyecto');
  });

  test('maneja rutas Windows', () => {
    expect(basename('C:\\Users\\Edel\\proyecto')).toBe('proyecto');
  });

  test('ignora barras finales', () => {
    expect(basename('/home/user/proyecto///')).toBe('proyecto');
    expect(basename('C:\\proyecto\\')).toBe('proyecto');
  });

  test('devuelve string vacío para entrada vacía', () => {
    expect(basename('')).toBe('');
  });

  test('devuelve el último segmento de rutas mixtas', () => {
    expect(basename('C:\\Users\\proyecto/src\\final')).toBe('final');
  });
});

describe('createTab', () => {
  test('aplica valores por defecto', () => {
    const tab = createTab();
    expect(tab.title).toBe('Nueva Sesión');
    expect(tab.mode).toBe('chat');
    expect(tab.messages).toEqual([]);
    expect(tab.projectPath).toBe('');
    expect(tab.parameters).toEqual(DEFAULT_PARAMETERS);
  });

  test('acepta overrides', () => {
    const tab = createTab({ title: 'Mi Tab', mode: 'freeform', projectPath: '/tmp/x' });
    expect(tab.title).toBe('Mi Tab');
    expect(tab.mode).toBe('freeform');
    expect(tab.projectPath).toBe('/tmp/x');
  });

  test('genera IDs únicos', () => {
    const ids = new Set(Array.from({ length: 20 }, () => createTab().id));
    expect(ids.size).toBe(20);
  });
});

describe('useTabs', () => {
  test('arranca con una pestaña cuando no hay storage', () => {
    const { result } = renderHook(() => useTabs());
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].title).toBe('Sesión 1');
    expect(result.current.activeTab?.id).toBe(result.current.tabs[0].id);
  });

  test('newTab numera secuencialmente sin colisiones', () => {
    const { result } = renderHook(() => useTabs());
    act(() => {
      result.current.newTab();
      result.current.newTab();
      result.current.newTab();
    });
    const titles = result.current.tabs.map((t) => t.title);
    expect(titles).toEqual(['Sesión 1', 'Sesión 2', 'Sesión 3', 'Sesión 4']);
    expect(result.current.activeId).toBe(result.current.tabs[3].id);
  });

  test('newTab respeta MAX_TABS (12)', () => {
    const { result } = renderHook(() => useTabs());
    act(() => {
      for (let i = 0; i < 20; i++) result.current.newTab();
    });
    expect(result.current.tabs).toHaveLength(12);
  });

  test('closeTab nunca deja cero pestañas', () => {
    const { result } = renderHook(() => useTabs());
    act(() => {
      result.current.closeTab(result.current.tabs[0].id);
    });
    expect(result.current.tabs).toHaveLength(1);
  });

  test('closeTab cierra y mueve el activo a la vecina', () => {
    const { result } = renderHook(() => useTabs());
    act(() => {
      result.current.newTab();
      result.current.newTab();
    });
    const middleId = result.current.tabs[1].id;
    act(() => {
      result.current.closeTab(middleId);
    });
    expect(result.current.tabs.map((t) => t.id)).not.toContain(middleId);
    expect(result.current.tabs).toHaveLength(2);
  });

  test('closeOthers deja solo la pestaña indicada', () => {
    const { result } = renderHook(() => useTabs());
    act(() => {
      result.current.newTab();
      result.current.newTab();
    });
    const targetId = result.current.tabs[1].id;
    act(() => {
      result.current.closeOthers(targetId);
    });
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeId).toBe(targetId);
  });

  test('selectTab ignora IDs inexistentes', () => {
    const { result } = renderHook(() => useTabs());
    const before = result.current.activeId;
    act(() => {
      result.current.selectTab('id-falso-123');
    });
    expect(result.current.activeId).toBe(before);
  });

  test('renameTab marca manualTitle y trunca a 60 caracteres', () => {
    const { result } = renderHook(() => useTabs());
    const id = result.current.tabs[0].id;
    act(() => {
      result.current.renameTab(id, 'x'.repeat(100));
    });
    expect(result.current.activeTab?.manualTitle).toBe(true);
    expect(result.current.activeTab?.title).toHaveLength(60);
  });

  test('renameTab con texto vacío usa "Sesión"', () => {
    const { result } = renderHook(() => useTabs());
    const id = result.current.tabs[0].id;
    act(() => {
      result.current.renameTab(id, '   ');
    });
    expect(result.current.activeTab?.title).toBe('Sesión');
  });

  test('setProject renombra con el basename si no hay manualTitle', () => {
    const { result } = renderHook(() => useTabs());
    const id = result.current.tabs[0].id;
    act(() => {
      result.current.setProject('/home/usuario/mi-proyecto', id);
    });
    expect(result.current.activeTab?.projectPath).toBe('/home/usuario/mi-proyecto');
    expect(result.current.activeTab?.title).toBe('mi-proyecto');
  });

  test('setProject respeta el renombrado manual', () => {
    const { result } = renderHook(() => useTabs());
    const id = result.current.tabs[0].id;
    act(() => {
      result.current.renameTab(id, 'Nombre Manual');
    });
    act(() => {
      result.current.setProject('/home/usuario/otro-proyecto', id);
    });
    expect(result.current.activeTab?.projectPath).toBe('/home/usuario/otro-proyecto');
    expect(result.current.activeTab?.title).toBe('Nombre Manual');
  });

  test('setProject con ruta vacía solo limpia projectPath', () => {
    const { result } = renderHook(() => useTabs());
    const id = result.current.tabs[0].id;
    act(() => {
      result.current.setProject('/tmp/proyecto', id);
    });
    act(() => {
      result.current.setProject('', id);
    });
    expect(result.current.activeTab?.projectPath).toBe('');
  });

  test('autoTitle renombra desde el primer mensaje del usuario', () => {
    const { result } = renderHook(() => useTabs());
    const id = result.current.tabs[0].id;
    act(() => {
      result.current.autoTitle(id, 'Crear una API de tareas con Express');
    });
    expect(result.current.activeTab?.title).toBe('Crear una API de tareas con Express');
    // No debe marcar manualTitle: el proyecto aún puede renombrarla
    expect(result.current.activeTab?.manualTitle).toBeFalsy();
  });

  test('autoTitle ignora textos de solo 2 caracteres', () => {
    const { result } = renderHook(() => useTabs());
    const id = result.current.tabs[0].id;
    act(() => {
      result.current.autoTitle(id, 'ab');
    });
    expect(result.current.activeTab?.title).toBe('Sesión 1');
  });

  test('autoTitle ignora prompts automáticos de auditoría', () => {
    const { result } = renderHook(() => useTabs());
    const id = result.current.tabs[0].id;
    act(() => {
      result.current.autoTitle(id, 'Realiza una AUDITORÍA GENERAL del proyecto completo');
    });
    expect(result.current.activeTab?.title).toBe('Sesión 1');
  });

  test('autoTitle no pisa un título ya renombrado a mano', () => {
    const { result } = renderHook(() => useTabs());
    const id = result.current.tabs[0].id;
    act(() => {
      result.current.renameTab(id, 'Manual');
    });
    act(() => {
      result.current.autoTitle(id, 'Texto del primer mensaje');
    });
    expect(result.current.activeTab?.title).toBe('Manual');
  });

  test('persiste las pestañas en localStorage', async () => {
    const { result } = renderHook(() => useTabs());
    act(() => {
      result.current.newTab();
    });
    // La persistencia va en queueMicrotask
    await Promise.resolve();
    const raw = localStorage.getItem('ai_studio_tabs_v1');
    expect(raw).toBeTruthy();
    const parsed: WorkspaceTab[] = JSON.parse(raw!);
    expect(parsed).toHaveLength(2);
  });

  test('hidrata las pestañas desde localStorage', () => {
    const stored = [
      { ...createTab({ title: 'Persistida 1', projectPath: '/tmp/p1' }) },
      { ...createTab({ title: 'Persistida 2' }) },
    ];
    localStorage.setItem('ai_studio_tabs_v1', JSON.stringify(stored));
    const { result } = renderHook(() => useTabs());
    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.tabs[0].title).toBe('Persistida 1');
  });

  test('initialProjectPath se aplica a la primera pestaña', () => {
    const { result } = renderHook(() => useTabs('/home/usuario/proyecto-inicial'));
    expect(result.current.activeTab?.projectPath).toBe('/home/usuario/proyecto-inicial');
  });

  test('updateTab aplica el patch a la pestaña activa', () => {
    const { result } = renderHook(() => useTabs());
    act(() => {
      result.current.updateTab({ selectedModel: 'gpt-4o' });
    });
    expect(result.current.activeTab?.selectedModel).toBe('gpt-4o');
  });
});

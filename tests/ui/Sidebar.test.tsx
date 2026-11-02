/**
 * Tests del Sidebar: agrupación de modos en secciones colapsables,
 * estado activo y grupos plegados al montar.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Sidebar } from '../../src/components/Sidebar';
import { DEFAULT_PARAMETERS } from '../../src/hooks/useTabs';

const baseProps = () => ({
  mode: 'chat' as const,
  setMode: vi.fn(),
  recentHistory: [],
  onSelectHistoryItem: vi.fn(),
  onClearHistory: vi.fn(),
  onNewPrompt: vi.fn(),
  onOpenGallery: vi.fn(),
  lang: 'es' as const,
  isSidebarOpen: true,
});

const chatButton = (container: HTMLElement) =>
  container.querySelector('[data-tooltip="Nuevo chat (nueva sesión)"]') as HTMLButtonElement;

describe('Sidebar (panel lateral agrupado)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('muestra las secciones de navegación plegadas', () => {
    render(<Sidebar {...baseProps()} />);
    for (const title of ['Crear', 'Agentes', 'Modelos', 'Herramientas']) {
      expect(screen.getByRole('button', { name: title })).toHaveAttribute('aria-expanded', 'false');
    }
  });

  test('los modos siguen accesibles dentro de su grupo', () => {
    const { container } = render(<Sidebar {...baseProps()} />);
    for (const name of ['Crear', 'Agentes', 'Herramientas']) fireEvent.click(screen.getByRole('button', { name }));
    expect(chatButton(container)).toBeTruthy();
    expect(container.querySelector('[data-tooltip*="Modo Agente"]')).toBeTruthy();
    expect(container.querySelector('[data-tooltip*="Telemetría"]')).toBeTruthy();
  });

  test('nuevo chat es una acción y no un selector de modo', () => {
    const props = baseProps();
    const { container } = render(<Sidebar {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
    fireEvent.click(chatButton(container));
    expect(props.onNewPrompt).toHaveBeenCalledTimes(1);
    expect(props.setMode).not.toHaveBeenCalled();
    expect(chatButton(container)).not.toHaveClass('nc-active');
  });

  test('marca el modo activo con la clase nc-active', () => {
    const { container } = render(<Sidebar {...baseProps()} mode="composer" />);
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
    const composer = container.querySelector('[data-tooltip="Commander Composer (Multi-Archivo & Diffs)"]') as HTMLElement;
    expect(composer.className).toContain('nc-active');
    expect(chatButton(container).className).not.toContain('nc-active');
  });

  test('plegar un grupo oculta sus modos', () => {
    const { container } = render(<Sidebar {...baseProps()} />);
    const header = screen.getByRole('button', { name: 'Crear' });
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(chatButton(container)).toBeNull();
  });

  test('no persiste la apertura en localStorage', () => {
    render(<Sidebar {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
    expect(screen.getByRole('button', { name: 'Crear' })).toHaveAttribute('aria-expanded', 'true');
    expect(localStorage.getItem('ai_studio_sidebar_groups')).toBeNull();
  });

  test('ignora la apertura guardada y vuelve a plegar al montar', () => {
    localStorage.setItem('ai_studio_sidebar_groups', JSON.stringify({ crear: false, agentes: false }));
    const { container, unmount } = render(<Sidebar {...baseProps()} />);
    expect(screen.getByRole('button', { name: 'Crear' })).toHaveAttribute('aria-expanded', 'false');
    expect(chatButton(container)).toBeNull();
    expect(container.querySelector('[data-tooltip*="Modo Agente"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
    unmount();
    render(<Sidebar {...baseProps()} />);
    expect(screen.getByRole('button', { name: 'Crear' })).toHaveAttribute('aria-expanded', 'false');
  });

  test('el botón Nuevo chat sigue disponible en Crear', () => {
    const props = baseProps();
    render(<Sidebar {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
    fireEvent.click(screen.getByText('Nuevo chat'));
    expect(props.onNewPrompt).toHaveBeenCalledTimes(1);
  });

  test('las acciones movidas desde el menú (compilar y librería) llaman a sus manejadores', () => {
    const props = { ...baseProps(), onOpenCompile: vi.fn(), onOpenLibrary: vi.fn() };
    render(<Sidebar {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Herramientas' }));
    fireEvent.click(screen.getByText(/Compilar Proyecto/));
    expect(props.onOpenCompile).toHaveBeenCalledTimes(1);
  });

  test('compilar vive en Herramientas; voz y galería en Crear', () => {
    const props = { ...baseProps(), onOpenCompile: vi.fn(), onOpenLibrary: vi.fn() };
    const { container } = render(<Sidebar {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Herramientas' }));
    expect(container.querySelector('[data-tooltip="Compilar / Exportar Proyecto"]')).toBeTruthy();
    expect(container.querySelector('[data-tooltip="Galería Pública de Proyectos"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
    fireEvent.click(container.querySelector('[data-tooltip="Galería Pública de Proyectos"]')!);
    expect(props.onOpenGallery).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('[data-tooltip*="Voz en Vivo"]')!);
    expect(props.setMode).toHaveBeenCalledWith('live_voice');
  });

  test('Configurar LLM Local (grupo Modelos) dispara su manejador', () => {
    const props = { ...baseProps(), onOpenLocalLlmConfig: vi.fn() };
    const { container } = render(<Sidebar {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Modelos' }));
    expect(container.querySelector('[data-tooltip="Configurar LLM Local"]')).toBeTruthy();
    fireEvent.click(screen.getByText('Configurar LLM Local'));
    expect(props.onOpenLocalLlmConfig).toHaveBeenCalledTimes(1);
  });

  test('Instrucciones del sistema vive en el sidebar (editor + preset de rol)', () => {
    const props = {
      ...baseProps(),
      parameters: { ...DEFAULT_PARAMETERS, systemInstruction: 'rol actual' },
      setParameters: vi.fn(),
    };
    render(<Sidebar {...props} />);

    expect(screen.getByRole('button', { name: 'Instrucciones' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Instrucciones' }));
    const ta = screen.getByPlaceholderText(/Instrucción del sistema/) as HTMLTextAreaElement;
    expect(ta.value).toBe('rol actual');

    // React 19 restaura el DOM al valor controlado tras el evento; la captura
    // inmediata en el handler garantiza el valor escrito.
    fireEvent.change(ta, { target: { value: 'nuevo rol' } });
    expect(props.setParameters).toHaveBeenCalledTimes(1);
    const updater = props.setParameters.mock.calls[0][0];
    expect(updater({ ...DEFAULT_PARAMETERS })).toMatchObject({ systemInstruction: 'nuevo rol' });

    // El preset de rol rellena la instrucción al seleccionarlo.
    fireEvent.change(screen.getByLabelText('Preset de rol'), { target: { value: 'security-auditor' } });
    expect(props.setParameters).toHaveBeenCalledTimes(2);
    const presetUpdater = props.setParameters.mock.calls[1][0];
    expect(presetUpdater({ ...DEFAULT_PARAMETERS }).systemInstruction).toContain('ciberseguridad');
  });

  test('sin parámetros no se renderiza el grupo Instrucciones', () => {
    render(<Sidebar {...baseProps()} />);
    expect(screen.queryByRole('button', { name: 'Instrucciones' })).toBeNull();
  });

  test('cerrar oculta el panel completo sin ancho o padding de escritorio', () => {
    const { container, rerender } = render(<Sidebar {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
    rerender(<Sidebar {...baseProps()} isSidebarOpen={false} />);
    expect(container.querySelector('aside')).toHaveClass('hidden');
    expect(container.querySelector('aside')).not.toHaveClass('lg:w-64', 'p-3');
    rerender(<Sidebar {...baseProps()} />);
    expect(screen.getByRole('button', { name: 'Crear' })).toHaveAttribute('aria-expanded', 'true');
  });
  test('busca en los mensajes con retardo y abre la coincidencia', () => {
    vi.useFakeTimers();
    const onSearchMessages = vi.fn();
    const onOpenSearchResult = vi.fn();
    // El servidor devuelve el JSON de `parts` con `<b>` alrededor de la coincidencia.
    const hit = { thread_id: 'th-abcdef12', seq: 7, snippet: '{"text":"aquí estaba el <b>bug</b>"}' };
    render(
      <Sidebar
        {...baseProps()}
        serverSessions={[{ id: 'th-abcdef12', title: 'Sesión' }]}
        searchHits={[hit]}
        onSearchMessages={onSearchMessages}
        onOpenSearchResult={onOpenSearchResult}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Buscar historial...'), { target: { value: 'bu' } });
    // Sin retardo, cada pulsación dispararía una petición al servidor.
    expect(onSearchMessages).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(onSearchMessages).toHaveBeenCalledWith('bu');

    const results = screen.getByTestId('message-search-results');
    expect(results).toHaveTextContent('EN MENSAJES');
    const fila = screen.getByRole('button', { name: /aquí estaba el bug/ });
    expect(fila).not.toHaveTextContent('<b>');
    fireEvent.click(fila);
    expect(onOpenSearchResult).toHaveBeenCalledWith(hit);
    vi.useRealTimers();
  });

});

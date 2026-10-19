/**
 * Tests del Sidebar: agrupación de modos en secciones colapsables,
 * estado activo y persistencia de grupos plegados.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  container.querySelector('[data-tooltip="Modo Chat Conversacional"]') as HTMLButtonElement;

describe('Sidebar (panel lateral agrupado)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('muestra las cinco secciones de navegación', () => {
    render(<Sidebar {...baseProps()} />);
    for (const title of ['Crear', 'Agentes', 'Modelos', 'Salida', 'Sistema']) {
      expect(screen.getByRole('button', { name: title })).toBeInTheDocument();
    }
  });

  test('los modos siguen accesibles dentro de su grupo', () => {
    const { container } = render(<Sidebar {...baseProps()} />);
    expect(chatButton(container)).toBeTruthy();
    expect(container.querySelector('[data-tooltip*="Modo Agente"]')).toBeTruthy();
    expect(container.querySelector('[data-tooltip*="Telemetría"]')).toBeTruthy();
  });

  test('al pulsar un modo se llama a setMode', () => {
    const props = baseProps();
    const { container } = render(<Sidebar {...props} />);
    fireEvent.click(chatButton(container));
    expect(props.setMode).toHaveBeenCalledWith('chat');
  });

  test('marca el modo activo con la clase nc-active', () => {
    const { container } = render(<Sidebar {...baseProps()} mode="composer" />);
    const composer = container.querySelector('[data-tooltip="Commander Composer (Multi-Archivo & Diffs)"]') as HTMLElement;
    expect(composer.className).toContain('nc-active');
    expect(chatButton(container).className).not.toContain('nc-active');
  });

  test('plegar un grupo oculta sus modos', () => {
    const { container } = render(<Sidebar {...baseProps()} />);
    const header = screen.getByRole('button', { name: 'Crear' });
    expect(header).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(chatButton(container)).toBeNull();
  });

  test('persiste el estado plegado en localStorage', () => {
    render(<Sidebar {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
    const saved = JSON.parse(localStorage.getItem('ai_studio_sidebar_groups') || '{}');
    expect(saved.crear).toBe(true);
  });

  test('recupera los grupos plegados guardados', () => {
    localStorage.setItem('ai_studio_sidebar_groups', JSON.stringify({ crear: true }));
    const { container } = render(<Sidebar {...baseProps()} />);
    expect(screen.getByRole('button', { name: 'Crear' })).toHaveAttribute('aria-expanded', 'false');
    expect(chatButton(container)).toBeNull();
    // Otro grupo sigue abierto
    expect(container.querySelector('[data-tooltip*="Modo Agente"]')).toBeTruthy();
  });

  test('el botón Nuevo Prompt sigue disponible arriba', () => {
    const props = baseProps();
    render(<Sidebar {...props} />);
    fireEvent.click(screen.getByText('Nuevo Prompt'));
    expect(props.onNewPrompt).toHaveBeenCalledTimes(1);
  });

  test('las acciones movidas desde el menú (compilar y librería) llaman a sus manejadores', () => {
    const props = { ...baseProps(), onOpenCompile: vi.fn(), onOpenLibrary: vi.fn() };
    render(<Sidebar {...props} />);
    fireEvent.click(screen.getByText(/Compilar Proyecto/));
    expect(props.onOpenCompile).toHaveBeenCalledTimes(1);
  });

  test('compilar vive en la sección Salida y la librería en Sistema', () => {
    const props = { ...baseProps(), onOpenCompile: vi.fn(), onOpenLibrary: vi.fn() };
    const { container } = render(<Sidebar {...props} />);
    expect(container.querySelector('[data-tooltip="Compilar / Exportar Proyecto"]')).toBeTruthy();
  });

  test('Configurar LLM Local (grupo Modelos) dispara su manejador', () => {
    const props = { ...baseProps(), onOpenLocalLlmConfig: vi.fn() };
    const { container } = render(<Sidebar {...props} />);
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
});

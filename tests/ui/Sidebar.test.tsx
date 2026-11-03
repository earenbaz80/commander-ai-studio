/**
 * Tests del Sidebar: agrupación de modos en secciones colapsables,
 * estado activo, grupos plegados al montar e historial único
 * (equipo + servidor en la misma lista).
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Sidebar } from '../../src/components/Sidebar';

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

  test('un solo historial: las filas del servidor llevan su proyecto y las fijadas suben', () => {
    const onRenameServerSession = vi.fn();
    const onToggleServerSessionPin = vi.fn();
    const onDeleteServerSession = vi.fn();
    const { container } = render(
      <Sidebar
        {...baseProps()}
        serverSessions={[
          { id: 'th-uno', title: 'Refactor', project_path: 'C:/repo/uno', pinned: 0, updated_at: 1700000000000 },
          { id: 'th-dos', title: 'Arreglo', project_path: 'C:/repo/dos', pinned: 1, updated_at: 1700000000000 },
          { id: 'th-tres', title: 'Suelto' },
        ]}
        onRenameServerSession={onRenameServerSession}
        onToggleServerSessionPin={onToggleServerSessionPin}
        onDeleteServerSession={onDeleteServerSession}
      />
    );

    // Ya no hay cabeceras por proyecto: el nombre de la carpeta vive en la fila.
    expect(screen.queryByRole('button', { name: 'Proyecto uno' })).toBeNull();
    expect(screen.getAllByTestId('session-row-th-uno')).toHaveLength(1);
    expect(screen.getByTestId('session-row-th-uno')).toHaveTextContent('uno');
    expect(screen.getByTestId('session-row-th-dos')).toHaveTextContent('dos');
    // Una sola lista: fijados arriba y, después, el orden que manda el servidor.
    expect(
      Array.from(container.querySelectorAll('[data-testid^="session-row-"]')).map((row) => row.getAttribute('data-testid'))
    ).toEqual(['session-row-th-dos', 'session-row-th-uno', 'session-row-th-tres']);
    // Lo que sólo vive en el servidor se marca SRV, no EQ.
    expect(screen.getByTestId('session-row-th-uno')).toHaveTextContent('SRV');
    expect(screen.getByTestId('session-row-th-uno')).not.toHaveTextContent('EQ');

    // Renombrar: el lápiz abre el campo y Enter guarda recortado.
    fireEvent.click(screen.getByRole('button', { name: 'Renombrar Arreglo' }));
    const input = screen.getByLabelText('Nuevo nombre del hilo');
    fireEvent.change(input, { target: { value: '  Otro nombre  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRenameServerSession).toHaveBeenCalledWith('th-dos', 'Otro nombre');

    // Escape cierra el campo sin guardar.
    fireEvent.click(screen.getByRole('button', { name: 'Renombrar Refactor' }));
    fireEvent.keyDown(screen.getByLabelText('Nuevo nombre del hilo'), { key: 'Escape' });
    expect(onRenameServerSession).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Nuevo nombre del hilo')).toBeNull();

    // Fijar recibe el hilo completo: la fila sabe si ya estaba fijado.
    fireEvent.click(screen.getByRole('button', { name: 'Soltar Arreglo' }));
    expect(onToggleServerSessionPin).toHaveBeenCalledWith(expect.objectContaining({ id: 'th-dos', pinned: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Fijar Refactor' }));
    expect(onToggleServerSessionPin).toHaveBeenCalledWith(expect.objectContaining({ id: 'th-uno', pinned: 0 }));

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Suelto' }));
    expect(onDeleteServerSession).toHaveBeenCalledWith('th-tres');
  });

  test('una conversación con el mismo id es una sola fila y su borrado alcanza a los dos lados', () => {
    const onDeleteHistoryItem = vi.fn();
    const onDeleteServerSession = vi.fn();
    const onSelectHistoryItem = vi.fn();
    // Al subir una entrada local la pestaña adopta ese id: la misma charla vive
    // en los dos sitios y no debe aparecer dos veces.
    render(
      <Sidebar
        {...baseProps()}
        onSelectHistoryItem={onSelectHistoryItem}
        recentHistory={[
          { id: 'th-duplicado', title: 'Misma charla', timestamp: 'hoy', mode: 'chat' },
        ]}
        serverSessions={[{ id: 'th-duplicado', title: 'Misma charla', pinned: 0 }]}
        onDeleteHistoryItem={onDeleteHistoryItem}
        onDeleteServerSession={onDeleteServerSession}
      />
    );

    const rows = screen.getAllByTestId('session-row-th-duplicado');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('EQ');
    expect(rows[0]).toHaveTextContent('SRV');

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Misma charla' }));
    expect(onDeleteHistoryItem).toHaveBeenCalledWith('th-duplicado');
    expect(onDeleteServerSession).toHaveBeenCalledWith('th-duplicado');
  });

  test('el filtro de historial también recorta las sesiones en servidor', () => {
    render(
      <Sidebar
        {...baseProps()}
        serverSessions={[
          { id: 'th-a', title: 'Refactor', project_path: 'C:/repo/uno' },
          { id: 'th-b', title: 'Arreglo', project_path: 'C:/repo/uno' },
        ]}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('Buscar historial...'), { target: { value: 'arreglo' } });
    expect(screen.queryByText('Refactor')).toBeNull();
    expect(screen.getByText('Arreglo')).toBeInTheDocument();
  });

});

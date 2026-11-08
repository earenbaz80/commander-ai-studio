/**
 * Tests del Sidebar: agrupación de modos en secciones colapsables,
 * estado activo, grupos plegados al montar e historial único
 * (equipo + servidor en la misma lista).
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react';
import { Sidebar } from '../../src/components/Sidebar';

const archiveSyncMocks = vi.hoisted(() => ({
  subscribeArchivedProjects: vi.fn(),
  saveArchivedProjects: vi.fn(),
  setProjectArchivedRemote: vi.fn(),
}));

vi.mock('../../src/lib/firebase', () => archiveSyncMocks);

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
    vi.clearAllMocks();
    archiveSyncMocks.subscribeArchivedProjects.mockReturnValue(() => {});
    archiveSyncMocks.saveArchivedProjects.mockResolvedValue(undefined);
    archiveSyncMocks.setProjectArchivedRemote.mockResolvedValue(undefined);
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

  test('compilar vive en Herramientas; galería en Crear', () => {
    const props = { ...baseProps(), onOpenCompile: vi.fn(), onOpenLibrary: vi.fn() };
    const { container } = render(<Sidebar {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Herramientas' }));
    expect(container.querySelector('[data-tooltip="Compilar / Exportar Proyecto"]')).toBeTruthy();
    expect(container.querySelector('[data-tooltip="Galería Pública de Proyectos"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
    fireEvent.click(container.querySelector('[data-tooltip="Galería Pública de Proyectos"]')!);
    expect(props.onOpenGallery).toHaveBeenCalledTimes(1);
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

    // Cada proyecto encabeza su grupo; las filas conservan su proyecto.
    expect(screen.getByTestId('project-group-uno')).toHaveTextContent('uno');
    expect(screen.getByTestId('project-group-dos')).toHaveTextContent('dos');
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

  test('cada proyecto ofrece GitHub, nuevo chat y archivar reversible', () => {
    const onConnectGitHub = vi.fn();
    const onNewChatForProject = vi.fn();
    render(
      <Sidebar
        {...baseProps()}
        serverSessions={[
          { id: 'th-uno', title: 'Refactor', project_path: 'C:/repo/uno' },
          { id: 'th-dos', title: 'Arreglo', project_path: 'C:/repo/dos' },
        ]}
        onConnectGitHub={onConnectGitHub}
        onNewChatForProject={onNewChatForProject}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Opciones del proyecto uno' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Conectar con GitHub' }));
    expect(onConnectGitHub).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Opciones del proyecto uno' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Nuevo chat' }));
    expect(onNewChatForProject).toHaveBeenCalledWith('C:/repo/uno');

    fireEvent.click(screen.getByRole('button', { name: 'Opciones del proyecto uno' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archivar' }));
    expect(screen.queryByTestId('session-row-th-uno')).toBeNull();
    expect(screen.getByTestId('session-row-th-dos')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('commander_archived_projects') || '[]')).toContain('path:C:/repo/uno');

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar archivados' }));
    expect(screen.getByTestId('session-row-th-uno')).toBeInTheDocument();
    expect(screen.getByTestId('project-group-uno')).toHaveTextContent('ARCHIVADO');

    fireEvent.click(screen.getByRole('button', { name: 'Opciones del proyecto uno' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Desarchivar' }));
    expect(JSON.parse(localStorage.getItem('commander_archived_projects') || '[]')).not.toContain('path:C:/repo/uno');
    expect(screen.getByTestId('session-row-th-uno')).toBeInTheDocument();
  });

  test('copia la ruta local del proyecto desde su menú', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const onProjectPathCopied = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true });
    render(
      <Sidebar
        {...baseProps()}
        onProjectPathCopied={onProjectPathCopied}
        serverSessions={[{ id: 'th-uno', title: 'Refactor', project_path: 'C:/repo/uno' }]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Opciones del proyecto uno' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copiar ruta' }));
    expect(writeText).toHaveBeenCalledWith('C:/repo/uno');
    // La confirmación se avisa sólo cuando el portapapeles acepta la escritura.
    await waitFor(() => expect(onProjectPathCopied).toHaveBeenCalledWith('C:/repo/uno'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('copia la ruta con el método antiguo si no existe Clipboard API', async () => {
    const execCommand = vi.fn((command: string) => {
      expect(command).toBe('copy');
      expect((document.querySelector('textarea') as HTMLTextAreaElement | null)?.value).toBe('C:/repo/uno');
      return true;
    });
    const execCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand, writable: true });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, writable: true });
    const onProjectPathCopied = vi.fn();
    const onProjectPathCopyFailed = vi.fn();
    try {
      render(
        <Sidebar
          {...baseProps()}
          onProjectPathCopied={onProjectPathCopied}
          onProjectPathCopyFailed={onProjectPathCopyFailed}
          serverSessions={[{ id: 'th-uno', title: 'Refactor', project_path: 'C:/repo/uno' }]}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Opciones del proyecto uno' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Copiar ruta' }));

      await waitFor(() => expect(onProjectPathCopied).toHaveBeenCalledWith('C:/repo/uno'));
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(onProjectPathCopyFailed).not.toHaveBeenCalled();
      expect(document.querySelector('textarea')).toBeNull();
    } finally {
      if (execCommandDescriptor) {
        Object.defineProperty(document, 'execCommand', execCommandDescriptor);
      } else {
        Reflect.deleteProperty(document, 'execCommand');
      }
    }
  });

  test('avisa si el portapapeles rechaza la ruta local del proyecto', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('permiso denegado'));
    const onProjectPathCopied = vi.fn();
    const onProjectPathCopyFailed = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true });
    try {
      render(
        <Sidebar
          {...baseProps()}
          onProjectPathCopied={onProjectPathCopied}
          onProjectPathCopyFailed={onProjectPathCopyFailed}
          serverSessions={[{ id: 'th-uno', title: 'Refactor', project_path: 'C:/repo/uno' }]}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Opciones del proyecto uno' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Copiar ruta' }));

      await waitFor(() => expect(onProjectPathCopyFailed).toHaveBeenCalledWith('C:/repo/uno'));
      expect(onProjectPathCopied).not.toHaveBeenCalled();
      expect(screen.queryByRole('menu')).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  test('aplica el archivo de la cuenta y reconoce un proyecto por nombre', () => {
    render(
      <Sidebar
        {...baseProps()}
        currentUserUid="uid-1"
        serverSessions={[{ id: 'th-uno', title: 'Refactor', project_path: 'D:/otro/uno' }]}
      />
    );

    expect(archiveSyncMocks.subscribeArchivedProjects).toHaveBeenCalledWith(
      'uid-1',
      expect.any(Function),
      expect.any(Function)
    );
    const onChange = archiveSyncMocks.subscribeArchivedProjects.mock.calls[0][1] as (
      keys: string[] | null
    ) => void;
    act(() => onChange(['name:uno']));

    expect(screen.queryByTestId('session-row-th-uno')).toBeNull();
    expect(JSON.parse(localStorage.getItem('commander_archived_projects') || '[]')).toContain('name:uno');
  });

  test('el remoto de Git identifica el proyecto: dos clones comparten el archivo', () => {
    render(
      <Sidebar
        {...baseProps()}
        currentUserUid="uid-1"
        serverSessions={[
          {
            id: 'th-alpha',
            title: 'Alpha',
            project_path: 'C:/repo/a/uno',
            git_remote: 'github.com/org/alpha',
          },
          {
            id: 'th-beta',
            title: 'Beta',
            project_path: 'C:/repo/b/uno',
            git_remote: 'github.com/org/alpha',
          },
        ]}
      />
    );

    // Dos carpetas, un solo proyecto: el remoto manda sobre la ruta.
    expect(screen.getAllByTestId('project-group-uno')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Opciones del proyecto uno' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archivar' }));

    expect(screen.queryByTestId('session-row-th-alpha')).toBeNull();
    expect(screen.queryByTestId('session-row-th-beta')).toBeNull();
    const archived = JSON.parse(localStorage.getItem('commander_archived_projects') || '[]');
    expect(archived).toContain('remote:github.com/org/alpha');
    expect(archived).not.toContain('path:C:/repo/a/uno');
    expect(archived).not.toContain('path:C:/repo/b/uno');
    expect(archived).not.toContain('name:uno');
    expect(archiveSyncMocks.setProjectArchivedRemote).toHaveBeenCalledWith(
      'uid-1',
      ['remote:github.com/org/alpha'],
      true
    );
  });

  test('muestra el remoto cuando la carpeta no coincide con el repositorio', () => {
    render(
      <Sidebar
        {...baseProps()}
        serverSessions={[
          {
            id: 'th-clon',
            title: 'Clon',
            project_path: 'C:/repo/commander-2.5.1',
            git_remote: 'github.com/org/commander-ai-studio',
          },
          {
            id: 'th-alfa',
            title: 'Alfa',
            project_path: 'C:/repo/Alpha',
            git_remote: 'github.com/org/alpha',
          },
        ]}
      />
    );

    // Sólo el grupo cuya carpeta no se llama como el repositorio muestra el remoto.
    const remotes = screen.getAllByTestId('project-remote');
    expect(remotes).toHaveLength(1);
    expect(remotes[0]).toHaveTextContent('github.com/org/commander-ai-studio');
    // El remoto abre el repositorio en otra pestaña.
    expect(screen.getByRole('link', { name: 'github.com/org/commander-ai-studio' })).toHaveAttribute(
      'href',
      'https://github.com/org/commander-ai-studio'
    );
    expect(remotes[0]).toHaveAttribute('target', '_blank');
    expect(remotes[0]).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('dos repos distintos con la misma carpeta se archivan por separado', () => {
    render(
      <Sidebar
        {...baseProps()}
        serverSessions={[
          { id: 'th-alpha', title: 'Alpha', project_path: 'C:/repo/a/uno', git_remote: 'github.com/org/alpha' },
          { id: 'th-beta', title: 'Beta', project_path: 'C:/repo/b/uno', git_remote: 'github.com/org/beta' },
        ]}
      />
    );

    const groups = screen.getAllByTestId('project-group-uno');
    expect(groups).toHaveLength(2);
    fireEvent.click(within(groups[0]).getByRole('button', { name: 'Opciones del proyecto uno' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archivar' }));

    expect(screen.queryByTestId('session-row-th-alpha')).toBeNull();
    expect(screen.getByTestId('session-row-th-beta')).toBeInTheDocument();
    const archived = JSON.parse(localStorage.getItem('commander_archived_projects') || '[]');
    expect(archived).toContain('remote:github.com/org/alpha');
    expect(archived).not.toContain('remote:github.com/org/beta');
    expect(archived).not.toContain('path:C:/repo/a/uno');
  });

  test('aplica un archivado por remoto guardado por una versión anterior', () => {
    localStorage.setItem(
      'commander_archived_projects',
      JSON.stringify(['remote:github.com/org/alpha'])
    );
    render(
      <Sidebar
        {...baseProps()}
        serverSessions={[
          {
            id: 'th-remoto',
            title: 'Refactor',
            project_path: 'D:/otro/uno',
            git_remote: 'github.com/org/alpha',
          },
        ]}
      />
    );

    expect(screen.queryByTestId('session-row-th-remoto')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar archivados' }));
    expect(screen.getByTestId('session-row-th-remoto')).toBeInTheDocument();
    expect(screen.getByTestId('project-group-uno')).toHaveTextContent('ARCHIVADO');
  });

  test('aplica un archivado antiguo por nombre si el proyecto es inequívoco', () => {
    localStorage.setItem('commander_archived_projects', JSON.stringify(['name:uno']));
    render(
      <Sidebar
        {...baseProps()}
        serverSessions={[
          {
            id: 'th-viejo',
            title: 'Refactor',
            project_path: 'D:/otro/uno',
            git_remote: 'github.com/org/alpha',
          },
        ]}
      />
    );

    expect(screen.queryByTestId('session-row-th-viejo')).toBeNull();
    const archived = JSON.parse(localStorage.getItem('commander_archived_projects') || '[]');
    expect(archived).toContain('name:uno');
    expect(archived).not.toContain('remote:github.com/org/alpha');

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar archivados' }));
    fireEvent.click(screen.getByRole('button', { name: 'Opciones del proyecto uno' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Desarchivar' }));
    expect(
      JSON.parse(localStorage.getItem('commander_archived_projects') || '[]')
    ).not.toContain('name:uno');
  });

  test('no aplica un archivado por nombre a dos carpetas homónimas', () => {
    localStorage.setItem('commander_archived_projects', JSON.stringify(['name:uno']));
    render(
      <Sidebar
        {...baseProps()}
        serverSessions={[
          {
            id: 'th-alpha',
            title: 'Alpha',
            project_path: 'C:/repo/a/uno',
            git_remote: 'github.com/org/alpha',
          },
          {
            id: 'th-beta',
            title: 'Beta',
            project_path: 'C:/repo/b/uno',
            // Repos distintos: con remotos distintos siguen siendo dos grupos
            // homónimos y el nombre antiguo no alcanza a ninguno.
            git_remote: 'github.com/org/beta',
          },
        ]}
      />
    );

    expect(screen.getByTestId('session-row-th-alpha')).toBeInTheDocument();
    expect(screen.getByTestId('session-row-th-beta')).toBeInTheDocument();
  });

  test('archivar y desarchivar se escribe en la cuenta', () => {
    render(
      <Sidebar
        {...baseProps()}
        currentUserUid="uid-1"
        serverSessions={[{ id: 'th-uno', title: 'Refactor', project_path: 'C:/repo/uno' }]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Opciones del proyecto uno' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archivar' }));
    expect(archiveSyncMocks.setProjectArchivedRemote).toHaveBeenCalledWith(
      'uid-1',
      ['path:C:/repo/uno'],
      true
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar archivados' }));
    fireEvent.click(screen.getByRole('button', { name: 'Opciones del proyecto uno' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Desarchivar' }));
    expect(archiveSyncMocks.setProjectArchivedRemote).toHaveBeenLastCalledWith(
      'uid-1',
      ['path:C:/repo/uno'],
      false
    );
  });

  test('la primera sincronización sube el archivo local si el servidor no tiene lista', () => {
    localStorage.setItem('commander_archived_projects', JSON.stringify(['path:C:/repo/uno']));
    render(<Sidebar {...baseProps()} currentUserUid="uid-1" />);

    const onChange = archiveSyncMocks.subscribeArchivedProjects.mock.calls[0][1] as (
      keys: string[] | null
    ) => void;
    act(() => onChange(null));

    expect(archiveSyncMocks.saveArchivedProjects).toHaveBeenCalledWith('uid-1', ['path:C:/repo/uno']);
  });

});

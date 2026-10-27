/**
 * Tests del Workbench: menú de vistas, árbol de archivos, terminal
 * integrada (misma ruta que usan los modelos) y navegador embebido.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { WorkbenchPanel } from '../../src/components/WorkbenchPanel';
import { TerminalView } from '../../src/components/panel/TerminalView';
import { BrowserView } from '../../src/components/panel/BrowserView';
import { TabsView } from '../../src/components/panel/TabsView';
import { EditorView } from '../../src/components/panel/EditorView';
import { EditorView as CMView } from '@codemirror/view';
import { createTab, type WorkspaceTab } from '../../src/hooks/useTabs';

/** Lee el documento actual del editor CodeMirror montado. */
const cmValue = (): string => {
  const el = document.querySelector('.cm-content') as HTMLElement | null;
  if (!el) return '';
  const view = CMView.findFromDOM(el);
  return view ? view.state.doc.toString() : '';
};

/** Reemplaza el documento del editor CodeMirror montado (simula teclear). */
const cmSet = (value: string) => {
  const el = document.querySelector('.cm-content') as HTMLElement | null;
  const view = el ? CMView.findFromDOM(el) : null;
  expect(view).toBeTruthy();
  act(() => {
    view!.dispatch({ changes: { from: 0, to: view!.state.doc.length, insert: value } });
  });
};

const mockTabs: WorkspaceTab[] = [
  { ...createTab({ title: 'Sesión 1' }), id: 't1', mode: 'chat', messages: [] },
  { ...createTab({ title: 'Proyecto Web' }), id: 't2', mode: 'composer', projectPath: 'C:/tmp/proyecto-web' },
];

const baseProps = () => ({
  isOpen: true,
  onClose: vi.fn(),
  lang: 'es' as const,
  projectPath: 'C:/tmp/proyecto-web',
  tabs: mockTabs,
  activeTabId: 't1',
  onSelectTab: vi.fn(),
  onCloseTab: vi.fn(),
  onNewTab: vi.fn(),
  onRenameTab: vi.fn(),
});

describe('WorkbenchPanel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('no renderiza nada cuando está cerrado', () => {
    render(<WorkbenchPanel {...baseProps()} isOpen={false} />);
    expect(screen.queryByTitle('Árbol de archivos del proyecto')).toBeNull();
    expect(screen.queryByTitle('Terminal integrada (comandos reales)')).toBeNull();
  });

  test('muestra el menú con las 5 vistas', () => {
    render(<WorkbenchPanel {...baseProps()} />);
    expect(screen.getByTitle('Árbol de archivos del proyecto')).toBeInTheDocument();
    expect(screen.getByTitle('Editor de texto integrado (leer y guardar)')).toBeInTheDocument();
    expect(screen.getByTitle('Sesiones del workspace')).toBeInTheDocument();
    expect(screen.getByTitle('Terminal integrada (comandos reales)')).toBeInTheDocument();
    expect(screen.getByTitle('Navegador integrado')).toBeInTheDocument();
  });

  test('el botón cerrar llama onClose', () => {
    const props = baseProps();
    render(<WorkbenchPanel {...props} />);
    fireEvent.click(screen.getByTitle('Cerrar panel'));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  test('cambiar a la vista de pestañas', () => {
    render(<WorkbenchPanel {...baseProps()} />);
    fireEvent.click(screen.getByTitle('Sesiones del workspace'));
    expect(screen.getByText(/pestaña/)).toBeInTheDocument();
  });

  test('cambiar a la vista de navegador', () => {
    render(<WorkbenchPanel {...baseProps()} />);
    fireEvent.click(screen.getByTitle('Navegador integrado'));
    expect(screen.getByPlaceholderText('https://…')).toBeInTheDocument();
  });

  test('etiquetas en inglés con lang="en"', () => {
    render(<WorkbenchPanel {...baseProps()} lang="en" />);
    expect(screen.getByTitle('Project file tree')).toBeInTheDocument();
    expect(screen.getByTitle('Workspace sessions')).toBeInTheDocument();
    expect(screen.getByTitle('Integrated terminal (real commands)')).toBeInTheDocument();
    expect(screen.getByTitle('Integrated browser')).toBeInTheDocument();
  });
});

describe('TerminalView', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('ejecuta un comando y muestra la salida', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { stdout: 'archivo1.txt\narchivo2.txt', stderr: '', exitCode: 0, durationMs: 12 } }),
    });
    global.fetch = fetchMock as any;

    render(<TerminalView projectPath="C:/tmp/proyecto-web" />);
    const input = screen.getByPlaceholderText(/Escribe un comando/);
    fireEvent.change(input, { target: { value: 'ls' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText(/archivo1\.txt/)).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agent/run-tool',
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.toolId).toBe('shell.run');
    expect(body.input.root).toBe('C:/tmp/proyecto-web');
    expect(body.input.command).toBe('ls');
  });

  test('muestra el código de salida y la duración', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { stdout: 'v24.0.0', stderr: '', exitCode: 0, durationMs: 340 } }),
    }) as any;

    render(<TerminalView projectPath="C:/tmp/x" />);
    const input = screen.getByPlaceholderText(/Escribe un comando/);
    fireEvent.change(input, { target: { value: 'node -v' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText(/exit=0 · 340ms/)).toBeInTheDocument();
    });
  });

  test('un error del servidor se muestra en rojo', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: 'Comando bloqueado por seguridad' }),
    }) as any;

    render(<TerminalView projectPath="C:/tmp/x" />);
    const input = screen.getByPlaceholderText(/Escribe un comando/);
    fireEvent.change(input, { target: { value: 'rm -rf /' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('Comando bloqueado por seguridad')).toBeInTheDocument();
    });
  });

  test('recupera el historial con flecha arriba', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { stdout: 'ok', stderr: '', exitCode: 0, durationMs: 5 } }),
    }) as any;

    render(<TerminalView projectPath="C:/tmp/x" />);
    const input = screen.getByPlaceholderText(/Escribe un comando/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'pwd' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('ok')).toBeInTheDocument());

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('pwd');
  });

  test('los comandos rápidos se ejecutan al clic', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { stdout: '', stderr: '', exitCode: 0, durationMs: 3 } }),
    });
    global.fetch = fetchMock as any;

    render(<TerminalView projectPath="C:/tmp/x" />);
    fireEvent.click(screen.getByText('pwd'));
    await waitFor(() => {
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.input.command).toBe('pwd');
    });
  });

  test('no envía comandos vacíos', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    render(<TerminalView projectPath="C:/tmp/x" />);
    const input = screen.getByPlaceholderText(/Escribe un comando/);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('sin proyecto avisa que usará el directorio del servidor', () => {
    render(<TerminalView projectPath="" />);
    expect(screen.getByText(/sin proyecto activo/)).toBeInTheDocument();
  });
});

describe('BrowserView', () => {
  test('carga la URL del dev server por defecto', () => {
    render(<BrowserView projectPath="C:/tmp/x" />);
    expect(screen.getByPlaceholderText('https://…')).toHaveValue('http://localhost:3001');
    // Sin navegación aún no hay iframe
    expect(screen.queryByTitle('Navegador integrado')).toBeNull();
  });

  test('el botón Dev Server navega con iframe', () => {
    render(<BrowserView projectPath="C:/tmp/x" />);
    fireEvent.click(screen.getByText('Dev Server'));
    const frame = screen.getByTitle('Navegador integrado') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe('http://localhost:3001');
  });

  test('Enter en la barra navega a la URL', () => {
    render(<BrowserView projectPath="C:/tmp/x" />);
    const bar = screen.getByPlaceholderText('https://…');
    fireEvent.change(bar, { target: { value: 'ejemplo.com' } });
    fireEvent.keyDown(bar, { key: 'Enter' });
    const frame = screen.getByTitle('Navegador integrado') as HTMLIFrameElement;
    // Se normaliza añadiendo https://
    expect(frame.getAttribute('src')).toBe('https://ejemplo.com');
  });

  test('añade https:// a URLs sin esquema', () => {
    render(<BrowserView projectPath="C:/tmp/x" />);
    const bar = screen.getByPlaceholderText('https://…');
    fireEvent.change(bar, { target: { value: 'https://google.com' } });
    fireEvent.keyDown(bar, { key: 'Enter' });
    const frame = screen.getByTitle('Navegador integrado') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe('https://google.com');
  });

  test('previsualiza un HTML local con fs.read', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { content: '<h1>Hola</h1>', exists: true } }),
    });
    global.fetch = fetchMock as any;

    render(<BrowserView projectPath="C:/tmp/x" />);

    await waitFor(() => {
      expect(screen.getByTitle('Vista previa local')).toBeInTheDocument();
    });

    const frame = screen.getByTitle('Vista previa local') as HTMLIFrameElement;
    expect(frame.getAttribute('srcdoc')).toBe('<h1>Hola</h1>');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.toolId).toBe('fs.read');
    expect(body.input.path).toBe('index.html');
    expect(body.input.root).toBe('C:/tmp/x');
  });

  test('un error de lectura se muestra como estado', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: 'El archivo no existe' }),
    }) as any;

    render(<BrowserView projectPath="C:/tmp/x" />);
    await waitFor(() => {
      expect(screen.getByText('⚠️ El archivo no existe')).toBeInTheDocument();
    });
  });
});

describe('TabsView', () => {
  test('lista las pestañas con su modo y contador de mensajes', () => {
    render(
      <TabsView
        tabs={mockTabs}
        activeId="t1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
        onRename={vi.fn()}
      />
    );
    expect(screen.getByDisplayValue('Sesión 1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Proyecto Web')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('Composer')).toBeInTheDocument();
  });

  test('clic en una pestaña la selecciona', () => {
    const onSelect = vi.fn();
    render(
      <TabsView tabs={mockTabs} activeId="t1" onSelect={onSelect} onClose={vi.fn()} onNew={vi.fn()} />
    );
    fireEvent.click(screen.getByDisplayValue('Proyecto Web'));
    expect(onSelect).toHaveBeenCalledWith('t2');
  });

  test('el botón cerrar llama onClose con el id', () => {
    const onClose = vi.fn();
    render(
      <TabsView tabs={mockTabs} activeId="t1" onSelect={vi.fn()} onClose={onClose} onNew={vi.fn()} />
    );
    const closeButtons = screen.getAllByTitle('Cerrar pestaña');
    fireEvent.click(closeButtons[1]);
    expect(onClose).toHaveBeenCalledWith('t2');
  });

  test('el botón Nueva crea una pestaña', () => {
    const onNew = vi.fn();
    render(
      <TabsView tabs={mockTabs} activeId="t1" onSelect={vi.fn()} onClose={vi.fn()} onNew={onNew} />
    );
    fireEvent.click(screen.getByText('Nueva'));
    expect(onNew).toHaveBeenCalledOnce();
  });

  test('escribir en el título llama onRename', () => {
    const onRename = vi.fn();
    render(
      <TabsView tabs={mockTabs} activeId="t1" onSelect={vi.fn()} onClose={vi.fn()} onNew={vi.fn()} onRename={onRename} />
    );
    const input = screen.getByDisplayValue('Sesión 1');
    fireEvent.change(input, { target: { value: 'Renombrada' } });
    expect(onRename).toHaveBeenCalledWith('t1', 'Renombrada');
  });
});

describe('EditorView', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('sin proyecto abre igualmente el bloc de notas local', async () => {
    render(<EditorView projectPath="" />);
    expect(screen.getByTitle('Abrir archivo local desde tu disco')).toBeInTheDocument();
    expect(screen.getByTitle('Guardar archivo en tu disco')).toBeInTheDocument();
    // El editor (CodeMirror) carga bajo demanda.
    await waitFor(() => expect(document.querySelector('.cm-content')).toBeTruthy());
    expect(screen.getByText(/Bloc de notas local/)).toBeInTheDocument();
  });

  test('abre un archivo (fs.read) y lo guarda (fs.write)', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: any) => {
      const body = JSON.parse(init.body);
      if (body.toolId === 'fs.glob') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, data: { files: ['src/App.tsx', 'index.html'] } }),
        });
      }
      if (body.toolId === 'fs.read') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, data: { content: 'console.log("hola")', exists: true } }),
        });
      }
      if (body.toolId === 'fs.write') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, data: { path: 'src/App.tsx', bytes: 42 } }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    });
    global.fetch = fetchMock as any;

    render(<EditorView projectPath="C:/tmp/proyecto-web" />);

    const pathInput = screen.getByPlaceholderText(/Ruta del archivo/);
    fireEvent.change(pathInput, { target: { value: 'src/App.tsx' } });
    fireEvent.click(screen.getByTitle('Abrir del proyecto (Enter)'));

    await waitFor(() => {
      expect(cmValue()).toBe('console.log("hola")');
    });

    // El archivo se abre con fs.read sobre el proyecto activo
    const readCall = fetchMock.mock.calls.find((c: any) => JSON.parse(c[1].body).toolId === 'fs.read');
    expect(JSON.parse(readCall![1].body).input.root).toBe('C:/tmp/proyecto-web');

    cmSet('console.log("adios")');

    const saveBtn = screen.getByTitle('Guardar en el proyecto (Ctrl+S)');
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);

    await waitFor(() => {
      const writeCall = fetchMock.mock.calls.find((c: any) => JSON.parse(c[1].body).toolId === 'fs.write');
      expect(writeCall).toBeTruthy();
      const body = JSON.parse(writeCall![1].body);
      expect(body.input.path).toBe('src/App.tsx');
      expect(body.input.content).toBe('console.log("adios")');
      expect(body.input.overwrite).toBe(true);
    });
  });

  test('el botón Guardar está deshabilitado sin cambios pendientes', async () => {
    global.fetch = vi.fn().mockImplementation((_url: string, init: any) => {
      const body = JSON.parse(init.body);
      if (body.toolId === 'fs.glob') {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, data: { files: [] } }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, data: { content: 'sin cambios', exists: true } }),
      });
    }) as any;

    render(<EditorView projectPath="C:/tmp/x" />);
    const pathInput = screen.getByPlaceholderText(/Ruta del archivo/);
    fireEvent.change(pathInput, { target: { value: 'a.txt' } });
    fireEvent.click(screen.getByTitle('Abrir del proyecto (Enter)'));

    await waitFor(() => {
      expect(cmValue()).toBe('sin cambios');
    });
    expect(screen.getByTitle('Guardar en el proyecto (Ctrl+S)')).toBeDisabled();
  });

  test('abre un archivo LOCAL existente y carga su contenido en el editor', async () => {
    render(<EditorView projectPath="" />);
    const input = document.querySelector('input[data-testid="editor-local-open"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const file = new File(['<h1>hola local</h1>'], 'index.html', { type: 'text/html' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    await waitFor(() => {
      expect(cmValue()).toBe('<h1>hola local</h1>');
    });
    expect(screen.getByText(/Abierto: index\.html \(local\)/)).toBeInTheDocument();
  });

  test('guarda el contenido como archivo LOCAL descargable (txt/html/otro)', async () => {
    const downloads: string[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push(this.download);
      });
    (URL as any).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as any).revokeObjectURL = vi.fn();

    render(<EditorView projectPath="" />);
    await waitFor(() => expect(document.querySelector('.cm-content')).toBeTruthy());
    cmSet('Hola guardado local');

    fireEvent.click(screen.getByTitle('Guardar archivo en tu disco'));
    const nameInput = screen.getByPlaceholderText(/nombre\.txt/);
    fireEvent.change(nameInput, { target: { value: 'mis-notas.html' } });
    fireEvent.click(screen.getByText('Guardar local'));

    expect(downloads).toContain('mis-notas.html');
    expect(screen.getByText(/Descargado · mis-notas\.html/)).toBeInTheDocument();
    clickSpy.mockRestore();
  });

  test('"Guardar como" escribe el contenido en un archivo nuevo del proyecto', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: any) => {
      const body = JSON.parse(init.body);
      if (body.toolId === 'fs.glob') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, data: { files: ['src/App.tsx'] } }),
        });
      }
      if (body.toolId === 'fs.write') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, data: { path: 'docs/nota.md', bytes: 5 } }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, data: {} }) });
    });
    global.fetch = fetchMock as any;

    render(<EditorView projectPath="C:/tmp/proyecto-web" />);

    await waitFor(() => expect(document.querySelector('.cm-content')).toBeTruthy());
    cmSet('hola');

    fireEvent.click(screen.getByTitle('Guardar como otro archivo del proyecto (Ctrl+Shift+S)'));
    const nameInput = screen.getByPlaceholderText('nueva/ruta/archivo.ts');
    fireEvent.change(nameInput, { target: { value: 'docs/nota.md' } });
    fireEvent.click(screen.getByText('Guardar como'));

    await waitFor(() => {
      const writeCall = fetchMock.mock.calls.find((c: any) => JSON.parse(c[1].body).toolId === 'fs.write');
      expect(writeCall).toBeTruthy();
      const body = JSON.parse(writeCall![1].body);
      expect(body.input.path).toBe('docs/nota.md');
      expect(body.input.content).toBe('hola');
      expect(body.input.root).toBe('C:/tmp/proyecto-web');
    });
    // El nuevo archivo pasa a ser el archivo activo y se recuerda.
    await waitFor(() => {
      expect(localStorage.getItem('commander_editor_last_file::C:/tmp/proyecto-web')).toBe('docs/nota.md');
    });
  });

  test('recuerda y reabre el último archivo del proyecto entre sesiones', async () => {
    localStorage.setItem('commander_editor_last_file::C:/tmp/proyecto-web', 'src/App.tsx');
    const fetchMock = vi.fn().mockImplementation((_url: string, init: any) => {
      const body = JSON.parse(init.body);
      if (body.toolId === 'fs.glob') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, data: { files: ['src/App.tsx', 'index.html'] } }),
        });
      }
      if (body.toolId === 'fs.read') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, data: { content: 'recordado!', exists: true } }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, data: {} }) });
    });
    global.fetch = fetchMock as any;

    render(<EditorView projectPath="C:/tmp/proyecto-web" />);

    await waitFor(() => {
      expect(cmValue()).toBe('recordado!');
    });
    expect((screen.getByPlaceholderText(/Ruta del archivo/) as HTMLInputElement).value).toBe('src/App.tsx');
  });
});

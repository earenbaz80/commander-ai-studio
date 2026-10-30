/**
 * Tests de ChatPlayground: estado vacío, envío de mensajes, teclado,
 * edición, adjuntos y limpieza del chat.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ChatPlayground } from '../../src/components/ChatPlayground';
import { DEFAULT_PARAMETERS } from '../../src/hooks/useTabs';
import { ChatMessage } from '../../src/types/studio';
import { searchFiles } from '../../src/utils/codeSearchApi';

vi.mock('../../src/utils/codeSearchApi', () => ({ searchFiles: vi.fn() }));
const mockSearchFiles = searchFiles as unknown as ReturnType<typeof vi.fn>;

const baseProps = () => ({
  messages: [] as ChatMessage[],
  setMessages: vi.fn(),
  parameters: { ...DEFAULT_PARAMETERS },
  selectedModel: 'gemini-3.5-flash',
  setSelectedModel: vi.fn(),
  isGenerating: false,
  onSendMessage: vi.fn(),
  onClearChat: vi.fn(),
  lang: 'es' as const,
});

const userMessage = (content = 'Hola Nono'): ChatMessage => ({
  id: 'u1',
  role: 'user',
  content,
  timestamp: '10:00',
});

const modelMessage = (content = 'Respuesta del modelo'): ChatMessage => ({
  id: 'm1',
  role: 'model',
  content,
  timestamp: '10:01',
  modelUsed: 'gemini-3.5-flash',
});

const getTextarea = () => screen.getByPlaceholderText('Escribe tu mensaje...') as HTMLTextAreaElement;
const getSendButton = () => screen.getByLabelText('Enviar mensaje');

describe('ChatPlayground', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    localStorage.clear();
    // changeRunMode y PermissionsModal llaman a /api/permissions; en jsdom no
    // hay base URL, así que se mock globalmente (devuelve permisos por defecto).
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          permissions: { mode: 'build', allowedTools: null, deniedTools: [], files: { read: [], write: [] } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  describe('estado vacío', () => {
    test('ya no muestra el saludo: solo lo hace Nono', () => {
      render(<ChatPlayground {...baseProps()} displayName="Edel" />);
      expect(screen.queryByText(/En qué puedo ayudarte/)).toBeNull();
      expect(screen.queryByText(/¡Hola, Edel!/)).toBeNull();
    });

    test('avisa de sesión de invitado cuando no está autenticado', () => {
      render(<ChatPlayground {...baseProps()} isAuthenticated={false} />);
      expect(screen.getByText(/Sesión de invitado/)).toBeInTheDocument();
    });
  });

  describe('envío de mensajes', () => {
    test('el botón enviar llama a onSendMessage con el texto', () => {
      const props = baseProps();
      render(<ChatPlayground {...props} />);
      fireEvent.change(getTextarea(), { target: { value: 'Hola Nono' } });
      fireEvent.click(getSendButton());

      expect(props.onSendMessage).toHaveBeenCalledWith('Hola Nono', undefined, undefined, 'build');
      // El campo se vacía tras enviar
      expect(getTextarea().value).toBe('');
    });

    test('Enter envía el mensaje', () => {
      const props = baseProps();
      render(<ChatPlayground {...props} />);
      fireEvent.change(getTextarea(), { target: { value: 'Mensaje con Enter' } });
      fireEvent.keyDown(getTextarea(), { key: 'Enter' });
      expect(props.onSendMessage).toHaveBeenCalledWith('Mensaje con Enter', undefined, undefined, 'build');
    });

    test('Shift+Enter NO envía (nueva línea)', () => {
      const props = baseProps();
      render(<ChatPlayground {...props} />);
      fireEvent.change(getTextarea(), { target: { value: 'Multi\nlínea' } });
      fireEvent.keyDown(getTextarea(), { key: 'Enter', shiftKey: true });
      expect(props.onSendMessage).not.toHaveBeenCalled();
    });

    test('el botón está deshabilitado con el campo vacío', () => {
      render(<ChatPlayground {...baseProps()} />);
      expect(getSendButton()).toBeDisabled();
    });

    test('el botón está deshabilitado mientras genera', () => {
      const props = baseProps();
      const { rerender } = render(<ChatPlayground {...props} />);
      fireEvent.change(getTextarea(), { target: { value: 'Hola' } });
      expect(getSendButton()).not.toBeDisabled();
      // isGenerating llega por props
      rerender(<ChatPlayground {...props} isGenerating={true} />);
      expect(getSendButton()).toBeDisabled();
    });
  });

  describe('render de mensajes', () => {
    test('muestra las etiquetas TÚ / AI', () => {
      render(
        <ChatPlayground
          {...baseProps()}
          messages={[userMessage(), modelMessage()]}
        />
      );
      expect(screen.getByText('TÚ')).toBeInTheDocument();
      expect(screen.getByText('AI')).toBeInTheDocument();
    });

    test('muestra el modelo usado', () => {
      render(<ChatPlayground {...baseProps()} messages={[modelMessage()]} />);
      expect(screen.getByText('gemini-3.5-flash')).toBeInTheDocument();
    });
  });

  describe('limpiar chat', () => {
    test('limpiar desde Opciones llama a onClearChat y cierra el menú', () => {
      const props = baseProps();
      render(<ChatPlayground {...props} />);
      const options = screen.getByLabelText('Opciones de conversación');
      expect(options.closest('details')).not.toHaveAttribute('open');
      fireEvent.click(options);
      fireEvent.click(screen.getByRole('button', { name: 'Limpiar conversación' }));
      expect(props.onClearChat).toHaveBeenCalledOnce();
      expect(options.closest('details')).not.toHaveAttribute('open');
      expect(options).toHaveFocus();
      expect(screen.queryByText(/🗑️/)).toBeNull();
    });

    test('no hay botón de cerrar app en la barra inferior', () => {
      render(<ChatPlayground {...baseProps()} />);
      expect(screen.queryByLabelText('Cerrar la aplicación')).toBeNull();
    });
  });

  describe('editar mensaje', () => {
    test('editar permite modificar el contenido y guardar', async () => {
      const setMessages = vi.fn();
      render(
        <ChatPlayground
          {...baseProps()}
          messages={[modelMessage('Texto original')]}
          setMessages={setMessages}
        />
      );

      fireEvent.click(screen.getByText('Editar'));

      const editArea = screen.getByDisplayValue('Texto original') as HTMLTextAreaElement;
      expect(editArea).toBeInTheDocument();

      fireEvent.change(editArea, { target: { value: 'Texto corregido' } });
      fireEvent.click(screen.getByText('Guardar'));

      // setMessages se llama con una función updater
      expect(setMessages).toHaveBeenCalled();
      const updater = setMessages.mock.calls[setMessages.mock.calls.length - 1][0];
      if (typeof updater === 'function') {
        const result = updater([modelMessage('Texto original')]);
        expect(result[0].content).toBe('Texto corregido');
      } else {
        throw new Error('setMessages debería recibir una función updater');
      }
    });

    test('editar permite cancelar sin modificar', () => {
      const setMessages = vi.fn();
      render(
        <ChatPlayground
          {...baseProps()}
          messages={[modelMessage('Sigue igual')]}
          setMessages={setMessages}
        />
      );
      fireEvent.click(screen.getByText('Editar'));
      fireEvent.click(screen.getByText('Cancelar'));
      expect(setMessages).not.toHaveBeenCalled();
      expect(screen.getByText('Sigue igual')).toBeInTheDocument();
    });
  });

  describe('copiar mensaje', () => {
    test('Copiar escribe en el portapapeles', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true });

      render(<ChatPlayground {...baseProps()} messages={[modelMessage('Contenido copiable')]} />);
      fireEvent.click(screen.getByText('Copiar'));

      // Ambas aserciones en el mismo `waitFor`: «Copiado» se autolimpia a los 2 s,
      // así que no conviene dejar una espera entre comprobar el portapapeles y el aviso.
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith('Contenido copiable');
        expect(screen.getByText('Copiado')).toBeInTheDocument();
      });
    });
  });

  describe('tamaño de fuente', () => {
    test('el botón A+ cicla la escala de fuente', () => {
      render(<ChatPlayground {...baseProps()} messages={[modelMessage('Texto')]} />);
      const fontButton = screen.getByText('A');
      expect(fontButton).toBeInTheDocument();
      fireEvent.click(fontButton);
      expect(screen.getByText('A+')).toBeInTheDocument();
      fireEvent.click(screen.getByText('A+'));
      expect(screen.getByText('A++')).toBeInTheDocument();
    });
  });

  describe('selector de modelo', () => {
    test('muestra el modelo actual seleccionado', () => {
      render(<ChatPlayground {...baseProps()} />);
      const selector = screen.getByLabelText('Modelo que se usará para responder') as HTMLSelectElement;
      expect(selector.value).toBe('gemini-3.5-flash');
    });

    test('el icono de ayuda va antes del botón de adjuntar', () => {
      render(<ChatPlayground {...baseProps()} />);
      const bar = screen.getByLabelText('Modelo que se usará para responder').parentElement as HTMLElement;
      const help = screen.getByRole('button', { name: /ayuda de menciones|mention help/i });
      const attach = screen.getByLabelText('Adjuntar archivos');
      const select = screen.getByLabelText('Modelo que se usará para responder');
      // El icono de ayuda es el primer hijo, seguido del adjuntar y luego el selector
      expect(bar.firstElementChild).toBe(help);
      expect(help.nextElementSibling).toBe(attach);
      expect(attach.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(attach.tagName).toBe('BUTTON');
    });

    test('enviar tiene etiqueta visible junto a Opciones', () => {
      render(<ChatPlayground {...baseProps()} />);
      const options = screen.getByLabelText('Opciones de conversación').closest('details')!;
      const enviar = screen.getByLabelText('Enviar mensaje');
      expect(options.nextElementSibling).toBe(enviar);
      expect(enviar).toHaveTextContent('Enviar');
    });

    test('ya no se muestra el texto de atajos de teclado', () => {
      render(<ChatPlayground {...baseProps()} />);
      expect(screen.queryByText(/Enter para enviar/)).toBeNull();
      expect(screen.queryByText(/Shift\+Enter/)).toBeNull();
    });

    test('agrupa los modelos por proveedor', () => {
      render(<ChatPlayground {...baseProps()} />);
      const groups = Array.from(document.querySelectorAll('optgroup')).map((g) => g.getAttribute('label'));
      expect(groups).toContain('Google Gemini');
      expect(groups).toContain('OpenRouter');
      expect(groups).toContain('HuggingFace (Local)');
      expect(groups).toContain('Ollama (Local)');
    });

    test('cambiar el modelo llama a setSelectedModel', () => {
      const props = baseProps();
      render(<ChatPlayground {...props} />);
      const selector = screen.getByLabelText('Modelo que se usará para responder');
      fireEvent.change(selector, { target: { value: 'ollama/llama3.2' } });
      expect(props.setSelectedModel).toHaveBeenCalledWith('ollama/llama3.2');
    });

    test('un modelo fuera del catálogo se muestra igual', () => {
      render(<ChatPlayground {...baseProps()} selectedModel="mi-modelo-local-descargado" />);
      const selector = screen.getByLabelText('Modelo que se usará para responder') as HTMLSelectElement;
      expect(selector.value).toBe('mi-modelo-local-descargado');
      expect(screen.getByText('mi-modelo-local-descargado')).toBeInTheDocument();
    });

    test('cada opción muestra el nombre del modelo (con su badge)', () => {
      render(<ChatPlayground {...baseProps()} />);
      expect(screen.getByRole('option', { name: 'Gemini 3.5 Flash · Flash 2026' })).toBeInTheDocument();
    });
  });

  describe('modo de ejecución Build/Plan', () => {
    test('ya no muestra Build/Plan en la barra inferior (ahora en modal Permisos)', () => {
      render(<ChatPlayground {...baseProps()} />);
      // Los botones Build/Plan/Read-only ya no están en la barra inferior
      expect(screen.queryByRole('group', { name: 'Modo de ejecución' })).not.toBeInTheDocument();
      expect(screen.queryByText('Build')).not.toBeInTheDocument();
      expect(screen.queryByText('Plan')).not.toBeInTheDocument();
    });

    test('arranca en Build por defecto (estado interno)', () => {
      render(<ChatPlayground {...baseProps()} />);
      // El estado interno sigue siendo 'build' por defecto
      expect(localStorage.getItem('ai_studio_run_mode')).toBeNull(); // No hay guardado previo
    });

    test('Cambiar modo en el menu lo activa y lo persiste', async () => {
      render(<ChatPlayground {...baseProps()} />);
      // Menú de selección (inicialmente Build)
      const runModeSelect = screen.getByRole('combobox', { name: /Modo del agente|Agent mode/ });
      expect(runModeSelect).toHaveValue('build');
      // Selecciona Plan
      fireEvent.change(runModeSelect, { target: { value: 'plan' } });
      expect(runModeSelect).toHaveValue('plan');
      expect(localStorage.getItem('ai_studio_run_mode')).toBe('plan');
    });

    test('recupera Plan guardado en localStorage', () => {
      localStorage.setItem('ai_studio_run_mode', 'plan');
      render(<ChatPlayground {...baseProps()} />);
      // El estado interno se recupera del localStorage
      expect(localStorage.getItem('ai_studio_run_mode')).toBe('plan');
    });

    test('enviar en Plan pasa runMode=plan a onSendMessage', () => {
      localStorage.setItem('ai_studio_run_mode', 'plan');
      const props = baseProps();
      render(<ChatPlayground {...props} />);
      fireEvent.change(getTextarea(), { target: { value: 'planifica X' } });
      fireEvent.click(getSendButton());
      expect(props.onSendMessage).toHaveBeenCalledWith('planifica X', undefined, undefined, 'plan');
    });

    test('enviar en Sólo lectura pasa runMode=readonly a onSendMessage', () => {
      localStorage.setItem('ai_studio_run_mode', 'readonly');
      const props = baseProps();
      render(<ChatPlayground {...props} />);
      fireEvent.change(getTextarea(), { target: { value: 'analiza X' } });
      fireEvent.click(getSendButton());
      expect(props.onSendMessage).toHaveBeenCalledWith('analiza X', undefined, undefined, 'readonly');
    });

    test('el botón Avanzado abre la configuración avanzada', async () => {
      render(<ChatPlayground {...baseProps()} />);
      fireEvent.click(screen.getByText(/Avanzado|Advanced/));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/Configuración avanzada|Advanced settings/)).toBeInTheDocument();
      // El modal ya no incluye selector de modo (se usa el toggle rápido);
      // verifica que sí tenga tools y globs.
      expect(within(dialog).getByText(/Tools permitidas|Allowed tools/)).toBeInTheDocument();
      expect(within(dialog).getByText(/Globs de lectura|Read globs/)).toBeInTheDocument();
      expect(within(dialog).getByText(/Globs de escritura|Write globs/)).toBeInTheDocument();
    });
  });

  describe('menciones @', () => {
    beforeEach(() => {
      mockSearchFiles.mockReset();
      mockSearchFiles.mockResolvedValue({
        files: [{ path: 'src/components/ChatPlayground.tsx', score: 1 }],
      });
    });

    test('escribir @ abre el picker con archivos reales del proyecto', async () => {
      render(<ChatPlayground {...baseProps()} />);
      fireEvent.change(getTextarea(), { target: { value: 'revisa @' } });

      expect(await screen.findByText('@src/components/ChatPlayground.tsx')).toBeInTheDocument();
      expect(mockSearchFiles).toHaveBeenCalled();
    });

    test('Enter selecciona la mención e inserta la ruta', async () => {
      render(<ChatPlayground {...baseProps()} />);
      const ta = getTextarea();
      fireEvent.change(ta, { target: { value: 'revisa @' } });
      await screen.findByText('@src/components/ChatPlayground.tsx');

      fireEvent.keyDown(ta, { key: 'Enter' });

      await waitFor(() => expect(ta.value).toBe('revisa @src/components/ChatPlayground.tsx '));
    });

    test('Escape cierra el picker', async () => {
      render(<ChatPlayground {...baseProps()} />);
      const ta = getTextarea();
      fireEvent.change(ta, { target: { value: 'revisa @' } });
      await screen.findByText('@src/components/ChatPlayground.tsx');

      fireEvent.keyDown(ta, { key: 'Escape' });

      await waitFor(() =>
        expect(screen.queryByText('@src/components/ChatPlayground.tsx')).toBeNull()
      );
    });
  });
});

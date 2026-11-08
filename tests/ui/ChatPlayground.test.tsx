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
import { writeChatQueue } from '../../src/components/chat/chatQueue';

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
          // El catálogo base ya no inventa modelos de Ollama: llegan del
          // catálogo vivo, como los de un servidor real con modelos descargados.
          models: [
            {
              id: 'ollama/llama3.2',
              name: 'Llama 3.2 (Ollama local, gratis)',
              provider: 'ollama',
              contextWindow: '128K tokens',
              supportsTools: true,
            },
          ],
          // `/api/providers` devuelve la lista de proveedores configurados; sin
          // esto el compositor filtra todos los grupos al saber qué hay activo.
          providers: [
            { id: 'google', name: 'Google Gemini', configured: true, enabled: true, whitelist: [], blacklist: [] },
            { id: 'huggingface', name: 'HuggingFace (Local)', configured: true, enabled: true, whitelist: [], blacklist: [] },
            { id: 'ollama', name: 'Ollama (Local)', configured: true, enabled: true, whitelist: [], blacklist: [] },
            { id: 'openrouter', name: 'OpenRouter', configured: true, enabled: true, whitelist: [], blacklist: [] },
            { id: 'custom', name: 'OpenAI-compatible', configured: true, enabled: true, whitelist: [], blacklist: [] },
          ],
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

    test('el contexto de LM Studio configurado en el compositor se guarda en los parámetros', async () => {
      globalThis.fetch = vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            permissions: { mode: 'build', allowedTools: null, deniedTools: [], files: { read: [], write: [] } },
            providers: [
              { id: 'lmstudio', name: 'LM Studio', configured: true, enabled: true, whitelist: [], blacklist: [] },
            ],
            models: [
              {
                id: 'lmstudio/qwen2.5-coder-14b',
                name: 'Qwen 2.5 Coder 14B',
                provider: 'lmstudio',
                contextWindow: '32K tokens',
                contextLength: 32768,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      ) as unknown as typeof fetch;

      const setParameters = vi.fn();
      const props = { ...baseProps(), selectedModel: 'lmstudio/qwen2.5-coder-14b', setParameters };
      render(<ChatPlayground {...props} />);

      const select = (await screen.findByLabelText('Contexto al cargar el modelo')) as HTMLSelectElement;
      expect(select.value).toBe('0');

      fireEvent.change(select, { target: { value: '8192' } });
      expect(setParameters).toHaveBeenCalledTimes(1);
      const update = setParameters.mock.calls[0][0] as (prev: typeof DEFAULT_PARAMETERS) => typeof DEFAULT_PARAMETERS;
      expect(update({ ...DEFAULT_PARAMETERS })).toMatchObject({ contextLength: 8192 });
    });

    test('Enter envía el mensaje', () => {
      const props = baseProps();
      render(<ChatPlayground {...props} />);
      fireEvent.change(getTextarea(), { target: { value: 'Mensaje con Enter' } });
      fireEvent.keyDown(getTextarea(), { key: 'Enter' });
      expect(props.onSendMessage).toHaveBeenCalledWith('Mensaje con Enter', undefined, undefined, 'build');
    });

    test('Ctrl+Enter interrumpe la acción actual y envía ya', () => {
      const props = baseProps();
      const onStop = vi.fn();
      render(<ChatPlayground {...props} isGenerating={true} onStop={onStop} />);
      const textarea = screen.getByRole('textbox');

      fireEvent.change(textarea, { target: { value: 'Corta y envía' } });
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

      expect(onStop).toHaveBeenCalledTimes(1);
      expect(props.onSendMessage).toHaveBeenCalledWith('Corta y envía', undefined, undefined, 'build');
      expect(screen.queryByTestId('chat-queue')).toBeNull();
      expect((textarea as HTMLTextAreaElement).value).toBe('');
    });

    test('Cmd+Enter también interrumpe la acción actual y envía ya', () => {
      const props = baseProps();
      const onStop = vi.fn();
      render(<ChatPlayground {...props} isGenerating={true} onStop={onStop} />);
      const textarea = screen.getByRole('textbox');

      fireEvent.change(textarea, { target: { value: 'En Mac' } });
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

      expect(onStop).toHaveBeenCalledTimes(1);
      expect(props.onSendMessage).toHaveBeenCalledWith('En Mac', undefined, undefined, 'build');
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

    test('mientras genera, el hueco de Enviar lo ocupa Detener', () => {
      const props = baseProps();
      const { rerender } = render(<ChatPlayground {...props} />);
      fireEvent.change(getTextarea(), { target: { value: 'Hola' } });
      expect(getSendButton()).not.toBeDisabled();
      // isGenerating llega por props: ya no se bloquea, se puede cortar.
      rerender(<ChatPlayground {...props} isGenerating={true} />);
      expect(screen.queryByLabelText('Enviar mensaje')).toBeNull();
      expect(screen.getByLabelText('Detener generación')).toBeEnabled();
      // El campo sigue escribible y lo nuevo se puede encolar.
      expect(screen.getByRole('textbox')).not.toBeDisabled();
      expect(screen.getByLabelText('Encolar mensaje')).toBeEnabled();
    });

    test('lo escrito mientras genera se encola y sale al terminar', () => {
      const props = baseProps();
      const { rerender } = render(<ChatPlayground {...props} isGenerating={true} />);
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(textarea).not.toBeDisabled();

      fireEvent.change(textarea, { target: { value: 'Mensaje en espera' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });

      expect(props.onSendMessage).not.toHaveBeenCalled();
      expect(screen.getByTestId('chat-queue')).toHaveTextContent('Mensaje en espera');
      expect(textarea.value).toBe('');

      rerender(<ChatPlayground {...props} isGenerating={false} />);

      expect(props.onSendMessage).toHaveBeenCalledTimes(1);
      expect(props.onSendMessage).toHaveBeenCalledWith('Mensaje en espera', undefined, undefined, 'build');
      expect(screen.queryByTestId('chat-queue')).toBeNull();
      // El avance automático de la cola no es un envío inmediato: no avisa.
      expect(screen.queryByTestId('queue-send-notice')).toBeNull();
    });

    test('con «Interrumpir» activo, enviar corta la acción y sale de inmediato', () => {
      const props = baseProps();
      const onStop = vi.fn();
      render(<ChatPlayground {...props} isGenerating={true} onStop={onStop} />);

      const toggle = screen.getByLabelText('Interrumpir la acción al enviar');
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-pressed', 'true');

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ahora mismo' } });
      fireEvent.click(screen.getByLabelText('Interrumpir y enviar'));

      expect(onStop).toHaveBeenCalledTimes(1);
      expect(props.onSendMessage).toHaveBeenCalledWith('Ahora mismo', undefined, undefined, 'build');
      expect(screen.queryByTestId('chat-queue')).toBeNull();
    });

    test('la preferencia de interrumpir se recuerda entre montajes', () => {
      const { unmount } = render(<ChatPlayground {...baseProps()} isGenerating={true} />);
      fireEvent.click(screen.getByLabelText('Interrumpir la acción al enviar'));
      unmount();

      render(<ChatPlayground {...baseProps()} isGenerating={true} />);
      expect(screen.getByLabelText('Interrumpir la acción al enviar')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });

    test('un mensaje en cola se puede quitar antes de enviarse', () => {
      const props = baseProps();
      const { rerender } = render(<ChatPlayground {...props} isGenerating={true} />);
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'Mensaje descartable' } });
      fireEvent.click(screen.getByLabelText('Encolar mensaje'));

      fireEvent.click(screen.getByLabelText('Quitar de la cola: Mensaje descartable'));
      expect(screen.queryByTestId('chat-queue')).toBeNull();

      rerender(<ChatPlayground {...props} isGenerating={false} />);
      expect(props.onSendMessage).not.toHaveBeenCalled();
    });

    test('envía varios mensajes encolados en orden, uno por acción', () => {
      const props = baseProps();
      const { rerender } = render(<ChatPlayground {...props} isGenerating={true} />);
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

      fireEvent.change(textarea, { target: { value: 'Primero' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      fireEvent.change(textarea, { target: { value: 'Segundo' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });

      expect(props.onSendMessage).not.toHaveBeenCalled();
      expect(screen.getByTestId('chat-queue')).toHaveTextContent('Primero');
      expect(screen.getByTestId('chat-queue')).toHaveTextContent('Segundo');

      // Termina la acción en curso: sólo sale el primero.
      rerender(<ChatPlayground {...props} isGenerating={false} />);
      expect(props.onSendMessage).toHaveBeenNthCalledWith(1, 'Primero', undefined, undefined, 'build');
      expect(screen.getByTestId('chat-queue')).toHaveTextContent('Segundo');

      // El padre marca la nueva acción como en curso y después termina.
      rerender(<ChatPlayground {...props} isGenerating={true} />);
      rerender(<ChatPlayground {...props} isGenerating={false} />);
      expect(props.onSendMessage).toHaveBeenNthCalledWith(2, 'Segundo', undefined, undefined, 'build');
      expect(props.onSendMessage).toHaveBeenCalledTimes(2);
      expect(screen.queryByTestId('chat-queue')).toBeNull();
    });

    test('Ctrl+Shift+Enter envía ya el primer pendiente y conserva el resto', () => {
      const key = 'queue-shortcut-first';
      writeChatQueue(key, []);
      const props = baseProps();
      const onStop = vi.fn();
      render(<ChatPlayground {...props} queueKey={key} isGenerating onStop={onStop} />);
      const textarea = screen.getByRole('textbox');

      fireEvent.change(textarea, { target: { value: 'Primero' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      fireEvent.change(textarea, { target: { value: 'Segundo' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });

      fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true, shiftKey: true });

      expect(onStop).toHaveBeenCalledTimes(1);
      expect(props.onSendMessage).toHaveBeenCalledTimes(1);
      expect(props.onSendMessage).toHaveBeenCalledWith('Primero', undefined, undefined, 'build');
      expect(screen.getByTestId('queue-send-notice')).toHaveTextContent(
        'Mensaje enviado al instante · queda 1 en cola'
      );
      expect(screen.getByTestId('chat-queue')).toHaveTextContent('Segundo');
      expect(screen.getByTestId('chat-queue')).not.toHaveTextContent('Primero');

      // Cmd+Shift+Enter hace lo mismo en macOS.
      fireEvent.keyDown(window, { key: 'Enter', metaKey: true, shiftKey: true });
      expect(props.onSendMessage).toHaveBeenNthCalledWith(2, 'Segundo', undefined, undefined, 'build');
      expect(onStop).toHaveBeenCalledTimes(2);
      expect(screen.queryByTestId('chat-queue')).toBeNull();
      expect(screen.getByTestId('queue-send-notice')).toHaveTextContent(
        'Mensaje enviado al instante · la cola quedó vacía'
      );
    });
  });

  describe('edición y orden de la cola', () => {
    test('un mensaje en cola vuelve al compositor con sus adjuntos y se puede reencolar', () => {
      const key = 'queue-return-to-composer';
      const primero = new File(['uno'], 'informe.txt', { type: 'text/plain' });
      const segundo = new File(['dos'], 'captura.png', { type: 'image/png' });
      writeChatQueue(key, [
        {
          id: 'queued-return',
          text: 'Original con adjuntos',
          attachments: [primero, segundo],
          runMode: 'build',
        },
      ]);
      const props = baseProps();
      const { rerender } = render(
        <ChatPlayground {...props} queueKey={key} isGenerating />
      );

      fireEvent.click(
        screen.getByLabelText('Editar en el compositor: Original con adjuntos')
      );

      expect(screen.queryByTestId('chat-queue')).toBeNull();
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Original con adjuntos');
      expect(screen.getByText('informe.txt')).toBeInTheDocument();
      expect(screen.getByText('captura.png')).toBeInTheDocument();

      fireEvent.change(textarea, { target: { value: 'Editado con adjuntos' } });
      fireEvent.click(screen.getByLabelText('Encolar mensaje'));

      expect(screen.getByTestId('chat-queue')).toHaveTextContent('Editado con adjuntos');
      expect(textarea.value).toBe('');

      rerender(<ChatPlayground {...props} queueKey={key} isGenerating={false} />);
      expect(props.onSendMessage).toHaveBeenCalledTimes(1);
      expect(props.onSendMessage).toHaveBeenCalledWith(
        'Editado con adjuntos',
        [primero, segundo],
        undefined,
        'build'
      );
    });

    test('un borrador existente en el compositor se conserva al devolver un mensaje de la cola', () => {
      const key = 'queue-return-keeps-draft';
      writeChatQueue(key, [
        {
          id: 'queued-return-draft',
          text: 'Mensaje en cola',
          attachments: [],
          runMode: 'build',
        },
      ]);
      render(<ChatPlayground {...baseProps()} queueKey={key} isGenerating />);

      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'Borrador a medias' } });

      fireEvent.click(
        screen.getByLabelText('Editar en el compositor: Mensaje en cola')
      );

      // El pendiente se añade debajo sin pisar lo que ya se estaba escribiendo.
      expect(textarea.value).toBe('Borrador a medias\n\nMensaje en cola');
      expect(screen.queryByTestId('chat-queue')).toBeNull();
    });

    test('un mensaje en cola se puede editar antes de enviarse', () => {
      const props = baseProps();
      const { rerender } = render(<ChatPlayground {...props} isGenerating />);
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'Texto original' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });

      fireEvent.click(screen.getByLabelText('Editar de la cola: Texto original'));
      const editor = screen.getByLabelText(
        'Editar mensaje en cola: Texto original'
      ) as HTMLTextAreaElement;
      fireEvent.change(editor, { target: { value: 'Texto corregido' } });
      fireEvent.keyDown(editor, { key: 'Enter' });

      expect(screen.getByTestId('chat-queue')).toHaveTextContent('Texto corregido');
      expect(screen.getByTestId('chat-queue')).not.toHaveTextContent('Texto original');

      rerender(<ChatPlayground {...props} isGenerating={false} />);
      expect(props.onSendMessage).toHaveBeenCalledWith(
        'Texto corregido',
        undefined,
        undefined,
        'build'
      );
    });

    test('un mensaje en edición se envía al instante con el texto actual sin guardarlo', () => {
      const key = 'queue-send-edited-now';
      const adjunto = new File(['adjunto'], 'nota.txt', { type: 'text/plain' });
      writeChatQueue(key, [
        {
          id: 'queued-send-edited',
          text: 'Texto original',
          attachments: [adjunto],
          runMode: 'build',
        },
      ]);
      const props = baseProps();
      const onStop = vi.fn();
      render(<ChatPlayground {...props} queueKey={key} isGenerating onStop={onStop} />);

      fireEvent.click(screen.getByLabelText('Editar de la cola: Texto original'));
      const editor = screen.getByLabelText(
        'Editar mensaje en cola: Texto original'
      ) as HTMLTextAreaElement;
      fireEvent.change(editor, { target: { value: 'Texto actual sin guardar' } });
      fireEvent.click(screen.getByLabelText('Enviar ahora sin guardar'));

      expect(onStop).toHaveBeenCalledTimes(1);
      expect(props.onSendMessage).toHaveBeenCalledTimes(1);
      expect(props.onSendMessage).toHaveBeenCalledWith(
        'Texto actual sin guardar',
        [adjunto],
        undefined,
        'build'
      );
      expect(screen.queryByTestId('chat-queue')).toBeNull();
      expect(screen.getByTestId('queue-send-notice')).toHaveTextContent(
        'Mensaje enviado al instante · la cola quedó vacía'
      );
      expect(screen.queryByLabelText('Editar mensaje en cola: Texto original')).toBeNull();
    });

    test('los mensajes en cola se pueden reordenar arrastrando y soltando', () => {
      const key = 'queue-drag-reorder';
      writeChatQueue(key, []);
      const props = baseProps();
      const { rerender } = render(<ChatPlayground {...props} queueKey={key} isGenerating />);
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'Primero' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      fireEvent.change(textarea, { target: { value: 'Segundo' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });

      const queue = screen.getByTestId('chat-queue');
      const items = within(queue).getAllByRole('listitem');
      expect(within(items[0]).getByTitle('Arrastrar para reordenar')).toBeInTheDocument();

      const dataTransfer = {
        effectAllowed: 'none',
        dropEffect: 'none',
        setData: vi.fn(),
        getData: vi.fn(() => ''),
      };
      fireEvent.dragStart(items[1], { dataTransfer });
      fireEvent.dragOver(items[0], { dataTransfer });
      // La mitad superior de la fila destino inserta delante de ella.
      fireEvent.drop(items[0], { dataTransfer });

      const reordered = within(queue).getAllByRole('listitem');
      expect(reordered[0]).toHaveTextContent('Segundo');
      expect(reordered[1]).toHaveTextContent('Primero');

      rerender(<ChatPlayground {...props} queueKey={key} isGenerating={false} />);
      expect(props.onSendMessage).toHaveBeenNthCalledWith(1, 'Segundo', undefined, undefined, 'build');
    });

    test('los mensajes en cola se pueden reordenar con arrastre táctil', () => {
      const key = 'queue-pointer-reorder';
      writeChatQueue(key, [
        { id: 'pointer-1', text: 'Primero', attachments: [], runMode: 'build' },
        { id: 'pointer-2', text: 'Segundo', attachments: [], runMode: 'build' },
      ]);
      render(<ChatPlayground {...baseProps()} queueKey={key} isGenerating />);

      const queue = screen.getByTestId('chat-queue');
      const items = within(queue).getAllByRole('listitem');
      const handle = within(items[1]).getByTitle('Arrastrar para reordenar');
      const originalElementFromPoint = document.elementFromPoint;
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: vi.fn(() => items[0]),
      });

      try {
        fireEvent.pointerDown(handle, {
          pointerId: 1,
          pointerType: 'touch',
          clientX: 10,
          clientY: 0,
        });
        fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 0 });
        fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 0 });
      } finally {
        Object.defineProperty(document, 'elementFromPoint', {
          configurable: true,
          value: originalElementFromPoint,
        });
      }

      const reordered = within(queue).getAllByRole('listitem');
      expect(reordered[0]).toHaveTextContent('Segundo');
      expect(reordered[1]).toHaveTextContent('Primero');
    });

    test('arrastrar hacia abajo coloca el mensaje después de la fila destino', () => {
      const key = 'queue-pointer-reorder-down';
      writeChatQueue(key, [
        { id: 'down-1', text: 'Primero', attachments: [], runMode: 'build' },
        { id: 'down-2', text: 'Segundo', attachments: [], runMode: 'build' },
      ]);
      render(<ChatPlayground {...baseProps()} queueKey={key} isGenerating />);

      const queue = screen.getByTestId('chat-queue');
      const items = within(queue).getAllByRole('listitem');
      const handle = within(items[0]).getByTitle('Arrastrar para reordenar');
      const originalElementFromPoint = document.elementFromPoint;
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: vi.fn(() => items[1]),
      });

      // jsdom no siempre define PointerEvent: fireEvent.pointerMove caería a
      // Event y perdería clientY, así que se despachan eventos con coordenadas
      // reales y el pointerId explícito.
      const pointerEvent = (type: string, clientY: number) => {
        const event = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY,
        });
        Object.defineProperty(event, 'pointerId', { value: 2 });
        Object.defineProperty(event, 'pointerType', { value: 'touch' });
        return event;
      };

      try {
        fireEvent(handle, pointerEvent('pointerdown', 0));
        // Mitad inferior de la fila destino: el origen queda después de ella.
        fireEvent(window, pointerEvent('pointermove', 20));
        fireEvent(window, pointerEvent('pointerup', 20));
      } finally {
        Object.defineProperty(document, 'elementFromPoint', {
          configurable: true,
          value: originalElementFromPoint,
        });
      }

      const reordered = within(queue).getAllByRole('listitem');
      expect(reordered[0]).toHaveTextContent('Segundo');
      expect(reordered[1]).toHaveTextContent('Primero');
    });

    test('los mensajes en cola se pueden reordenar antes de enviarse', () => {
      const props = baseProps();
      const { rerender } = render(<ChatPlayground {...props} isGenerating />);
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'Primero' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      fireEvent.change(textarea, { target: { value: 'Segundo' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });

      fireEvent.click(screen.getByLabelText('Subir en la cola: Segundo'));

      const items = within(screen.getByTestId('chat-queue')).getAllByRole('listitem');
      expect(items[0]).toHaveTextContent('Segundo');
      expect(items[1]).toHaveTextContent('Primero');

      rerender(<ChatPlayground {...props} isGenerating={false} />);
      expect(props.onSendMessage).toHaveBeenNthCalledWith(
        1,
        'Segundo',
        undefined,
        undefined,
        'build'
      );
    });

    test('un mensaje en cola se puede enviar al instante interrumpiendo la acción', () => {
      const key = 'queue-send-now';
      writeChatQueue(key, []);
      const props = baseProps();
      const onStop = vi.fn();
      const { rerender } = render(
        <ChatPlayground {...props} queueKey={key} isGenerating onStop={onStop} />
      );
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'Primero' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      fireEvent.change(textarea, { target: { value: 'Segundo' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });

      fireEvent.click(screen.getByLabelText('Enviar ahora: Segundo'));

      expect(onStop).toHaveBeenCalledTimes(1);
      expect(props.onSendMessage).toHaveBeenCalledTimes(1);
      expect(props.onSendMessage).toHaveBeenCalledWith(
        'Segundo',
        undefined,
        undefined,
        'build'
      );
      expect(screen.getByTestId('queue-send-notice')).toHaveTextContent(
        'Mensaje enviado al instante · queda 1 en cola'
      );
      const queue = screen.getByTestId('chat-queue');
      expect(queue).toHaveTextContent('Primero');
      expect(queue).not.toHaveTextContent('Segundo');

      // El resto de la cola sigue su turno cuando termina la acción nueva.
      rerender(
        <ChatPlayground {...props} queueKey={key} isGenerating={false} onStop={onStop} />
      );
      expect(props.onSendMessage).toHaveBeenNthCalledWith(
        2,
        'Primero',
        undefined,
        undefined,
        'build'
      );
    });
  });

  describe('cola persistente por sesión', () => {
    test('sobrevive a desmontar el chat al cambiar de modo', () => {
      const key = 'queue-mode-switch';
      writeChatQueue(key, []);
      const props = baseProps();
      const { unmount } = render(
        <ChatPlayground {...props} queueKey={key} isGenerating />
      );
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'Sobrevive al modo' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(screen.getByTestId('chat-queue')).toHaveTextContent('Sobrevive al modo');

      unmount();

      const after = baseProps();
      render(<ChatPlayground {...after} queueKey={key} isGenerating={false} />);
      expect(after.onSendMessage).toHaveBeenCalledTimes(1);
      expect(after.onSendMessage).toHaveBeenCalledWith(
        'Sobrevive al modo',
        undefined,
        undefined,
        'build'
      );
      expect(screen.queryByTestId('chat-queue')).toBeNull();
    });

    test('la preferencia de interrumpir al enviar también es por sesión', () => {
      const keyA = 'interrupt-session-a';
      const keyB = 'interrupt-session-b';
      const props = baseProps();
      const { rerender } = render(
        <ChatPlayground {...props} queueKey={keyA} isGenerating />
      );

      const toggleA = screen.getByLabelText('Interrumpir la acción al enviar');
      expect(toggleA).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(toggleA);
      expect(toggleA).toHaveAttribute('aria-pressed', 'true');
      expect(localStorage.getItem(`ai_studio_interrupt_on_send:${keyA}`)).toBe('true');
      // Ya no se escribe la clave global: la elección es de esta sesión.
      expect(localStorage.getItem('ai_studio_interrupt_on_send')).toBeNull();

      rerender(<ChatPlayground {...props} queueKey={keyB} isGenerating />);
      expect(screen.getByLabelText('Interrumpir la acción al enviar')).toHaveAttribute(
        'aria-pressed',
        'false'
      );
      expect(localStorage.getItem(`ai_studio_interrupt_on_send:${keyB}`)).toBeNull();

      rerender(<ChatPlayground {...props} queueKey={keyA} isGenerating />);
      expect(screen.getByLabelText('Interrumpir la acción al enviar')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });

    test('cada pestaña o sesión conserva su propia cola', () => {
      const keyA = 'queue-session-a';
      const keyB = 'queue-session-b';
      writeChatQueue(keyA, []);
      writeChatQueue(keyB, []);

      const props = baseProps();
      const { rerender } = render(
        <ChatPlayground {...props} queueKey={keyA} isGenerating />
      );
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'Pendiente de A' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });

      // Cambia de pestaña/sesión: la cola de A no aparece en B.
      rerender(<ChatPlayground {...props} queueKey={keyB} isGenerating />);
      expect(screen.queryByTestId('chat-queue')).toBeNull();
      expect(props.onSendMessage).not.toHaveBeenCalled();

      // Vuelve a A: el mensaje sigue esperando y no se coló en B.
      rerender(<ChatPlayground {...props} queueKey={keyA} isGenerating />);
      expect(screen.getByTestId('chat-queue')).toHaveTextContent('Pendiente de A');
      expect(props.onSendMessage).not.toHaveBeenCalled();

      // Al terminar la acción en A, sale el mensaje que se encoló allí.
      rerender(<ChatPlayground {...props} queueKey={keyA} isGenerating={false} />);
      expect(props.onSendMessage).toHaveBeenCalledTimes(1);
      expect(props.onSendMessage).toHaveBeenCalledWith(
        'Pendiente de A',
        undefined,
        undefined,
        'build'
      );
    });
  });

  describe('actividad en el chat', () => {
    test('mientras genera el chat muestra que está procesando, y lo retira al terminar', () => {
      const props = baseProps();
      const { rerender } = render(<ChatPlayground {...props} />);
      // En reposo no hay señal: el chat no finge actividad.
      expect(screen.queryByTestId('chat-activity')).toBeNull();

      rerender(<ChatPlayground {...props} isGenerating={true} />);
      const actividad = screen.getByTestId('chat-activity');
      expect(actividad).toHaveTextContent('Procesando');
      // Es un estado anunciable, no decoración: lectores de pantalla lo leen.
      expect(actividad).toHaveAttribute('role', 'status');

      rerender(<ChatPlayground {...props} isGenerating={false} />);
      expect(screen.queryByTestId('chat-activity')).toBeNull();
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

  describe('reintentar respuesta fallida', () => {
    const failedMessage = (id = 'm1'): ChatMessage => ({
      ...modelMessage('⚠️ Error al procesar consulta: sin conexión'),
      id,
      failed: true,
      retryRunMode: 'build',
    });

    test('el último mensaje fallido ofrece Reintentar y entrega su id', () => {
      const onRetryMessage = vi.fn();
      render(
        <ChatPlayground
          {...baseProps()}
          messages={[userMessage(), failedMessage()]}
          onRetryMessage={onRetryMessage}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

      expect(onRetryMessage).toHaveBeenCalledWith('m1');
    });

    test('no ofrece reintentar una respuesta fallida que ya no es la última', () => {
      render(
        <ChatPlayground
          {...baseProps()}
          messages={[
            userMessage(),
            failedMessage(),
            { ...modelMessage('Otra respuesta'), id: 'm2' },
          ]}
          onRetryMessage={vi.fn()}
        />
      );

      expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
    });
  });

  describe('selector de modelo', () => {
    test('muestra el modelo actual seleccionado', () => {
      render(<ChatPlayground {...baseProps()} />);
      const selector = screen.getByLabelText('Modelo que se usará para responder');
      expect(selector).toHaveTextContent('Gemini 3.5 Flash');
      expect(selector).toHaveAttribute('aria-expanded', 'false');
    });

    test('la barra de contexto queda debajo del campo y de los botones', () => {
      render(<ChatPlayground {...baseProps()} />);
      const textarea = getTextarea();
      const meter = screen.getByTestId('context-meter');
      const enviar = screen.getByLabelText('Enviar mensaje');

      expect(textarea.compareDocumentPosition(meter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(enviar.compareDocumentPosition(meter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

    test('mientras genera el botón pasa a Detener y llama a onStop', () => {
      const onStop = vi.fn();
      render(<ChatPlayground {...baseProps()} isGenerating={true} onStop={onStop} />);

      const detener = screen.getByLabelText('Detener generación');
      expect(detener).toHaveTextContent('Detener');
      fireEvent.click(detener);

      expect(onStop).toHaveBeenCalledTimes(1);
      // Mientras corre no hay Enviar: el mismo hueco lo ocupa Detener.
      expect(screen.queryByLabelText('Enviar mensaje')).toBeNull();
    });

    test('una corrida detenida ofrece Continuar', () => {
      const onResume = vi.fn();
      render(<ChatPlayground {...baseProps()} resumable={true} onResume={onResume} />);

      fireEvent.click(screen.getByLabelText('Continuar la corrida detenida'));

      expect(onResume).toHaveBeenCalledTimes(1);
    });

    test('ya no se muestra el texto de atajos de teclado', () => {
      render(<ChatPlayground {...baseProps()} />);
      expect(screen.queryByText(/Enter para enviar/)).toBeNull();
      expect(screen.queryByText(/Shift\+Enter/)).toBeNull();
    });

    test('agrupa los modelos por proveedor', async () => {
      render(<ChatPlayground {...baseProps()} />);
      fireEvent.click(screen.getByLabelText('Modelo que se usará para responder'));
      // Los modelos de Ollama llegan del catálogo vivo, no de una lista fija.
      await waitFor(() => {
        const groups = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'));
        expect(groups).toContain('Google Gemini');
        expect(groups).toContain('OpenRouter');
        expect(groups).toContain('HuggingFace (Local)');
        expect(groups).toContain('Ollama (Local)');
      });
    });

    test('elegir un modelo en el panel llama a setSelectedModel', async () => {
      const props = baseProps();
      render(<ChatPlayground {...props} />);
      fireEvent.click(screen.getByLabelText('Modelo que se usará para responder'));
      fireEvent.change(screen.getByLabelText('Buscar modelo o proveedor'), { target: { value: 'llama3.2' } });
      fireEvent.click(await screen.findByRole('option', { name: /Llama 3.2/ }));
      expect(props.setSelectedModel).toHaveBeenCalledWith('ollama/llama3.2');
    });

    test('un modelo fuera del catálogo se muestra igual', () => {
      render(<ChatPlayground {...baseProps()} selectedModel="mi-modelo-local-descargado" />);
      const selector = screen.getByLabelText('Modelo que se usará para responder');
      expect(selector).toHaveTextContent('mi-modelo-local-descargado');
    });

    test('cada opción muestra el nombre del modelo (con su badge)', () => {
      render(<ChatPlayground {...baseProps()} />);
      fireEvent.click(screen.getByLabelText('Modelo que se usará para responder'));
      expect(screen.getByRole('option', { name: /Gemini 3.5 Flash · Flash 2026/ })).toBeInTheDocument();
    });

    test('el panel busca por proveedor', async () => {
      render(<ChatPlayground {...baseProps()} />);
      fireEvent.click(screen.getByLabelText('Modelo que se usará para responder'));
      fireEvent.change(screen.getByLabelText('Buscar modelo o proveedor'), { target: { value: 'ollama' } });
      expect(await screen.findByRole('option', { name: /Llama 3.2/ })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /Gemini 3.5 Flash/ })).toBeNull();
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

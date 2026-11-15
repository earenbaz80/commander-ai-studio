/**
 * Tests de FloatingAssistant (Nono): apertura, mini-chat, acciones rápidas,
 * persistencia de posición, arrastre, reanclaje y ajuste de animación.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { FloatingAssistant } from '../../src/components/FloatingAssistant';

/** Nono busca la cabeza por su aria-label ("Nono"). */
const getHead = () => screen.getByLabelText('Nono') as HTMLElement;
const getHeadVisual = () => document.querySelector('[data-variant][data-expression]') as HTMLElement | null;
const getExpression = () => getHeadVisual()?.getAttribute('data-expression');

describe('FloatingAssistant (Nono)', () => {
  let unexpectedFetches: string[] = [];

  beforeEach(() => {
    localStorage.clear();
    // Reloj falso sin `shouldAdvanceTime`: el tiempo sólo avanza cuando el test lo pide,
    // así ninguna aserción depende de cuánto tarde la máquina en ejecutarla.
    vi.useFakeTimers();
    unexpectedFetches = [];
    // Nono lee la clave de Gemini del servidor; cualquier otra llamada de red es un fallo.
    // Al abrir el panel también refresca su contexto (sondeo de tools + memoria durable):
    // esas rutas contestan vacías para que no generen sugerencias.
    const json = (payload: unknown) => ({ ok: true, json: async () => payload }) as Response;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.startsWith('/api/keys/')) return json({ success: true, value: '' });
      if (u.startsWith('/api/agent/run-tool')) return json({ success: true, data: {} });
      if (u.startsWith('/api/nono/observations')) return json({ observations: [] });
      unexpectedFetches.push(u);
      throw new Error(`fetch no mockeado: ${u}`);
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    expect(unexpectedFetches).toEqual([]);
  });

  describe('visibilidad y anclaje', () => {
    test('la cabeza se muestra siempre (sin clic previo)', () => {
      render(<FloatingAssistant lang="es" />);
      expect(getHead()).toBeInTheDocument();
      expect(getHeadVisual()).toBeTruthy();
    });

    test('arranca con expresión neutral', () => {
      render(<FloatingAssistant lang="es" />);
      expect(['neutral', 'happy']).toContain(getExpression());
    });

    test('mientras el chat procesa, Nono mantiene la cara SVG sin capas aparte', () => {
      const { rerender } = render(<FloatingAssistant lang="es" busy />);

      expect(getExpression()).toBe('thinking');
      expect(screen.queryByTestId('nono-working')).toBeNull();
      expect(screen.queryByTestId('nono-face-process')).toBeNull();
      expect(screen.queryByTestId('nono-face-eyes')).toBeNull();
      expect(screen.queryByTestId('nono-face-mouth')).toBeNull();
      expect(getHead().className).toContain('nono-busy');

      // Al terminar, el estado de proceso desaparece, vuelve la cara SVG y Nono celebra un instante.
      rerender(<FloatingAssistant lang="es" busy={false} />);
      expect(screen.queryByTestId('nono-working')).toBeNull();
      expect(screen.queryByTestId('nono-face-process')).toBeNull();
      expect(screen.getByTestId('nono-bothead')).toBeInTheDocument();
      expect(screen.getByTestId('nono-classic-face')).toBeInTheDocument();
      expect(document.querySelector('.nono-bothead__gif')).toBeNull();
      expect(getHead().className).not.toContain('nono-busy');
      // Terminar bien se celebra con gafas de sol.
      expect(getExpression()).toBe('cool');
    });

    test('el orbe procesando mira arriba, asiente y dice que sí', () => {
      localStorage.setItem('nono-memory-v1', JSON.stringify({ ui: { orbSkin: true } }));
      render(<FloatingAssistant lang="es" busy />);

      const face = document.querySelector(
        'svg[data-variant="orb"] [data-testid="nono-orb-busy-face"]'
      );
      expect(face).toBeTruthy();
      expect(face?.getAttribute('data-look')).toBe('up');
      expect(document.querySelector('svg[data-variant="orb"] .nono-orb-affirm')).toBeTruthy();
      expect(document.querySelector('.nono-orb-rotor')).toBeNull();
      expect(document.querySelector('.nono-orb-latitudes')).toBeNull();
      // La cara de proceso sustituye a los ojos normales, no los oculta.
      expect(screen.queryByTestId('nono-orb-eyes')).toBeNull();
      expect(screen.getByText('¡Sí! Voy con ello.')).toBeInTheDocument();
      expect(screen.queryByText('Procesando…')).toBeNull();

      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(screen.getByText('¡Sí! Voy con ello.')).toBeInTheDocument();
    });

    test('el orbe no muestra boca en ningún estado', () => {
      localStorage.setItem('nono-memory-v1', JSON.stringify({ ui: { orbSkin: true } }));

      const expectOrbWithoutMouth = () => {
        const orb = document.querySelector('svg[data-variant="orb"]') as SVGSVGElement | null;
        expect(orb).toBeTruthy();
        expect(orb?.querySelector('[data-testid="nono-face-mouth"]')).toBeNull();
        // La sonrisa del antiguo estado busy era el único trazo de boca del orbe.
        expect(orb?.innerHTML).not.toContain('M27 39 Q32 43 37 39');
      };

      const { rerender } = render(<FloatingAssistant lang="es" />);
      expectOrbWithoutMouth();

      rerender(<FloatingAssistant lang="es" busy status={{ type: 'generating' }} />);
      expect(screen.getByTestId('nono-orb-busy-face')).toBeInTheDocument();
      expectOrbWithoutMouth();

      rerender(<FloatingAssistant lang="es" busy status={{ type: 'error' }} />);
      expect(getExpression()).toBe('error');
      expectOrbWithoutMouth();

      rerender(<FloatingAssistant lang="es" status={{ type: 'done' }} />);
      expectOrbWithoutMouth();

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expectOrbWithoutMouth();
    });

    test('se ancla a la línea del chat cuando existe', () => {
      const divider = document.createElement('div');
      divider.setAttribute('data-chat-divider', '');
      // Posicionamos la línea a 500px del viewport (altura jsdom = 768)
      divider.getBoundingClientRect = () => ({ top: 500, bottom: 500, left: 0, right: 0, width: 0, height: 0 }) as DOMRect;
      document.body.appendChild(divider);

      render(<FloatingAssistant lang="es" />);
      const head = getHead();
      // bottom = innerHeight - top - 4 + GAP(8) = 768 - 500 - 4 + 8 = 272
      expect(head.style.bottom).toBe('272px');
      divider.remove();
    });

    test('sin divider usa la esquina inferior derecha', () => {
      render(<FloatingAssistant lang="es" />);
      const head = getHead();
      expect(head.style.bottom).toBe('16px'); // 8 (anchor) + 8 (GAP)
      expect(head.style.right).toBe('16px');
    });
  });

  describe('mini-chat', () => {
    test('clic abre el panel con un saludo', () => {
      render(<FloatingAssistant lang="es" />);
      expect(document.querySelector('.nono-panel')).toBeNull();
      fireEvent.click(getHead());
      expect(document.querySelector('.nono-panel')).toBeInTheDocument();
      expect(screen.getByText('Nono')).toBeInTheDocument();
    });

    test('el panel se adapta a la ventana y la lista de mensajes queda desplazable', () => {
      render(<FloatingAssistant lang="es" />);
      fireEvent.click(getHead());

      const panel = document.querySelector('.nono-panel') as HTMLElement;
      const messages = screen.getByTestId('nono-messages');
      expect(panel.style.height).not.toBe('320px');
      expect(Number.parseInt(panel.style.height, 10)).toBeGreaterThan(320);
      expect(messages).toHaveClass('min-h-0', 'overflow-y-auto', 'overscroll-contain');
    });

    test('el saludo es un mensaje de Nono (no del usuario)', () => {
      render(<FloatingAssistant lang="es" />);
      fireEvent.click(getHead());
      const bubbles = document.querySelectorAll('[data-testid="nono-message-bubble"]');
      expect(bubbles.length).toBeGreaterThanOrEqual(1);
    });

    test('enviar un mensaje muestra typing y luego la respuesta', () => {
      render(<FloatingAssistant lang="es" />);
      fireEvent.click(getHead());

      const input = screen.getByPlaceholderText('Escribe...');
      fireEvent.change(input, { target: { value: 'hola' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      // Mensaje del usuario presente
      expect(screen.getByText('hola')).toBeInTheDocument();

      // Indicador de typing visible
      expect(screen.getByText('● ● ●')).toBeInTheDocument();

      // Avanzamos el temporizador de respuesta (1000-2500ms)
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      // El typing desaparece y hay una respuesta de Nono
      expect(screen.queryByText('● ● ●')).toBeNull();
      const bubbles = document.querySelectorAll('[data-testid="nono-message-bubble"]');
      expect(bubbles.length).toBeGreaterThanOrEqual(1);
    });

    test('Escape cierra el panel', () => {
      render(<FloatingAssistant lang="es" />);
      fireEvent.click(getHead());
      expect(document.querySelector('.nono-panel')).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(document.querySelector('.nono-panel')).toBeNull();
    });

    test('Enter con campo vacío no envía nada', () => {
      render(<FloatingAssistant lang="es" />);
      fireEvent.click(getHead());
      const input = screen.getByPlaceholderText('Escribe...') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(input.value).toBe('   ');
      expect(document.querySelectorAll('[data-testid="nono-user-bubble"]')).toHaveLength(0);
    });

    test('expresión cambia según la palabra clave', () => {
      render(<FloatingAssistant lang="es" />);
      fireEvent.click(getHead());
      const input = screen.getByPlaceholderText('Escribe...');
      fireEvent.change(input, { target: { value: 'hubo un error' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      // La frustración del usuario enfada a Nono; el aspa de error es para la app.
      expect(getExpression()).toBe('angry');
    });
  });

  describe('acciones rápidas', () => {
    test('🗑️ limpia el chat', () => {
      render(<FloatingAssistant lang="es" />);
      fireEvent.click(getHead());
      expect(document.querySelectorAll('[data-testid="nono-user-bubble"]').length).toBe(0);

      const input = screen.getByPlaceholderText('Escribe...');
      fireEvent.change(input, { target: { value: 'mensaje de prueba' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(document.querySelectorAll('[data-testid="nono-user-bubble"]').length).toBe(1);

      fireEvent.click(screen.getByLabelText('Limpiar chat'));
      expect(document.querySelectorAll('[data-testid="nono-user-bubble"]')).toHaveLength(0);
      expect(screen.getByText(/Chat limpiado/)).toBeInTheDocument();
    });

    test('📋 copia el último mensaje al portapapeles', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true });

      render(<FloatingAssistant lang="es" />);
      fireEvent.click(getHead());
      const input = screen.getByPlaceholderText('Escribe...');
      fireEvent.change(input, { target: { value: 'texto a copiar' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      fireEvent.click(screen.getByLabelText('Copiar último'));
      // Sin `waitFor`: el aviso «¡Copiado!» se autolimpia a los 1,8 s de reloj falso.
      // Basta con vaciar los microtasks que el handler espera en `clipboard.writeText`;
      // así el aviso se mira en el mismo instante en que se pinta.
      await act(async () => {
        await Promise.resolve();
      });

      expect(writeText).toHaveBeenCalledWith('texto a copiar');
      expect(screen.getByText(/¡Copiado!/)).toBeInTheDocument();
    });

    test('📋 avisa si no hay nada que copiar', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true });

      render(<FloatingAssistant lang="es" />);
      fireEvent.click(getHead());
      // Limpiamos el saludo inicial para dejar el chat vacío
      fireEvent.click(screen.getByLabelText('Limpiar chat'));
      fireEvent.click(screen.getByLabelText('Copiar último'));

      expect(screen.getByText('Nada que copiar')).toBeInTheDocument();
      expect(writeText).not.toHaveBeenCalled();
    });

    test('🆕 llama a onNewPrompt y cierra el panel', () => {
      const onNewPrompt = vi.fn();
      render(<FloatingAssistant lang="es" onNewPrompt={onNewPrompt} />);
      fireEvent.click(getHead());
      expect(document.querySelector('.nono-panel')).toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('Nuevo chat'));
      expect(onNewPrompt).toHaveBeenCalledOnce();
      expect(document.querySelector('.nono-panel')).toBeNull();
    });

    test('el botón 🆕 no existe sin onNewPrompt', () => {
      render(<FloatingAssistant lang="es" />);
      fireEvent.click(getHead());
      expect(screen.queryByLabelText('Nuevo chat')).toBeNull();
    });
  });

  describe('persistencia de posición', () => {
    test('restaura la posición guardada al montar', () => {
      localStorage.setItem('nono-position-v1', JSON.stringify({ x: 250, y: 175 }));
      render(<FloatingAssistant lang="es" />);
      const head = getHead();
      expect(head.style.left).toBe('0px');
      expect(head.style.transform).toBe('translate3d(250px, 175px, 0)');
    });

    test('ignora una posición corrupta y se ancla', () => {
      localStorage.setItem('nono-position-v1', 'no-es-json');
      render(<FloatingAssistant lang="es" />);
      const head = getHead();
      expect(head.style.left).toBe('');
      expect(head.style.bottom).toBe('16px');
    });

    test('guarda la posición tras arrastrar', () => {
      render(<FloatingAssistant lang="es" />);
      const head = getHead();
      fireEvent.mouseDown(head, { clientX: 100, clientY: 100 });
      fireEvent.mouseMove(window, { clientX: 300, clientY: 400 });
      fireEvent.mouseUp(window);

      expect(localStorage.getItem('nono-position-v1')).toBeTruthy();
      const saved = JSON.parse(localStorage.getItem('nono-position-v1')!);
      expect(saved.x).toBeGreaterThan(0);
      expect(saved.y).toBeGreaterThan(0);
    });

    test('se inclina hacia el chat al escribir aunque tenga posición arrastrada', () => {
      // Antes la clase vivía en el div arrastrado, cuyo translate3d en línea
      // pisaba el rotate: al mover a Nono dejaba de inclinarse.
      localStorage.setItem('nono-position-v1', JSON.stringify({ x: 250, y: 175 }));
      render(
        <>
          <FloatingAssistant lang="es" />
          <textarea data-chat-input aria-label="chat de prueba" />
        </>,
      );
      const head = getHead();
      expect(head.style.transform).toContain('translate3d(250px, 175px');

      fireEvent.input(screen.getByLabelText('chat de prueba'));

      const inner = head.querySelector('.nono-head-inner');
      expect(inner?.className).toContain('nono-lean-chat');
    });

    test('doble clic vuelve al anclaje y olvida la posición', () => {
      localStorage.setItem('nono-position-v1', JSON.stringify({ x: 250, y: 175 }));
      render(<FloatingAssistant lang="es" />);
      const head = getHead();
      expect(head.style.transform).toBe('translate3d(250px, 175px, 0)');

      fireEvent.doubleClick(head);
      expect(head.style.transform).toBe('');
      expect(localStorage.getItem('nono-position-v1')).toBeNull();
    });

    test('la posición arrastrada se limita a la ventana', () => {
      render(<FloatingAssistant lang="es" />);
      const head = getHead();
      // Arrastramos muy a la derecha: sin clamp quedaría fuera del viewport (1024px)
      fireEvent.mouseDown(head, { clientX: 100, clientY: 100 });
      fireEvent.mouseMove(window, { clientX: 5000, clientY: 100 });
      fireEvent.mouseUp(window);

      const saved = JSON.parse(localStorage.getItem('nono-position-v1')!);
      expect(saved.x).toBeLessThanOrEqual(window.innerWidth - 70);
    });
  });

  describe('observar el chat', () => {
    test('pone expresión curious al escribir en el textarea del chat', () => {
      const chatInput = document.createElement('textarea');
      chatInput.setAttribute('data-chat-input', '');
      document.body.appendChild(chatInput);

      render(<FloatingAssistant lang="es" />);
      expect(getExpression()).toBe('neutral');

      chatInput.focus();
      act(() => {
        chatInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      });
      // Sin escribir aún no hay "curious"
      expect(getExpression()).not.toBe('curious');

      act(() => {
        chatInput.value = 'h';
        chatInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
      });
      expect(getExpression()).toBe('curious');

      // Al cabo de ~1s sin escribir, abandona "curious"
      act(() => {
        vi.advanceTimersByTime(1100);
      });
      expect(getExpression()).not.toBe('curious');

      chatInput.remove();
    });

    test('la cabeza se remonta al empezar a escribir (rebote)', () => {
      const chatInput = document.createElement('textarea');
      chatInput.setAttribute('data-chat-input', '');
      document.body.appendChild(chatInput);

      render(<FloatingAssistant lang="es" />);
      const before = getHeadVisual();

      act(() => {
        chatInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
      });
      const after = getHeadVisual();
      // Remontar la cabeza reinicia la animación de rebote de Nono
      expect(after).not.toBe(before);
      expect(document.querySelector('.nono-lean-chat')).toBeTruthy();

      // Dentro de la misma ráfaga no se vuelve a remontar
      act(() => {
        chatInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
      });
      expect(getHeadVisual()).toBe(after);

      chatInput.remove();
    });

    test('ignora el foco en el input del propio panel de Nono', () => {
      render(<FloatingAssistant lang="es" />);
      fireEvent.click(getHead());

      const ownInput = screen.getByPlaceholderText('Escribe...') as HTMLInputElement;
      ownInput.focus();
      ownInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      expect(getExpression()).not.toBe('curious');
    });
  });

  describe('cara clásica', () => {
    test('parpadea una vez sin contexto y no encadena doble', () => {
      const random = vi.spyOn(Math, 'random').mockReturnValue(0);
      try {
        render(<FloatingAssistant lang="es" />);
        const head = () => document.querySelector('[data-testid="nono-bothead"]') as HTMLElement;
        expect(head().getAttribute('data-blink')).toBe('false');

        act(() => { vi.advanceTimersByTime(3500); });
        expect(head().getAttribute('data-blink')).toBe('true');

        act(() => { vi.advanceTimersByTime(150); });
        expect(head().getAttribute('data-blink')).toBe('false');

        act(() => { vi.advanceTimersByTime(90); });
        expect(head().getAttribute('data-blink')).toBe('false');

        act(() => { vi.advanceTimersByTime(150); });
        expect(head().getAttribute('data-blink')).toBe('false');
      } finally {
        random.mockRestore();
      }
    });

    test('hace el doble parpadeo después de una sorpresa', () => {
      // Un valor no nulo evita que dos mensajes creados en el mismo milisegundo
      // compartan id; después fijamos el azar para medir el parpadeo.
      const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
      try {
        render(<FloatingAssistant lang="es" />);
        fireEvent.click(getHead());
        act(() => { vi.advanceTimersByTime(1); });

        const input = screen.getByPlaceholderText('Escribe...');
        fireEvent.change(input, { target: { value: '¿?' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(getExpression()).toBe('surprised');
        random.mockReturnValue(0);

        const head = () => document.querySelector('[data-testid="nono-bothead"]') as HTMLElement;
        act(() => { vi.advanceTimersByTime(300); });
        expect(head().getAttribute('data-blink')).toBe('true');

        act(() => { vi.advanceTimersByTime(150); });
        expect(head().getAttribute('data-blink')).toBe('false');

        act(() => { vi.advanceTimersByTime(90); });
        expect(head().getAttribute('data-blink')).toBe('true');

        act(() => { vi.advanceTimersByTime(150); });
        expect(head().getAttribute('data-blink')).toBe('false');
      } finally {
        random.mockRestore();
      }
    });

    test('hace el doble parpadeo al volver al reposo desde un error', () => {
      const random = vi.spyOn(Math, 'random').mockReturnValue(0);
      try {
        render(<FloatingAssistant lang="es" status={{ type: 'error' }} />);
        expect(getExpression()).toBe('error');

        act(() => { vi.advanceTimersByTime(4500); });
        expect(getExpression()).toBe('neutral');

        const head = () => document.querySelector('[data-testid="nono-bothead"]') as HTMLElement;
        act(() => { vi.advanceTimersByTime(300); });
        expect(head().getAttribute('data-blink')).toBe('true');

        act(() => { vi.advanceTimersByTime(150); });
        expect(head().getAttribute('data-blink')).toBe('false');

        act(() => { vi.advanceTimersByTime(90); });
        expect(head().getAttribute('data-blink')).toBe('true');

        act(() => { vi.advanceTimersByTime(150); });
        expect(head().getAttribute('data-blink')).toBe('false');
      } finally {
        random.mockRestore();
      }
    });

    test('no repite el doble si vuelve al reposo dentro del enfriamiento', () => {
      const random = vi.spyOn(Math, 'random').mockReturnValue(1);
      try {
        const { rerender } = render(<FloatingAssistant lang="es" status={{ type: 'error' }} />);
        act(() => { vi.advanceTimersByTime(4500); });
        expect(getExpression()).toBe('neutral');

        const head = () => document.querySelector('[data-testid="nono-bothead"]') as HTMLElement;
        act(() => { vi.advanceTimersByTime(300); });
        expect(head().getAttribute('data-blink')).toBe('true');
        act(() => { vi.advanceTimersByTime(230); });
        act(() => { vi.advanceTimersByTime(90); });
        expect(head().getAttribute('data-blink')).toBe('true');
        act(() => { vi.advanceTimersByTime(230); });
        expect(head().getAttribute('data-blink')).toBe('false');

        // Otra vuelta al reposo, ahora desde «love», demasiado pronto.
        rerender(<FloatingAssistant lang="es" status={{ type: 'success' }} />);
        act(() => { vi.advanceTimersByTime(3000); });
        expect(getExpression()).toBe('neutral');
        act(() => { vi.advanceTimersByTime(300); });
        expect(head().getAttribute('data-blink')).toBe('false');
      } finally {
        random.mockRestore();
      }
    });

    test('no parpadea mientras procesa', () => {
      const random = vi.spyOn(Math, 'random').mockReturnValue(0);
      try {
        render(<FloatingAssistant lang="es" busy />);
        const head = () => document.querySelector('[data-testid="nono-bothead"]') as HTMLElement;

        act(() => { vi.advanceTimersByTime(3500); });

        expect(head().getAttribute('data-blink')).toBe('false');
        expect(document.querySelector('[data-testid="nono-classic-eyelid"]')).toBeNull();
        expect(document.querySelector('[data-testid="nono-thinking-dots"]')).toBeTruthy();
      } finally {
        random.mockRestore();
      }
    });

    test('no parpadea durante un error', () => {
      const random = vi.spyOn(Math, 'random').mockReturnValue(0);
      try {
        render(<FloatingAssistant lang="es" status={{ type: 'error' }} />);
        const head = () => document.querySelector('[data-testid="nono-bothead"]') as HTMLElement;

        act(() => { vi.advanceTimersByTime(3500); });

        expect(getExpression()).toBe('error');
        expect(head().getAttribute('data-blink')).toBe('false');
        expect(document.querySelector('[data-testid="nono-classic-eyelid"]')).toBeNull();
        expect(
          document.querySelectorAll('[data-testid="nono-classic-face"] path[stroke="var(--nono-danger)"]')
        ).toHaveLength(4);
      } finally {
        random.mockRestore();
      }
    });

    test('es SVG y no carga el gif antiguo', () => {
      render(<FloatingAssistant lang="es" />);
      const svg = document.querySelector('svg.nono-bothead__svg');
      expect(svg?.querySelector('image')).toBeNull();
      expect(screen.getByTestId('nono-classic-face')).toBeInTheDocument();
      expect(document.querySelector('.nono-bothead__gif')).toBeNull();

      fireEvent.mouseMove(window, { clientX: 1000, clientY: 800 });

      expect(svg?.querySelector('image')).toBeNull();
      expect(screen.getByTestId('nono-classic-face')).toBeInTheDocument();
    });
  });

  describe('mirada en reposo del orbe', () => {
    const orbEyes = () =>
      document.querySelector('svg[data-variant="orb"] [data-testid="nono-orb-eyes"]');

    const withOrb = () => {
      localStorage.setItem('nono-memory-v1', JSON.stringify({ ui: { orbSkin: true } }));
      render(<FloatingAssistant lang="es" />);
    };

    test('el orbe mira a los lados cuando el puntero lleva un rato quieto', () => {
      withOrb();
      expect(orbEyes()).not.toBeNull();
      expect(orbEyes()?.getAttribute('class') ?? '').not.toContain('nono-orb-gaze');

      act(() => { vi.advanceTimersByTime(8000); });

      expect(orbEyes()?.getAttribute('class') ?? '').toContain('nono-orb-gaze');
    });

    test('mover el puntero devuelve la mirada al cursor', () => {
      withOrb();
      act(() => { vi.advanceTimersByTime(8000); });
      expect(orbEyes()?.getAttribute('class') ?? '').toContain('nono-orb-gaze');

      fireEvent.mouseMove(window, { clientX: 400, clientY: 300 });

      expect(orbEyes()?.getAttribute('class') ?? '').not.toContain('nono-orb-gaze');
    });
  });

  describe('internacionalización', () => {
    test('usa textos en inglés con lang="en"', () => {
      render(<FloatingAssistant lang="en" />);
      fireEvent.click(getHead());
      expect(screen.getByPlaceholderText('Type...')).toBeInTheDocument();
    });
  });

  describe('saludo flotante con tipeado', () => {
    const getGreeting = () => document.querySelector('[data-nono-greeting]') as HTMLElement | null;

    test('aparece y completa el saludo tras el tipeado', () => {
      render(<FloatingAssistant lang="es" />);
      act(() => { vi.advanceTimersByTime(1200); });
      expect(getGreeting()).toBeTruthy();
      act(() => { vi.advanceTimersByTime(4000); });
      expect(getGreeting()?.textContent).toContain('¿En qué ayudo?');
    });

    test('incluye el nombre del usuario', () => {
      render(<FloatingAssistant lang="es" displayName="Edel" />);
      act(() => { vi.advanceTimersByTime(6000); });
      expect(getGreeting()?.textContent).toContain('¡Hola, Edel!');
    });

    test('menciona el nombre de Nono', () => {
      render(<FloatingAssistant lang="es" displayName="Edel" />);
      act(() => { vi.advanceTimersByTime(6000); });
      expect(getGreeting()?.textContent).toContain('Soy Nono');
    });

    test('también se presenta sin nombre de usuario', () => {
      render(<FloatingAssistant lang="es" />);
      act(() => { vi.advanceTimersByTime(6000); });
      expect(getGreeting()?.textContent).toContain('Soy Nono');
    });

    test('flota sin recuadro (sin fondo ni borde)', () => {
      render(<FloatingAssistant lang="es" />);
      act(() => { vi.advanceTimersByTime(6000); });
      const greeting = getGreeting()!;
      expect(greeting.className).not.toMatch(/(^|\s)bg-/);
      expect(greeting.className).not.toMatch(/border/);
    });

    test('se oculta al abrir el panel', () => {
      render(<FloatingAssistant lang="es" />);
      act(() => { vi.advanceTimersByTime(6000); });
      expect(getGreeting()?.className).toContain('opacity-100');
      fireEvent.click(getHead());
      expect(getGreeting()?.className).toContain('opacity-0');
    });
  });

  describe('saludo del orbe', () => {
    const inner = () => document.querySelector('.nono-head-inner');

    test('hace un pop con balanceo al aparecer y no se repite', () => {
      localStorage.setItem('nono-memory-v1', JSON.stringify({ ui: { orbSkin: true } }));
      render(<FloatingAssistant lang="es" />);
      expect(inner()?.className ?? '').not.toContain('nono-orb-greet');

      act(() => { vi.advanceTimersByTime(1200); });
      expect(inner()?.className ?? '').toContain('nono-orb-greet');

      act(() => { vi.advanceTimersByTime(1600); });
      expect(inner()?.className ?? '').not.toContain('nono-orb-greet');

      // El resto del saludo (y un saludo posterior) no lo vuelve a disparar.
      act(() => { vi.advanceTimersByTime(9000); });
      expect(inner()?.className ?? '').not.toContain('nono-orb-greet');
    });

    test('el clásico no recibe el saludo del orbe', () => {
      render(<FloatingAssistant lang="es" />);
      act(() => { vi.advanceTimersByTime(1200); });
      expect(inner()?.className ?? '').not.toContain('nono-orb-greet');
    });
  });

  describe('preguntas dinámicas al pasar el puntero', () => {
    test('muestra una pregunta al hacer hover', () => {
      render(<FloatingAssistant lang="es" />);
      fireEvent.mouseEnter(getHead());
      const el = document.querySelector('[data-nono-hover]') as HTMLElement;
      expect(el).toBeTruthy();
      expect(el.getAttribute('data-nono-hover')).toBe('true');
      expect(el.textContent?.trim().length).toBeGreaterThan(0);
    });

    test('incluye el nombre del usuario', () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      render(<FloatingAssistant lang="es" displayName="Edel" />);
      fireEvent.mouseEnter(getHead());
      const el = document.querySelector('[data-nono-hover]') as HTMLElement;
      expect(el.textContent).toContain('Edel');
      randomSpy.mockRestore();
    });

    test('oculta la pregunta al salir el puntero', () => {
      render(<FloatingAssistant lang="es" />);
      fireEvent.mouseEnter(getHead());
      expect(document.querySelector('[data-nono-hover="true"]')).toBeTruthy();
      fireEvent.mouseLeave(getHead());
      expect(document.querySelector('[data-nono-hover="true"]')).toBeNull();
    });

    test('usa preguntas en inglés con lang="en"', () => {
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      render(<FloatingAssistant lang="en" displayName="Edel" />);
      fireEvent.mouseEnter(getHead());
      const el = document.querySelector('[data-nono-hover]') as HTMLElement;
      expect(el.textContent).toMatch(/how can I help/i);
      randomSpy.mockRestore();
    });
  });

  /** Umbral de auto-sueño de Nono (ver `FloatingAssistant.tsx`: 5 minutos). */
  const IDLE_SLEEP_MS = 5 * 60 * 1000;

  /** Avanza el reloj falso lo justo para que Nono entre en reposo. */
  const advancePastIdle = () =>
    act(() => {
      vi.advanceTimersByTime(IDLE_SLEEP_MS + 1000);
    });

  describe('sueño (Zzz de cómic)', () => {
    test('no muestra Zzz despierto', () => {
      render(<FloatingAssistant lang="es" />);
      expect(document.querySelector('.nono-sleep-z')).toBeNull();
    });

    test('muestra el Zzz animado mientras duerme', () => {
      render(<FloatingAssistant lang="es" />);
      advancePastIdle();
      expect(getExpression()).toBe('sleepy');
      const zzz = document.querySelector('.nono-sleep-z');
      expect(zzz).toBeTruthy();
      expect(zzz?.querySelectorAll('span').length).toBe(3);
    });

    /** Proyecto con datos suficientes para que el ciclo de sugerencias dispare. */
    const projectInfo = {
      path: 'C:/tmp/proyecto-web',
      files: ['src/App.tsx', 'index.html'],
      hasPackageJson: true,
      hasTsConfig: true,
      hasGit: true,
      framework: 'React',
      mainLanguage: 'ts',
      mode: 'chat' as const,
    };

    /**
     * Avanza el umbral de sueño en pasos cortos, no de un tirón: React tiene que
     * re-renderizar entre tick y tick de las sugerencias, como en tiempo real.
     */
    const advancePastIdleWithSuggestions = () => {
      for (let elapsed = 0; elapsed < IDLE_SLEEP_MS + 16_000; elapsed += 5_000) {
        act(() => {
          vi.advanceTimersByTime(5_000);
        });
      }
    };

    test('se duerme aunque el proyecto le dispare sugerencias cada 50 s', () => {
      // Regresión: cada sugerencia cambia la expresión, y la cuenta de sueño se
      // reiniciaba con cualquier cambio, así que nunca llegaba a los 5 minutos.
      render(<FloatingAssistant lang="es" projectInfo={projectInfo} />);
      advancePastIdleWithSuggestions();
      expect(getExpression()).toBe('sleepy');
      expect(document.querySelector('.nono-sleep-z')).toBeTruthy();
    });

    test('una sugerencia periódica no lo despierta', () => {
      render(<FloatingAssistant lang="es" projectInfo={projectInfo} />);
      advancePastIdleWithSuggestions();
      expect(getExpression()).toBe('sleepy');

      // Cruzamos un tick completo del ciclo de sugerencias (50 s).
      act(() => {
        vi.advanceTimersByTime(60000);
      });
      expect(getExpression()).toBe('sleepy');
    });
  });

  describe('reacciones contextuales a la app', () => {
    test('al generar pasa a expresión thinking', () => {
      render(<FloatingAssistant lang="es" status={{ type: 'generating' }} />);
      expect(getExpression()).toBe('thinking');
    });

    test('un error pone la expresión de alerta', () => {
      render(<FloatingAssistant lang="es" status={{ type: 'error' }} />);
      expect(getExpression()).toBe('error');
    });

    test('un error durante el procesamiento retira la cara satisfecha y el «sí»', () => {
      localStorage.setItem('nono-memory-v1', JSON.stringify({ ui: { orbSkin: true } }));
      const { rerender } = render(
        <FloatingAssistant lang="es" busy status={{ type: 'generating' }} />
      );

      expect(screen.getByTestId('nono-orb-busy-face')).toBeInTheDocument();
      expect(screen.getByText('¡Sí! Voy con ello.')).toBeInTheDocument();

      rerender(<FloatingAssistant lang="es" busy status={{ type: 'error' }} />);

      expect(getExpression()).toBe('error');
      expect(screen.queryByTestId('nono-orb-busy-face')).toBeNull();
      expect(screen.getByTestId('nono-orb-eyes')).toBeInTheDocument();
      expect(screen.queryByText('¡Sí! Voy con ello.')).toBeNull();
      expect(screen.getByText('⚠️ Algo falló. ¿Reviso?')).toBeInTheDocument();
    });

    test('un error no se convierte en «¡Listo!» al terminar', () => {
      const { rerender } = render(
        <FloatingAssistant lang="es" busy status={{ type: 'error' }} />
      );

      rerender(<FloatingAssistant lang="es" busy={false} status={{ type: 'error' }} />);

      expect(getExpression()).toBe('error');
      expect(screen.getByText('⚠️ Algo falló. ¿Reviso?')).toBeInTheDocument();
      expect(screen.queryByText('¡Listo!')).toBeNull();
    });

    test('al terminar (done) se felicita y vuelve a neutral', () => {
      render(<FloatingAssistant lang="es" status={{ type: 'done' }} />);
      expect(getExpression()).toBe('happy');
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(getExpression()).toBe('neutral');
    });
  });

  describe('acciones rápidas reales de la app', () => {
    test('muestra un chip por cada acción disponible', () => {
      render(
        <FloatingAssistant
          lang="es"
          onOpenWorkbench={() => {}}
          onOpenCompile={() => {}}
          onOpenGallery={() => {}}
          onOpenSearch={() => {}}
        />
      );
      fireEvent.click(getHead());
      // Los chips ya no llevan aria-label: su nombre accesible es el texto visible.
      expect(screen.getByRole('button', { name: 'Workbench' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Compilar' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Galería' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Buscar' })).toBeInTheDocument();
    });

    test('sin callbacks no muestra chips', () => {
      render(<FloatingAssistant lang="es" />);
      fireEvent.click(getHead());
      expect(screen.queryByRole('button', { name: 'Workbench' })).toBeNull();
    });

    test('el chip Workbench dispara su manejador', () => {
      const onWorkbench = vi.fn();
      render(<FloatingAssistant lang="es" onOpenWorkbench={onWorkbench} />);
      fireEvent.click(getHead());
      fireEvent.click(screen.getByRole('button', { name: 'Workbench' }));
      expect(onWorkbench).toHaveBeenCalledOnce();
    });

    test('el comando /workbench dispara su manejador', () => {
      const onWorkbench = vi.fn();
      render(<FloatingAssistant lang="es" onOpenWorkbench={onWorkbench} />);
      fireEvent.click(getHead());
      const input = screen.getByPlaceholderText('Escribe...');
      fireEvent.change(input, { target: { value: '/workbench' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onWorkbench).toHaveBeenCalledOnce();
      expect(screen.getByText(/Abriendo Workbench/)).toBeInTheDocument();
    });

    test('un comando sin manejador se reporta como desconocido', () => {
      render(<FloatingAssistant lang="es" />);
      fireEvent.click(getHead());
      const input = screen.getByPlaceholderText('Escribe...');
      fireEvent.change(input, { target: { value: '/workbench' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(screen.getByText(/Comando no reconocido/)).toBeInTheDocument();
    });

    test('el comando /nuevo dispara onNewPrompt y cierra el panel', () => {
      const onNewPrompt = vi.fn();
      render(<FloatingAssistant lang="es" onNewPrompt={onNewPrompt} />);
      fireEvent.click(getHead());
      const input = screen.getByPlaceholderText('Escribe...');
      fireEvent.change(input, { target: { value: '/nuevo' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onNewPrompt).toHaveBeenCalledOnce();
      expect(document.querySelector('.nono-panel')).toBeNull();
    });
  });

  describe('animación forzada (ajuste «animar»)', () => {
    /**
     * El ajuste no toca estilos: pone esta clase en :root y el CSS de
     * `prefers-reduced-motion` la deja fuera con `:not(.nono-force-motion)`.
     * Por eso se comprueba en `document.documentElement`, no en el SVG.
     */
    const rootHasForce = () => document.documentElement.classList.contains('nono-force-motion');

    /** Abre el panel y devuelve el botón del ajuste (su aria-label cambia con el estado). */
    const openPanel = () => {
      fireEvent.click(getHead());
      return screen.getByLabelText(/^Animar siempre: (des)?activado$/);
    };

    beforeEach(() => {
      // El root es compartido por toda la suite: que un test no herede el estado de otro.
      document.documentElement.classList.remove('nono-force-motion');
    });

    test('por defecto no fuerza la animación (respeta al sistema)', () => {
      render(<FloatingAssistant lang="es" />);
      expect(rootHasForce()).toBe(false);
      const button = openPanel();
      expect(button).toHaveAttribute('aria-pressed', 'false');
      expect(button).toHaveAccessibleName('Animar siempre: desactivado');
    });

    test('al pulsarlo pone la clase en el root', () => {
      render(<FloatingAssistant lang="es" />);
      fireEvent.click(openPanel());

      expect(rootHasForce()).toBe(true);
      const button = screen.getByLabelText('Animar siempre: activado');
      expect(button).toHaveAttribute('aria-pressed', 'true');
    });

    test('volver a pulsarlo devuelve al modo respetuoso', () => {
      render(<FloatingAssistant lang="es" />);
      fireEvent.click(openPanel());
      expect(rootHasForce()).toBe(true);

      fireEvent.click(screen.getByLabelText('Animar siempre: activado'));
      expect(rootHasForce()).toBe(false);
      expect(screen.getByLabelText('Animar siempre: desactivado')).toHaveAttribute('aria-pressed', 'false');
    });

    test('persiste tras remontar el componente', () => {
      const first = render(<FloatingAssistant lang="es" />);
      fireEvent.click(openPanel());
      expect(rootHasForce()).toBe(true);

      // La preferencia queda en la memoria de Nono, no sólo en el estado de React.
      const saved = JSON.parse(localStorage.getItem('nono-memory-v1')!);
      expect(saved.ui.forceMotion).toBe(true);

      first.unmount();
      // Desmontar no debe dejar la clase pegada en un root compartido.
      expect(rootHasForce()).toBe(false);

      render(<FloatingAssistant lang="es" />);
      // La clase vuelve sola: el estado inicial sale de la memoria guardada.
      expect(rootHasForce()).toBe(true);
      fireEvent.click(getHead());
      expect(screen.getByLabelText('Animar siempre: activado')).toHaveAttribute('aria-pressed', 'true');
    });

    test('no reescribe el ajuste al desmontar', () => {
      const { unmount } = render(<FloatingAssistant lang="es" />);
      fireEvent.click(openPanel());
      unmount();

      const saved = JSON.parse(localStorage.getItem('nono-memory-v1')!);
      expect(saved.ui.forceMotion).toBe(true);
    });
  });

  describe('asentimiento del orbe al procesar', () => {
    const rootOn = () => document.documentElement.classList.contains('nono-orb-rotate-on');
    const rootOff = () => document.documentElement.classList.contains('nono-orb-rotate-off');

    beforeEach(() => {
      // El root es compartido: ningún caso debe heredar el estado del anterior.
      document.documentElement.classList.remove('nono-orb-rotate-on', 'nono-orb-rotate-off');
    });

    test('por defecto el asentimiento queda activado', () => {
      render(<FloatingAssistant lang="es" />);

      expect(rootOn()).toBe(true);
      expect(rootOff()).toBe(false);
    });

    test('el ajuste guardado desactiva el asentimiento aunque el sistema lo permita', () => {
      localStorage.setItem(
        'nono-memory-v1',
        JSON.stringify({ ui: { orbSkin: true, orbRotate: false } })
      );
      render(<FloatingAssistant lang="es" busy />);

      expect(rootOn()).toBe(false);
      expect(rootOff()).toBe(true);
      // La cara sigue montada; el CSS decide si asiente.
      expect(document.querySelector('.nono-orb-affirm')).toBeTruthy();
    });

    test('desmontar limpia las clases del root', () => {
      const { unmount } = render(<FloatingAssistant lang="es" />);
      expect(rootOn()).toBe(true);

      unmount();

      expect(rootOn()).toBe(false);
      expect(rootOff()).toBe(false);
    });
  });
});

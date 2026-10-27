/**
 * Tests de FloatingAssistant (Nono): apertura, mini-chat, acciones rápidas,
 * persistencia de posición, arrastre y reanclaje.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { FloatingAssistant } from '../../src/components/FloatingAssistant';

/** Nono busca la cabeza por su aria-label ("Nono"). */
const getHead = () => screen.getByLabelText('Nono') as HTMLElement;
const getSvg = () => document.querySelector('svg[data-expression]') as SVGElement;
const getExpression = () => getSvg()?.getAttribute('data-expression');

describe('FloatingAssistant (Nono)', () => {
  let unexpectedFetches: string[] = [];

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    unexpectedFetches = [];
    // Nono lee la clave de Gemini del servidor; cualquier otra llamada de red es un fallo.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/keys/')) {
        return { ok: true, json: async () => ({ success: true, value: '' }) } as Response;
      }
      unexpectedFetches.push(String(url));
      throw new Error(`fetch no mockeado: ${url}`);
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
      expect(getSvg()).toBeTruthy();
    });

    test('arranca con expresión neutral', () => {
      render(<FloatingAssistant lang="es" />);
      expect(['neutral', 'happy']).toContain(getExpression());
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

    test('el saludo es un mensaje de Nono (no del usuario)', () => {
      render(<FloatingAssistant lang="es" />);
      fireEvent.click(getHead());
      const bubbles = document.querySelectorAll('.nono-panel .bg-\\[\\#00243e\\]');
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
      const bubbles = document.querySelectorAll('.nono-panel .bg-\\[\\#00243e\\]');
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
      expect(document.querySelectorAll('.nono-panel .bg-\\[\\#ffff55\\]')).toHaveLength(0);
    });

    test('expresión cambia según la palabra clave', () => {
      render(<FloatingAssistant lang="es" />);
      fireEvent.click(getHead());
      const input = screen.getByPlaceholderText('Escribe...');
      fireEvent.change(input, { target: { value: 'hubo un error' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(getExpression()).toBe('error');
    });
  });

  describe('acciones rápidas', () => {
    test('🗑️ limpia el chat', () => {
      render(<FloatingAssistant lang="es" />);
      fireEvent.click(getHead());
      expect(document.querySelectorAll('.nono-panel .bg-\\[\\#ffff55\\]').length).toBe(0);

      const input = screen.getByPlaceholderText('Escribe...');
      fireEvent.change(input, { target: { value: 'mensaje de prueba' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(document.querySelectorAll('.nono-panel .bg-\\[\\#ffff55\\]').length).toBe(1);

      fireEvent.click(screen.getByLabelText('Limpiar chat'));
      expect(document.querySelectorAll('.nono-panel .bg-\\[\\#ffff55\\]')).toHaveLength(0);
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
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('texto a copiar'));
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

    test('el SVG se remonta al empezar a escribir (rebote)', () => {
      const chatInput = document.createElement('textarea');
      chatInput.setAttribute('data-chat-input', '');
      document.body.appendChild(chatInput);

      render(<FloatingAssistant lang="es" />);
      const before = getSvg();

      act(() => {
        chatInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
      });
      const after = getSvg();
      // Remontar el SVG reinicia la animación de rebote de Nono
      expect(after).not.toBe(before);
      expect(document.querySelector('.nono-lean-chat')).toBeTruthy();

      // Dentro de la misma ráfaga no se vuelve a remontar
      act(() => {
        chatInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
      });
      expect(getSvg()).toBe(after);

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

  describe('ojos que siguen el puntero', () => {
    /** Coloca el centro de la cabeza en (500, 300): jsdom mide todo en 0. */
    const stubHeadRect = () => {
      getHead().getBoundingClientRect = () =>
        ({ left: 480, top: 280, right: 520, bottom: 320, width: 40, height: 40, x: 480, y: 280 }) as DOMRect;
    };

    const getPupil = () =>
      document.querySelector('svg[data-expression] circle[fill="#000000"]') as SVGCircleElement | null;

    test('las pupilas miran hacia el puntero', () => {
      render(<FloatingAssistant lang="es" />);
      stubHeadRect();

      // Sin movimiento, ambas pupilas están centradas (20 es el ojo izquierdo)
      expect(Number(getPupil()?.getAttribute('cx'))).toBe(20);

      fireEvent.mouseMove(window, { clientX: 1000, clientY: 300 });
      expect(Number(getPupil()?.getAttribute('cx'))).toBeGreaterThan(20);
      expect(Number(getPupil()?.getAttribute('cy'))).toBeCloseTo(38, 1);

      fireEvent.mouseMove(window, { clientX: 500, clientY: 800 });
      expect(Number(getPupil()?.getAttribute('cy'))).toBeGreaterThan(38);
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

  describe('LED de la antena', () => {
    test('el único indicador parpadeante es el de la antena', () => {
      render(<FloatingAssistant lang="es" />);
      const led = document.querySelector('.nono-antenna-led');
      expect(led).toBeTruthy();
      expect(led?.getAttribute('data-led')).toBe('active');
      // El antiguo badge de notificación (otro LED) ya no existe
      expect(document.querySelector('.absolute.-top-1.-right-1')).toBeNull();
    });

    test('en reposo (dormido) cambia de color a verde', () => {
      render(<FloatingAssistant lang="es" />);
      advancePastIdle();
      expect(getExpression()).toBe('sleepy');
      const led = document.querySelector('.nono-antenna-led');
      expect(led?.getAttribute('data-led')).toBe('resting');
      const core = led?.querySelectorAll('circle')[1] as SVGCircleElement;
      expect(core.getAttribute('fill')).toBe('#00ff66');
    });
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
});

import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PreferencesModal } from '../../src/components/PreferencesModal';
import { ATASCO_KEY, PREFERENCIAS_EVENT } from '../../src/components/ServerSubAgents';
import { NONO_MEMORY_KEY } from '../../src/features/nono/nonoMemoryStore';

/**
 * El umbral de atasco se configura en Configuración y lo consume el panel de
 * subagentes. Aquí se prueba la mitad de Configuración: persistir el valor,
 * acotarlo y avisar al panel sin recargar.
 */

/** Entra a una sección desde el menú lateral del panel. */
const irASeccion = (nombre: string) =>
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Secciones de configuración' })).getByRole('button', {
      name: nombre,
    })
  );

/** Abre el panel y entra en la sección pedida (el umbral vive en «Agente»). */
const abrir = (seccion = 'Agente') => {
  const utils = render(<PreferencesModal isOpen onClose={() => {}} />);
  irASeccion(seccion);
  return utils;
};

afterEach(() => {
  localStorage.removeItem(ATASCO_KEY);
  localStorage.removeItem(NONO_MEMORY_KEY);
});

describe('PreferencesModal · sección Nono', () => {
  const preview = () => screen.getByTestId('nono-preview');

  test('cambia entre clásico y orbe, y lo guarda al momento', () => {
    render(<PreferencesModal isOpen onClose={() => {}} />);
    irASeccion('Nono');

    expect(preview().querySelector('svg[data-variant="classic"]')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Orbe' }));

    expect(preview().querySelector('svg[data-variant="orb"]')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(NONO_MEMORY_KEY) || '{}').ui.orbSkin).toBe(true);
  });

  test('permite desactivar la interpolación de la mirada', () => {
    render(<PreferencesModal isOpen onClose={() => {}} />);
    irASeccion('Nono');

    const instantanea = screen.getByTestId('nono-instant-gaze') as HTMLInputElement;
    expect(instantanea.checked).toBe(false);

    fireEvent.click(instantanea);
    expect(instantanea.checked).toBe(true);
    expect(JSON.parse(localStorage.getItem(NONO_MEMORY_KEY) || '{}').ui.instantGaze).toBe(true);

    fireEvent.click(screen.getByTestId('nono-instant-gaze'));
    expect(JSON.parse(localStorage.getItem(NONO_MEMORY_KEY) || '{}').ui.instantGaze).toBe(false);
  });

  test('edita colores, aplica presets y guarda el acento clásico', () => {
    render(<PreferencesModal isOpen onClose={() => {}} />);
    irASeccion('Nono');

    fireEvent.change(screen.getByLabelText('Color superior del orbe'), {
      target: { value: '#123456' },
    });
    expect(JSON.parse(localStorage.getItem(NONO_MEMORY_KEY) || '{}').ui.orbColors.top).toBe('#123456');

    fireEvent.click(screen.getByRole('button', { name: 'Océano' }));
    expect(JSON.parse(localStorage.getItem(NONO_MEMORY_KEY) || '{}').ui.orbColors).toMatchObject({
      top: '#3d8bff',
      mid: '#00c2ff',
      bottom: '#00f0d0',
    });

    fireEvent.change(screen.getByLabelText('Color del contorno clásico'), {
      target: { value: '#ffcc00' },
    });
    expect(JSON.parse(localStorage.getItem(NONO_MEMORY_KEY) || '{}').ui.classicAccent).toBe('#ffcc00');
  });

  test('la vista previa muestra la expresión elegida', () => {
    render(<PreferencesModal isOpen onClose={() => {}} />);
    irASeccion('Nono');

    const svg = () => preview().querySelector('svg[data-expression]');
    expect(svg()?.getAttribute('data-expression')).toBe('neutral');

    // Las 13 expresiones tienen cara propia.
    const expresiones = screen.getByTestId('nono-expressions');
    expect(within(expresiones).getAllByRole('button')).toHaveLength(13);

    fireEvent.click(screen.getByRole('button', { name: 'Feliz' }));
    expect(svg()?.getAttribute('data-expression')).toBe('happy');

    fireEvent.click(screen.getByRole('button', { name: 'Enamorado' }));
    expect(svg()?.getAttribute('data-expression')).toBe('love');

    fireEvent.click(screen.getByRole('button', { name: 'Observando' }));
    expect(svg()?.getAttribute('data-expression')).toBe('watch');

    fireEvent.click(screen.getByRole('button', { name: 'Curioso' }));
    expect(svg()?.getAttribute('data-expression')).toBe('curious');
  });
});

describe('PreferencesModal · umbral de atasco', () => {
  test('no guarda nada mientras se escribe: espera a salir del campo', () => {
    abrir();

    const aviso = vi.fn();
    window.addEventListener(PREFERENCIAS_EVENT, aviso);

    try {
      const input = screen.getByTestId('stuck-threshold-input') as HTMLInputElement;
      expect(input.value).toBe('5');

      // Escribir «10» pasa antes por «1»: sin borrador, ese 1 ya se guardaría.
      fireEvent.change(input, { target: { value: '1' } });
      expect(input.value).toBe('1');
      expect(localStorage.getItem(ATASCO_KEY)).toBeNull();
      expect(aviso).not.toHaveBeenCalled();

      fireEvent.change(input, { target: { value: '10' } });
      fireEvent.blur(input);

      expect(localStorage.getItem(ATASCO_KEY)).toBe('10');
      expect(input.value).toBe('10');
      expect(aviso).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(PREFERENCIAS_EVENT, aviso);
    }
  });

  test('acota el valor al salir del campo', () => {
    abrir();
    const input = screen.getByTestId('stuck-threshold-input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(localStorage.getItem(ATASCO_KEY)).toBe('1');
    expect(input.value).toBe('1');

    fireEvent.change(input, { target: { value: '9999' } });
    fireEvent.blur(input);
    expect(localStorage.getItem(ATASCO_KEY)).toBe('120');
    expect(input.value).toBe('120');
  });

  test('un campo vacío o con texto no cambia el valor vigente', () => {
    localStorage.setItem(ATASCO_KEY, '15');
    abrir();
    const input = screen.getByTestId('stuck-threshold-input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(input.value).toBe('15');
    expect(localStorage.getItem(ATASCO_KEY)).toBe('15');
  });

  test('Enter confirma sin esperar a salir del campo', () => {
    abrir();
    const input = screen.getByTestId('stuck-threshold-input') as HTMLInputElement;

    // Hace falta el foco real: jsdom sólo emite `blur` si el campo lo tenía.
    input.focus();
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(localStorage.getItem(ATASCO_KEY)).toBe('7');
    expect(input.value).toBe('7');
  });

  test('al abrirse arranca con el valor guardado', () => {
    localStorage.setItem(ATASCO_KEY, '15');

    abrir();

    expect((screen.getByTestId('stuck-threshold-input') as HTMLInputElement).value).toBe('15');
  });

  test('se navega por secciones desde el menú lateral', () => {
    render(<PreferencesModal isOpen onClose={() => {}} />);

    const nav = screen.getByRole('navigation', { name: 'Secciones de configuración' });
    expect(within(nav).getAllByRole('button')).toHaveLength(8);
    expect(within(nav).getByRole('button', { name: 'Nono' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Extensiones' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Ayuda' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Acerca de' })).toBeInTheDocument();
    // Sólo la sección pedida está montada: no se pinta la página entera.
    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Modelo' })).toBeNull();

    fireEvent.click(within(nav).getByRole('button', { name: 'Modelo' }));
    expect(screen.getByRole('heading', { name: 'Modelo' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'General' })).toBeNull();
  });

  test('Ayuda y Acerca de se leen dentro del panel, sin ventana aparte', async () => {
    render(<PreferencesModal isOpen onClose={() => {}} />);

    irASeccion('Ayuda');
    expect(await screen.findByPlaceholderText('Buscar en el manual…')).toBeInTheDocument();
    expect(screen.getByText('6. Atajos de Teclado')).toBeInTheDocument();

    irASeccion('Acerca de');
    expect(await screen.findByText('COMMANDER AI STUDIO')).toBeInTheDocument();
  });

  test('los accesos directos abren su sección', () => {
    render(<PreferencesModal isOpen onClose={() => {}} initialSection="agente" />);
    expect(screen.getByRole('heading', { name: 'Agente' })).toBeInTheDocument();
    expect(screen.getByTestId('stuck-threshold-input')).toBeInTheDocument();
  });

  test('la sección Modelo reúne los parámetros de generación', () => {
    const parametros = {
      temperature: 0.7,
      topP: 0.95,
      topK: 40,
      maxTokens: 2048,
      systemInstruction: 'base',
    } as any;
    const setParameters = vi.fn();

    render(
      <PreferencesModal
        isOpen
        onClose={() => {}}
        parameters={parametros}
        setParameters={setParameters}
        selectedModel="gemini-3-pro"
        selectedProvider="google"
      />
    );
    irASeccion('Modelo');
    expect(screen.getByRole('slider', { name: 'Temperatura' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Máximo de tokens' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Instrucciones del sistema' })).toHaveValue('base');

    fireEvent.change(screen.getByRole('slider', { name: 'Temperatura' }), { target: { value: '1.2' } });
    expect(setParameters).toHaveBeenCalledTimes(1);
    const actualizar = setParameters.mock.calls[0][0] as (prev: any) => any;
    expect(actualizar(parametros)).toMatchObject({ temperature: 1.2 });
  });

  test('la sección Modelo incluye herramientas y salida estructurada', () => {
    const parametros = {
      temperature: 0.7,
      topP: 0.95,
      topK: 40,
      maxTokens: 2048,
      responseFormat: 'text',
      jsonSchema: '',
      systemInstruction: 'base',
      examples: [],
      tools: { googleSearch: true, codeExecution: false, urlContext: true },
    } as any;
    const setParameters = vi.fn();

    render(
      <PreferencesModal
        isOpen
        onClose={() => {}}
        parameters={parametros}
        setParameters={setParameters}
        selectedModel="gemini-3-pro"
        selectedProvider="google"
      />
    );

    irASeccion('Modelo');
    const busqueda = screen.getByLabelText('Búsqueda web') as HTMLInputElement;
    expect(busqueda).toBeChecked();
    fireEvent.click(busqueda);

    const actualizarHerramientas = setParameters.mock.calls[0][0] as (prev: any) => any;
    expect(actualizarHerramientas(parametros).tools).toMatchObject({
      googleSearch: false,
      codeExecution: false,
    });

    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    const actualizarFormato = setParameters.mock.calls[1][0] as (prev: any) => any;
    expect(actualizarFormato(parametros).responseFormat).toBe('json');
  });

  test('los ejemplos few-shot se añaden al prompt sin llamarlo fine-tuning', () => {
    const parametros = {
      temperature: 0.7,
      topP: 0.95,
      topK: 40,
      maxTokens: 2048,
      responseFormat: 'text',
      jsonSchema: '',
      systemInstruction: 'base',
      examples: [],
      tools: { googleSearch: true, codeExecution: false, urlContext: true },
    } as any;
    const setParameters = vi.fn();

    render(
      <PreferencesModal
        isOpen
        onClose={() => {}}
        parameters={parametros}
        setParameters={setParameters}
        selectedModel="gemini-3-pro"
        selectedProvider="google"
      />
    );

    irASeccion('Modelo');
    expect(screen.getByText('Ejemplos few-shot')).toBeInTheDocument();
    expect(screen.queryByText(/fine-tuning/i)).toBeNull();

    fireEvent.change(screen.getByLabelText('Entrada del ejemplo'), {
      target: { value: 'Hola' },
    });
    fireEvent.change(screen.getByLabelText('Salida del ejemplo'), {
      target: { value: 'Mundo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Añadir ejemplo' }));

    const actualizar = setParameters.mock.calls[0][0] as (prev: any) => any;
    const siguiente = actualizar(parametros);
    expect(siguiente.examples).toHaveLength(1);
    expect(siguiente.examples[0]).toMatchObject({ input: 'Hola', output: 'Mundo' });
  });
});

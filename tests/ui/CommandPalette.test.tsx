/**
 * Tests de la paleta de comandos (Ctrl+K): render, filtrado, navegación
 * por teclado y ejecución de comandos.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPalette, type CommandItem } from '../../src/components/CommandPalette';

const makeCommands = (runs: Record<string, () => void>): CommandItem[] => [
  { id: 'chat', label: 'Chat conversacional', group: 'Modos', icon: null, run: runs.chat },
  { id: 'composer', label: 'Composer multi-archivo', group: 'Modos', run: runs.composer },
  { id: 'telemetry', label: 'Telemetría y rendimiento', group: 'Modos', run: runs.telemetry },
  { id: 'gallery', label: 'Galería de proyectos', group: 'Herramientas', run: runs.gallery },
  { id: 'config', label: 'Configuración / Parámetros', group: 'Herramientas', keywords: 'ajustes', run: runs.config },
];

const setup = (isOpen = true) => {
  const runs = {
    chat: vi.fn<() => void>(),
    composer: vi.fn<() => void>(),
    telemetry: vi.fn<() => void>(),
    gallery: vi.fn<() => void>(),
    config: vi.fn<() => void>(),
  };
  const onClose = vi.fn();
  const utils = render(
    <CommandPalette isOpen={isOpen} onClose={onClose} commands={makeCommands(runs)} lang="es" />
  );
  return { runs, onClose, ...utils };
};

const getOption = (label: string) => screen.getByRole('option', { name: new RegExp(label) });
const getInput = () => screen.getByLabelText('Paleta de comandos') as HTMLInputElement;

describe('CommandPalette', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('no renderiza nada cuando está cerrada', () => {
    setup(false);
    expect(document.querySelector('[data-command-palette]')).toBeNull();
  });

  test('muestra los comandos agrupados al abrirse', () => {
    setup(true);
    expect(document.querySelector('[data-command-palette]')).toBeTruthy();
    // Agrupaciones
    expect(screen.getByRole('group', { name: 'Modos' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Herramientas' })).toBeInTheDocument();
    // Comandos
    expect(getOption('Chat conversacional')).toBeInTheDocument();
    expect(getOption('Galería de proyectos')).toBeInTheDocument();
  });

  test('filtra por el texto introducido', () => {
    setup(true);
    fireEvent.change(getInput(), { target: { value: 'composer' } });
    expect(getOption('Composer multi-archivo')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Chat conversacional/ })).toBeNull();
  });

  test('la búsqueda ignora acentos', () => {
    setup(true);
    fireEvent.change(getInput(), { target: { value: 'telemetria' } });
    expect(getOption('Telemetría y rendimiento')).toBeInTheDocument();
  });

  test('acepta coincidencias difusas por subsecuencia', () => {
    setup(true);
    fireEvent.change(getInput(), { target: { value: 'cmpsr' } });
    expect(getOption('Composer multi-archivo')).toBeInTheDocument();
  });

  test('busca también por palabras clave', () => {
    setup(true);
    fireEvent.change(getInput(), { target: { value: 'ajustes' } });
    expect(getOption('Configuración / Parámetros')).toBeInTheDocument();
  });

  test('muestra aviso cuando no hay coincidencias', () => {
    setup(true);
    fireEvent.change(getInput(), { target: { value: 'zzzzzz' } });
    expect(screen.getByText('Sin coincidencias')).toBeInTheDocument();
  });

  test('Enter ejecuta el primer comando y cierra', () => {
    const { runs, onClose } = setup(true);
    fireEvent.keyDown(getInput(), { key: 'Enter' });
    expect(runs.chat).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('ArrowDown mueve el foco y Enter ejecuta el segundo', () => {
    const { runs } = setup(true);
    fireEvent.keyDown(getInput(), { key: 'ArrowDown' });
    fireEvent.keyDown(getInput(), { key: 'Enter' });
    expect(runs.chat).not.toHaveBeenCalled();
    expect(runs.composer).toHaveBeenCalledTimes(1);
  });

  test('Escape cierra sin ejecutar', () => {
    const { runs, onClose } = setup(true);
    fireEvent.keyDown(getInput(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(runs.chat).not.toHaveBeenCalled();
  });

  test('Escape cierra aunque el foco no esté en el buscador', () => {
    const { runs, onClose } = setup(true);
    // El foco se pierde al mirar la lista o al hacer clic en el pie.
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(runs.chat).not.toHaveBeenCalled();
  });

  test('clic en un comando lo ejecuta y cierra', () => {
    const { runs, onClose } = setup(true);
    fireEvent.click(getOption('Galería de proyectos'));
    expect(runs.gallery).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

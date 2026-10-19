/**
 * Tests del Header: controles de ventana (minimizar, maximizar, cerrar)
 * y el color rojo del icono de cerrar.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from '../../src/components/Header';

const baseProps = () => ({
  mode: 'chat' as const,
  setMode: vi.fn(),
  selectedModel: 'gemini-2.5-flash',
  onOpenExport: vi.fn(),
  onOpenInspector: vi.fn(),
  onToggleSidebar: vi.fn(),
  onToggleWorkbench: vi.fn(),
  onOpenAuth: vi.fn(),
  currentUser: null,
  promptTitle: 'Nuevo prompt',
  lang: 'es' as const,
});

const getCloseButton = (container: HTMLElement) =>
  container.querySelector('[data-tooltip="Cerrar Aplicación"]') as HTMLButtonElement;

describe('Header', () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as any).electronAPI;
  });

  describe('botón de cerrar (esquina superior derecha)', () => {
    test('el icono X es rojo de forma permanente', () => {
      const { container } = render(<Header {...baseProps()} />);
      const closeBtn = getCloseButton(container);
      expect(closeBtn).toBeTruthy();

      const icon = closeBtn.querySelector('svg') as SVGElement;
      expect(icon).toBeTruthy();
      expect(icon.getAttribute('class')).toContain('text-red-500');
    });

    test('el icono X se vuelve blanco al pasar el ratón sobre el botón', () => {
      const { container } = render(<Header {...baseProps()} />);
      const icon = getCloseButton(container).querySelector('svg') as SVGElement;
      expect(icon.getAttribute('class')).toContain('group-hover:text-white');
    });

    test('usa electronAPI.close() cuando existe', () => {
      const close = vi.fn();
      (window as any).electronAPI = { close };

      const { container } = render(<Header {...baseProps()} />);
      fireEvent.click(getCloseButton(container));

      expect(close).toHaveBeenCalledOnce();
    });
  });

  describe('botones de ventana', () => {
    test('renderiza minimizar, maximizar y cerrar', () => {
      const { container } = render(<Header {...baseProps()} />);
      expect(container.querySelector('[data-tooltip="Minimizar Ventana"]')).toBeTruthy();
      expect(container.querySelector('[data-tooltip="Pantalla Completa / Maximizar"]')).toBeTruthy();
      expect(getCloseButton(container)).toBeTruthy();
    });
  });

  describe('paleta de comandos', () => {
    test('el botón abre la paleta (Ctrl+K)', () => {
      const onOpenCommandPalette = vi.fn();
      render(<Header {...baseProps()} onOpenCommandPalette={onOpenCommandPalette} />);
      fireEvent.click(screen.getByLabelText('Abrir paleta de comandos'));
      expect(onOpenCommandPalette).toHaveBeenCalledTimes(1);
    });

    test('no muestra el botón si no se pasa el manejador', () => {
      render(<Header {...baseProps()} />);
      expect(screen.queryByLabelText('Abrir paleta de comandos')).toBeNull();
    });
  });

  describe('menú de Consola', () => {
    const openMenu = (container: HTMLElement) => {
      fireEvent.click(
        container.querySelector('[data-tooltip="Menú de Configuración & Utilidades"]') as HTMLButtonElement
      );
    };

    test('muestra "Refrescar consola" y "Pantalla completa"', () => {
      const { container } = render(<Header {...baseProps()} />);
      openMenu(container);
      expect(screen.getByText('Refrescar consola')).toBeInTheDocument();
      expect(screen.getByText('Pantalla completa')).toBeInTheDocument();
    });

    test('"Pantalla completa" no rompe si el entorno no soporta la API', () => {
      const { container } = render(<Header {...baseProps()} />);
      openMenu(container);
      expect(() => fireEvent.click(screen.getByText('Pantalla completa'))).not.toThrow();
    });
  });
});

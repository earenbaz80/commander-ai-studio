/**
 * Tests del Header: controles de ventana (minimizar, maximizar, cerrar)
 * y el color rojo del icono de cerrar.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { Header } from '../../src/components/Header';

const baseProps = () => ({
  mode: 'chat' as const,
  setMode: vi.fn(),
  selectedModel: 'gemini-2.5-flash',
  onOpenExport: vi.fn(),
  onToggleSidebar: vi.fn(),
  onToggleWorkbench: vi.fn(),
  onOpenAuth: vi.fn(),
  onLogout: vi.fn(),
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

  describe('menú de usuario', () => {
    test('muestra perfil, cuenta y cierre de sesión', () => {
      const onOpenAuth = vi.fn();
      const onLogout = vi.fn();
      render(
        <Header
          {...baseProps()}
          currentUser={{ displayName: 'Edel', email: 'edel@example.com' }}
          onOpenAuth={onOpenAuth}
          onLogout={onLogout}
        />
      );

      const trigger = screen.getByLabelText('Cuenta de usuario');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(trigger);

      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const menu = screen.getByRole('menu', { name: 'Menú de usuario' });
      expect(within(menu).getByText('Edel')).toBeInTheDocument();
      expect(within(menu).getByText('edel@example.com')).toBeInTheDocument();
      expect(within(menu).getByText('Cuenta conectada')).toBeInTheDocument();

      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Cuenta' }));
      expect(onOpenAuth).toHaveBeenCalledOnce();
      expect(screen.queryByRole('menu')).toBeNull();

      fireEvent.click(trigger);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }));
      expect(onLogout).toHaveBeenCalledOnce();
      expect(screen.queryByRole('menu')).toBeNull();
    });

    test('como invitado ofrece acceso y no muestra cerrar sesión', () => {
      const onOpenAuth = vi.fn();
      render(<Header {...baseProps()} onOpenAuth={onOpenAuth} />);

      fireEvent.click(screen.getByLabelText('Cuenta de usuario'));
      const menu = screen.getByRole('menu', { name: 'Menú de usuario' });
      expect(within(menu).getByText('Sesión de invitado')).toBeInTheDocument();
      expect(within(menu).queryByRole('menuitem', { name: 'Cerrar sesión' })).toBeNull();

      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Iniciar sesión o registrarse' }));
      expect(onOpenAuth).toHaveBeenCalledOnce();
      expect(screen.queryByRole('menu')).toBeNull();
    });

    test('se cierra con Escape y devuelve el foco al botón', () => {
      render(<Header {...baseProps()} />);
      const trigger = screen.getByLabelText('Cuenta de usuario');
      fireEvent.click(trigger);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.queryByRole('menu')).toBeNull();
      expect(trigger).toHaveFocus();
    });
  });

  describe('configuración directa', () => {
    test('abre Configuración sin un menú intermedio', () => {
      const onOpenPreferences = vi.fn();
      render(<Header {...baseProps()} onOpenPreferences={onOpenPreferences} />);

      fireEvent.click(screen.getByLabelText('Abrir configuración'));

      expect(onOpenPreferences).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('CONFIGURACIÓN Y SETUP')).toBeNull();
    });

    test('deja separación entre la cuenta y Configuración', () => {
      render(<Header {...baseProps()} onOpenPreferences={vi.fn()} />);
      const account = screen.getByLabelText('Cuenta de usuario');
      const settings = screen.getByLabelText('Abrir configuración');

      const spacer = account.parentElement?.nextElementSibling;
      expect(spacer).toHaveAttribute('aria-hidden', 'true');
      expect(spacer?.className).toContain('w-1.5');
      expect(spacer?.nextElementSibling).toBe(settings);
    });

    test('no duplica acciones de consola, cuenta ni preferencias', () => {
      render(<Header {...baseProps()} onOpenPreferences={vi.fn()} />);
      expect(screen.queryByText('Refrescar consola')).toBeNull();
      expect(screen.queryByText('Pantalla completa')).toBeNull();
      expect(screen.queryByText('Cuenta')).toBeNull();
      expect(screen.queryByText('Parámetros del modelo')).toBeNull();
      expect(screen.queryByText('Preferencias')).toBeNull();
    });
  });
});

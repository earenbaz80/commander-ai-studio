/**
 * Manual de ayuda: secciones, atajos al día y búsqueda que recorre todo el
 * contenido en vez de sólo la pestaña abierta.
 */
import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HelpModal } from '../../src/components/HelpModal';

const open = () => render(<HelpModal isOpen onClose={() => {}} lang="es" />);

describe('HelpModal', () => {
  test('la sección de atajos incluye los atajos nuevos', () => {
    open();
    fireEvent.click(screen.getByText('6. Atajos de Teclado'));

    expect(screen.getByText('Ctrl + `')).toBeTruthy();
    expect(screen.getByText('Abrir la Paleta de Comandos (alternativo)')).toBeTruthy();
    expect(screen.getByText('Alt + M')).toBeTruthy();
  });

  test('la búsqueda encuentra contenido de otras secciones', () => {
    open();
    fireEvent.change(screen.getByPlaceholderText('Buscar en el manual…'), {
      target: { value: 'paneles' },
    });

    expect(screen.getByTestId('help-search-results')).toBeTruthy();
    expect(screen.getAllByText('Paneles a tu medida').length).toBeGreaterThan(0);
  });

  test('avisa cuando la búsqueda no encuentra nada y la pestaña limpia el filtro', () => {
    open();
    const input = screen.getByPlaceholderText('Buscar en el manual…');
    fireEvent.change(input, { target: { value: 'zzzz' } });
    expect(screen.getByText('Sin resultados para esta búsqueda.')).toBeTruthy();

    fireEvent.click(screen.getByText('2. Modos de Trabajo'));
    expect(screen.queryByTestId('help-search-results')).toBeNull();
    expect(screen.getByText('Una barra, seis pantallas')).toBeTruthy();
  });
});

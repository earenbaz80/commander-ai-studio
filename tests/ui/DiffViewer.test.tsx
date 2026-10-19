import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiffViewer } from '../../src/components/DiffViewer';

describe('DiffViewer', () => {
  test('muestra el archivo y el encabezado del hunk', () => {
    render(<DiffViewer path="src/a.ts" oldText={'a\nb'} newText={'a\nc'} onApply={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText(/src\/a\.ts/)).toBeTruthy();
    expect(screen.getAllByText(/@@/)).toHaveLength(1);
  });

  test('aplicar envía el contenido fusionado completo por defecto', () => {
    const onApply = vi.fn();
    render(<DiffViewer path="a.ts" oldText={'a\nb'} newText={'a\nc'} onApply={onApply} onReject={vi.fn()} />);
    fireEvent.click(screen.getByText('Aplicar seleccionados'));
    expect(onApply).toHaveBeenCalledWith('a\nc');
  });

  test('rechazar un hunk mantiene el contenido original', () => {
    const onApply = vi.fn();
    const { container } = render(
      <DiffViewer path="a.ts" oldText={'a\nb'} newText={'a\nc'} onApply={onApply} onReject={vi.fn()} />
    );
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByText('Aplicar seleccionados'));
    expect(onApply).toHaveBeenCalledWith('a\nb');
  });

  test('rechazar todo llama a onReject', () => {
    const onReject = vi.fn();
    render(<DiffViewer path="a.ts" oldText={'a'} newText={'b'} onApply={vi.fn()} onReject={onReject} />);
    fireEvent.click(screen.getByText('Rechazar todo'));
    expect(onReject).toHaveBeenCalledOnce();
  });

  test('sin cambios muestra aviso en lugar de hunks', () => {
    render(<DiffViewer path="a.ts" oldText={'a'} newText={'a'} onApply={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText(/Sin cambios/)).toBeTruthy();
    expect(screen.queryByText('Aplicar seleccionados')).toBeNull();
  });

  test('plegar un hunk oculta sus líneas', () => {
    const { container } = render(
      <DiffViewer path="a.ts" oldText={'a\nb'} newText={'a\nc'} onApply={vi.fn()} onReject={vi.fn()} />
    );
    expect(container.querySelectorAll('[data-testid="diff-hunks"] > div')).toHaveLength(1);
    fireEvent.click(screen.getByText(/@@/));
    // El cuerpo del hunk (líneas) desaparece, pero el hunk sigue existiendo.
    expect(screen.queryByText('b')).toBeNull();
  });
});

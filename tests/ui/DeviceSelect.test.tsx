import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeviceSelect } from '../../src/components/preview/DeviceSelect';
import { DEVICE_GROUPS, PREVIEW_DEVICES, findDevice } from '../../src/data/previewDevices';

/**
 * El selector de aparatos. Lo que importa: que se puedan elegir modelos
 * concretos (no sólo «móvil»), que las medidas salgan del catálogo y que un id
 * viejo o desconocido no rompa el preview.
 */

describe('catálogo de dispositivos', () => {
  test('no repite ids y todos declaran medidas', () => {
    const ids = PREVIEW_DEVICES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const device of PREVIEW_DEVICES) {
      expect(device.name.length).toBeGreaterThan(0);
      if (device.id === 'responsive') {
        expect(device.width).toBe(0);
      } else {
        expect(device.width).toBeGreaterThan(0);
        expect(device.height).toBeGreaterThan(0);
      }
    }
  });

  test('cubre iPhone, Galaxy desde el S20 y tablets', () => {
    const ids = PREVIEW_DEVICES.map((d) => d.id);
    expect(ids).toContain('iphone-15-pro');
    expect(ids).toContain('iphone-16-pro-max');
    for (const model of ['galaxy-s20', 'galaxy-s21', 'galaxy-s22', 'galaxy-s23', 'galaxy-s24', 'galaxy-s25']) {
      expect(ids).toContain(model);
    }
    expect(ids).toContain('ipad-pro-13');
    expect(ids).toContain('galaxy-tab-s9');
    expect(DEVICE_GROUPS.map((g) => g.id)).toEqual(['desktop', 'phone', 'tablet']);
  });

  test('un id desconocido cae en «ajustar al panel»', () => {
    expect(findDevice('nokia-3310').id).toBe('responsive');
  });
});

describe('DeviceSelect', () => {
  test('agrupa las opciones por tipo de aparato', () => {
    render(<DeviceSelect value="responsive" onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Teléfonos' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Tablets' })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Galaxy S20 · 360×800/ })).toBeTruthy();
  });

  test('avisa del modelo elegido con su id', () => {
    const onChange = vi.fn();
    render(<DeviceSelect value="responsive" onChange={onChange} testId="sandbox-device" />);
    fireEvent.change(screen.getByTestId('sandbox-device'), { target: { value: 'galaxy-s24-ultra' } });
    expect(onChange).toHaveBeenCalledWith('galaxy-s24-ultra');
  });

  test('enseña el tamaño del modelo activo', () => {
    render(<DeviceSelect value="iphone-15-pro" onChange={vi.fn()} />);
    const select = screen.getByTestId('device-select') as HTMLSelectElement;
    expect(select.value).toBe('iphone-15-pro');
    expect(screen.getByText('393×852')).toBeTruthy();
  });
});

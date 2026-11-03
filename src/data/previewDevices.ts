/**
 * Presets de dispositivo para el preview de la app.
 *
 * Un único catálogo para los dos visores (sandbox del Composer y visor del
 * chat): antes cada uno tenía sus tres botones y sus anchos escritos a mano, así
 * que un iPhone y otro no se podían comparar y «móvil» significaba 375px en un
 * sitio y 390px en el otro.
 *
 * Las medidas son las del viewport CSS en píxeles, que es lo que hace que las
 * media queries del CSS se comporten como en el aparato. `width: 0` significa
 * «adaptarse al panel».
 */

export type DeviceCategory = 'desktop' | 'phone' | 'tablet';

export interface PreviewDevice {
  id: string;
  name: string;
  category: DeviceCategory;
  /** Ancho del viewport en px. 0 = adaptarse al panel. */
  width: number;
  height: number;
}

export const PREVIEW_DEVICES: PreviewDevice[] = [
  { id: 'responsive', name: 'Ajustar al panel', category: 'desktop', width: 0, height: 0 },
  { id: 'desktop-1440', name: 'Escritorio 1440', category: 'desktop', width: 1440, height: 900 },
  { id: 'laptop-1280', name: 'Portátil 1280', category: 'desktop', width: 1280, height: 800 },
  { id: 'fhd-1920', name: 'Full HD 1920', category: 'desktop', width: 1920, height: 1080 },

  // iPhone
  { id: 'iphone-se-2022', name: 'iPhone SE (2022)', category: 'phone', width: 375, height: 667 },
  { id: 'iphone-13-mini', name: 'iPhone 13 mini', category: 'phone', width: 375, height: 812 },
  { id: 'iphone-14-15', name: 'iPhone 14 / 15', category: 'phone', width: 390, height: 844 },
  { id: 'iphone-15-pro', name: 'iPhone 15 Pro', category: 'phone', width: 393, height: 852 },
  { id: 'iphone-16', name: 'iPhone 16', category: 'phone', width: 393, height: 852 },
  { id: 'iphone-15-pro-max', name: 'iPhone 15 Pro Max', category: 'phone', width: 430, height: 932 },
  { id: 'iphone-16-pro-max', name: 'iPhone 16 Pro Max', category: 'phone', width: 440, height: 956 },

  // Samsung Galaxy S, desde el S20
  { id: 'galaxy-s20', name: 'Galaxy S20', category: 'phone', width: 360, height: 800 },
  { id: 'galaxy-s21', name: 'Galaxy S21', category: 'phone', width: 360, height: 800 },
  { id: 'galaxy-s22', name: 'Galaxy S22', category: 'phone', width: 360, height: 780 },
  { id: 'galaxy-s23', name: 'Galaxy S23', category: 'phone', width: 360, height: 780 },
  { id: 'galaxy-s24', name: 'Galaxy S24', category: 'phone', width: 360, height: 780 },
  { id: 'galaxy-s24-ultra', name: 'Galaxy S24 Ultra', category: 'phone', width: 384, height: 824 },
  { id: 'galaxy-s25', name: 'Galaxy S25', category: 'phone', width: 360, height: 780 },
  { id: 'galaxy-s25-ultra', name: 'Galaxy S25 Ultra', category: 'phone', width: 384, height: 824 },

  // Tablets
  { id: 'ipad-mini', name: 'iPad mini', category: 'tablet', width: 744, height: 1133 },
  { id: 'ipad-10', name: 'iPad (10.9")', category: 'tablet', width: 820, height: 1180 },
  { id: 'ipad-air-11', name: 'iPad Air 11"', category: 'tablet', width: 820, height: 1180 },
  { id: 'ipad-pro-11', name: 'iPad Pro 11"', category: 'tablet', width: 834, height: 1194 },
  { id: 'ipad-pro-13', name: 'iPad Pro 13"', category: 'tablet', width: 1024, height: 1366 },
  { id: 'galaxy-tab-s9', name: 'Galaxy Tab S9', category: 'tablet', width: 800, height: 1280 },
  { id: 'galaxy-tab-s9-ultra', name: 'Galaxy Tab S9 Ultra', category: 'tablet', width: 1200, height: 1920 },
];

export interface DeviceGroup {
  id: DeviceCategory;
  label: { es: string; en: string };
  devices: PreviewDevice[];
}

export const DEVICE_GROUPS: DeviceGroup[] = [
  { id: 'desktop', label: { es: 'Escritorio', en: 'Desktop' }, devices: PREVIEW_DEVICES.filter((d) => d.category === 'desktop') },
  { id: 'phone', label: { es: 'Teléfonos', en: 'Phones' }, devices: PREVIEW_DEVICES.filter((d) => d.category === 'phone') },
  { id: 'tablet', label: { es: 'Tablets', en: 'Tablets' }, devices: PREVIEW_DEVICES.filter((d) => d.category === 'tablet') },
];

export const DEFAULT_DEVICE_ID = 'responsive';

/** Un id desconocido (guardado viejo) cae en «ajustar al panel», no revienta. */
export function findDevice(id: string): PreviewDevice {
  return PREVIEW_DEVICES.find((d) => d.id === id) || PREVIEW_DEVICES[0];
}

/** Etiqueta corta para la barra: `390×844` o `100%` si es responsivo. */
export function deviceSizeLabel(device: PreviewDevice): string {
  return device.width > 0 ? `${device.width}×${device.height}` : '100%';
}

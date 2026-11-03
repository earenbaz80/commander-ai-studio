/**
 * Selector de modelo de dispositivo para el preview.
 *
 * Sustituye a los tres botones (desktop/tablet/mobile) que tenían los dos
 * visores: ahora se elige un aparato concreto —iPhone, Galaxy desde el S20,
 * tablets— y las medidas salen del catálogo compartido.
 *
 * Un `<select>` nativo y no un menú propio: con ~25 opciones agrupadas es más
 * rápido de recorrer con teclado, funciona en cualquier tamaño de panel y no
 * añade estado que mantener.
 */
import { deText } from '../../i18n/de';
import type { Language } from '../../i18n/translations';
import { DEVICE_GROUPS, deviceSizeLabel, findDevice } from '../../data/previewDevices';

export interface DeviceSelectProps {
  value: string;
  onChange: (id: string) => void;
  lang?: Language;
  testId?: string;
  className?: string;
}

export function DeviceSelect({
  value,
  onChange,
  lang = 'es',
  testId = 'device-select',
  className = '',
}: DeviceSelectProps) {
  const t = (es: string, en: string) => (lang === 'es' ? es : lang === 'de' ? deText(en) : en);
  const current = findDevice(value);

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <select
        value={current.id}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t('Modelo de dispositivo', 'Device model')}
        data-testid={testId}
        className={`bg-[var(--nc-bg-main)] text-[var(--nc-text)] border border-[var(--nc-border-light)] text-[10px] px-1 py-0.5 outline-none max-w-[200px] truncate ${className}`}
      >
        {DEVICE_GROUPS.map((group) => (
          <optgroup key={group.id} label={lang === 'es' ? group.label.es : group.label.en}>
            {group.devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name} · {deviceSizeLabel(device)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <span className="text-[10px] text-[var(--nc-text)]/60 tabular-nums shrink-0 hidden sm:inline">
        {deviceSizeLabel(current)}
      </span>
    </div>
  );
}

export default DeviceSelect;

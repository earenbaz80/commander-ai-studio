import React from 'react';
import { Check, ChevronDown, User } from 'lucide-react';
import type { Language } from '../../i18n/translations';
import { getAvatarOptions, resolveAvatar } from '../../features/user/avatarCatalog';
import { useUserAvatar } from '../../features/user/useUserAvatar';
import { UserAvatar } from '../UserAvatar';

export interface AvatarPickerProps {
  lang?: Language;
  uid?: string | null;
}

/**
 * Selector compacto: muestra el avatar actual y despliega la colección.
 * No habla con Firebase; guarda la elección con `useUserAvatar`.
 */
export const AvatarPicker: React.FC<AvatarPickerProps> = ({ lang = 'es', uid }) => {
  const t = (es: string, en: string, de: string) =>
    lang === 'es' ? es : lang === 'de' ? de : en;
  const { avatarId, selectAvatar } = useUserAvatar(uid);
  const [open, setOpen] = React.useState(false);
  const options = getAvatarOptions(lang);
  const usingPngs = options[0]?.source === 'png';
  const selectedLabel = resolveAvatar(avatarId, lang).label;

  return (
    <div
      className="border border-[var(--nc-border-light)] bg-[var(--nc-bg-main)]"
      data-testid="avatar-picker"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2 py-2 text-left hover:bg-[var(--nc-bg-hover)]"
        data-testid="avatar-picker-toggle"
      >
        <UserAvatar id={avatarId} size={40} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 text-[10px] font-bold text-[var(--nc-text-accent)]">
            <User className="h-3 w-3" />
            {t('Avatar', 'Avatar', 'Avatar')}
          </span>
          <span className="block truncate text-[9px] opacity-70">
            {selectedLabel} · {t('haz clic para cambiar', 'click to change', 'zum Ändern klicken')}
          </span>
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[var(--nc-text-accent)] transition-transform ${
            open ? 'rotate-180' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="border-t border-[var(--nc-border-dark)] p-2">
          <div
            role="listbox"
            aria-label={t('Elige tu avatar', 'Choose your avatar', 'Wähle deinen Avatar')}
            className="grid grid-cols-6 gap-1.5"
          >
            {options.map(({ id, label }) => {
              const selected = id === avatarId;
              return (
                <button
                  key={id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-label={label}
                  title={label}
                  onClick={() => selectAvatar(id)}
                  className={`relative flex h-10 w-10 shrink-0 justify-self-center items-center justify-center rounded-full p-0.5 transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nc-text-accent)] ${
                    selected ? 'ring-2 ring-[var(--nc-text-accent)]' : ''
                  }`}
                  data-testid={`avatar-option-${id}`}
                >
                  <UserAvatar id={id} size={36} />
                  {selected && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-black bg-[var(--nc-text-accent)] text-black">
                      <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[8px] leading-snug opacity-60">
            {usingPngs
              ? t(
                  'PNGs de public/avatars; los 12 clásicos quedan como respaldo.',
                  'PNGs from public/avatars; the 12 classics remain as fallback.',
                  'PNGs aus public/avatars; die 12 Klassiker bleiben als Rückfall.'
                )
              : t(
                  'Se guarda en tu perfil o en este equipo.',
                  'Saved to your profile or this device.',
                  'Wird in deinem Profil oder auf diesem Gerät gespeichert.'
                )}
          </p>
        </div>
      )}
    </div>
  );
};

export default AvatarPicker;

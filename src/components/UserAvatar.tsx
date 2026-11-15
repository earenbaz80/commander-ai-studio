import React from 'react';
import { AVATAR_VIEWBOX, getAvatarPixels, resolveAvatar } from '../features/user/avatarCatalog';
import { getPngAvatarSrc } from '../features/user/pngAvatarCatalog';
import { useUserAvatar } from '../features/user/useUserAvatar';

export interface UserAvatarProps {
  id?: string | null;
  size?: number;
  className?: string;
}

/** Avatar de píxeles sin fondo; sin texto alternativo porque el nombre va al lado. */
export const UserAvatar: React.FC<UserAvatarProps> = ({ id, size = 32, className = '' }) => {
  const resolved = resolveAvatar(id);
  const pixels = React.useMemo(() => getAvatarPixels(resolved.builtin), [resolved.builtin]);
  const [imageFailed, setImageFailed] = React.useState(false);

  React.useEffect(() => {
    setImageFailed(false);
  }, [id]);

  if (resolved.source === 'png' && !imageFailed) {
    return (
      <span
        className={`user-avatar shrink-0 ${className}`}
        style={{ width: size, height: size }}
        data-avatar-id={resolved.id}
        data-avatar-source="png"
        data-testid="user-avatar"
        aria-hidden="true"
      >
        <img
          src={getPngAvatarSrc(resolved.png)}
          alt=""
          width={size}
          height={size}
          draggable={false}
          onError={() => setImageFailed(true)}
        />
      </span>
    );
  }

  const visible = resolved.builtin;
  return (
    <span
      className={`user-avatar shrink-0 ${className}`}
      style={{ width: size, height: size }}
      data-avatar-id={visible.id}
      data-testid="user-avatar"
      aria-hidden="true"
    >
      <svg viewBox={AVATAR_VIEWBOX} shapeRendering="crispEdges" focusable="false">
        {pixels.map((pixel) => (
          <rect
            key={`${pixel.x}-${pixel.y}`}
            x={pixel.x}
            y={pixel.y}
            width="1"
            height="1"
            fill={pixel.color}
          />
        ))}
      </svg>
    </span>
  );
};

export interface UserAvatarBadgeProps {
  uid?: string | null;
  photoURL?: string | null;
  size?: number;
  className?: string;
}

/**
 * Preferencia explícita > foto de la cuenta > avatar predeterminado.
 * Así quien ya tenía foto de Google no la pierde hasta elegir un avatar.
 */
export const UserAvatarBadge: React.FC<UserAvatarBadgeProps> = ({
  uid,
  photoURL,
  size = 32,
  className = '',
}) => {
  const { avatarId, hasCustomAvatar } = useUserAvatar(uid);
  if (!hasCustomAvatar && photoURL) {
    return (
      <img
        src={photoURL}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 rounded-full border border-[var(--nc-border-light)] object-cover ${className}`}
        data-testid="user-avatar-photo"
        aria-hidden="true"
      />
    );
  }
  return <UserAvatar id={avatarId} size={size} className={className} />;
};

export default UserAvatar;

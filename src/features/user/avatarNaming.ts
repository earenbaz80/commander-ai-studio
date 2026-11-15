/**
 * Nombres e ids de avatares: reglas compartidas por el sincronizador de
 * `public/avatars`, el lector del manifiesto y el catálogo.
 *
 * Sin `node:*` para poder importarse desde el navegador y desde los scripts.
 */

/** Nombre plano de un PNG dentro de `public/avatars/`. */
export const AVATAR_FILE_RE = /^[a-z0-9][a-z0-9._-]*\.png$/i;

/** Id de avatar tal como viaja en el manifiesto y en Firestore. */
export const AVATAR_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** `Gato Naranja.png` → `gato-naranja`, con el mismo tope de 64 que el id. */
export function slugifyAvatarId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

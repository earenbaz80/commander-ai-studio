import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { loadUserAvatar, saveUserAvatar } from '../../lib/firebase';
import { getDefaultAvatarId, isAvatarId } from './avatarCatalog';

/**
 * Avatar elegido por el usuario.
 *
 * La preferencia se guarda en localStorage por UID (o invitado) para que la UI
 * responda al instante y funcione sin red. Con sesión iniciada también se
 * sincroniza con `users/{uid}`; si Firestore falla, localStorage manda.
 *
 * El estado vive en un store por UID: Header, el selector y el modal comparten
 * una sola lectura remota y se actualizan juntos.
 */
const STORAGE_PREFIX = 'commander-user-avatar:';

interface AvatarEntry {
  selectedId: string | null;
  loaded: boolean;
  loading: boolean;
  /** Cambia con cada elección local o remota; invalida respuestas antiguas. */
  revision: number;
  listeners: Set<() => void>;
}

const entries = new Map<string, AvatarEntry>();

function ownerOf(uid?: string | null): string {
  return uid || 'guest';
}

function storageKey(uid?: string | null): string {
  return `${STORAGE_PREFIX}${ownerOf(uid)}`;
}

/** null = el usuario aún no ha elegido avatar; se usa el predeterminado. */
function readSelectedAvatar(uid?: string | null): string | null {
  try {
    const raw = localStorage.getItem(storageKey(uid));
    return isAvatarId(raw) ? raw : null;
  } catch {
    return null;
  }
}

function writeLocalAvatar(uid: string | null | undefined, id: string): void {
  try {
    localStorage.setItem(storageKey(uid), id);
  } catch {
    /* sin almacenamiento: al menos queda el cambio en esta sesión */
  }
}

function entryFor(uid?: string | null): AvatarEntry {
  const owner = ownerOf(uid);
  let entry = entries.get(owner);
  if (!entry) {
    entry = {
      selectedId: readSelectedAvatar(uid),
      loaded: !uid,
      loading: false,
      revision: 0,
      listeners: new Set(),
    };
    entries.set(owner, entry);
  }
  return entry;
}

function notify(entry: AvatarEntry): void {
  for (const listener of entry.listeners) listener();
}

function commitSelection(entry: AvatarEntry, uid: string | null | undefined, id: string): void {
  entry.selectedId = id;
  entry.revision += 1;
  writeLocalAvatar(uid, id);
  notify(entry);
}

function loadRemote(entry: AvatarEntry, uid: string): void {
  if (entry.loading || entry.loaded) return;

  entry.loading = true;
  const revisionAtStart = entry.revision;

  void loadUserAvatar(uid)
    .then((remoteId) => {
      entry.loading = false;
      entry.loaded = true;

      // Una elección local (o una respuesta más nueva) ya mandó.
      if (entry.revision !== revisionAtStart || !isAvatarId(remoteId)) return;
      if (entry.selectedId === remoteId) return;

      commitSelection(entry, uid, remoteId);
    })
    .catch(() => {
      // Sin red: se conserva la elección local y se permite reintentar al
      // montar otro consumidor del mismo UID.
      entry.loading = false;
    });
}

// Mantiene sincronizadas las pestañas que compartan localStorage.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (!event.key || !event.key.startsWith(STORAGE_PREFIX)) return;
    const entry = entries.get(event.key.slice(STORAGE_PREFIX.length));
    if (!entry) return;

    const next = isAvatarId(event.newValue) ? event.newValue : null;
    if (entry.selectedId === next) return;

    entry.selectedId = next;
    entry.loaded = true;
    entry.revision += 1;
    notify(entry);
  });
}

/** Solo para tests: olvida el estado en memoria; localStorage no se toca. */
export function __resetUserAvatarStore(): void {
  entries.clear();
}

export function useUserAvatar(uid?: string | null) {
  const entry = entryFor(uid);

  useEffect(() => {
    if (uid) loadRemote(entry, uid);
  }, [entry, uid]);

  const selectedAvatarId = useSyncExternalStore(
    useCallback(
      (listener) => {
        entry.listeners.add(listener);
        return () => {
          entry.listeners.delete(listener);
        };
      },
      [entry]
    ),
    useCallback(() => entry.selectedId, [entry]),
    useCallback(() => entry.selectedId, [entry])
  );

  const selectAvatar = useCallback(
    (id: string) => {
      if (!isAvatarId(id)) return;

      const target = entryFor(uid);
      if (target.selectedId === id) return;

      target.loaded = true;
      commitSelection(target, uid, id);

      if (uid) {
        void saveUserAvatar(uid, id).catch(() => {
          /* localStorage ya quedó guardado */
        });
      }
    },
    [uid]
  );

  const avatarId = selectedAvatarId ?? getDefaultAvatarId(uid);
  return {
    /** Avatar visible, aunque no se haya elegido explícitamente. */
    avatarId,
    /** true si el usuario ya eligió uno; sirve para respetar photoURL. */
    hasCustomAvatar: selectedAvatarId !== null,
    selectAvatar,
  };
}

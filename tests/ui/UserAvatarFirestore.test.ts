import { beforeEach, describe, expect, test, vi } from 'vitest';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { loadUserAvatar, saveUserAvatar } from '../../src/lib/firebase';

const getDocMock = vi.mocked(getDoc);
const setDocMock = vi.mocked(setDoc);
const docMock = vi.mocked(doc);

beforeEach(() => {
  vi.clearAllMocks();
  getDocMock.mockReset();
  setDocMock.mockReset().mockResolvedValue(undefined);
});

describe('avatar en users/{uid}', () => {
  test('lee avatarId del documento del usuario', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ avatarId: 'fox' }),
    } as any);

    await expect(loadUserAvatar('uid-1')).resolves.toBe('fox');
    expect(docMock).toHaveBeenCalledWith(expect.anything(), 'users', 'uid-1');
  });

  test('sin documento o con un valor inválido devuelve null', async () => {
    getDocMock.mockResolvedValueOnce({ exists: () => false, data: () => ({}) } as any);
    await expect(loadUserAvatar('uid-1')).resolves.toBeNull();

    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ avatarId: 42 }),
    } as any);
    await expect(loadUserAvatar('uid-1')).resolves.toBeNull();
  });

  test('un fallo de red al leer no rompe la carga', async () => {
    getDocMock.mockRejectedValueOnce(new Error('offline'));
    await expect(loadUserAvatar('uid-1')).resolves.toBeNull();
  });

  test('guarda avatarId con merge para no pisar el perfil', async () => {
    await saveUserAvatar('uid-1', 'fox');

    expect(docMock).toHaveBeenCalledWith(expect.anything(), 'users', 'uid-1');
    expect(setDocMock).toHaveBeenCalledWith(
      expect.anything(),
      { avatarId: 'fox' },
      { merge: true }
    );
  });

  test('un fallo de red al guardar no se propaga', async () => {
    setDocMock.mockRejectedValueOnce(new Error('offline'));
    await expect(saveUserAvatar('uid-1', 'fox')).resolves.toBeUndefined();
  });

  test('sin uid no toca Firestore', async () => {
    await expect(loadUserAvatar('')).resolves.toBeNull();
    await saveUserAvatar('', 'fox');
    expect(getDocMock).not.toHaveBeenCalled();
    expect(setDocMock).not.toHaveBeenCalled();
  });
});

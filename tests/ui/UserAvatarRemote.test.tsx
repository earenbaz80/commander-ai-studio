import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const remote = vi.hoisted(() => ({
  loadUserAvatar: vi.fn(),
  saveUserAvatar: vi.fn(),
}));

vi.mock('../../src/lib/firebase', () => remote);

import { AvatarPicker } from '../../src/components/settings/AvatarPicker';
import { __resetUserAvatarStore } from '../../src/features/user/useUserAvatar';

const STORAGE_KEY = 'commander-user-avatar:uid-remote';

beforeEach(() => {
  localStorage.clear();
  __resetUserAvatarStore();
  remote.loadUserAvatar.mockReset().mockResolvedValue(null);
  remote.saveUserAvatar.mockReset().mockResolvedValue(undefined);
});

describe('AvatarPicker · Firestore', () => {
  test('pinta el avatar local y luego aplica el remoto al iniciar sesión', async () => {
    let resolveRemote!: (value: string | null) => void;
    remote.loadUserAvatar.mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolveRemote = resolve;
      })
    );

    render(<AvatarPicker lang="es" uid="uid-remote" />);

    // El primer render no espera a Firestore.
    expect(screen.getByTestId('avatar-picker')).toBeInTheDocument();
    expect(remote.loadUserAvatar).toHaveBeenCalledWith('uid-remote');

    await act(async () => resolveRemote('fox'));

    await waitFor(() => expect(screen.getByTestId('avatar-picker')).toHaveTextContent('Zorro'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('fox');
    expect(remote.saveUserAvatar).not.toHaveBeenCalled();
  });

  test('dos consumidores del mismo UID comparten una lectura y una escritura', async () => {
    remote.loadUserAvatar.mockResolvedValue('fox');

    render(
      <>
        <AvatarPicker lang="es" uid="uid-remote" />
        <AvatarPicker lang="es" uid="uid-remote" />
      </>
    );

    await waitFor(() => {
      for (const picker of screen.getAllByTestId('avatar-picker')) {
        expect(picker).toHaveTextContent('Zorro');
      }
    });
    expect(remote.loadUserAvatar).toHaveBeenCalledTimes(1);
    expect(remote.saveUserAvatar).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByTestId('avatar-picker-toggle')[0]);
    fireEvent.click(screen.getAllByTestId('avatar-option-robot')[0]);

    await waitFor(() => {
      for (const picker of screen.getAllByTestId('avatar-picker')) {
        expect(picker).toHaveTextContent('Robot');
      }
    });
    expect(remote.saveUserAvatar).toHaveBeenCalledTimes(1);
    expect(remote.saveUserAvatar).toHaveBeenCalledWith('uid-remote', 'robot');
  });

  test('reutiliza la lectura remota al montar otro consumidor', async () => {
    remote.loadUserAvatar.mockResolvedValue('fox');

    const first = render(<AvatarPicker lang="es" uid="uid-remote" />);
    await waitFor(() => expect(screen.getByTestId('avatar-picker')).toHaveTextContent('Zorro'));
    first.unmount();

    render(<AvatarPicker lang="es" uid="uid-remote" />);
    expect(screen.getByTestId('avatar-picker')).toHaveTextContent('Zorro');
    expect(remote.loadUserAvatar).toHaveBeenCalledTimes(1);
  });

  test('si Firestore falla, conserva la elección local', async () => {
    localStorage.setItem(STORAGE_KEY, 'robot');
    remote.loadUserAvatar.mockRejectedValue(new Error('sin red'));

    render(<AvatarPicker lang="es" uid="uid-remote" />);

    expect(screen.getByTestId('avatar-picker')).toHaveTextContent('Robot');
    await waitFor(() => expect(remote.loadUserAvatar).toHaveBeenCalled());
    expect(screen.getByTestId('avatar-picker')).toHaveTextContent('Robot');
  });

  test('guarda la elección en users/{uid} sin esperar a la red', async () => {
    remote.loadUserAvatar.mockResolvedValue(null);
    remote.saveUserAvatar.mockReturnValue(new Promise<void>(() => {}));

    render(<AvatarPicker lang="es" uid="uid-remote" />);
    fireEvent.click(screen.getByTestId('avatar-picker-toggle'));
    fireEvent.click(screen.getByTestId('avatar-option-fox'));

    expect(localStorage.getItem(STORAGE_KEY)).toBe('fox');
    expect(screen.getByTestId('avatar-picker')).toHaveTextContent('Zorro');
    expect(remote.saveUserAvatar).toHaveBeenCalledWith('uid-remote', 'fox');
  });

  test('una respuesta remota antigua no pisa una elección hecha mientras cargaba', async () => {
    let resolveRemote!: (value: string | null) => void;
    remote.loadUserAvatar.mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolveRemote = resolve;
      })
    );

    render(<AvatarPicker lang="es" uid="uid-remote" />);
    fireEvent.click(screen.getByTestId('avatar-picker-toggle'));
    fireEvent.click(screen.getByTestId('avatar-option-fox'));

    await act(async () => resolveRemote('robot'));

    expect(screen.getByTestId('avatar-picker')).toHaveTextContent('Zorro');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('fox');
  });

  test('un fallo al guardar no revierte la elección local', async () => {
    remote.loadUserAvatar.mockResolvedValue(null);
    remote.saveUserAvatar.mockRejectedValue(new Error('sin red'));

    render(<AvatarPicker lang="es" uid="uid-remote" />);
    fireEvent.click(screen.getByTestId('avatar-picker-toggle'));
    fireEvent.click(screen.getByTestId('avatar-option-fox'));

    await waitFor(() => expect(remote.saveUserAvatar).toHaveBeenCalled());
    expect(screen.getByTestId('avatar-picker')).toHaveTextContent('Zorro');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('fox');
  });

  test('un invitado no toca Firestore', () => {
    render(<AvatarPicker lang="es" />);
    fireEvent.click(screen.getByTestId('avatar-picker-toggle'));
    fireEvent.click(screen.getByTestId('avatar-option-fox'));

    expect(remote.loadUserAvatar).not.toHaveBeenCalled();
    expect(remote.saveUserAvatar).not.toHaveBeenCalled();
  });
});

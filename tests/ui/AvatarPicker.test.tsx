import { beforeEach, describe, expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AvatarPicker } from '../../src/components/settings/AvatarPicker';
import {
  getDefaultAvatarId,
  USER_AVATARS,
} from '../../src/features/user/avatarCatalog';
import { __resetUserAvatarStore } from '../../src/features/user/useUserAvatar';

beforeEach(() => {
  localStorage.clear();
  __resetUserAvatarStore();
});

describe('AvatarPicker', () => {
  test('muestra el avatar actual y despliega la colección', () => {
    render(<AvatarPicker lang="es" uid="uid-ada" />);

    expect(screen.getByTestId('avatar-picker')).toBeInTheDocument();
    expect(screen.getByText(/haz clic para cambiar/)).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(screen.getByTestId('avatar-picker-toggle'));

    expect(screen.getByRole('listbox', { name: 'Elige tu avatar' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(USER_AVATARS.length);
    expect(screen.getByTestId(`avatar-option-${getDefaultAvatarId('uid-ada')}`)).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  test('guarda la elección por UID y la refleja al instante', () => {
    render(<AvatarPicker lang="es" uid="uid-ada" />);

    fireEvent.click(screen.getByTestId('avatar-picker-toggle'));
    fireEvent.click(screen.getByTestId('avatar-option-fox'));

    expect(localStorage.getItem('commander-user-avatar:uid-ada')).toBe('fox');
    expect(screen.getByTestId('avatar-option-fox')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('avatar-picker')).toHaveTextContent('Zorro');
  });

  test('el invitado y cada cuenta tienen su propia elección', () => {
    localStorage.setItem('commander-user-avatar:uid-ada', 'robot');

    const { unmount } = render(<AvatarPicker lang="es" uid="uid-ada" />);
    expect(screen.getByTestId('avatar-picker')).toHaveTextContent('Robot');
    fireEvent.click(screen.getByTestId('avatar-picker-toggle'));
    expect(screen.getByTestId('avatar-option-cat')).not.toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('avatar-option-robot')).toHaveAttribute('aria-selected', 'true');
    unmount();

    render(<AvatarPicker lang="es" />);
    expect(screen.getByTestId('avatar-picker')).toHaveTextContent('Gato');
  });
});

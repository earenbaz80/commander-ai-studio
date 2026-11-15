import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../src/features/user/pngAvatarCatalog', () => {
  const png = { id: 'avatar-01', file: 'avatar-01.png', label: 'Avatar 01' };
  return {
    PNG_AVATARS: [png],
    getPngAvatar: (id?: string | null) => (id === png.id ? png : undefined),
    getPngAvatarSrc: () => '/avatars/avatar-01.png',
  };
});

import { AvatarPicker } from '../../src/components/settings/AvatarPicker';
import { __resetUserAvatarStore } from '../../src/features/user/useUserAvatar';

beforeEach(() => {
  localStorage.clear();
  __resetUserAvatarStore();
});

describe('AvatarPicker con PNGs', () => {
  test('muestra el manifiesto PNG y guarda la elección', () => {
    render(<AvatarPicker lang="es" uid="uid-png" />);

    fireEvent.click(screen.getByTestId('avatar-picker-toggle'));

    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByTestId('avatar-option-avatar-01')).toBeInTheDocument();
    expect(screen.getByTestId('avatar-picker')).toHaveTextContent(/PNG/);

    fireEvent.click(screen.getByTestId('avatar-option-avatar-01'));

    expect(localStorage.getItem('commander-user-avatar:uid-png')).toBe('avatar-01');
    expect(screen.getByTestId('avatar-option-avatar-01')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('avatar-picker')).toHaveTextContent('Avatar 01');
  });
});

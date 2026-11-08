import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import {
  AccountSettings,
  type AccountUser,
} from '../../src/components/settings/AccountSettings';

const accountUser = (providers: string[]): AccountUser => ({
  uid: 'uid-ada',
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  photoURL: null,
  emailVerified: true,
  providerData: providers.map((providerId) => ({ providerId })),
});

const props = (
  overrides: Partial<ComponentProps<typeof AccountSettings>> = {}
): ComponentProps<typeof AccountSettings> => ({
  currentUser: null,
  guestName: 'Nono',
  onOpenAuth: vi.fn(),
  onLogout: vi.fn(),
  onLinkProvider: vi.fn(async () => accountUser(['password'])),
  onLinkPassword: vi.fn(async () => accountUser(['password'])),
  onUnlinkProvider: vi.fn(async () => accountUser(['password'])),
  onOpenIntegrations: vi.fn(),
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AccountSettings', () => {
  test('sin sesión muestra el invitado y abre el acceso', () => {
    const onOpenAuth = vi.fn();
    render(<AccountSettings {...props({ onOpenAuth })} />);

    expect(screen.getByText('Nono')).toBeInTheDocument();
    expect(screen.getByText('Sesión local sin cuenta')).toBeInTheDocument();
    expect(screen.getByTestId('account-open-integrations')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('account-open-auth'));
    expect(onOpenAuth).toHaveBeenCalledTimes(1);
  });

  test('muestra el perfil y los métodos conectados', () => {
    render(
      <AccountSettings
        {...props({ currentUser: accountUser(['password', 'google.com']) })}
      />
    );

    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(within(screen.getByTestId('account-provider-password')).getByText('Conectado')).toBeInTheDocument();
    expect(within(screen.getByTestId('account-provider-google.com')).getByText('Conectado')).toBeInTheDocument();
    expect(within(screen.getByTestId('account-provider-github.com')).getByText('Sin conectar')).toBeInTheDocument();
  });

  test('añade correo y contraseña a una cuenta de Google', async () => {
    const onLinkPassword = vi.fn(async () => accountUser(['google.com', 'password']));
    render(
      <AccountSettings
        {...props({ currentUser: accountUser(['google.com']), onLinkPassword })}
      />
    );

    expect(
      within(screen.getByTestId('account-provider-password')).getByText('Sin conectar')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('account-add-password'));

    const form = screen.getByTestId('account-password-form');
    fireEvent.change(within(form).getByLabelText('Correo'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.change(within(form).getByLabelText('Contraseña'), {
      target: { value: 'secreto123' },
    });
    fireEvent.change(within(form).getByLabelText('Repite la contraseña'), {
      target: { value: 'secreto123' },
    });
    fireEvent.click(within(form).getByTestId('account-link-password'));

    await waitFor(() =>
      expect(onLinkPassword).toHaveBeenCalledWith('ada@example.com', 'secreto123')
    );
    await waitFor(() =>
      expect(
        within(screen.getByTestId('account-provider-password')).getByText('Conectado')
      ).toBeInTheDocument()
    );
    expect(screen.getByRole('status')).toHaveTextContent('Correo y contraseña conectados.');
    expect(screen.queryByTestId('account-password-form')).not.toBeInTheDocument();
  });

  test('valida las contraseñas antes de vincular', () => {
    const onLinkPassword = vi.fn(async () => accountUser(['github.com', 'password']));
    render(
      <AccountSettings
        {...props({ currentUser: accountUser(['github.com']), onLinkPassword })}
      />
    );

    fireEvent.click(screen.getByTestId('account-add-password'));
    const form = screen.getByTestId('account-password-form');
    fireEvent.change(within(form).getByLabelText('Contraseña'), {
      target: { value: 'secreto123' },
    });
    fireEvent.change(within(form).getByLabelText('Repite la contraseña'), {
      target: { value: 'otro12345' },
    });
    fireEvent.click(within(form).getByTestId('account-link-password'));

    expect(onLinkPassword).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Las contraseñas no coinciden.');
  });

  test('muestra el error si el correo ya pertenece a otra cuenta', async () => {
    const onLinkPassword = vi.fn(
      async (_email: string, _password: string): Promise<AccountUser> => {
        throw { code: 'auth/email-already-in-use' };
      }
    );
    render(
      <AccountSettings
        {...props({ currentUser: accountUser(['google.com']), onLinkPassword })}
      />
    );

    fireEvent.click(screen.getByTestId('account-add-password'));
    const form = screen.getByTestId('account-password-form');
    fireEvent.change(within(form).getByLabelText('Contraseña'), {
      target: { value: 'secreto123' },
    });
    fireEvent.change(within(form).getByLabelText('Repite la contraseña'), {
      target: { value: 'secreto123' },
    });
    fireEvent.click(within(form).getByTestId('account-link-password'));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Ese correo ya está en uso por otra cuenta.'
      )
    );
    expect(screen.getByTestId('account-password-form')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('account-provider-password')).getByText('Sin conectar')
    ).toBeInTheDocument();
  });

  test('conecta GitHub y actualiza la lista de métodos', async () => {
    const onLinkProvider = vi.fn(async () => accountUser(['password', 'github.com']));
    render(
      <AccountSettings
        {...props({ currentUser: accountUser(['password']), onLinkProvider })}
      />
    );

    const github = screen.getByTestId('account-provider-github.com');
    fireEvent.click(within(github).getByRole('button', { name: /Conectar/ }));

    await waitFor(() => expect(onLinkProvider).toHaveBeenCalledWith('github.com'));
    await waitFor(() =>
      expect(
        within(screen.getByTestId('account-provider-github.com')).getByText('Conectado')
      ).toBeInTheDocument()
    );
    expect(screen.getByRole('status')).toHaveTextContent('GitHub conectado.');
  });

  test('desconecta un método si queda otro', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onUnlinkProvider = vi.fn(async () => accountUser(['google.com']));
    render(
      <AccountSettings
        {...props({
          currentUser: accountUser(['google.com', 'github.com']),
          onUnlinkProvider,
        })}
      />
    );

    fireEvent.click(
      within(screen.getByTestId('account-provider-github.com')).getByRole('button', {
        name: 'Desconectar GitHub',
      })
    );

    await waitFor(() => expect(onUnlinkProvider).toHaveBeenCalledWith('github.com'));
    await waitFor(() =>
      expect(
        within(screen.getByTestId('account-provider-github.com')).getByText('Sin conectar')
      ).toBeInTheDocument()
    );
    expect(confirm).toHaveBeenCalled();
  });

  test('no deja desconectar el único método', () => {
    render(<AccountSettings {...props({ currentUser: accountUser(['password']) })} />);

    expect(
      within(screen.getByTestId('account-provider-password')).getByRole('button', {
        name: 'Desconectar Correo y contraseña',
      })
    ).toBeDisabled();
    expect(
      screen.getByText('Debe quedar al menos un método de acceso conectado.')
    ).toBeInTheDocument();
  });

  test('cierra la sesión desde el perfil', async () => {
    const onLogout = vi.fn();
    render(
      <AccountSettings {...props({ currentUser: accountUser(['password']), onLogout })} />
    );

    fireEvent.click(screen.getByTestId('account-logout'));
    await waitFor(() => expect(onLogout).toHaveBeenCalledTimes(1));
  });
});

// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authV2Api } from '../api/trade';
import { useAppStore } from '../store/useAppStore';
import { LoginDialog } from './LoginDialog';

vi.mock('../api/trade', () => ({
  authV2Api: { login: vi.fn() },
}));

describe('LoginDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useAppStore.getState().reset();
    vi.mocked(authV2Api.login).mockReset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([{
        broker_id: 'runtime-broker',
        broker_name: 'Runtime Broker',
        backend_url: 'https://broker.example',
        market_api_url: 'https://broker.example',
        logo_url: '',
      }]),
    }));
  });

  it('clears stale optional tokens omitted by a successful real login', async () => {
    const user = userEvent.setup();
    localStorage.setItem('refresh_token', 'stale-local-refresh');
    localStorage.setItem('token_expires_at', '2099-01-01T00:00:00.000Z');
    sessionStorage.setItem('refresh_token', 'stale-session-refresh');
    sessionStorage.setItem('token_expires_at', '2099-01-01T00:00:00.000Z');
    useAppStore.setState({
      refreshToken: 'stale-store-refresh',
      tokenExpiresAt: Date.parse('2099-01-01T00:00:00.000Z'),
    });
    vi.mocked(authV2Api.login).mockResolvedValue({
      access_token: 'fresh-real-token',
      account_login: 123456,
      broker_id: 'runtime-broker',
    });

    render(
      <LoginDialog
        isOpen
        onClose={vi.fn()}
        onLoginSuccess={vi.fn()}
        lockedBrokerId="runtime-broker"
        lockedBrokerDisplayName="Runtime Broker"
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Account ID'), { target: { value: '123456' } });
    await user.type(screen.getByPlaceholderText('Password'), 'Password1');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(useAppStore.getState().authToken).toBe('fresh-real-token'));
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(localStorage.getItem('token_expires_at')).toBeNull();
    expect(sessionStorage.getItem('refresh_token')).toBeNull();
    expect(sessionStorage.getItem('token_expires_at')).toBeNull();
    expect(useAppStore.getState()).toMatchObject({
      isAuthenticated: true,
      accountId: '123456',
      refreshToken: null,
      tokenExpiresAt: null,
    });
  });

  it.each(['close', 'unmount'] as const)(
    'does not authenticate when real login resolves after %s',
    async (action) => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      const onLoginSuccess = vi.fn();
      let resolveLogin!: (response: {
        access_token: string;
        account_login: number;
        broker_id: string;
      }) => void;
      vi.mocked(authV2Api.login).mockReturnValue(new Promise((resolve) => {
        resolveLogin = resolve;
      }));

      const view = render(
        <LoginDialog
          isOpen
          onClose={onClose}
          onLoginSuccess={onLoginSuccess}
          lockedBrokerId="runtime-broker"
          lockedBrokerDisplayName="Runtime Broker"
        />,
      );

      fireEvent.change(screen.getByPlaceholderText('Account ID'), { target: { value: '123456' } });
      await user.type(screen.getByPlaceholderText('Password'), 'Password1');
      await user.click(screen.getByRole('button', { name: 'Log in' }));
      await waitFor(() => expect(authV2Api.login).toHaveBeenCalledOnce());
      expect(authV2Api.login).toHaveBeenCalledWith(
        expect.objectContaining({ username: '123456' }),
        expect.objectContaining({ persistSession: false }),
      );

      if (action === 'close') {
        await user.click(screen.getByTitle('Close'));
        expect(onClose).toHaveBeenCalledOnce();
      } else {
        view.unmount();
      }

      await act(async () => {
        resolveLogin({
          access_token: 'late-real-token',
          account_login: 123456,
          broker_id: 'runtime-broker',
        });
        await Promise.resolve();
      });

      expect(onLoginSuccess).not.toHaveBeenCalled();
      expect(useAppStore.getState()).toMatchObject({
        isAuthenticated: false,
        authToken: null,
      });
      expect(localStorage.getItem('auth_token')).toBeNull();
      expect(localStorage.getItem('rtx_last_login')).toBeNull();
    },
  );
});

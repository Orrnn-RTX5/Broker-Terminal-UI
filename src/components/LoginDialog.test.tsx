// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authV2Api } from '../api/trade';
import { useAppStore } from '../store/useAppStore';
import { getCommittedBrokerAccountSessionScope, onSessionChange } from '../services/brokerSession';
import { LoginDialog } from './LoginDialog';

vi.mock('../api/trade', () => ({
  authV2Api: { login: vi.fn() },
}));

describe('LoginDialog', () => {
  beforeEach(() => {
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = { CONFIG_SOURCE: 'deployment', API_HOST: 'https://broker.example', WS_HOST: 'wss://broker.example', BROKER_ID: 'runtime-broker', DEFAULT_MT5_SERVER: 'Runtime Broker', DISCOVERY_BASE_URL: 'https://directory.example' };
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

  it.each([
    { name: 'Account Owner', expectedName: 'Account Owner' },
    { name: undefined, expectedName: '' },
  ])('never commits the email as a label when login returns name $name', async ({ name, expectedName }) => {
    useAppStore.setState({ savedAccounts: [] });
    vi.mocked(authV2Api.login).mockResolvedValue({
      access_token: 'name-token', account_login: 200003, broker_id: 'runtime-broker',
      user: { username: 'owner@example.test', name },
    });
    const labels: string[] = [];
    const unsubscribe = useAppStore.subscribe(state => {
      const account = state.savedAccounts.find(account => account.login === 200003);
      if (account) labels.push(account.name);
    });
    try {
      render(<LoginDialog isOpen onClose={vi.fn()} />);
      fireEvent.change(screen.getByPlaceholderText('Account ID'), { target: { value: '200003' } });
      fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'test-password' } });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
      await waitFor(() => expect(useAppStore.getState().authToken).toBe('name-token'));
      expect(labels.length).toBeGreaterThan(0);
      expect(labels.every(label => label === expectedName)).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it('retains the authenticated broker logo when server discovery has no logo', async () => {
    vi.mocked(authV2Api.login).mockResolvedValue({
      access_token: 'logo-token', account_login: 200003, broker_id: 'runtime-broker',
      logo_url: '/branding/active-broker.svg',
    });
    render(<LoginDialog isOpen onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Account ID'), { target: { value: '200003' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'test-password' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(useAppStore.getState().authToken).toBe('logo-token'));
    expect(localStorage.getItem('logo_url')).toBe('/branding/active-broker.svg');
  });

  it.each(['demo', 'real', 'contest'] as const)('saves the backend %s classification at login', async accountType => {
    vi.mocked(authV2Api.login).mockResolvedValue({
      access_token: 'type-token', account_login: 200003, broker_id: 'runtime-broker',
      account_type: accountType,
    });
    render(<LoginDialog isOpen onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Account ID'), { target: { value: '200003' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'test-password' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(useAppStore.getState().authToken).toBe('type-token'));
    expect(useAppStore.getState().savedAccounts).toContainEqual(expect.objectContaining({
      login: 200003, accountType, isLive: accountType === 'real', brokerId: 'runtime-broker',
    }));
  });

  it('preserves a proven account type for the same broker when login omits type metadata', async () => {
    useAppStore.setState({ savedAccounts: [
      { login: 200003, name: 'Current owner', server: 'Runtime Broker', brokerId: 'runtime-broker',
        serverUrl: 'https://broker.example', accountType: 'demo', isLive: false, lastUsed: 1 },
      { login: 200003, name: 'Foreign owner', server: 'Runtime Broker', brokerId: 'foreign-broker',
        serverUrl: 'https://foreign.example', accountType: 'contest', isLive: false, lastUsed: 1 },
    ] });
    vi.mocked(authV2Api.login).mockResolvedValue({
      access_token: 'type-token', account_login: 200003, broker_id: 'runtime-broker',
    });
    render(<LoginDialog isOpen onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Account ID'), { target: { value: '200003' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'test-password' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(useAppStore.getState().authToken).toBe('type-token'));
    expect(useAppStore.getState().savedAccounts).toHaveLength(2);
    expect(useAppStore.getState().savedAccounts).toContainEqual(expect.objectContaining({
      login: 200003, accountType: 'demo', isLive: false, brokerId: 'runtime-broker',
    }));
    expect(useAppStore.getState().savedAccounts).toContainEqual(expect.objectContaining({
      login: 200003, accountType: 'contest', brokerId: 'foreign-broker', name: 'Foreign owner',
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

  it.each(['Orrnn', 'new-broker-42'])('locks every web login entry point to %s without a lock prop', async brokerId => {
    const runtime = window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };
    runtime.__RTX_RUNTIME_CONFIG__!.BROKER_ID = brokerId;
    localStorage.setItem('broker_id', 'other-broker');
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [
      { broker_id: 'other-broker', broker_name: 'Other Broker' },
      { broker_id: brokerId.toUpperCase(), broker_name: 'Case-distinct Broker' },
      { broker_id: brokerId, broker_name: 'Configured Broker' },
    ] } as Response);
    vi.mocked(authV2Api.login).mockResolvedValue({ access_token: 'scoped-token', account_login: 123456, broker_id: brokerId });
    render(<LoginDialog isOpen onClose={vi.fn()} />);
    const server = screen.getByPlaceholderText(/search broker/i);
    await waitFor(() => expect(server).toHaveValue('Configured Broker'));
    expect(server).toHaveAttribute('readonly');
    fireEvent.change(screen.getByPlaceholderText('Account ID'), { target: { value: '123456' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'Password1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(authV2Api.login).toHaveBeenCalledWith(
      expect.objectContaining({ broker_id: brokerId }),
      expect.objectContaining({ baseUrl: 'https://broker.example/api/v2' }),
    ));
    await waitFor(() => expect(useAppStore.getState().isAuthenticated).toBe(true));
  });

  it('refuses a caller attempting to unlock a different broker', async () => {
    render(<LoginDialog isOpen onClose={vi.fn()} lockedBrokerId="other-broker" />);
    expect(await screen.findByText('This terminal only accepts accounts for its configured broker.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeDisabled();
    expect(authV2Api.login).not.toHaveBeenCalled();
  });

  it.each([
    { previousAccount: null, reason: 'login' },
    { previousAccount: '123456', reason: 'token_rotation' },
    { previousAccount: '654321', reason: 'account_change' },
  ])('publishes one complete $reason transition after authentication', async ({ previousAccount, reason }) => {
    if (previousAccount) useAppStore.getState().setAuthenticated(true, previousAccount, 'previous-token');
    vi.mocked(authV2Api.login).mockResolvedValue({
      access_token: 'fresh-token', account_login: 123456, broker_id: 'runtime-broker',
      refresh_token: 'fresh-refresh', expires_at: 1_900_000_000,
    });
    const onClose = vi.fn();
    render(<LoginDialog isOpen onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('Account ID'), { target: { value: '123456' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'Password1' } });

    const transitions: unknown[] = [];
    const unsubscribe = onSessionChange(change => {
      if (change === 'broker_url_change') return;
      const state = useAppStore.getState();
      transitions.push({
        reason: change, account: state.accountId, token: state.authToken,
        scope: getCommittedBrokerAccountSessionScope().accountId,
        savedAccount: state.savedAccounts.find(account => account.login === 123456)?.login,
        persistedToken: localStorage.getItem('auth_token'),
      });
    });
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
      await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
      expect(transitions).toEqual([{
        reason, account: '123456', token: 'fresh-token', scope: '123456',
        savedAccount: 123456, persistedToken: 'fresh-token',
      }]);
    } finally {
      unsubscribe();
    }
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

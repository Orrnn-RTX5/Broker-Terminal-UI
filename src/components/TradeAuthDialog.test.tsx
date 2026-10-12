import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SAVED_ACCOUNTS_STORAGE_KEY, useAppStore } from '../store/useAppStore';
import { TradeAuthDialog } from './TradeAuthDialog';
import { registerRuntimeBrokerDemoAccount } from '../api/demoRegistration';
import { getCachedBrokerDirectory, loadAppBrokerDirectory, loadBrokerDirectory } from '../services/brokerDirectory';

vi.mock('../services/brokerDirectory', () => ({
  loadBrokerDirectory: vi.fn(),
  loadAppBrokerDirectory: vi.fn(),
  getCachedBrokerDirectory: vi.fn(),
}));

vi.mock('../api/demoRegistration', () => ({
  registerRuntimeBrokerDemoAccount: vi.fn(),
}));

vi.mock('../utils/audio', () => ({
  playSystemSound: vi.fn(),
}));

describe('TradeAuthDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, string> }).__RTX_RUNTIME_CONFIG__ = {
      CONFIG_SOURCE: 'deployment',
      BACKEND_TARGET: 'web',
      BROKER_ID: 'runtime-broker',
      API_HOST: 'https://runtime-broker.example',
      WS_HOST: 'wss://runtime-broker.example',
      DEFAULT_MT5_SERVER: 'Runtime Broker-Live',
      DISCOVERY_BASE_URL: 'https://directory.example',
    };
    useAppStore.setState({
      isAuthenticated: false,
      accountId: null,
      authToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      savedAccounts: [],
    });
    vi.mocked(registerRuntimeBrokerDemoAccount).mockReset();
    const brokers = [
      { broker_id: 'other-broker', broker_name: 'Other Broker', server_url: 'https://other-broker.example', logo_url: '' },
      { broker_id: 'runtime-broker', broker_name: 'Runtime Broker', server_url: 'https://runtime-broker.example', logo_url: '' },
    ];
    vi.mocked(loadBrokerDirectory).mockReset().mockResolvedValue(brokers);
    vi.mocked(loadAppBrokerDirectory).mockReset().mockResolvedValue(brokers);
    vi.mocked(getCachedBrokerDirectory).mockReset().mockReturnValue(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => brokers,
    }));
  });

  afterEach(() => {
    delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, string> }).__RTX_RUNTIME_CONFIG__;
    vi.unstubAllGlobals();
  });

  it('opens the configured login immediately without a verification alert while directory metadata is pending', async () => {
    vi.mocked(loadBrokerDirectory).mockReturnValue(new Promise(() => undefined));
    const view = render(<TradeAuthDialog isOpen intent={null} onClose={vi.fn()} onAuthenticated={vi.fn()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/verifying.*broker configuration/i)).not.toBeInTheDocument();
    const login = screen.getByRole('button', { name: /log in to live account/i });
    expect(login).toBeEnabled();
    expect(screen.getByRole('button', { name: /create demo account/i })).toBeEnabled();
    fireEvent.click(login);
    expect(await screen.findByPlaceholderText(/search broker/i)).toHaveAttribute('readonly');
    view.unmount();
  });

  it('does not show a verification alert in the demo form while directory metadata is pending', () => {
    vi.mocked(loadBrokerDirectory).mockReturnValue(new Promise(() => undefined));
    const view = render(<TradeAuthDialog isOpen initialMode="demo" intent={null} onClose={vi.fn()} onAuthenticated={vi.fn()} />);
    expect(screen.getByRole('button', { name: /create and continue/i })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/verifying.*broker configuration/i)).not.toBeInTheDocument();
    view.unmount();
  });

  it('reports actual missing deployment configuration and keeps account actions disabled', () => {
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, string> }).__RTX_RUNTIME_CONFIG__!.API_HOST = '';
    const view = render(<TradeAuthDialog isOpen intent={null} onClose={vi.fn()} onAuthenticated={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/API_HOST/i);
    expect(screen.getByRole('button', { name: /log in to live account/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /create demo account/i })).toBeDisabled();
    expect(screen.queryByText(/verifying.*broker configuration/i)).not.toBeInTheDocument();
    view.unmount();
  });

  it('closes the credential form when broker metadata rejects account access', async () => {
    let resolveDirectory!: (brokers: Array<{ broker_id: string; enabled: boolean }>) => void;
    vi.mocked(loadBrokerDirectory).mockReturnValue(new Promise(resolve => { resolveDirectory = resolve; }));
    const view = render(<TradeAuthDialog isOpen intent={null} onClose={vi.fn()} onAuthenticated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /log in to live account/i }));
    expect(await screen.findByPlaceholderText(/search broker/i)).toBeInTheDocument();
    await act(async () => { resolveDirectory([{ broker_id: 'runtime-broker', enabled: false }]); });
    expect(screen.queryByPlaceholderText(/search broker/i)).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/unavailable for account access/i);
    expect(screen.getByRole('button', { name: /log in to live account/i })).toBeDisabled();
    view.unmount();
  });

  it('does not commit a pending demo session after broker metadata rejects account access', async () => {
    let resolveDirectory!: (brokers: Array<{ broker_id: string; enabled: boolean }>) => void;
    let resolveRegistration!: (response: { access_token: string; account_login: number; broker_id: string }) => void;
    vi.mocked(loadBrokerDirectory).mockReturnValue(new Promise(resolve => { resolveDirectory = resolve; }));
    vi.mocked(registerRuntimeBrokerDemoAccount).mockReturnValue(new Promise(resolve => { resolveRegistration = resolve; }));
    const onAuthenticated = vi.fn();
    const view = render(<TradeAuthDialog isOpen initialMode="demo" intent={null} onClose={vi.fn()} onAuthenticated={onAuthenticated} />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Demo User' } });
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'demo@example.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Password1' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'Password1' } });
    fireEvent.click(screen.getByRole('button', { name: /create and continue/i }));
    expect(registerRuntimeBrokerDemoAccount).toHaveBeenCalledOnce();
    await act(async () => { resolveDirectory([{ broker_id: 'runtime-broker', enabled: false }]); });
    expect(screen.getByRole('alert')).toHaveTextContent(/unavailable for account access/i);
    await act(async () => { resolveRegistration({ access_token: 'late-demo-token', account_login: 123456, broker_id: 'runtime-broker' }); });
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(useAppStore.getState()).toMatchObject({ isAuthenticated: false, authToken: null });
    expect(screen.getByRole('button', { name: /create and continue/i })).toBeDisabled();
    view.unmount();
  });

  it('creates a demo session and returns the draft to App for review', async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    vi.mocked(registerRuntimeBrokerDemoAccount).mockResolvedValue({
      access_token: 'demo-jwt',
      refresh_token: 'demo-refresh',
      account_login: 123456,
      broker_id: 'runtime-broker',
      broker_name: 'RUNTIME BROKER',
      expires_in: 86400,
      name: 'Demo User',
    });

    render(
      <TradeAuthDialog
        isOpen
        intent={{ source: 'quick-trade', side: 'BUY', symbol: 'EURUSD', volume: 0.2 }}
        onClose={vi.fn()}
        onAuthenticated={onAuthenticated}
      />,
    );

    expect(screen.getByText(/order will not be sent automatically/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /create demo account/i }));
    await user.type(screen.getByLabelText(/full name/i), 'Demo User');
    await user.type(screen.getByLabelText(/^email$/i), 'demo@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password1');
    await user.type(screen.getByLabelText(/confirm password/i), 'Password1');
    const observeAuthenticatedBookmark = vi.fn();
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (state.isAuthenticated && !previous.isAuthenticated) {
        observeAuthenticatedBookmark(state.savedAccounts);
      }
    });
    try {
      await user.click(screen.getByRole('button', { name: /create and continue/i }));
      await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith('123456'));
    } finally {
      unsubscribe();
    }
    expect(registerRuntimeBrokerDemoAccount).toHaveBeenCalledWith({
      name: 'Demo User',
      email: 'demo@example.com',
      password: 'Password1',
    }, 'runtime-broker');
    expect(useAppStore.getState()).toMatchObject({
      isAuthenticated: true,
      accountId: '123456',
      authToken: 'demo-jwt',
    });
    const expectedBookmark = {
      login: 123456, name: 'Demo User', server: 'RUNTIME BROKER', accountType: 'demo', isLive: false,
      brokerId: 'runtime-broker', serverUrl: 'https://runtime-broker.example',
    };
    expect(observeAuthenticatedBookmark).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining(expectedBookmark),
    ]);
    expect(useAppStore.getState().savedAccounts).toEqual([expect.objectContaining(expectedBookmark)]);
    const persisted = localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY)!;
    expect(JSON.parse(persisted)).toEqual([expect.objectContaining(expectedBookmark)]);
    expect(persisted).not.toContain('demo-jwt');
    expect(persisted).not.toContain('demo-refresh');
    expect(persisted).not.toContain('Password1');
  });

  it('locks real-account login to the runtime broker', async () => {
    const user = userEvent.setup();
    render(
      <TradeAuthDialog
        isOpen
        intent={{ source: 'quick-trade', side: 'SELL', symbol: 'EURUSD', volume: 0.1 }}
        onClose={vi.fn()}
        onAuthenticated={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /log in to live account/i }));
    const serverInput = await screen.findByPlaceholderText(/search broker/i);
    expect(serverInput).toHaveAttribute('readonly');
    await waitFor(() => expect(serverInput).toHaveValue('Runtime Broker'));
  });

  it('rejects a demo session returned for a different broker', async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    vi.mocked(registerRuntimeBrokerDemoAccount).mockResolvedValue({
      access_token: 'wrong-jwt',
      account_login: 654321,
      broker_id: 'other-broker',
    });

    render(
      <TradeAuthDialog
        isOpen
        intent={{ source: 'quick-trade', side: 'BUY', symbol: 'EURUSD', volume: 0.1 }}
        onClose={vi.fn()}
        onAuthenticated={onAuthenticated}
      />,
    );

    await user.click(screen.getByRole('button', { name: /create demo account/i }));
    await user.type(screen.getByLabelText(/full name/i), 'Demo User');
    await user.type(screen.getByLabelText(/^email$/i), 'demo@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password1');
    await user.type(screen.getByLabelText(/confirm password/i), 'Password1');
    await user.click(screen.getByRole('button', { name: /create and continue/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/different broker/i);
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(useAppStore.getState().authToken).toBeNull();
  });

  it.each(['close', 'unmount', 'back', 'escape'] as const)(
    'does not authenticate when demo registration resolves after %s',
    async (action) => {
      const user = userEvent.setup();
      const onAuthenticated = vi.fn();
      let resolveRegistration!: (response: {
        access_token: string;
        account_login: number;
        broker_id: string;
      }) => void;
      vi.mocked(registerRuntimeBrokerDemoAccount).mockReturnValue(new Promise((resolve) => {
        resolveRegistration = resolve;
      }));

      const view = render(
        <TradeAuthDialog
          isOpen
          intent={{ source: 'quick-trade', side: 'BUY', symbol: 'EURUSD', volume: 0.1 }}
          onClose={vi.fn()}
          onAuthenticated={onAuthenticated}
        />,
      );

      await user.click(screen.getByRole('button', { name: /create demo account/i }));
      await user.type(screen.getByLabelText(/full name/i), 'Demo User');
      await user.type(screen.getByLabelText(/^email$/i), 'demo@example.com');
      await user.type(screen.getByLabelText(/^password$/i), 'Password1');
      await user.type(screen.getByLabelText(/confirm password/i), 'Password1');
      await user.click(screen.getByRole('button', { name: /create and continue/i }));
      await waitFor(() => expect(registerRuntimeBrokerDemoAccount).toHaveBeenCalledOnce());

      if (action === 'close') {
        await user.click(screen.getByRole('button', { name: /^close$/i }));
      } else if (action === 'back') {
        await user.click(screen.getByRole('button', { name: /^back$/i }));
        expect(screen.getByText('Account required to trade')).toBeInTheDocument();
      } else if (action === 'escape') {
        await user.keyboard('{Escape}');
        expect(screen.getByText('Account required to trade')).toBeInTheDocument();
      } else {
        view.unmount();
      }
      await act(async () => {
        resolveRegistration({
          access_token: 'late-token',
          account_login: 123456,
          broker_id: 'runtime-broker',
        });
        await Promise.resolve();
      });

      expect(onAuthenticated).not.toHaveBeenCalled();
      expect(useAppStore.getState()).toMatchObject({
        isAuthenticated: false,
        authToken: null,
      });
      expect(localStorage.getItem('auth_token')).toBeNull();
    },
  );

  it('clears stale refresh and expiration values omitted by a new demo session', async () => {
    const user = userEvent.setup();
    localStorage.setItem('refresh_token', 'stale-local-refresh');
    localStorage.setItem('token_expires_at', '2099-01-01T00:00:00.000Z');
    sessionStorage.setItem('refresh_token', 'stale-session-refresh');
    sessionStorage.setItem('token_expires_at', '2099-01-01T00:00:00.000Z');
    useAppStore.setState({
      refreshToken: 'stale-store-refresh',
      tokenExpiresAt: Date.parse('2099-01-01T00:00:00.000Z'),
    });
    vi.mocked(registerRuntimeBrokerDemoAccount).mockResolvedValue({
      access_token: 'fresh-token',
      account_login: 123456,
      broker_id: 'runtime-broker',
    });

    render(
      <TradeAuthDialog
        isOpen
        intent={{ source: 'quick-trade', side: 'BUY', symbol: 'EURUSD', volume: 0.1 }}
        onClose={vi.fn()}
        onAuthenticated={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /create demo account/i }));
    await user.type(screen.getByLabelText(/full name/i), 'Demo User');
    await user.type(screen.getByLabelText(/^email$/i), 'demo@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password1');
    await user.type(screen.getByLabelText(/confirm password/i), 'Password1');
    await user.click(screen.getByRole('button', { name: /create and continue/i }));

    await waitFor(() => expect(useAppStore.getState().authToken).toBe('fresh-token'));
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(localStorage.getItem('token_expires_at')).toBeNull();
    expect(sessionStorage.getItem('refresh_token')).toBeNull();
    expect(sessionStorage.getItem('token_expires_at')).toBeNull();
    expect(useAppStore.getState()).toMatchObject({
      refreshToken: null,
      tokenExpiresAt: null,
    });
  });
});

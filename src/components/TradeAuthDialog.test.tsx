import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '../store/useAppStore';
import { TradeAuthDialog } from './TradeAuthDialog';
import { registerRuntimeBrokerDemoAccount } from '../api/demoRegistration';

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
      BROKER_ID: 'runtime-broker',
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([
        { broker_id: 'other-broker', broker_name: 'Other Broker', logo_url: '' },
        { broker_id: 'runtime-broker', broker_name: 'Runtime Broker', logo_url: '' },
      ]),
    }));
  });

  it('creates a demo session and returns the draft to App for review', async () => {
    const user = userEvent.setup();
    const onAuthenticated = vi.fn();
    vi.mocked(registerRuntimeBrokerDemoAccount).mockResolvedValue({
      access_token: 'demo-jwt',
      refresh_token: 'demo-refresh',
      account_login: 123456,
      broker_id: 'runtime-broker',
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
    await user.click(screen.getByRole('button', { name: /create and continue/i }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith('123456'));
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

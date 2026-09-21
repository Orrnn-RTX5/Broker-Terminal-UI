// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppShell from './AppShell';

const runtimeWindow = window as Window & {
  __RTX_RUNTIME_CONFIG__?: Record<string, unknown>;
  RUNTIME_CONFIG?: Record<string, unknown>;
};

const shellMocks = vi.hoisted(() => ({
  terminalRender: vi.fn(),
  terminalUnmount: vi.fn(),
  desktop: true,
}));

vi.mock('./config/backendTarget.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./config/backendTarget.js')>(),
  isDesktopBackendTarget: () => shellMocks.desktop,
}));
vi.mock('./App', () => ({
  default: ({
    initialSessionHandoff,
    onSessionEnded,
  }: {
    initialSessionHandoff?: unknown;
    onSessionEnded?: () => void;
  }) => {
    shellMocks.terminalRender(initialSessionHandoff);
    React.useEffect(() => () => shellMocks.terminalUnmount(), []);
    return (
      <div data-testid="authenticated-terminal">
        <button data-testid="terminal-logout" onClick={onSessionEnded}>Log Out</button>
      </div>
    );
  },
}));

vi.mock('./services/screenshotService', () => ({}));
vi.mock('./i18n', async (importOriginal) => ({
  ...await importOriginal<typeof import('./i18n')>(),
  i18nReady: Promise.resolve(),
}));
vi.mock('./authenticatedStyles', () => ({}));

vi.mock('./components/WelcomeTerminal', () => ({
  WelcomeTerminal: ({ onLogin, onPrepareTerminal }: {
    onLogin: (accountId: string, handoff: {
      accountId: string;
      token: string;
      expiresAt: number;
      committedAt: number;
    }) => void;
    onPrepareTerminal?: () => void;
  }) => (
    <>
      <input data-testid="login-input" onFocus={onPrepareTerminal} />
      <button
        data-testid="login-success"
        onClick={() => onLogin('200002', {
          accountId: '200002',
          token: 'fresh-token',
          expiresAt: Date.now() + 60_000,
          committedAt: Date.now(),
        })}
      >
        Login
      </button>
    </>
  ),
}));

describe('AppShell startup boundary', () => {
  beforeEach(() => {
    shellMocks.desktop = true;
    localStorage.clear();
    sessionStorage.clear();
    shellMocks.terminalRender.mockClear();
    shellMocks.terminalUnmount.mockClear();
    delete runtimeWindow.RUNTIME_CONFIG;
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
    vi.stubEnv('VITE_BROKER_ID', '');
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    delete runtimeWindow.RUNTIME_CONFIG;
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
    vi.unstubAllEnvs();
  });

  it('keeps a known-expired stored session on the lightweight login path', async () => {
    localStorage.setItem('rtx_last_login', '200002');
    localStorage.setItem('auth_token', 'expired-token');
    localStorage.setItem('token_expires_at', new Date(Date.now() - 60_000).toISOString());

    const view = render(<AppShell />);

    await waitFor(
      () => expect(view.getByTestId('login-input')).toBeTruthy(),
      { timeout: 10_000 },
    );
    expect(shellMocks.terminalRender).not.toHaveBeenCalled();
  });

  it('can retry a failed cold stored-session terminal load', async () => {
    localStorage.setItem('rtx_last_login', '200002');
    localStorage.setItem('auth_token', 'active-token');
    localStorage.setItem('token_expires_at', new Date(Date.now() + 60_000).toISOString());
    const retryableTerminalModule = {
      default: ({ initialSessionHandoff }: { initialSessionHandoff?: unknown }) => {
        shellMocks.terminalRender(initialSessionHandoff);
        return <div data-testid="authenticated-terminal" />;
      },
    } as unknown as typeof import('./App');
    const loadStoredSessionTerminal = vi.fn<() => Promise<typeof import('./App')>>()
      .mockRejectedValueOnce(new Error('temporary chunk failure'))
      .mockResolvedValue(retryableTerminalModule);
    const view = render(
      <AppShell loadStoredSessionTerminal={loadStoredSessionTerminal} />,
    );

    await waitFor(() => expect(view.getByRole('button', { name: 'Retry' })).toBeTruthy());
    expect(view.queryByTestId('authenticated-terminal')).toBeNull();
    expect(loadStoredSessionTerminal).toHaveBeenCalledTimes(1);

    fireEvent.click(view.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(view.getByTestId('authenticated-terminal')).toBeTruthy());
    expect(loadStoredSessionTerminal).toHaveBeenCalledTimes(2);
  });

  it('restores an unexpired stored session through the authenticated boundary', async () => {
    localStorage.setItem('rtx_last_login', '200002');
    localStorage.setItem('auth_token', 'active-token');
    localStorage.setItem('token_expires_at', new Date(Date.now() + 60_000).toISOString());

    const view = render(<AppShell />);

    await waitFor(
      () => expect(view.getByTestId('authenticated-terminal')).toBeTruthy(),
      { timeout: 5_000 },
    );
  });

  it('opens configured web markets after discarding a previous broker session', async () => {
    shellMocks.desktop = false;
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web', BROKER_ID: 'achiever-financials',
      API_HOST: 'https://service.achieverfinancials.com',
    };
    localStorage.setItem('broker_id', 'TEST');
    localStorage.setItem('server_url', 'https://fxtrustbrokerbackend.orrnn.com');
    localStorage.setItem('rtx_last_login', '200002');
    localStorage.setItem('auth_token', 'previous-broker-token');
    localStorage.setItem('token_expires_at', new Date(Date.now() + 60_000).toISOString());
    const loadStoredSessionTerminal = vi.fn<() => Promise<typeof import('./App')>>();

    const view = render(<AppShell loadStoredSessionTerminal={loadStoredSessionTerminal} />);

    await view.findByTestId('authenticated-terminal');
    expect(loadStoredSessionTerminal).not.toHaveBeenCalled();
    expect(shellMocks.terminalRender).toHaveBeenCalledWith(null);
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('broker_id')).toBe('achiever-financials');
  });

  it('restores a matching configured broker session on reload', async () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: 'web', BROKER_ID: 'achiever-financials',
      API_HOST: 'https://service.achieverfinancials.com',
    };
    localStorage.setItem('broker_id', 'achiever-financials');
    localStorage.setItem('server_url', 'https://service.achieverfinancials.com');
    localStorage.setItem('rtx_last_login', '200002');
    localStorage.setItem('auth_token', 'matching-broker-token');
    localStorage.setItem('token_expires_at', new Date(Date.now() + 60_000).toISOString());

    const view = render(<AppShell />);

    await waitFor(() => expect(view.getByTestId('authenticated-terminal')).toBeTruthy());
    expect(localStorage.getItem('auth_token')).toBe('matching-broker-token');
  });

  it('does not mount the authenticated terminal before login', async () => {
    const view = render(<AppShell />);

    await waitFor(() => expect(view.getByTestId('login-input')).toBeTruthy());
    expect(shellMocks.terminalRender).not.toHaveBeenCalled();
  });

  it('crosses the boundary immediately when authentication is committed', async () => {
    const view = render(<AppShell />);

    await waitFor(() => expect(view.getByTestId('login-success')).toBeTruthy());
    fireEvent.click(view.getByTestId('login-success'));

    await waitFor(
      () => expect(view.getByTestId('authenticated-terminal')).toBeTruthy(),
      { timeout: 5_000 },
    );
    expect(shellMocks.terminalRender).toHaveBeenCalledTimes(1);
    expect(shellMocks.terminalRender).toHaveBeenCalledWith(expect.objectContaining({
      accountId: '200002',
      token: 'fresh-token',
    }));
  });

  it('returns directly to the already-loaded real login UI on logout', async () => {
    const view = render(<AppShell />);

    await waitFor(() => expect(view.getByTestId('login-success')).toBeTruthy());
    fireEvent.click(view.getByTestId('login-success'));
    await waitFor(() => expect(view.getByTestId('terminal-logout')).toBeTruthy());

    fireEvent.click(view.getByTestId('terminal-logout'));

    await waitFor(() => expect(view.getByTestId('login-input')).toBeTruthy());
    expect(view.queryByTestId('authenticated-terminal')).toBeNull();
    expect(document.querySelector('[data-login-module-loading="true"]')).toBeNull();
  });
  it('opens the existing web workspace without creating an authenticated session', async () => {
    shellMocks.desktop = false;
    const view = render(<AppShell />);
    await view.findByTestId('authenticated-terminal');
    expect(view.queryByTestId('login-input')).toBeNull();
    expect(localStorage.getItem('auth_token')).toBeNull();
    fireEvent.click(view.getByTestId('terminal-logout'));
    expect(view.getByTestId('authenticated-terminal')).toBeTruthy();
  });

  it('discards the account terminal instance on web logout while keeping guest markets available', async () => {
    shellMocks.desktop = false;
    localStorage.setItem('rtx_last_login', '200002');
    localStorage.setItem('auth_token', 'active-token');
    const view = render(<AppShell />);
    await view.findByTestId('authenticated-terminal');

    fireEvent.click(view.getByTestId('terminal-logout'));

    expect(shellMocks.terminalUnmount).toHaveBeenCalledOnce();
    expect(view.getByTestId('authenticated-terminal')).toBeTruthy();
    expect(view.queryByTestId('login-input')).toBeNull();
  });

});

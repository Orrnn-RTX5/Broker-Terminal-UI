// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppShell from './AppShell';

const shellMocks = vi.hoisted(() => ({
  terminalRender: vi.fn(),
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
    return (
      <div data-testid="authenticated-terminal">
        <button data-testid="terminal-logout" onClick={onSessionEnded}>Log Out</button>
      </div>
    );
  },
}));

vi.mock('./services/screenshotService', () => ({}));
vi.mock('./i18n', () => ({
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
    localStorage.clear();
    sessionStorage.clear();
    shellMocks.terminalRender.mockClear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
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
});

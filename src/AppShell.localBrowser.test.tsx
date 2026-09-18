// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppShell from './AppShell';
import { isDesktopBackendTarget, isElectronRuntime } from './config/backendTarget.js';

vi.mock('./App', () => ({
  default: ({ onSessionEnded }: { onSessionEnded?: () => void }) => (
    <div data-testid="guest-terminal">
      <button onClick={onSessionEnded}>Log out</button>
    </div>
  ),
}));
vi.mock('./components/WelcomeTerminal', () => ({
  WelcomeTerminal: () => <div data-testid="old-login" />,
}));
vi.mock('./i18n', () => ({
  i18nReady: Promise.resolve(),
  default: { t: (key: string) => key },
}));
vi.mock('./authenticatedStyles', () => ({}));
vi.mock('./startup/tradingChartRuntime', () => ({
  preloadTradingChartRuntime: vi.fn(async () => undefined),
}));

const runtimeWindow = window as Window & {
  RUNTIME_CONFIG?: Record<string, unknown>;
  __RTX_RUNTIME_CONFIG__?: Record<string, unknown>;
};

afterEach(() => {
  cleanup();
  delete runtimeWindow.RUNTIME_CONFIG;
  delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllEnvs();
});

describe('local browser login flow with direct backend configuration', () => {
  it.each(['desktop', 'direct', 'electron'])('keeps the guest terminal before and after logout with %s backend mode', async (mode) => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      BACKEND_TARGET: mode, BACKEND_MODE: mode,
      BROKER_ID: 'Nexa', API_HOST: 'https://nexa.orrnn.com',
    };
    // Exercise the real resolver: transport stays direct, UI stays in the browser.
    expect(isDesktopBackendTarget()).toBe(true);
    expect(isElectronRuntime()).toBe(false);

    const view = render(<AppShell />);
    await waitFor(() => expect(view.getByTestId('guest-terminal')).toBeTruthy());
    expect(view.queryByTestId('old-login')).toBeNull();
    expect(localStorage.getItem('auth_token')).toBeNull();

    fireEvent.click(view.getByRole('button', { name: 'Log out' }));
    expect(view.getByTestId('guest-terminal')).toBeTruthy();
    expect(view.queryByTestId('old-login')).toBeNull();
  });

  it('opens charts for an expired browser session even with desktop build settings', async () => {
    vi.stubEnv('VITE_BACKEND_MODE', 'desktop');
    localStorage.setItem('rtx_last_login', '200001');
    localStorage.setItem('auth_token', 'expired-test-token');
    localStorage.setItem('token_expires_at', String(Date.now() - 60_000));
    expect(isDesktopBackendTarget()).toBe(true);
    expect(isElectronRuntime()).toBe(false);

    const view = render(<AppShell />);
    await waitFor(() => expect(view.getByTestId('guest-terminal')).toBeTruthy());
    expect(view.queryByTestId('old-login')).toBeNull();
  });
});

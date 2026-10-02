import type { ReactNode } from 'react';
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountApp } from './bootstrap';
import { getBackendTarget } from './config/backendTarget.js';

const mocks = vi.hoisted(() => ({
  renderTerminal: vi.fn(),
  preloadTerminal: vi.fn(() => Promise.resolve()),
  hasStoredSession: vi.fn(() => false),
  initializeTheme: vi.fn(),
  roots: [] as Array<{ unmount(): void }>,
}));

vi.mock('react-dom/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-dom/client')>();
  return {
    ...original,
    createRoot: (...args: Parameters<typeof original.createRoot>) => {
      const root = original.createRoot(...args);
      mocks.roots.push(root);
      return root;
    },
  };
});
vi.mock('./AppShell', () => ({
  default: () => {
    mocks.renderTerminal();
    return <div data-testid="terminal-shell">Terminal</div>;
  },
  hasStoredSessionCandidate: mocks.hasStoredSession,
  preloadAuthenticatedTerminal: mocks.preloadTerminal,
}));
vi.mock('./components/layout/DesktopWindowShell', () => ({
  DesktopWindowShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('./contexts/ThemeContext', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('./utils/advancedViewRootClasses', () => ({ initRootTheme: mocks.initializeTheme }));

const runtimeWindow = window as Window & {
  __RTX_RUNTIME_CONFIG__?: Record<string, unknown>;
  RUNTIME_CONFIG?: Record<string, unknown>;
  __RUNTIME_CONFIG__?: Record<string, unknown>;
};
const validRuntime = {
  CONFIG_SOURCE: 'deployment', BACKEND_TARGET: 'web', BROKER_ID: 'achiever',
  API_HOST: 'https://service.achiever.orrnn.com',
  WS_HOST: 'wss://service.achiever.orrnn.com', DEFAULT_MT5_SERVER: 'broker-server-3',
};
let network: ReturnType<typeof vi.fn>;

describe('broker configuration bootstrap gate', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    localStorage.clear();
    sessionStorage.clear();
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
    delete runtimeWindow.RUNTIME_CONFIG;
    delete runtimeWindow.__RUNTIME_CONFIG__;
    mocks.renderTerminal.mockClear();
    mocks.preloadTerminal.mockClear();
    mocks.hasStoredSession.mockReset().mockReturnValue(false);
    mocks.initializeTheme.mockClear();
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    // A shared image may still contain older compiled values. Runtime errors
    // must remain errors instead of restoring those packaged broker settings.
    vi.stubEnv('VITE_API_HOST', 'https://service.orrnn.com');
    vi.stubEnv('VITE_WS_HOST', 'wss://service.orrnn.com');
    vi.stubEnv('VITE_BROKER_ID', 'Orrnn');
    vi.stubEnv('VITE_DEFAULT_MT5_SERVER', 'Orrnn-Live');
    network = vi.fn(() => { throw new Error('Bootstrap must not issue a real network request in this test.'); });
    vi.stubGlobal('fetch', network);
  });

  afterEach(() => {
    act(() => { mocks.roots.splice(0).forEach(root => root.unmount()); });
    document.body.innerHTML = '';
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
    delete runtimeWindow.RUNTIME_CONFIG;
    delete runtimeWindow.__RUNTIME_CONFIG__;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ['missing production configuration', undefined],
    ['empty runtime configuration', {}],
    ['missing broker identity', { ...validRuntime, BROKER_ID: '' }],
    ['explicit empty API override', { ...validRuntime, API_HOST: '', VITE_API_HOST: 'https://service.orrnn.com' }],
    ['cleartext public API', { ...validRuntime, API_HOST: 'http://service.achiever.orrnn.com' }],
    ['unapproved socket origin', { ...validRuntime, WS_HOST: 'wss://service.orrnn.com' }],
    ['deployment desktop bypass', { ...validRuntime, BACKEND_TARGET: 'desktop' }],
  ] as Array<[string, Record<string, unknown> | undefined]>)('shows a clear error and starts no terminal for %s', (_label, configuration) => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = configuration;
    localStorage.setItem('auth_token', 'stale-orrnn-token');
    mocks.hasStoredSession.mockReturnValue(true);

    act(() => mountApp());

    expect(screen.getByRole('alert')).toHaveTextContent('Broker configuration error');
    expect(screen.getByRole('alert')).toHaveTextContent('Broker connections are disabled.');
    expect(document.querySelector('.rtx-terminal-loading__message')?.textContent).toBeTruthy();
    expect(screen.queryByTestId('terminal-shell')).toBeNull();
    expect(mocks.renderTerminal).not.toHaveBeenCalled();
    expect(mocks.preloadTerminal).not.toHaveBeenCalled();
    expect(mocks.hasStoredSession).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it('mounts and preloads a valid deployment with authoritative runtime settings', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      ...validRuntime, VITE_API_HOST: 'https://service.orrnn.com',
      VITE_BROKER_ID: 'Orrnn', VITE_BACKEND_TARGET: 'desktop',
    };

    act(() => mountApp());

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('terminal-shell')).toBeInTheDocument();
    expect(mocks.renderTerminal).toHaveBeenCalled();
    expect(mocks.preloadTerminal).toHaveBeenCalledTimes(1);
    expect(mocks.initializeTheme).toHaveBeenCalledTimes(1);
    expect(network).not.toHaveBeenCalled();
  });

  it('prefers the deployment global over an older compiled global', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      ...validRuntime, CONFIG_SOURCE: 'build', BROKER_ID: 'Orrnn',
      API_HOST: 'https://service.orrnn.com', WS_HOST: 'wss://service.orrnn.com',
    };
    runtimeWindow.RUNTIME_CONFIG = validRuntime;

    act(() => mountApp());

    expect(getBackendTarget()).toBe(validRuntime.API_HOST);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('terminal-shell')).toBeInTheDocument();
    expect(mocks.preloadTerminal).toHaveBeenCalledTimes(1);
    expect(network).not.toHaveBeenCalled();
  });

  it('does not revive a compiled global when the explicit deployment is incomplete', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { ...validRuntime, CONFIG_SOURCE: 'build' };
    runtimeWindow.RUNTIME_CONFIG = { CONFIG_SOURCE: 'deployment' };

    act(() => mountApp());

    expect(getBackendTarget()).toBe('');
    expect(screen.getByRole('alert')).toHaveTextContent('API_HOST is required');
    expect(mocks.renderTerminal).not.toHaveBeenCalled();
    expect(mocks.preloadTerminal).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it('blocks conflicting deployment identities across legacy globals', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = validRuntime;
    runtimeWindow.RUNTIME_CONFIG = { ...validRuntime, BROKER_ID: 'Achiever' };

    act(() => mountApp());

    expect(getBackendTarget()).toBe('');
    expect(screen.getByRole('alert')).toHaveTextContent('Conflicting deployment runtime configuration sources');
    expect(mocks.renderTerminal).not.toHaveBeenCalled();
    expect(mocks.preloadTerminal).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves physical Electron login/session preload behavior (saved session: %s)', (savedSession) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Browser Electron/40');
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { BACKEND_TARGET: 'desktop' };
    mocks.hasStoredSession.mockReturnValue(savedSession);

    act(() => mountApp());

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('terminal-shell')).toBeInTheDocument();
    expect(mocks.preloadTerminal).toHaveBeenCalledTimes(savedSession ? 1 : 0);
    expect(network).not.toHaveBeenCalled();
  });
});

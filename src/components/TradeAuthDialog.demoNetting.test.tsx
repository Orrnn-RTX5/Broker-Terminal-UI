/**
 * #21 terminal demo NETTING sign-up in the trade login dialog.
 * Owner acceptance: after the demo NETTING account is created the terminal is
 * logged STRAIGHT into it (no extra login step, no page reload) and the #18
 * account-mode label reads "Netting".
 * Fixtures are neutral (no real broker, host, group or login).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useAppStore } from '../store/useAppStore';
import { TradeAuthDialog } from './TradeAuthDialog';
import {
  DEMO_NETTING_NOT_CONFIGURED_MESSAGE,
  loadDemoRegistrationModes,
  registerRuntimeBrokerDemoAccount,
} from '../api/demoRegistration';
import { getCachedBrokerDirectory, loadAppBrokerDirectory, loadBrokerDirectory } from '../services/brokerDirectory';
import { apiClient } from '../api/client';
import { UNKNOWN_MARGIN_MODE, useTerminalBrokerInfo } from '../hooks/useTerminalTitle';

vi.mock('../services/brokerDirectory', () => ({
  loadBrokerDirectory: vi.fn(),
  loadAppBrokerDirectory: vi.fn(),
  getCachedBrokerDirectory: vi.fn(),
}));

vi.mock('../api/demoRegistration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/demoRegistration')>();
  return { ...actual, registerRuntimeBrokerDemoAccount: vi.fn(), loadDemoRegistrationModes: vi.fn() };
});

vi.mock('../startup/runAfterTerminalReady', () => ({
  runAfterTerminalReady: (task: () => void) => { task(); return () => undefined; },
}));

vi.mock('../utils/audio', () => ({ playSystemSound: vi.fn() }));

const BROKER = 'runtime-broker';
const NEW_LOGIN = 700001;
const SYMBOL = 'WIRESYM';
type RuntimeWindow = Window & { __RTX_RUNTIME_CONFIG__?: Record<string, string> };

const fillDemoForm = () => {
  fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Demo User' } });
  fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'demo@example.com' } });
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Password1' } });
  fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'Password1' } });
};
const renderDemo = (onAuthenticated = vi.fn()) => render(
  <TradeAuthDialog isOpen initialMode="demo" intent={null} onClose={vi.fn()} onAuthenticated={onAuthenticated} />,
);
const nettingRadio = () => screen.queryByRole('radio', { name: /^netting$/i });
const hedgingRadio = () => screen.queryByRole('radio', { name: /^hedging$/i });
const createdAccount = (mode: 'netting' | 'hedging') => ({
  access_token: `demo-jwt-${mode}`, refresh_token: 'demo-refresh', account_login: NEW_LOGIN,
  broker_id: BROKER, broker_name: 'RUNTIME BROKER', expires_in: 86400, name: 'Demo User', account_mode: mode,
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = {
    CONFIG_SOURCE: 'deployment',
    BACKEND_TARGET: 'web',
    BROKER_ID: BROKER,
    API_HOST: 'https://runtime-broker.example',
    WS_HOST: 'wss://runtime-broker.example',
    DEFAULT_MT5_SERVER: 'Runtime Broker-Live',
    DISCOVERY_BASE_URL: 'https://directory.example',
  };
  useAppStore.setState({
    isAuthenticated: false, accountId: null, authToken: null, refreshToken: null, tokenExpiresAt: null, savedAccounts: [],
  });
  vi.mocked(registerRuntimeBrokerDemoAccount).mockReset();
  vi.mocked(loadDemoRegistrationModes).mockReset().mockResolvedValue({ hedging: null, netting: false });
  const brokers = [{ broker_id: BROKER, broker_name: 'Runtime Broker', server_url: 'https://runtime-broker.example', logo_url: '' }];
  vi.mocked(loadBrokerDirectory).mockReset().mockResolvedValue(brokers);
  vi.mocked(loadAppBrokerDirectory).mockReset().mockResolvedValue(brokers);
  vi.mocked(getCachedBrokerDirectory).mockReset().mockReturnValue(null);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => brokers }));
});

afterEach(() => {
  cleanup();
  delete (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('demo netting option visibility (fail closed)', () => {
  it('asks this broker for its demo options when the dialog opens', async () => {
    renderDemo();
    await waitFor(() => expect(loadDemoRegistrationModes).toHaveBeenCalledWith(BROKER, expect.any(AbortSignal)));
  });

  it('hides the mode choice when the broker does not offer netting', async () => {
    renderDemo();
    await waitFor(() => expect(loadDemoRegistrationModes).toHaveBeenCalled());
    await act(async () => {});
    expect(nettingRadio()).toBeNull();
    expect(hedgingRadio()).toBeNull();
  });

  it('hides the mode choice while the broker answer is pending', () => {
    vi.mocked(loadDemoRegistrationModes).mockReturnValue(new Promise(() => undefined));
    renderDemo();
    expect(nettingRadio()).toBeNull();
  });

  it('shows Hedging (default) and Netting when the broker offers netting', async () => {
    vi.mocked(loadDemoRegistrationModes).mockResolvedValue({ hedging: true, netting: true });
    renderDemo();
    expect(await screen.findByRole('radio', { name: /^netting$/i })).not.toBeChecked();
    expect(hedgingRadio()).toBeChecked();
    expect(hedgingRadio()).toBeEnabled();
    expect(screen.getByRole('group', { name: /account mode/i })).toBeInTheDocument();
  });

  it('keeps Hedging offered (default, enabled) when the broker does not say whether hedging is on', async () => {
    vi.mocked(loadDemoRegistrationModes).mockResolvedValue({ hedging: null, netting: true });
    renderDemo();
    expect(await screen.findByRole('radio', { name: /^netting$/i })).not.toBeChecked();
    expect(hedgingRadio()).toBeChecked();
    expect(hedgingRadio()).toBeEnabled();
  });

  it('ignores a late answer from a read that was aborted when the dialog closed', async () => {
    const pending: Array<(modes: { hedging: boolean | null; netting: boolean }) => void> = [];
    vi.mocked(loadDemoRegistrationModes).mockImplementation(() => new Promise(resolve => { pending.push(resolve); }));
    const props = { initialMode: 'demo' as const, intent: null, onClose: vi.fn(), onAuthenticated: vi.fn() };
    const view = render(<TradeAuthDialog isOpen {...props} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    const firstSignal = vi.mocked(loadDemoRegistrationModes).mock.calls[0][1] as AbortSignal;
    view.rerender(<TradeAuthDialog isOpen={false} {...props} />);
    expect(firstSignal.aborted).toBe(true);
    view.rerender(<TradeAuthDialog isOpen {...props} />);
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => { pending[0]({ hedging: true, netting: true }); });
    expect(nettingRadio()).toBeNull();
    // The current read still applies: its own answer shows the option.
    await act(async () => { pending[1]({ hedging: true, netting: true }); });
    expect(nettingRadio()).toBeInTheDocument();
  });

  it('drops the previous broker\'s answer as soon as the deployment broker changes', async () => {
    const brokers = [
      { broker_id: BROKER, broker_name: 'Runtime Broker', server_url: 'https://runtime-broker.example', logo_url: '' },
      { broker_id: 'next-broker', broker_name: 'Next Broker', server_url: 'https://next-broker.example', logo_url: '' },
    ];
    vi.mocked(loadBrokerDirectory).mockResolvedValue(brokers);
    vi.mocked(loadDemoRegistrationModes).mockImplementation(async (brokerId?: string) => (
      brokerId === BROKER ? { hedging: true, netting: true } : new Promise(() => undefined)
    ));
    const props = { initialMode: 'demo' as const, intent: null, onClose: vi.fn(), onAuthenticated: vi.fn() };
    const view = render(<TradeAuthDialog isOpen {...props} />);
    expect(await screen.findByRole('radio', { name: /^netting$/i })).toBeInTheDocument();
    const runtime = (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__!;
    runtime.BROKER_ID = 'next-broker';
    runtime.API_HOST = 'https://next-broker.example';
    runtime.WS_HOST = 'wss://next-broker.example';
    view.rerender(<TradeAuthDialog isOpen {...props} />);
    await waitFor(() => expect(loadDemoRegistrationModes).toHaveBeenCalledWith('next-broker', expect.any(AbortSignal)));
    expect(nettingRadio()).toBeNull();
  });

  it('preselects Netting and disables Hedging when the broker turned hedging demo sign-up off', async () => {
    vi.mocked(loadDemoRegistrationModes).mockResolvedValue({ hedging: false, netting: true });
    renderDemo();
    expect(await screen.findByRole('radio', { name: /^netting$/i })).toBeChecked();
    expect(hedgingRadio()).toBeDisabled();
  });
});

describe('demo netting submit', () => {
  it('a Hedging submit sends exactly today\'s input (no account mode)', async () => {
    vi.mocked(loadDemoRegistrationModes).mockResolvedValue({ hedging: true, netting: true });
    vi.mocked(registerRuntimeBrokerDemoAccount).mockResolvedValue(createdAccount('hedging'));
    renderDemo();
    await screen.findByRole('radio', { name: /^netting$/i });
    fillDemoForm();
    fireEvent.click(screen.getByRole('button', { name: /create and continue/i }));
    await waitFor(() => expect(registerRuntimeBrokerDemoAccount).toHaveBeenCalledOnce());
    expect(registerRuntimeBrokerDemoAccount).toHaveBeenCalledWith(
      { name: 'Demo User', email: 'demo@example.com', password: 'Password1' }, BROKER,
    );
  });

  it('a Netting submit sends accountMode netting', async () => {
    vi.mocked(loadDemoRegistrationModes).mockResolvedValue({ hedging: true, netting: true });
    vi.mocked(registerRuntimeBrokerDemoAccount).mockResolvedValue(createdAccount('netting'));
    renderDemo();
    fireEvent.click(await screen.findByRole('radio', { name: /^netting$/i }));
    fillDemoForm();
    fireEvent.click(screen.getByRole('button', { name: /create and continue/i }));
    await waitFor(() => expect(registerRuntimeBrokerDemoAccount).toHaveBeenCalledOnce());
    expect(registerRuntimeBrokerDemoAccount).toHaveBeenCalledWith(
      { name: 'Demo User', email: 'demo@example.com', password: 'Password1', accountMode: 'netting' }, BROKER,
    );
  });

  it('shows the clear backend error copy and stays logged out', async () => {
    vi.mocked(loadDemoRegistrationModes).mockResolvedValue({ hedging: true, netting: true });
    vi.mocked(registerRuntimeBrokerDemoAccount).mockRejectedValue(new Error(DEMO_NETTING_NOT_CONFIGURED_MESSAGE));
    const onAuthenticated = vi.fn();
    renderDemo(onAuthenticated);
    fireEvent.click(await screen.findByRole('radio', { name: /^netting$/i }));
    fillDemoForm();
    fireEvent.click(screen.getByRole('button', { name: /create and continue/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(DEMO_NETTING_NOT_CONFIGURED_MESSAGE);
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(useAppStore.getState()).toMatchObject({ isAuthenticated: false, authToken: null });
  });
});

describe('owner acceptance: straight into the new netting account, no reload, label "Netting"', () => {
  it.each([
    ['netting', 'Netting'],
    ['hedging', 'Hedge'],
  ] as const)('a %s demo logs in at once and the header shows %s', async (mode, label) => {
    const capabilityReads: string[] = [];
    vi.spyOn(apiClient, 'get').mockImplementation(async (endpoint: string) => {
      if (endpoint.startsWith('/account/symbol-capabilities/')) {
        capabilityReads.push(endpoint);
        return { account_login: String(NEW_LOGIN), account_mode: mode } as never;
      }
      if (endpoint === '/broker/servers') return [] as never;
      if (endpoint === '/brokers') return { brokers: [], count: 0 } as never;
      return {} as never;
    });
    const consoleError = vi.spyOn(console, 'error');
    const hrefBefore = window.location.href;
    vi.mocked(loadDemoRegistrationModes).mockResolvedValue({ hedging: true, netting: true });
    vi.mocked(registerRuntimeBrokerDemoAccount).mockResolvedValue(createdAccount(mode));

    // The header hook is mounted as a guest BEFORE sign-up and is never remounted.
    const header = renderHook(() => useTerminalBrokerInfo(SYMBOL));
    expect(header.result.current.marginMode).toBe(UNKNOWN_MARGIN_MODE);

    const onAuthenticated = vi.fn();
    renderDemo(onAuthenticated);
    if (mode === 'netting') fireEvent.click(await screen.findByRole('radio', { name: /^netting$/i }));
    else await screen.findByRole('radio', { name: /^hedging$/i });
    fillDemoForm();
    fireEvent.click(screen.getByRole('button', { name: /create and continue/i }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledExactlyOnceWith(String(NEW_LOGIN)));
    expect(useAppStore.getState()).toMatchObject({
      isAuthenticated: true, accountId: String(NEW_LOGIN), authToken: `demo-jwt-${mode}`,
    });
    await waitFor(() => expect(header.result.current.marginMode).toBe(label));
    expect(capabilityReads).toEqual([`/account/symbol-capabilities/${SYMBOL}`]);

    // No reload / navigation anywhere: same document URL, and jsdom reports no navigation attempt.
    expect(window.location.href).toBe(hrefBefore);
    expect(consoleError.mock.calls.flat().map(String).join('\n')).not.toMatch(/not implemented: navigation/i);
    header.unmount();
  });
});

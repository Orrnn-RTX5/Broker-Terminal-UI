import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyBrokerChrome } from '../services/brokerPresentation';
import { WelcomeTerminal, type BrokerServerItem } from './WelcomeTerminal';

const runtime = vi.hoisted(() => ({
  login: vi.fn(), persist: vi.fn(), setAuthenticated: vi.fn(),
}));
const runtimeWindow = window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };
vi.mock('../hooks/useUiTranslation', () => ({ useUiTranslation: () => (text: string) => text }));
vi.mock('../startup/loginRuntime', () => ({
  preloadLoginTransportRuntime: async () => ({ authV2Api: { login: runtime.login }, persistBrokerSessionDiscovery: runtime.persist }),
  loadAuthenticatedLoginStoreRuntime: async () => ({ useAppStore: { getState: () => ({ setAuthenticated: runtime.setAuthenticated }) } }),
}));
vi.mock('../startup/performanceBudget', () => ({
  beginLoginPerformanceMeasurement: vi.fn(), markAuthenticationAccepted: vi.fn(),
  markAuthenticationRequestStarted: vi.fn(), markPostAuthenticationPhase: vi.fn(),
  scheduleAuthenticatedShellPaintMeasurement: vi.fn(), waitForLoginFeedbackPaint: async () => {},
}));

const achiever: BrokerServerItem = {
  broker_id: 'achiever-financials', broker_name: 'Achiever Financials', logo_url: '',
  server_url: 'https://service.achieverfinancials.com', active: true, enabled: true,
  server_ip: '192.0.2.1', server_port: 8091,
};
const gta: BrokerServerItem = {
  broker_id: 'gta_broker', broker_name: 'Grow Trading Academy', logo_url: '',
  server_url: 'https://services.growtradingacademy.com', active: true, enabled: true,
};
const myprop: BrokerServerItem = {
  broker_id: 'myprop-trade', broker_name: 'MyProp', logo_url: '',
  server_url: 'https://services.myprop.test', active: true, enabled: true,
};
const nexa: BrokerServerItem = {
  broker_id: 'Nexa', broker_name: 'Nexa', logo_url: 'https://directory.example.test/nexa.ico',
  server_url: 'https://nexa.orrnn.com', active: true, enabled: true,
};
const directory = [achiever, gta, myprop, nexa];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const pending = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const fetchMock = vi.fn();
const loginButton = () => screen.getByRole('button', { name: 'Login' });
const selectBroker = (name: string) => {
  fireEvent.click(screen.getByRole('combobox'));
  fireEvent.click(screen.getByRole('option', { name }));
};
const fillCredentials = () => {
  fireEvent.change(screen.getByLabelText('Account ID'), { target: { value: '12345' } });
  fireEvent.change(screen.getByLabelText('Password', { selector: 'input' }), { target: { value: 'test-password' } });
};
const submit = () => fireEvent.submit(loginButton().closest('form')!);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  runtimeWindow.__RTX_RUNTIME_CONFIG__ = { BACKEND_TARGET: 'desktop', BROKER_ID: achiever.broker_id, API_HOST: achiever.server_url };
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/broker/servers')) return json(directory);
    if (url === `${nexa.server_url}/api/v2/broker/config?broker_id=${nexa.broker_id}`) {
      return json({ theme_color: '#6D4AFF' });
    }
    return json({ status: 'ok' });
  });
  vi.stubGlobal('fetch', fetchMock);
  runtime.login.mockReset().mockResolvedValue({ access_token: 'test-token', account_login: 12345 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
  applyBrokerChrome({});
  document.title = '';
});

describe('desktop broker directory login', () => {
  it('shows every directory broker and changes branding and health target on selection', async () => {
    render(<WelcomeTerminal onLogin={vi.fn()} />);
    await waitFor(() => expect(loginButton()).toBeEnabled());
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getAllByRole('option')).toHaveLength(4);
    fillCredentials();
    selectBroker(gta.broker_name);
    expect(screen.getByLabelText('Password', { selector: 'input' })).toHaveValue('');
    await waitFor(() => expect(loginButton()).toBeEnabled());
    expect(document.querySelector('.rtx-login-visual img')).toHaveAttribute('src', expect.stringContaining('gta-hero'));
    expect(fetchMock).toHaveBeenCalledWith(`${gta.server_url}/health`, expect.objectContaining({ cache: 'no-store' }));
    selectBroker(myprop.broker_name);
    await waitFor(() => expect(loginButton()).toBeEnabled());
    expect(document.querySelector('.rtx-login-visual img')).toHaveAttribute('src', expect.stringContaining('myprop-hero'));
    selectBroker(nexa.broker_name);
    await waitFor(() => expect(loginButton()).toBeEnabled());
    await waitFor(() => expect(document.querySelector('.rtx-login-overlay')).toHaveStyle('--rtx-broker-accent: #6D4AFF'));
    expect(document.querySelector('.rtx-login-overlay')).toHaveAttribute('data-broker-id', nexa.broker_id);
    expect(document.documentElement).toHaveAttribute('data-broker-id', nexa.broker_id);
    expect(document.documentElement).toHaveStyle('--rtx-broker-accent: #6D4AFF');
    expect(document.title).toBe(`RTX Terminal - ${nexa.broker_name}`);
    expect(document.querySelector('.rtx-login-broker-identity')).toHaveTextContent(nexa.broker_name);
    expect(document.querySelector('.rtx-login-broker-identity-logo img')).toHaveAttribute('src', nexa.logo_url);
    expect(document.querySelector('.rtx-login-visual img')).toHaveAttribute('src', expect.stringContaining('trading-desk-hero'));
    expect(fetchMock).toHaveBeenCalledWith(
      `${nexa.server_url}/api/v2/broker/config?broker_id=${nexa.broker_id}`,
      expect.objectContaining({ cache: 'no-store' }),
    );
    selectBroker(gta.broker_name);
    await waitFor(() => expect(loginButton()).toBeEnabled());
    expect(document.title).toBe(`RTX Terminal - ${gta.broker_name}`);
    expect(document.documentElement).toHaveAttribute('data-broker-id', gta.broker_id);
    expect(document.documentElement.style.getPropertyValue('--rtx-broker-accent')).toBe('');
    expect(document.querySelector('.rtx-login-broker-identity')).toHaveTextContent(gta.broker_name);
    expect(document.querySelector('.rtx-login-visual img')).toHaveAttribute('src', expect.stringContaining('gta-hero'));
  });

  it('requires fresh health even with a recent cached Online badge and blocks direct form submission', async () => {
    const health = pending<Response>();
    localStorage.setItem('rtx_broker_presentation_v1', JSON.stringify({ version: 1, brokerId: achiever.broker_id, healthVerifiedAt: Date.now() }));
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/broker/servers') ? json(directory) : health.promise);
    render(<WelcomeTerminal onLogin={vi.fn()} />);
    await screen.findByText('Checking');
    expect(loginButton()).toBeDisabled();
    expect(screen.getByLabelText('Account ID')).toBeDisabled();
    submit();
    await screen.findByText('Select an available broker and wait for the server check before logging in.');
    expect(runtime.login).not.toHaveBeenCalled();
    await act(async () => health.resolve(json({ status: 'ok' })));
    expect(loginButton()).toBeEnabled();
  });

  it('ignores an old broker health response after selecting another broker', async () => {
    const oldHealth = pending<Response>();
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/broker/servers') ? json(directory) : url.startsWith(achiever.server_url!) ? oldHealth.promise : json({}, 503));
    render(<WelcomeTerminal onLogin={vi.fn()} />);
    await screen.findByText('Checking');
    selectBroker(gta.broker_name);
    await screen.findByText('Broker temporarily unavailable');
    await act(async () => oldHealth.resolve(json({ status: 'ok' })));
    expect(loginButton()).toBeDisabled();
    expect(screen.getByText('Broker temporarily unavailable')).toBeInTheDocument();
  });

  it('turns a timeout into Unavailable and allows a fresh retry', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (url: string, options: RequestInit) => {
      if (url.endsWith('/broker/servers')) return json(directory);
      return new Promise<Response>((_, reject) => options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    });
    render(<WelcomeTerminal onLogin={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(8001); });
    expect(screen.getByText('Broker temporarily unavailable')).toBeInTheDocument();
    expect(loginButton()).toBeDisabled();
    fetchMock.mockResolvedValue(json({ status: 'ok' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    expect(loginButton()).toBeEnabled();
  });

  it('does not fall back to the configured broker when the directory fails, and can retry', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 503));
    render(<WelcomeTerminal onLogin={vi.fn()} />);
    await screen.findByText('Broker list unavailable. Please try again.');
    expect(loginButton()).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(loginButton()).toBeEnabled());
    expect(screen.getByRole('combobox')).toHaveValue(achiever.broker_name);
  });

  it.each([{ rows: [] }, { rows: [{ ...achiever, enabled: false }] }, { rows: [{ ...achiever, server_url: '' }] }])('blocks an empty or unusable directory without inventing a server (%j)', async ({ rows }) => {
    fetchMock.mockResolvedValue(json(rows));
    render(<WelcomeTerminal onLogin={vi.fn()} />);
    await screen.findByText('No available broker servers.');
    expect(loginButton()).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.queryAllByRole('option').every(option => (option as HTMLButtonElement).disabled)).toBe(true);
  });

  it('authenticates and hands off only the selected, verified broker and locks selection in flight', async () => {
    const login = pending<Record<string, unknown>>();
    runtime.login.mockReturnValue(login.promise);
    const onLogin = vi.fn();
    render(<WelcomeTerminal onLogin={onLogin} />);
    await waitFor(() => expect(loginButton()).toBeEnabled());
    selectBroker(gta.broker_name);
    await waitFor(() => expect(loginButton()).toBeEnabled());
    fillCredentials();
    submit();
    submit();
    await waitFor(() => expect(runtime.login).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(runtime.login).toHaveBeenCalledWith({ username: '12345', password: 'test-password', broker_id: gta.broker_id }, { baseUrl: `${gta.server_url}/api/v2`, skipDynamicUrl: true });
    await act(async () => login.resolve({ access_token: 'test-token', account_login: 12345, server_url: achiever.server_url }));
    expect(runtime.persist).toHaveBeenCalledWith(expect.objectContaining({ broker_id: gta.broker_id, server_url: gta.server_url, backend_url: gta.server_url, market_api_url: gta.server_url, ws_url: `${gta.server_url!.replace('https:', 'wss:')}/ws/v2`, feed_url: `${gta.server_url!.replace('https:', 'wss:')}/ws/feed` }));
    expect(onLogin).toHaveBeenCalledWith('12345', expect.objectContaining({ token: 'test-token' }));
  });

  it('keeps rejected credentials on the selected broker login screen', async () => {
    runtime.login.mockRejectedValue(new Error('Invalid credentials'));
    const onLogin = vi.fn();
    render(<WelcomeTerminal onLogin={onLogin} />);
    await waitFor(() => expect(loginButton()).toBeEnabled());
    fillCredentials();
    submit();
    await screen.findByText('Invalid credentials');
    expect(runtime.persist).not.toHaveBeenCalled();
    expect(onLogin).not.toHaveBeenCalled();
    expect(loginButton()).toBeEnabled();
  });

  it('requires choosing the search result before logging in to another broker', async () => {
    render(<WelcomeTerminal onLogin={vi.fn()} />);
    await waitFor(() => expect(loginButton()).toBeEnabled());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'MyProp' } });
    expect(loginButton()).toBeDisabled();
    submit();
    await screen.findByText('Select an available broker and wait for the server check before logging in.');
    expect(runtime.login).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    await waitFor(() => expect(loginButton()).toBeEnabled());
    expect(screen.getByRole('combobox')).toHaveValue('MyProp');
  });

  it('fetches a fresh directory on remount and checks a changed URL for the same broker', async () => {
    const first = render(<WelcomeTerminal onLogin={vi.fn()} />);
    await waitFor(() => expect(loginButton()).toBeEnabled());
    first.unmount();
    const nextUrl = 'https://new-broker.example';
    fetchMock.mockImplementation(async (url: string) => json(url.endsWith('/broker/servers') ? [{ ...achiever, server_url: nextUrl }] : { status: 'ok' }));
    render(<WelcomeTerminal onLogin={vi.fn()} />);
    await waitFor(() => expect(loginButton()).toBeEnabled());
    expect(fetchMock).toHaveBeenCalledWith(`${nextUrl}/health`, expect.anything());
  });

  it('keeps web broker selection locked to its configured deployment', async () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { BACKEND_TARGET: 'web', BROKER_ID: achiever.broker_id, API_HOST: achiever.server_url };
    render(<WelcomeTerminal onLogin={vi.fn()} />);
    await screen.findByText('Online');
    expect(screen.getByLabelText('Broker Server')).toHaveAttribute('readonly');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`${achiever.server_url}/api/v2/time`, expect.anything());
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TradeAuthDialog } from './TradeAuthDialog';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  persist: vi.fn(),
  loadDirectory: vi.fn(),
  webPolicy: vi.fn(),
  setToken: vi.fn(),
  setAuthTokens: vi.fn(),
  setAuthenticated: vi.fn(),
  addSavedAccount: vi.fn(),
  setActiveAccount: vi.fn(),
}));

vi.mock('../hooks/useUiTranslation', () => ({ useUiTranslation: () => (text: string) => text }));
vi.mock('../hooks/useBrokerLoginPolicy', () => ({ useBrokerLoginPolicy: mocks.webPolicy }));
vi.mock('../api/trade', () => ({ authV2Api: { login: mocks.login } }));
vi.mock('../api/demoRegistration', () => ({ registerRuntimeBrokerDemoAccount: vi.fn() }));
vi.mock('../api/client', () => ({
  setToken: mocks.setToken,
  setRefreshToken: vi.fn(),
  removeToken: vi.fn(),
  parseTokenExpiresAt: vi.fn(),
}));
vi.mock('../services/brokerSession', () => ({ persistBrokerSessionDiscovery: mocks.persist }));
vi.mock('../services/brokerDirectory', () => ({ loadAppBrokerDirectory: mocks.loadDirectory }));
vi.mock('../services/brokerPresentation', () => ({
  applyBrokerChrome: vi.fn(),
  loadBrokerPresentation: vi.fn().mockResolvedValue(null),
  mergeBrokerPresentation: (broker: unknown) => broker,
}));
vi.mock('../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({
      accountId: '200001',
      setAuthTokens: mocks.setAuthTokens,
      setAuthenticated: mocks.setAuthenticated,
      addSavedAccount: mocks.addSavedAccount,
      setActiveAccount: mocks.setActiveAccount,
    }),
  },
}));
vi.mock('../config/api', () => ({
  BROKER_DISCOVERY_URL: 'https://directory.test',
  normalizeBrokerServerUrl: (url: string) => url,
  toLocalDevProxyUrl: (url: string) => url,
  updateDynamicUrls: vi.fn(),
}));
vi.mock('../config/backendTarget.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../config/backendTarget.js')>(),
  isElectronRuntime: () => true,
  isDesktopBackendTarget: () => true,
  getBackendTarget: () => 'https://environment-broker.test',
  normalizeBrokerInfoForTarget: (broker: unknown) => broker,
  resolveBrokerBackendUrl: () => 'https://environment-broker.test',
  resolveBrokerExtApiUrl: () => 'https://environment-broker.test',
}));
vi.mock('./WelcomeTerminal', () => ({
  pickDiscoveryBroker: (rows: Array<{ broker_id: string }>, options: { savedBrokerId: string }) =>
    rows.find(row => row.broker_id === options.savedBrokerId) || rows[0],
}));

const brokers = [
  { broker_id: 'achiever', broker_name: 'Achiever Financials', server_url: 'https://achiever.test' },
  { broker_id: 'Nexa', broker_name: 'Nexa', server_url: 'https://nexa.test' },
];
const intent = { source: 'quick-trade', side: 'BUY', symbol: 'BTCUSD', volume: 0.1 } as const;
const fetchMock = vi.fn();

describe('desktop trading authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('broker_id', 'Nexa');
    mocks.webPolicy.mockReturnValue({
      status: 'error', brokerId: '', displayName: '', locked: true, local: false,
      error: 'The active broker session does not match this terminal deployment URL.',
    });
    mocks.loadDirectory.mockResolvedValue(brokers);
    // account_type: 'real' makes the login classifiable so isLive is set
    // (ba43e98c: typeless logins intentionally omit isLive/accountType).
    mocks.login.mockResolvedValue({ access_token: 'desktop-test-token', account_login: 200001, broker_id: 'achiever', account_type: 'real' });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'ok' })));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('electron', { window: {} });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('opens the server-selecting desktop login without evaluating the web deployment policy', async () => {
    render(<TradeAuthDialog isOpen intent={null} onClose={vi.fn()} onAuthenticated={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Log in to trade' })).toBeVisible();
    expect(screen.queryByText('Account required to trade')).not.toBeInTheDocument();
    expect(screen.queryByText(/terminal deployment URL/)).not.toBeInTheDocument();
    await screen.findByText('Server online');
    const server = screen.getByRole('combobox', { name: 'Server' });
    expect(server).toBeEnabled();
    expect(server).toHaveValue('Nexa');
    expect(screen.getByRole('option', { name: 'Achiever Financials' })).toBeEnabled();
    expect(screen.getByRole('option', { name: 'Nexa' })).toBeEnabled();
    expect(mocks.webPolicy).not.toHaveBeenCalled();
    expect(mocks.loadDirectory).toHaveBeenCalledWith({ forceRefresh: true, desktop: true });
  });

  it('authenticates with a different selected broker and reports completion to the pending trade owner', async () => {
    const onClose = vi.fn();
    const onAuthenticated = vi.fn();
    render(<TradeAuthDialog isOpen intent={intent} onClose={onClose} onAuthenticated={onAuthenticated} />);
    await screen.findByText('Server online');

    fireEvent.change(screen.getByRole('combobox', { name: 'Server' }), { target: { value: 'achiever' } });
    await screen.findByText('Server online');
    fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'test-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith('200001'));
    expect(mocks.login).toHaveBeenCalledWith(
      { username: '200001', password: 'test-password', broker_id: 'achiever' },
      { baseUrl: 'https://achiever.test/api/v2', skipDynamicUrl: true, persistSession: false },
    );
    expect(mocks.persist).toHaveBeenLastCalledWith(expect.objectContaining({
      broker_id: 'achiever', server_url: 'https://achiever.test', access_token: 'desktop-test-token',
    }), { notifySessionChange: false });
    expect(mocks.setAuthenticated).toHaveBeenCalledExactlyOnceWith(
      true, '200001', 'desktop-test-token', undefined, undefined,
      expect.objectContaining({ login: 200001, server: 'Achiever Financials', isLive: true }),
    );
    expect(mocks.setAuthTokens).not.toHaveBeenCalled();
    expect(mocks.addSavedAccount).not.toHaveBeenCalled();
    expect(mocks.setActiveAccount).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    expect(mocks.webPolicy).not.toHaveBeenCalled();
  });

  it('lets the user close desktop trade login without authenticating', async () => {
    const onClose = vi.fn();
    const onAuthenticated = vi.fn();
    render(<TradeAuthDialog isOpen intent={intent} onClose={onClose} onAuthenticated={onAuthenticated} />);
    await screen.findByText('Server online');

    expect(screen.getByText(/No order has been placed/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Continue viewing' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('does not load either broker flow while the authentication dialog is closed', () => {
    render(<TradeAuthDialog isOpen={false} intent={null} onClose={vi.fn()} onAuthenticated={vi.fn()} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.loadDirectory).not.toHaveBeenCalled();
    expect(mocks.webPolicy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

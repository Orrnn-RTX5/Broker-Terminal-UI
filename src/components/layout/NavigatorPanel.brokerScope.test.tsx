import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigatorPanel } from './NavigatorPanel';
import { SAVED_ACCOUNTS_STORAGE_KEY, useAppStore, type SavedAccount } from '../../store/useAppStore';
import { commitBrokerAccountSessionScope } from '../../services/brokerSession';

vi.mock('../../api/trade', () => ({
  brokerV2Api: {
    getServers: vi.fn().mockResolvedValue([]),
    getBrokers: vi.fn().mockResolvedValue({ brokers: [], count: 0 }),
  },
}));
vi.mock('../../services/api', () => ({ api: { auth: { logout: vi.fn() } } }));
vi.mock('../../services/brokerDirectory', () => ({
  getCachedBrokerDirectory: () => null,
  loadAppBrokerDirectory: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../startup/runAfterTerminalReady', () => ({ runAfterTerminalReady: () => () => undefined }));
vi.mock('../../startup/terminalFeatures', () => ({ openAccountFeature: { Component: () => null } }));
vi.mock('../ChangePasswordDialog', () => ({ ChangePasswordDialog: () => null }));
vi.mock('../LoginDialog', () => ({
  LoginDialog: ({ isOpen, initialLogin, initialServer }: {
    isOpen: boolean;
    initialLogin?: string;
    initialServer?: string;
  }) => isOpen ? <div role="dialog" aria-label="Account login">{initialLogin} {initialServer}</div> : null,
}));

type BrokerFixture = { id: string; name: string; server: string; url: string; backend?: string };

const brokerA: BrokerFixture = {
  id: 'Broker-A', name: 'Alpha Trading', server: 'Alpha-Live', url: 'https://alpha.example:8443/trading',
};
const brokerB: BrokerFixture = {
  id: 'Broker-B', name: 'Beta Trading', server: 'Beta-Live', url: 'https://beta.example:9443/trading',
};

const saved = (name: string, server: string, login = 200003, isFavorite = true): SavedAccount => ({
  login, name, server, isFavorite, isLive: true, lastUsed: 1,
});

const storeBroker = (broker: BrokerFixture) => {
  Object.entries({
    rtx_broker_server: broker.server,
    server_url: broker.url,
    backend_url: broker.backend ?? broker.url,
    broker_id: broker.id,
    rtx_broker_id: broker.id,
    broker_name: broker.name,
  }).forEach(([key, value]) => localStorage.setItem(key, value));
};

const authenticate = (broker: BrokerFixture, accounts: SavedAccount[]) => {
  storeBroker(broker);
  useAppStore.setState({
    isAuthenticated: true, accountId: '200003', authToken: 'shared-test-token', savedAccounts: accounts,
  });
  commitBrokerAccountSessionScope({
    authenticated: true, accountId: '200003', brokerId: broker.id, serverUrl: broker.url,
  });
};

const favorites = () => within(screen.getByRole('region', { name: 'Favorites' }));

describe('Navigator authenticated broker account visibility', () => {
  beforeEach(() => {
    delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;
    localStorage.clear();
    sessionStorage.clear();
    useAppStore.setState({ isAuthenticated: false, accountId: null, authToken: null, savedAccounts: [] });
    commitBrokerAccountSessionScope({ authenticated: false, accountId: null, brokerId: '', serverUrl: '' });
  });

  afterEach(() => {
    cleanup();
    useAppStore.setState({ isAuthenticated: false, accountId: null, authToken: null, savedAccounts: [] });
    commitBrokerAccountSessionScope({ authenticated: false, accountId: null, brokerId: '', serverUrl: '' });
    delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;
    localStorage.clear();
  });

  it('shows every account and only Favorites from the active broker while retaining all saved records', () => {
    const accounts = [
      saved('Alpha owner', brokerA.server),
      saved('Alpha second account', brokerA.server, 200004, false),
      saved('Alpha second favorite', brokerA.server, 200005),
      saved('Beta same login', brokerB.server),
      saved('Beta other account', brokerB.server, 200006, false),
    ];
    authenticate(brokerA, accounts);
    const persisted = localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY);

    render(<NavigatorPanel />);

    expect(screen.getByText('200003: Alpha owner')).toBeInTheDocument();
    expect(screen.getByText('200004: Alpha second account')).toBeInTheDocument();
    expect(screen.getByText('200005: Alpha second favorite')).toBeInTheDocument();
    expect(favorites().getByText(/Alpha owner/)).toBeInTheDocument();
    expect(favorites().getByText(/Alpha second favorite/)).toBeInTheDocument();
    expect(favorites().queryByText(/Alpha second account/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Beta same login/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Beta other account/)).not.toBeInTheDocument();
    expect(screen.queryByText(brokerB.server)).not.toBeInTheDocument();
    expect(useAppStore.getState().savedAccounts).toEqual(accounts);
    expect(localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY)).toBe(persisted);
    expect(JSON.parse(persisted!)).toEqual(accounts);
  });

  it('recognizes saved broker names, opaque IDs, and complete authenticated endpoint aliases', () => {
    const broker = { ...brokerA, backend: 'https://api.alpha.example:9443/execution' };
    const accounts = [
      saved('Server alias', broker.server),
      saved('Name alias', broker.name, 200004),
      saved('ID alias', broker.id, 200005),
      saved('URL alias', 'https://ALPHA.example:8443/trading/', 200006),
      saved('Backend alias', broker.backend, 200007),
      saved('Other broker', brokerB.name, 200008),
    ];
    authenticate(broker, accounts);

    render(<NavigatorPanel />);

    for (const account of accounts.slice(0, -1)) {
      expect(screen.getByText(`${account.login}: ${account.name}`)).toBeInTheDocument();
      expect(favorites().getByText(new RegExp(account.name))).toBeInTheDocument();
    }
    expect(screen.queryByText(/Other broker/)).not.toBeInTheDocument();
  });

  it('does not confuse servers sharing a host, endpoint prefix, broker prefix, or case-distinct opaque ID', () => {
    authenticate(brokerA, [
      saved('Allowed account', brokerA.server),
      saved('Different port', 'https://alpha.example:9443/trading', 200004),
      saved('Different path', 'https://alpha.example:8443/other', 200005),
      saved('Endpoint prefix', 'https://alpha.example:8443/trading-other', 200006),
      saved('Broker prefix', `${brokerA.id}-other`, 200007),
      saved('Case distinct ID', brokerA.id.toLowerCase(), 200008),
    ]);

    render(<NavigatorPanel />);

    expect(screen.getByText('200003: Allowed account')).toBeInTheDocument();
    for (const name of ['Different port', 'Different path', 'Endpoint prefix', 'Broker prefix', 'Case distinct ID']) {
      expect(screen.queryByText(new RegExp(name))).not.toBeInTheDocument();
    }
  });

  it('does not admit another broker through a stale market API URL', () => {
    authenticate(brokerA, [
      saved('Alpha account', brokerA.server),
      saved('Stale market broker', brokerB.url),
    ]);
    localStorage.setItem('market_api_url', brokerB.url);

    render(<NavigatorPanel />);

    expect(screen.getByText('200003: Alpha account')).toBeInTheDocument();
    expect(screen.queryByText(/Stale market broker/)).not.toBeInTheDocument();
    expect(localStorage.getItem('market_api_url')).toBe(brokerB.url);
  });

  it('updates Accounts and Favorites when the committed broker changes without any selected store value changing', () => {
    const accounts = [saved('Alpha owner', brokerA.server), saved('Beta owner', brokerB.server)];
    authenticate(brokerA, accounts);
    const stateBefore = useAppStore.getState();
    const persisted = localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY);
    render(<NavigatorPanel />);
    expect(screen.getByText('200003: Alpha owner')).toBeInTheDocument();
    expect(screen.queryByText(/Beta owner/)).not.toBeInTheDocument();

    act(() => {
      storeBroker(brokerB);
      commitBrokerAccountSessionScope({
        authenticated: true, accountId: '200003', brokerId: brokerB.id, serverUrl: brokerB.url,
      });
    });

    expect(screen.getByText('200003: Beta owner')).toBeInTheDocument();
    expect(favorites().getByText(/Beta owner/)).toBeInTheDocument();
    expect(screen.queryByText(/Alpha owner/)).not.toBeInTheDocument();
    const stateAfter = useAppStore.getState();
    expect(stateAfter.accountId).toBe(stateBefore.accountId);
    expect(stateAfter.authToken).toBe(stateBefore.authToken);
    expect(stateAfter.isAuthenticated).toBe(stateBefore.isAuthenticated);
    expect(stateAfter.savedAccounts).toBe(stateBefore.savedAccounts);
    expect(localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY)).toBe(persisted);
  });

  it('keeps committed broker accounts visible while another broker is only staged for login', () => {
    const accounts = [saved('Alpha owner', brokerA.name), saved('Beta owner', brokerB.name)];
    authenticate(brokerA, accounts);
    const { rerender } = render(<NavigatorPanel />);

    storeBroker(brokerB);
    rerender(<NavigatorPanel />);

    expect(screen.getByText('200003: Alpha owner')).toBeInTheDocument();
    expect(favorites().getByText(/Alpha owner/)).toBeInTheDocument();
    expect(screen.queryByText(/Beta owner/)).not.toBeInTheDocument();

    const updatedAccounts = [...accounts, saved('Alpha added account', brokerA.name, 200004)];
    act(() => {
      useAppStore.setState({ savedAccounts: updatedAccounts });
    });

    expect(screen.getByText('200003: Alpha owner')).toBeInTheDocument();
    expect(screen.getByText('200004: Alpha added account')).toBeInTheDocument();
    expect(favorites().getByText(/Alpha added account/)).toBeInTheDocument();
    expect(screen.queryByText(/Beta owner/)).not.toBeInTheDocument();
    expect(useAppStore.getState().savedAccounts).toEqual(updatedAccounts);
    expect(JSON.parse(localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY)!)).toEqual(updatedAccounts);
  });

  it('uses the committed broker on remount when stored login metadata already belongs to another broker', () => {
    const accounts = [
      saved('Alpha endpoint account', brokerA.url),
      saved('Alpha ID account', brokerA.id, 200004),
      saved('Beta server account', brokerB.server),
      saved('Beta name account', brokerB.name, 200005),
      saved('Beta endpoint account', brokerB.url, 200006),
    ];
    authenticate(brokerA, accounts);
    const persisted = localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY);
    const { unmount } = render(<NavigatorPanel />);
    unmount();

    storeBroker(brokerB);
    render(<NavigatorPanel />);

    expect(screen.getByText('200003: Alpha endpoint account')).toBeInTheDocument();
    expect(screen.getByText('200004: Alpha ID account')).toBeInTheDocument();
    expect(favorites().getByText(/Alpha endpoint account/)).toBeInTheDocument();
    expect(favorites().getByText(/Alpha ID account/)).toBeInTheDocument();
    expect(screen.queryByText(/Beta .* account/)).not.toBeInTheDocument();
    expect(useAppStore.getState().savedAccounts).toEqual(accounts);
    expect(localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY)).toBe(persisted);
  });

  it('shows empty Accounts and Favorites when every saved account belongs to another broker', () => {
    const accounts = [saved('Beta owner', brokerB.server), saved('Beta other account', brokerB.name, 200004)];
    authenticate(brokerA, accounts);
    const persisted = localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY);

    render(<NavigatorPanel />);

    expect(screen.getByText('Click to login...')).toBeInTheDocument();
    expect(favorites().getByText('No favorite accounts yet')).toBeInTheDocument();
    expect(screen.queryByText(/Beta owner/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Beta other account/)).not.toBeInTheDocument();
    expect(useAppStore.getState().savedAccounts).toEqual(accounts);
    expect(localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY)).toBe(persisted);
  });

  it.each([
    { description: 'accepts runtime aliases when the committed endpoint matches', port: 8443, showAliases: true },
    { description: 'rejects runtime aliases for the same broker ID on a different endpoint', port: 9443, showAliases: false },
  ])('$description', ({ port, showAliases }) => {
    const broker = { ...brokerA, url: 'https://alpha.example:8443' };
    const configuredUrl = `https://alpha.example:${port}`;
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = {
      CONFIG_SOURCE: 'deployment',
      API_HOST: configuredUrl,
      WS_HOST: configuredUrl.replace('https:', 'wss:'),
      BROKER_ID: broker.id,
      BROKER_NAME: 'Configured Alpha Trading',
      DEFAULT_MT5_SERVER: 'Configured-Alpha-Live',
      DISCOVERY_BASE_URL: 'https://directory.example',
    };
    const accounts = [
      saved('Committed endpoint account', broker.url),
      saved('Configured name account', 'Configured Alpha Trading', 200004),
      saved('Configured server account', 'Configured-Alpha-Live', 200005),
    ];
    authenticate(broker, accounts);
    const persisted = localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY);

    render(<NavigatorPanel />);

    expect(screen.getByText('200003: Committed endpoint account')).toBeInTheDocument();
    for (const account of accounts.slice(1)) {
      if (showAliases) {
        expect(screen.getByText(`${account.login}: ${account.name}`)).toBeInTheDocument();
        expect(favorites().getByText(new RegExp(account.name))).toBeInTheDocument();
      } else {
        expect(screen.queryByText(new RegExp(account.name))).not.toBeInTheDocument();
      }
    }
    expect(useAppStore.getState().savedAccounts).toEqual(accounts);
    expect(localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY)).toBe(persisted);
  });

  it('keeps saved Favorites available for interactive login after logout and hides the Accounts list', async () => {
    const accounts = [saved('Alpha owner', brokerA.server), saved('Beta owner', brokerB.server)];
    authenticate(brokerA, accounts);
    const persisted = localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY);
    render(<NavigatorPanel />);

    act(() => {
      useAppStore.getState().setAuthenticated(false);
    });

    expect(screen.getByText('Click to login...')).toBeInTheDocument();
    expect(screen.queryByText('200003: Alpha owner')).not.toBeInTheDocument();
    expect(screen.queryByText('200003: Beta owner')).not.toBeInTheDocument();
    expect(favorites().getByText(/Alpha owner/)).toBeInTheDocument();
    fireEvent.click(favorites().getByText(/Beta owner/));
    expect(await screen.findByRole('dialog', { name: 'Account login' })).toHaveTextContent('200003 Beta-Live');
    expect(useAppStore.getState().savedAccounts).toEqual(accounts);
    expect(localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY)).toBe(persisted);
  });
});

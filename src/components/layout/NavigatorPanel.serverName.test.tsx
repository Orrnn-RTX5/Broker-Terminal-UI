/**
 * Navigator Accounts: one group per broker, labelled with the server name the
 * broker publishes. Accounts saved under the build fallback DEFAULT_MT5_SERVER
 * are merged into the broker's real key once the broker config is available.
 *
 * Fixtures are neutral: no real broker, host or account literals.
 */
import React from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigatorPanel } from './NavigatorPanel';
import { useAppStore, type SavedAccount } from '../../store/useAppStore';
import { commitBrokerAccountSessionScope } from '../../services/brokerSession';
import { clearKnownBrokerServerName, recordBrokerServerIdentity } from '../../services/brokerServerIdentity';

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
vi.mock('../LoginDialog', () => ({ LoginDialog: () => null }));

type RuntimeWindow = Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };

const API_HOST = 'https://broker.example';
const BROKER_ID = 'example-broker';
const FALLBACK = 'local-dev';
const SERVER_NAME = 'Example Markets';

const saved = (login: number, name: string, server: string, extra: Partial<SavedAccount> = {}): SavedAccount => ({
  login, name, server, isFavorite: true, lastUsed: 1, ...extra,
});

describe('Navigator server groups', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    clearKnownBrokerServerName();
    (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = {
      CONFIG_SOURCE: 'build', BACKEND_TARGET: 'web', API_HOST, API_HOST_EXT: API_HOST,
      WS_HOST: 'wss://broker.example', BROKER_ID, BROKER_NAME: '', DEFAULT_MT5_SERVER: FALLBACK,
      DISCOVERY_BASE_URL: API_HOST,
    };
    Object.entries({
      rtx_broker_server: API_HOST,
      server_url: API_HOST,
      backend_url: API_HOST,
      broker_id: BROKER_ID,
      rtx_broker_id: BROKER_ID,
    }).forEach(([key, value]) => localStorage.setItem(key, value));
    useAppStore.setState({
      isAuthenticated: true,
      accountId: '200001',
      authToken: 'test-token',
      savedAccounts: [
        saved(200001, 'Owner', BROKER_ID, { brokerId: BROKER_ID, serverUrl: API_HOST }),
        saved(200002, 'Second', FALLBACK),
        saved(200001, 'Owner', FALLBACK, { isFavorite: false }),
      ],
    });
    commitBrokerAccountSessionScope({ authenticated: true, accountId: '200001', brokerId: BROKER_ID, serverUrl: API_HOST });
  });

  afterEach(() => {
    cleanup();
    clearKnownBrokerServerName();
    useAppStore.setState({ isAuthenticated: false, accountId: null, authToken: null, savedAccounts: [] });
    commitBrokerAccountSessionScope({ authenticated: false, accountId: null, brokerId: '', serverUrl: '' });
    delete (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__;
    localStorage.clear();
  });

  it('shows one group labelled with the broker server name and never the build fallback', () => {
    act(() => { recordBrokerServerIdentity({ server_name: SERVER_NAME }); });
    render(<NavigatorPanel />);

    expect(screen.getAllByText(SERVER_NAME)).toHaveLength(1);
    expect(screen.queryByText(FALLBACK)).not.toBeInTheDocument();
    expect(screen.queryByText(BROKER_ID)).not.toBeInTheDocument();
    expect(screen.getAllByText('200001: Owner').length).toBeGreaterThan(0);
    expect(screen.getAllByText('200002: Second').length).toBeGreaterThan(0);

    const saved = useAppStore.getState().savedAccounts;
    expect(saved.map(a => a.login).sort()).toEqual([200001, 200002]);
    expect(new Set(saved.map(a => a.server))).toEqual(new Set([BROKER_ID]));
    const favourites = within(screen.getByRole('region', { name: 'Favorites' }));
    expect(favourites.getByText(/Owner/)).toBeInTheDocument();
    expect(favourites.getByText(/Second/)).toBeInTheDocument();
  });

  it('keeps legacy accounts visible when they move to the broker server name key', () => {
    useAppStore.setState({
      savedAccounts: [
        saved(200001, 'Owner', FALLBACK),
        saved(200002, 'Second', FALLBACK, { isFavorite: false }),
      ],
    });
    render(<NavigatorPanel />);
    act(() => { recordBrokerServerIdentity({ server_name: SERVER_NAME }); });

    expect(new Set(useAppStore.getState().savedAccounts.map(a => a.server))).toEqual(new Set([SERVER_NAME]));
    expect(screen.getAllByText(SERVER_NAME)).toHaveLength(1);
    expect(screen.queryByText(FALLBACK)).not.toBeInTheDocument();
    expect(screen.getAllByText('200001: Owner').length).toBeGreaterThan(0);
    expect(screen.getByText('200002: Second')).toBeInTheDocument();
    const favourites = within(screen.getByRole('region', { name: 'Favorites' }));
    expect(favourites.getByText(/Owner/)).toBeInTheDocument();
  });

  it('merges as soon as the broker config arrives after the first render', () => {
    render(<NavigatorPanel />);
    act(() => { recordBrokerServerIdentity({ server_name: SERVER_NAME }); });

    expect(screen.getAllByText(SERVER_NAME)).toHaveLength(1);
    expect(screen.queryByText(FALLBACK)).not.toBeInTheDocument();
    expect(new Set(useAppStore.getState().savedAccounts.map(a => a.server))).toEqual(new Set([BROKER_ID]));
  });
});

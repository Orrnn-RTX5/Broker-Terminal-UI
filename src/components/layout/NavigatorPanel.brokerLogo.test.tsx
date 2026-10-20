import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigatorPanel } from './NavigatorPanel';
import { useAppStore, type SavedAccount } from '../../store/useAppStore';
import { commitBrokerAccountSessionScope } from '../../services/brokerSession';
import type { BrokerDiscoveryItem } from '../../services/brokerDiscovery';

const brokerApiMocks = vi.hoisted(() => ({ getServers: vi.fn(), getBrokers: vi.fn() }));
const directoryMocks = vi.hoisted(() => ({ getCachedBrokerDirectory: vi.fn(), loadAppBrokerDirectory: vi.fn() }));

vi.mock('../../api/trade', () => ({ brokerV2Api: brokerApiMocks }));
vi.mock('../../services/api', () => ({ api: { auth: { logout: vi.fn() } } }));
vi.mock('../../services/brokerDirectory', () => directoryMocks);
vi.mock('../../startup/runAfterTerminalReady', () => ({ runAfterTerminalReady: (task: () => void) => { task(); return () => undefined; } }));
vi.mock('../../startup/terminalFeatures', () => ({ openAccountFeature: { Component: () => null } }));
vi.mock('../ui/ContextMenu', () => ({ ContextMenu: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../LoginDialog', () => ({ LoginDialog: () => null }));
vi.mock('../ChangePasswordDialog', () => ({ ChangePasswordDialog: () => null }));

const nexa = { broker_id: 'Nexa', broker_name: 'Nexa', server_url: 'https://nexa.example' };
const alpha = { broker_id: 'Broker-A', broker_name: 'Alpha Trading', server_url: 'https://shared.example:8443/alpha' };
const beta = { broker_id: 'Broker-B', broker_name: 'Beta Trading', server_url: 'https://shared.example:8443/beta' };

function authenticate(broker = nexa, serverName = broker.broker_name, login = 200001) {
  localStorage.setItem('broker_id', broker.broker_id);
  localStorage.setItem('broker_name', broker.broker_name);
  localStorage.setItem('server_url', broker.server_url);
  localStorage.setItem('rtx_broker_server', serverName);
  const saved: SavedAccount = {
    login, name: 'Trader', server: serverName, brokerId: broker.broker_id, serverUrl: broker.server_url, lastUsed: 1,
  };
  useAppStore.setState({ isAuthenticated: true, accountId: String(login), savedAccounts: [saved] });
  commitBrokerAccountSessionScope({ authenticated: true, accountId: String(login), brokerId: broker.broker_id, serverUrl: broker.server_url });
}

describe('Navigator broker logo ownership', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useAppStore.setState({ isAuthenticated: false, accountId: null, savedAccounts: [] });
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = {
      CONFIG_SOURCE: 'deployment', API_HOST: nexa.server_url, WS_HOST: 'wss://nexa.example',
      BROKER_ID: nexa.broker_id, BROKER_NAME: nexa.broker_name, DEFAULT_MT5_SERVER: 'Nexa-Live',
      DISCOVERY_BASE_URL: 'https://directory.example',
    };
    brokerApiMocks.getServers.mockReset().mockResolvedValue([]);
    brokerApiMocks.getBrokers.mockReset().mockResolvedValue({ brokers: [], count: 0 });
    directoryMocks.getCachedBrokerDirectory.mockReset().mockReturnValue(null);
    directoryMocks.loadAppBrokerDirectory.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    useAppStore.setState({ isAuthenticated: false, accountId: null, savedAccounts: [] });
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
    delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;
    localStorage.clear();
  });

  it.each([nexa, alpha, beta])('renders the own directory logo for arbitrary broker $broker_id despite a different saved alias', async broker => {
    authenticate(broker, 'Trading account server');
    directoryMocks.getCachedBrokerDirectory.mockReturnValue([
      { ...nexa, logo_url: 'https://images.example/nexa.png' },
      { ...alpha, logo_url: 'https://images.example/alpha.png' },
      { ...beta, logo_url: 'https://images.example/beta.png' },
    ]);
    render(<NavigatorPanel />);
    const file = broker === nexa ? 'nexa' : broker === alpha ? 'alpha' : 'beta';
    expect(await screen.findByRole('img', { name: `${broker.broker_name} Logo` }))
      .toHaveAttribute('src', `https://images.example/${file}.png`);
  });

  it('honors deployment branding after login without exposing it to a different broker', async () => {
    const runtime = (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__!;
    runtime.BROKER_LOGO_URL = 'https://branding.example/nexa.png';
    authenticate();
    brokerApiMocks.getServers.mockResolvedValue([{ ...nexa, logo_url: 'https://broken.example/old.png' }]);
    const { rerender } = render(<NavigatorPanel />);
    expect(await screen.findByRole('img', { name: 'Nexa Logo' }))
      .toHaveAttribute('src', 'https://branding.example/nexa.png');
    await act(async () => {});
    expect(screen.getByRole('img', { name: 'Nexa Logo' }))
      .toHaveAttribute('src', 'https://branding.example/nexa.png');
    act(() => { authenticate(alpha); });
    rerender(<NavigatorPanel />);
    expect(document.querySelector('img[src="https://branding.example/nexa.png"]')).toBeNull();
    expect(await screen.findByRole('img', { name: 'Alpha Trading Logo' }))
      .toHaveAttribute('src', 'https://directory.example/api/v1/brokers/Broker-A/logo');
  });

  it('resolves the broker directory logo path against the discovery service', async () => {
    authenticate();
    brokerApiMocks.getServers.mockResolvedValue([{ ...nexa, server: 'Nexa-Live' }]);
    brokerApiMocks.getBrokers.mockResolvedValue({ brokers: [{ broker_id: 'Nexa', name: 'Nexa', logo_url: '/api/v1/brokers/Nexa/logo' }], count: 1 });
    render(<NavigatorPanel />);
    expect(await screen.findByRole('img', { name: 'Nexa Logo' }))
      .toHaveAttribute('src', 'https://directory.example/api/v1/brokers/Nexa/logo');
  });

  it('tries only the owning broker assets and uses a neutral server icon if they all fail', async () => {
    authenticate();
    brokerApiMocks.getServers.mockResolvedValue([{ ...nexa, logo_url: 'https://broken.example/nexa.png' }]);
    render(<NavigatorPanel />);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Nexa Logo' })).toHaveAttribute('src', 'https://broken.example/nexa.png'));
    fireEvent.error(screen.getByRole('img', { name: 'Nexa Logo' }));
    expect(screen.getByRole('img', { name: 'Nexa Logo' })).toHaveAttribute('src', 'https://directory.example/api/v1/brokers/Nexa/logo');
    fireEvent.error(screen.getByRole('img', { name: 'Nexa Logo' }));
    expect(screen.queryByRole('img', { name: /Logo/ })).not.toBeInTheDocument();
    expect(document.querySelector('img[src*="terminal-icon"]')).toBeNull();
  });

  it('renders the selected broker logo on the logged-out placeholder', async () => {
    localStorage.setItem('rtx_broker_server', nexa.server_url);
    localStorage.setItem('server_url', nexa.server_url);
    localStorage.setItem('broker_id', nexa.broker_id);
    render(<NavigatorPanel />);
    expect(await screen.findByRole('img', { name: 'Nexa Logo' }))
      .toHaveAttribute('src', 'https://directory.example/api/v1/brokers/Nexa/logo');
    expect(screen.getByText('Click to login...')).toBeInTheDocument();
  });

  it('retains the next candidate when an image fails before passive effects', async () => {
    authenticate();
    brokerApiMocks.getServers.mockResolvedValue([{ ...nexa, logo_url: 'https://broken.example/nexa.png' }]);
    let failedDuringCommit = false;
    render(<React.Profiler id="broker-logo" onRender={() => {
      const logo = screen.queryByRole('img', { name: 'Nexa Logo' });
      if (!failedDuringCommit && logo?.getAttribute('src') === 'https://broken.example/nexa.png') {
        failedDuringCommit = true;
        logo.dispatchEvent(new Event('error'));
      }
    }}><NavigatorPanel /></React.Profiler>);
    await waitFor(() => {
      expect(failedDuringCommit).toBe(true);
      expect(screen.getByRole('img', { name: 'Nexa Logo' })).toHaveAttribute('src', 'https://directory.example/api/v1/brokers/Nexa/logo');
    });
  });

  it('does not confuse same-host brokers, same-ID different endpoints, or case-distinct IDs', async () => {
    authenticate(alpha, 'Shared display name');
    directoryMocks.getCachedBrokerDirectory.mockReturnValue([
      { ...beta, logo_url: 'https://wrong.example/beta.png' },
      { ...alpha, server_url: 'https://shared.example:9443/alpha', logo_url: 'https://wrong.example/port.png' },
      { ...alpha, server_url: beta.server_url, logo_url: 'https://wrong.example/path.png' },
      { ...alpha, broker_id: 'broker-a', logo_url: 'https://wrong.example/case.png' },
      { ...alpha, logo_url: '/assets/alpha.png' },
    ]);
    render(<NavigatorPanel />);
    expect(await screen.findByRole('img', { name: 'Alpha Trading Logo' })).toHaveAttribute('src', 'https://shared.example:8443/assets/alpha.png');
  });

  it('does not use staged storage metadata for an unmatched authenticated broker', async () => {
    authenticate(alpha);
    localStorage.setItem('broker_id', beta.broker_id);
    localStorage.setItem('server_url', beta.server_url);
    localStorage.setItem('logo_url', 'https://wrong.example/beta.png');
    directoryMocks.getCachedBrokerDirectory.mockReturnValue([{ ...beta, logo_url: 'https://wrong.example/beta.png' }]);
    render(<NavigatorPanel />);
    expect(await screen.findByRole('img', { name: /Logo/ })).toHaveAttribute('src', 'https://directory.example/api/v1/brokers/Broker-A/logo');
    expect(document.querySelector('img[src*="wrong.example"]')).toBeNull();
  });

  it('clears old logos immediately and ignores late responses across a same-label, same-login broker switch', async () => {
    authenticate(alpha, 'Shared server');
    let resolveOld!: (value: BrokerDiscoveryItem[]) => void;
    brokerApiMocks.getServers.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce([{ ...beta, logo_url: 'https://images.example/beta.png' }]);
    directoryMocks.getCachedBrokerDirectory.mockReturnValue([{ ...alpha, logo_url: 'https://images.example/alpha.png' }]);
    const { rerender } = render(<NavigatorPanel />);
    expect(screen.getByRole('img', { name: 'Alpha Trading Logo' })).toHaveAttribute('src', 'https://images.example/alpha.png');
    act(() => { authenticate(beta, 'Shared server'); });
    rerender(<NavigatorPanel />);
    expect(document.querySelector('img[src="https://images.example/alpha.png"]')).toBeNull();
    await waitFor(() => expect(screen.getByRole('img', { name: 'Beta Trading Logo' })).toHaveAttribute('src', 'https://images.example/beta.png'));
    await act(async () => { resolveOld([{ ...alpha, logo_url: 'https://late.example/alpha.png' }]); });
    expect(screen.getByRole('img', { name: 'Beta Trading Logo' })).toHaveAttribute('src', 'https://images.example/beta.png');
    expect(document.querySelector('img[src*="late.example"]')).toBeNull();
  });
});

import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigatorPanel } from './NavigatorPanel';
import { rememberAccountSession, useAppStore, type SavedAccount } from '../../store/useAppStore';
import { clearCachedAccountSessions } from '../../services/accountSessionCache';
import { commitBrokerAccountSessionScope } from '../../services/brokerSession';

const tradeMocks = vi.hoisted(() => ({
  login: vi.fn(),
}));

vi.mock('../../api/trade', () => ({
  brokerV2Api: { getServers: vi.fn(), getBrokers: vi.fn() },
  authV2Api: { login: tradeMocks.login },
}));
vi.mock('../../services/api', () => ({ api: { auth: { logout: vi.fn() } } }));
vi.mock('../../services/brokerDirectory', () => ({ getCachedBrokerDirectory: () => null, loadAppBrokerDirectory: vi.fn() }));
vi.mock('../../startup/runAfterTerminalReady', () => ({ runAfterTerminalReady: () => () => undefined }));
vi.mock('../../startup/terminalFeatures', () => ({ openAccountFeature: { Component: () => null } }));
vi.mock('../ui/ContextMenu', () => ({ ContextMenu: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../LoginDialog', () => ({
  LoginDialog: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div role="dialog" aria-label="Account login" /> : null),
}));
vi.mock('../ChangePasswordDialog', () => ({ ChangePasswordDialog: () => null }));

const css = readFileSync(resolve(process.cwd(), 'src/components/layout/NavigatorPanel.css'), 'utf8');

describe('Navigator account type icons', () => {
  beforeEach(() => {
    tradeMocks.login.mockReset();
    clearCachedAccountSessions();
    localStorage.clear();
    sessionStorage.clear();
    useAppStore.setState({ isAuthenticated: false, accountId: null, savedAccounts: [] });
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
  });

  afterEach(() => {
    cleanup();
    delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, string> }).__RTX_RUNTIME_CONFIG__;
    document.documentElement.classList.remove('rtx-skin-untitled-light');
    clearCachedAccountSessions();
    useAppStore.setState({ isAuthenticated: false, accountId: null, savedAccounts: [] });
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
    localStorage.clear();
    sessionStorage.clear();
  });

  it.each(['Alpha', 'Beta'])('uses each %s account type in both Accounts and Favorites, independent of sibling or active account', brokerId => {
    const serverUrl = `https://${brokerId.toLowerCase()}.example`;
    localStorage.setItem('broker_id', brokerId);
    localStorage.setItem('server_url', serverUrl);
    localStorage.setItem('rtx_broker_server', 'Shared server');
    const accounts: SavedAccount[] = (['demo', 'real', 'contest'] as const).map((accountType, index) => ({
      login: 200001 + index, name: `${accountType} owner`, server: 'Shared server', brokerId, serverUrl,
      accountType, isLive: true, isFavorite: true, lastUsed: 1,
    }));
    useAppStore.setState({ isAuthenticated: true, accountId: '200002', savedAccounts: accounts });
    commitBrokerAccountSessionScope({ authenticated: true, accountId: '200002', brokerId, serverUrl });
    render(<NavigatorPanel />);

    const favorites = within(screen.getByRole('region', { name: 'Favorites' }));
    for (const [index, type] of ['demo', 'real', 'contest'].entries()) {
      const label = `${type[0].toUpperCase()}${type.slice(1)} account`;
      expect(screen.getAllByRole('img', { name: label })).toHaveLength(2);
      const row = screen.getByText(`${200001 + index}: ${type} owner`).closest('.navigator-tree-item__row')!;
      const icon = within(row as HTMLElement).getByRole('img', { name: label });
      expect(icon).toHaveAttribute('data-account-type', type);
      expect(icon).toHaveAttribute('data-active', String(type === 'real'));
      expect(icon.querySelector('circle')).toHaveAttribute('fill', 'currentColor');
      expect(favorites.getByRole('img', { name: label })).toHaveAttribute('data-account-type', type);
    }
  });

  it('renders demo bookmarks as green Demo account icons and real bookmarks as yellow Real account icons', () => {
    const brokerId = 'Unknown-type-broker';
    const serverUrl = 'https://unknown.example';
    useAppStore.setState({ isAuthenticated: true, accountId: '200001', savedAccounts: [
      { login: 200002, name: 'Real Trader', server: 'Server', brokerId, serverUrl, isLive: true, isFavorite: true, lastUsed: 1 },
      { login: 200003, name: 'demo acc1', server: 'Server', brokerId, serverUrl, isLive: true, isFavorite: true, lastUsed: 2 },
    ] });
    commitBrokerAccountSessionScope({ authenticated: true, accountId: '200001', brokerId, serverUrl });
    render(<NavigatorPanel />);
    const realIcons = screen.getAllByRole('img', { name: 'Real account' });
    const demoIcons = screen.getAllByRole('img', { name: 'Demo account' });
    expect(realIcons).toHaveLength(3);
    expect(demoIcons).toHaveLength(2);
    for (const icon of realIcons) expect(icon).toHaveAttribute('data-account-type', 'real');
    for (const icon of demoIcons) expect(icon).toHaveAttribute('data-account-type', 'demo');
  });

  it.each([
    ['dark', '.navigator-panel', '#4ade80', '#facc15', '#60a5fa'],
    ['light', 'html.rtx-skin-untitled-light .navigator-panel', '#15803d', '#a16207', '#2563eb'],
  ])('keeps green Demo, yellow Real, and blue Contest colors in the %s theme', (_theme, selector, demo, real, contest) => {
    const block = css.slice(css.indexOf(`${selector} {`)).split('}')[0];
    expect(block).toContain(`--navigator-account-demo: ${demo};`);
    expect(block).toContain(`--navigator-account-real: ${real};`);
    expect(block).toContain(`--navigator-account-contest: ${contest};`);
    for (const type of ['demo', 'real', 'contest']) {
      expect(css).toContain(`[data-account-type="${type}"] { color: var(--navigator-account-${type}); }`);
    }
    expect(css).toContain('[data-active="true"] { opacity: 1; }');
  });

  it('groups demo-created and credential-login accounts under one broker node and styles non-connected accounts in grey', () => {
    const brokerId = 'alpha-broker';
    const serverUrl = 'https://alpha.example';
    localStorage.setItem('broker_id', brokerId);
    localStorage.setItem('broker_name', 'Alpha');
    localStorage.setItem('server_url', serverUrl);
    useAppStore.setState({
      isAuthenticated: true,
      accountId: '200003',
      savedAccounts: [
        { login: 200003, name: 'demo acc1', server: 'Alpha', brokerId, serverUrl, accountType: 'demo', isLive: false, lastUsed: 2 },
        { login: 200091, name: 'Demo Trader', server: 'alpha-broker', brokerId, serverUrl, accountType: 'demo', isLive: false, lastUsed: 1 },
      ],
    });
    commitBrokerAccountSessionScope({ authenticated: true, accountId: '200003', brokerId, serverUrl });
    render(<NavigatorPanel />);

    expect(screen.getAllByText('Alpha')).toHaveLength(1);
    const activeLabel = screen.getByText('200003: demo acc1');
    const inactiveLabel = screen.getByText('200091: Demo Trader');
    const activeRow = activeLabel.closest('.navigator-tree-item__row')!;
    const inactiveRow = inactiveLabel.closest('.navigator-tree-item__row')!;
    expect(activeRow).toHaveAttribute('data-account-active', 'true');
    expect(inactiveRow).toHaveAttribute('data-account-active', 'false');
    expect(activeLabel).toHaveAttribute('data-account-active', 'true');
    expect(inactiveLabel).toHaveAttribute('data-account-active', 'false');
    expect(inactiveLabel).toHaveClass('navigator-tree-item__label--inactive');
    expect(within(activeRow as HTMLElement).getByRole('img', { name: 'Demo account' })).toHaveAttribute('data-active', 'true');
    expect(within(inactiveRow as HTMLElement).getByRole('img', { name: 'Demo account' })).toHaveAttribute('data-active', 'false');
    expect(css).toContain('.navigator-panel .navigator-account-icon[data-active="false"]');
    expect(css).toContain('color: var(--navigator-account-inactive, #71717a) !important;');
    expect(css).toContain('.navigator-panel .navigator-tree-item__row[data-account-active="false"] .navigator-tree-item__label');
    expect(css).toContain('color: var(--navigator-account-inactive-text, #71717a) !important;');

    const indexCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    const enterpriseLightCss = readFileSync(resolve(process.cwd(), 'src/styles/enterprise-light.css'), 'utf8');
    expect(indexCss).toContain('.navigator-tree-item__row:not([data-account-active="false"]):not([aria-disabled="true"]) .navigator-tree-item__label');
    expect(indexCss).toContain('.navigator-tree-item__row[data-account-active="false"] .navigator-tree-item__label');
    expect(enterpriseLightCss).toContain('.navigator-tree-item__row:not([data-account-active="false"]):not([aria-disabled="true"]) .navigator-tree-item__label');
    expect(enterpriseLightCss).toContain('.navigator-tree-item__row[data-account-active="false"] .navigator-tree-item__label');
  });

  it('switches between authenticated demo and real accounts on double-click without requiring login again', () => {
    const brokerId = 'alpha-broker';
    const serverUrl = 'https://alpha.example';
    localStorage.setItem('broker_id', brokerId);
    localStorage.setItem('broker_name', 'Alpha');
    localStorage.setItem('server_url', serverUrl);
    localStorage.setItem('rtx_broker_server', 'Alpha');

    useAppStore.getState().setAuthenticated(true, '200003', 'token-demo-200003', 'refresh-200003', Date.now() + 3600_000, {
      login: 200003,
      name: 'Demo Trader',
      server: 'Alpha',
      brokerId,
      serverUrl,
      accountType: 'demo',
      isLive: false,
      lastUsed: 1,
    });
    useAppStore.getState().setAuthenticated(true, '200091', 'token-real-200091', 'refresh-200091', Date.now() + 3600_000, {
      login: 200091,
      name: 'Real Trader',
      server: 'Alpha',
      brokerId,
      serverUrl,
      accountType: 'real',
      isLive: true,
      lastUsed: 2,
    });

    render(<NavigatorPanel />);

    const demoRow = screen.getByText('200003: Demo Trader').closest('.navigator-tree-item__row')!;
    const realRow = screen.getByText('200091: Real Trader').closest('.navigator-tree-item__row')!;
    expect(demoRow).toHaveAttribute('data-account-active', 'false');
    expect(realRow).toHaveAttribute('data-account-active', 'true');

    fireEvent.doubleClick(demoRow);
    expect(useAppStore.getState().accountId).toBe('200003');
    expect(useAppStore.getState().authToken).toBe('token-demo-200003');
    expect(screen.getByText('200003: Demo Trader').closest('.navigator-tree-item__row')).toHaveAttribute('data-account-active', 'true');
    expect(screen.getByText('200091: Real Trader').closest('.navigator-tree-item__row')).toHaveAttribute('data-account-active', 'false');

    fireEvent.doubleClick(screen.getByText('200091: Real Trader').closest('.navigator-tree-item__row')!);
    expect(useAppStore.getState().accountId).toBe('200091');
    expect(useAppStore.getState().authToken).toBe('token-real-200091');
    expect(screen.getByText('200091: Real Trader').closest('.navigator-tree-item__row')).toHaveAttribute('data-account-active', 'true');
    expect(screen.getByText('200003: Demo Trader').closest('.navigator-tree-item__row')).toHaveAttribute('data-account-active', 'false');
    expect(screen.queryByRole('dialog', { name: 'Account login' })).not.toBeInTheDocument();
  });

  it.each(['alpha-broker', 'beta-broker'])(
    'supports 10 accounts on %s where switching from account 1 to account 10 enables 10 and disables 1..9 in grey without login dialog',
    brokerId => {
      const brokerLabel = `${brokerId.toUpperCase()} Server`;
      const serverUrl = `https://${brokerId}.example`;
      localStorage.setItem('broker_id', brokerId);
      localStorage.setItem('broker_name', brokerLabel);
      localStorage.setItem('server_url', serverUrl);
      localStorage.setItem('rtx_broker_server', brokerLabel);

      const logins = Array.from({ length: 10 }, (_, idx) => 300001 + idx);
      for (const [idx, login] of logins.entries()) {
        const isReal = idx % 2 === 0;
        useAppStore.getState().setAuthenticated(
          true,
          String(login),
          `token-${brokerId}-${login}`,
          `refresh-${brokerId}-${login}`,
          Date.now() + 3600_000,
          {
            login,
            name: `Account ${idx + 1}`,
            server: brokerLabel,
            brokerId,
            serverUrl,
            accountType: isReal ? 'real' : 'demo',
            isLive: isReal,
            lastUsed: idx + 1,
          },
        );
      }

      // Connect to Account 1 initially
      const firstLogin = logins[0];
      useAppStore.getState().setAuthenticated(
        true,
        String(firstLogin),
        `token-${brokerId}-${firstLogin}`,
        `refresh-${brokerId}-${firstLogin}`,
        Date.now() + 3600_000,
      );

      render(<NavigatorPanel />);

      const getRow = (idx: number) =>
        screen.getByText(`${logins[idx]}: Account ${idx + 1}`).closest('.navigator-tree-item__row') as HTMLElement;

      // Initially Account 1 is active, Accounts 2..10 are visible and disabled in grey
      for (let i = 0; i < 10; i++) {
        const row = getRow(i);
        const expectedActive = i === 0 ? 'true' : 'false';
        expect(row).toHaveAttribute('data-account-active', expectedActive);
        expect(within(row).getByRole('img')).toHaveAttribute('data-active', expectedActive);
      }

      // Single-clicking Account 10 must NOT switch or open the login dialog
      fireEvent.click(getRow(9));
      expect(useAppStore.getState().accountId).toBe(String(firstLogin));
      expect(screen.queryByRole('dialog', { name: 'Account login' })).not.toBeInTheDocument();

      // Double-clicking Account 10 connects Account 10 and disables Accounts 1..9 in grey
      fireEvent.doubleClick(getRow(9));
      const tenthLogin = logins[9];
      expect(useAppStore.getState().accountId).toBe(String(tenthLogin));
      expect(useAppStore.getState().authToken).toBe(`token-${brokerId}-${tenthLogin}`);
      expect(screen.queryByRole('dialog', { name: 'Account login' })).not.toBeInTheDocument();

      for (let i = 0; i < 10; i++) {
        const row = getRow(i);
        const expectedActive = i === 9 ? 'true' : 'false';
        expect(row).toHaveAttribute('data-account-active', expectedActive);
        expect(within(row).getByRole('img')).toHaveAttribute('data-active', expectedActive);
      }

      // Double-clicking Account 1 switches back to Account 1 and disables Accounts 2..10 in grey
      fireEvent.doubleClick(getRow(0));
      expect(useAppStore.getState().accountId).toBe(String(firstLogin));
      expect(useAppStore.getState().authToken).toBe(`token-${brokerId}-${firstLogin}`);
      expect(screen.queryByRole('dialog', { name: 'Account login' })).not.toBeInTheDocument();

      for (let i = 0; i < 10; i++) {
        const row = getRow(i);
        const expectedActive = i === 0 ? 'true' : 'false';
        expect(row).toHaveAttribute('data-account-active', expectedActive);
        expect(within(row).getByRole('img')).toHaveAttribute('data-active', expectedActive);
      }
    },
  );

  it('connects a newly created demo account on double-click using remembered credentials without opening the login screen', async () => {
    const brokerId = 'alpha-broker';
    const serverUrl = 'https://alpha.example';
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, string> }).__RTX_RUNTIME_CONFIG__ = {
      CONFIG_SOURCE: 'deployment',
      BACKEND_TARGET: 'web',
      BROKER_ID: brokerId,
      API_HOST: serverUrl,
      API_HOST_EXT: serverUrl,
      WS_HOST: 'wss://alpha.example',
      DEFAULT_MT5_SERVER: 'Alpha',
      DISCOVERY_BASE_URL: 'https://directory.example',
    };
    localStorage.setItem('broker_id', brokerId);
    localStorage.setItem('broker_name', 'Alpha');
    localStorage.setItem('server_url', serverUrl);
    localStorage.setItem('rtx_broker_server', 'Alpha');

    // User logged in with a Real account
    useAppStore.getState().setAuthenticated(true, '200091', 'token-real-200091', 'refresh-200091', Date.now() + 3600_000, {
      login: 200091,
      name: 'Real Trader',
      server: 'Alpha',
      brokerId,
      serverUrl,
      accountType: 'real',
      isLive: true,
      lastUsed: 2,
    });

    // User created a Demo account (saved in savedAccounts + password remembered in session cache, no JWT yet)
    rememberAccountSession({
      brokerId,
      serverUrl,
      login: 400001,
      password: 'Demo-Master-Pass-1',
    });
    useAppStore.getState().addSavedAccount({
      login: 400001,
      name: 'New Demo',
      server: 'Alpha',
      brokerId,
      serverUrl,
      accountType: 'demo',
      isLive: false,
      lastUsed: 3,
    });

    tradeMocks.login.mockResolvedValue({
      access_token: 'issued-demo-token-400001',
      refresh_token: 'issued-demo-refresh-400001',
      expires_at: Math.floor((Date.now() + 3600_000) / 1000),
      account_login: 400001,
      broker_id: brokerId,
      user: { username: 'New Demo', account_type: 'demo' },
    });

    render(<NavigatorPanel />);

    const realRow = screen.getByText('200091: Real Trader').closest('.navigator-tree-item__row')!;
    const demoRow = screen.getByText('400001: New Demo').closest('.navigator-tree-item__row')!;
    expect(realRow).toHaveAttribute('data-account-active', 'true');
    expect(demoRow).toHaveAttribute('data-account-active', 'false');

    fireEvent.doubleClick(demoRow);

    await waitFor(() => expect(useAppStore.getState().accountId).toBe('400001'));
    expect(tradeMocks.login).toHaveBeenCalledOnce();
    expect(useAppStore.getState().authToken).toBe('issued-demo-token-400001');
    expect(screen.queryByRole('dialog', { name: 'Account login' })).not.toBeInTheDocument();
    expect(screen.getByText('400001: New Demo').closest('.navigator-tree-item__row')).toHaveAttribute('data-account-active', 'true');
    expect(screen.getByText('200091: Real Trader').closest('.navigator-tree-item__row')).toHaveAttribute('data-account-active', 'false');

    // Double-clicking Real account switches back immediately using cached session without calling login API or opening dialog
    fireEvent.doubleClick(screen.getByText('200091: Real Trader').closest('.navigator-tree-item__row')!);
    expect(useAppStore.getState().accountId).toBe('200091');
    expect(useAppStore.getState().authToken).toBe('token-real-200091');
    expect(tradeMocks.login).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Account login' })).not.toBeInTheDocument();
    expect(screen.getByText('200091: Real Trader').closest('.navigator-tree-item__row')).toHaveAttribute('data-account-active', 'true');
    expect(screen.getByText('400001: New Demo').closest('.navigator-tree-item__row')).toHaveAttribute('data-account-active', 'false');
  });

  it('refreshes an unverified cached token via remembered password on double-click instead of reusing a stale token that triggers 401 logout', async () => {
    const brokerId = 'alpha-broker';
    const serverUrl = 'https://alpha.example';
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, string> }).__RTX_RUNTIME_CONFIG__ = {
      CONFIG_SOURCE: 'deployment',
      BACKEND_TARGET: 'web',
      BROKER_ID: brokerId,
      API_HOST: serverUrl,
      API_HOST_EXT: serverUrl,
      WS_HOST: 'wss://alpha.example',
      DEFAULT_MT5_SERVER: 'Alpha',
      DISCOVERY_BASE_URL: 'https://directory.example',
    };
    localStorage.setItem('broker_id', brokerId);
    localStorage.setItem('broker_name', 'Alpha');
    localStorage.setItem('server_url', serverUrl);
    localStorage.setItem('rtx_broker_server', 'Alpha');

    // Account 200091 has a stale token without expiresAt, plus a remembered password (surviving across reloads via localStorage)
    rememberAccountSession({
      brokerId,
      serverUrl,
      login: 200091,
      authToken: 'stale-token-200091',
      password: 'DemoPassword123',
    });
    sessionStorage.clear(); // Simulate browser tab reload clearing sessionStorage

    useAppStore.getState().addSavedAccount({
      login: 200091,
      name: 'Demo Trader',
      server: 'Alpha',
      brokerId,
      serverUrl,
      accountType: 'demo',
      isLive: false,
      lastUsed: 1,
    });

    // Account 200003 is currently connected
    useAppStore.getState().setAuthenticated(true, '200003', 'valid-token-200003', 'refresh-200003', Date.now() + 3600_000, {
      login: 200003,
      name: 'Real Trader',
      server: 'Alpha',
      brokerId,
      serverUrl,
      accountType: 'real',
      isLive: true,
      lastUsed: 2,
    });

    tradeMocks.login.mockResolvedValue({
      access_token: 'fresh-token-200091',
      expires_in: 3600,
      account_login: 200091,
      broker_id: brokerId,
      user: { username: 'Demo Trader', account_type: 'demo' },
    });

    render(<NavigatorPanel />);

    const demoRow = screen.getByText('200091: Demo Trader').closest('.navigator-tree-item__row')!;
    const realRow = screen.getByText('200003: Real Trader').closest('.navigator-tree-item__row')!;
    expect(demoRow).toHaveAttribute('data-account-active', 'false');
    expect(realRow).toHaveAttribute('data-account-active', 'true');

    fireEvent.doubleClick(demoRow);

    await waitFor(() => expect(useAppStore.getState().accountId).toBe('200091'));
    expect(tradeMocks.login).toHaveBeenCalledWith(
      { username: '200091', password: 'DemoPassword123', broker_id: brokerId },
      expect.objectContaining({ persistSession: false }),
    );
    expect(useAppStore.getState().isAuthenticated).toBe(true);
    expect(useAppStore.getState().authToken).toBe('fresh-token-200091');
    expect(screen.queryByRole('dialog', { name: 'Account login' })).not.toBeInTheDocument();
    expect(screen.getByText('200091: Demo Trader').closest('.navigator-tree-item__row')).toHaveAttribute('data-account-active', 'true');
    expect(screen.getByText('200003: Real Trader').closest('.navigator-tree-item__row')).toHaveAttribute('data-account-active', 'false');
  });
});

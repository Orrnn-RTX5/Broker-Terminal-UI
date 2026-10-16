import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigatorPanel } from './NavigatorPanel';
import { useAppStore, type SavedAccount } from '../../store/useAppStore';
import { commitBrokerAccountSessionScope } from '../../services/brokerSession';

vi.mock('../../api/trade', () => ({ brokerV2Api: { getServers: vi.fn(), getBrokers: vi.fn() } }));
vi.mock('../../services/api', () => ({ api: { auth: { logout: vi.fn() } } }));
vi.mock('../../services/brokerDirectory', () => ({ getCachedBrokerDirectory: () => null, loadAppBrokerDirectory: vi.fn() }));
vi.mock('../../startup/runAfterTerminalReady', () => ({ runAfterTerminalReady: () => () => undefined }));
vi.mock('../../startup/terminalFeatures', () => ({ openAccountFeature: { Component: () => null } }));
vi.mock('../ui/ContextMenu', () => ({ ContextMenu: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../LoginDialog', () => ({ LoginDialog: () => null }));
vi.mock('../ChangePasswordDialog', () => ({ ChangePasswordDialog: () => null }));

const css = readFileSync(resolve(process.cwd(), 'src/components/layout/NavigatorPanel.css'), 'utf8');

describe('Navigator account type icons', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({ isAuthenticated: false, accountId: null, savedAccounts: [] });
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
  });

  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove('rtx-skin-untitled-light');
    useAppStore.setState({ isAuthenticated: false, accountId: null, savedAccounts: [] });
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
    localStorage.clear();
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
});

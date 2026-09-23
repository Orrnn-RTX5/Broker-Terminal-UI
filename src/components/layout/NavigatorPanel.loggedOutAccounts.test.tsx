import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigatorPanel } from './NavigatorPanel';

const brokerApiMocks = vi.hoisted(() => ({
  getServers: vi.fn(),
  getBrokers: vi.fn(),
}));

const storeState = vi.hoisted(() => ({
  accountId: '',
  savedAccounts: [] as Array<{
    login: number;
    name: string;
    server: string;
    isLive: boolean;
    lastUsed: number;
  }>,
  removeSavedAccount: vi.fn(),
  addSavedAccount: vi.fn(),
  isAuthenticated: false,
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: (selector: (store: typeof storeState) => unknown) => selector(storeState),
}));

vi.mock('../../api/trade', () => ({
  brokerV2Api: brokerApiMocks,
}));

vi.mock('../../services/api', () => ({
  api: { auth: { logout: vi.fn() } },
}));

vi.mock('../../services/brokerServers', () => ({
  getStoredBrokerServer: () => 'https://test-broker.example',
}));

vi.mock('../ui/ContextMenu', () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../LoginDialog', () => ({ LoginDialog: () => null }));
vi.mock('../ChangePasswordDialog', () => ({ ChangePasswordDialog: () => null }));

describe('Navigator accounts across the session boundary', () => {
  beforeEach(() => {
    brokerApiMocks.getServers.mockReset().mockResolvedValue([]);
    brokerApiMocks.getBrokers.mockReset().mockResolvedValue({ brokers: [], count: 0 });
    storeState.savedAccounts = [
      { login: 200001, name: 'demo demo', server: 'https://test-broker.example', isLive: false, lastUsed: 1 },
    ];
  });

  it('lists the saved account while its session is authenticated', async () => {
    storeState.isAuthenticated = true;
    storeState.accountId = '200001';

    render(<NavigatorPanel />);

    expect(await screen.findByText('200001: demo demo')).toBeInTheDocument();
    expect(screen.queryByText('Click to login...')).not.toBeInTheDocument();
  });

  it('returns to the logged-out placeholder after logout even though savedAccounts persist', async () => {
    storeState.isAuthenticated = false;
    storeState.accountId = '';

    render(<NavigatorPanel />);

    expect(await screen.findByText('Click to login...')).toBeInTheDocument();
    expect(screen.queryByText('200001: demo demo')).not.toBeInTheDocument();
    expect(screen.queryByText(/demo demo/)).not.toBeInTheDocument();
  });
});

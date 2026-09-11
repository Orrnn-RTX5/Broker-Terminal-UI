import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigatorPanel } from './NavigatorPanel';

const brokerApiMocks = vi.hoisted(() => ({
  getServers: vi.fn(),
  getBrokers: vi.fn(),
}));

vi.mock('../../store/useAppStore', () => {
  const state = {
    accountId: '',
    savedAccounts: [],
    removeSavedAccount: vi.fn(),
    addSavedAccount: vi.fn(),
    isAuthenticated: false,
  };

  return {
    useAppStore: (selector: (store: typeof state) => unknown) => selector(state),
  };
});

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

const lockedSections = [
  { label: 'Indicators', child: 'Trend' },
  { label: 'Automated Strategies', child: 'Macd Sample' },
  { label: 'Scripts', child: 'CloseAllPositions' },
  { label: 'Services', child: 'Market' },
] as const;

const getTreeRow = (label: string): HTMLElement => {
  const row = screen
    .getByText(label, { selector: '.navigator-tree-item__label' })
    .closest('.navigator-tree-item__row');

  expect(row).not.toBeNull();
  return row as HTMLElement;
};

describe('Navigator locked placeholder sections', () => {
  beforeEach(() => {
    brokerApiMocks.getServers.mockReset().mockResolvedValue([]);
    brokerApiMocks.getBrokers.mockReset().mockResolvedValue({ brokers: [], count: 0 });
  });

  it('shows the full directory broker name even when no logo exists', async () => {
    brokerApiMocks.getServers.mockResolvedValue([{ server_url: 'https://test-broker.example', broker_name: 'Example Financial Services' }]);
    render(<NavigatorPanel />);
    expect(await screen.findByText('Example Financial Services')).toBeInTheDocument();
    expect(screen.queryByText('https://test-broker.example')).not.toBeInTheDocument();
  });

  it('keeps Accounts interactive while all non-functional sections stay visibly locked and closed', async () => {
    render(<NavigatorPanel />);

    await waitFor(() => {
      expect(brokerApiMocks.getServers).toHaveBeenCalledTimes(1);
      expect(brokerApiMocks.getBrokers).toHaveBeenCalledTimes(1);
    });

    const accountsRow = getTreeRow('Accounts');
    const accountsLabel = within(accountsRow).getByText('Accounts');
    expect(accountsRow).not.toHaveAttribute('aria-disabled');
    expect(accountsRow).toHaveClass('cursor-pointer');
    expect(accountsLabel).toHaveClass('text-[14px]', 'font-normal');
    expect(accountsRow.querySelector('.navigator-tree-item__lock')).toBeNull();
    expect(screen.getByText('Broker')).toBeInTheDocument();

    fireEvent.click(accountsRow);
    expect(screen.queryByText('Broker')).not.toBeInTheDocument();
    fireEvent.click(accountsRow);
    expect(screen.getByText('Broker')).toBeInTheDocument();

    lockedSections.forEach(({ label, child }) => {
      const row = getTreeRow(label);

      expect(row).toHaveAttribute('aria-disabled', 'true');
      expect(row).toHaveAttribute('aria-label', `${label}, currently unavailable`);
      expect(row).toHaveAttribute('title', `${label} is currently unavailable`);
      expect(row).toHaveClass('navigator-tree-item__row--disabled', 'cursor-not-allowed');
      expect(row).not.toHaveClass('opacity-[0.55]');
      expect(row.querySelector('.navigator-tree-item__chevron')).toBeNull();
      expect(within(row).getByText(label)).toHaveClass('text-[14px]', 'font-normal');
      expect(row.querySelector('.navigator-tree-item__lock')).not.toBeNull();

      fireEvent.click(row);
      fireEvent.doubleClick(row);
      fireEvent.keyDown(row, { key: 'Enter' });
      fireEvent.keyDown(row, { key: ' ' });
      expect(screen.queryByText(child)).not.toBeInTheDocument();
    });
  });
});

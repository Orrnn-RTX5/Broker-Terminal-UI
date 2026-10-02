import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigatorPanel } from './NavigatorPanel';

const brokerApiMocks = vi.hoisted(() => ({
  getServers: vi.fn(),
  getBrokers: vi.fn(),
}));

let mockSavedAccounts: Array<{ login: number; name: string; server: string; isLive: boolean }> = [];
let mockStoredBrokerServer = 'https://nexa.orrnn.com';

vi.mock('../../store/useAppStore', () => {
  return {
    useAppStore: (selector: (store: any) => unknown) =>
      selector({
        accountId: '200001',
        savedAccounts: mockSavedAccounts,
        removeSavedAccount: vi.fn(),
        addSavedAccount: vi.fn(),
        isAuthenticated: true,
      }),
  };
});

vi.mock('../../api/trade', () => ({
  brokerV2Api: brokerApiMocks,
}));

vi.mock('../../services/api', () => ({
  api: { auth: { logout: vi.fn() } },
}));

vi.mock('../../services/brokerServers', () => ({
  getStoredBrokerServer: () => mockStoredBrokerServer,
}));

vi.mock('../../services/brokerDirectory', () => ({
  getCachedBrokerDirectory: () => null,
  loadAppBrokerDirectory: vi.fn().mockResolvedValue([]),
}));

vi.mock('../ui/ContextMenu', () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../LoginDialog', () => ({ LoginDialog: () => null }));
vi.mock('../ChangePasswordDialog', () => ({ ChangePasswordDialog: () => null }));

describe('NavigatorPanel backend broker logo resolution', () => {
  afterEach(() => { delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__; });
  beforeEach(() => {
    localStorage.clear();
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = {
      CONFIG_SOURCE: 'deployment',
      API_HOST: 'https://nexa.orrnn.com',
      WS_HOST: 'wss://nexa.orrnn.com',
      BROKER_ID: 'Nexa',
      BROKER_NAME: 'Nexa',
      DEFAULT_MT5_SERVER: 'Nexa-Live',
      DISCOVERY_BASE_URL: 'https://directory.example',
    };
    mockSavedAccounts = [];
    mockStoredBrokerServer = 'https://nexa.orrnn.com';
    brokerApiMocks.getServers.mockReset().mockResolvedValue([]);
    brokerApiMocks.getBrokers.mockReset().mockResolvedValue({ brokers: [], count: 0 });
  });

  it('renders Nexa broker logo when account server is Nexa', async () => {
    mockSavedAccounts = [
      { login: 200001, name: 'Trader', server: 'Nexa', isLive: true },
    ];
    brokerApiMocks.getServers.mockResolvedValue([
      { server: 'broker-server-21', broker_id: 'Nexa', broker_name: 'Nexa' },
    ]);
    brokerApiMocks.getBrokers.mockResolvedValue({
      brokers: [
        { broker_id: 'Nexa', name: 'Nexa', logo_url: '/api/v1/brokers/Nexa/logo' },
      ],
      count: 1,
    });

    render(<NavigatorPanel />);

    const logo = await screen.findByRole('img', { name: /Nexa Logo/i });
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute('src', 'https://directory.example/api/v1/brokers/Nexa/logo');
  });

  it('resolves relative /api/v1/brokers/Nexa/logo to discovery base URL instead of 404 server URL', async () => {
    localStorage.setItem('server_url', 'https://nexa.orrnn.com');
    mockSavedAccounts = [
      { login: 200001, name: 'Trader', server: 'Nexa', isLive: true },
    ];
    brokerApiMocks.getServers.mockResolvedValue([
      { server_url: 'https://nexa.orrnn.com', broker_id: 'Nexa', broker_name: 'Nexa' },
    ]);
    brokerApiMocks.getBrokers.mockResolvedValue({
      brokers: [
        { broker_id: 'Nexa', name: 'Nexa', logo_url: '/api/v1/brokers/Nexa/logo' },
      ],
      count: 1,
    });

    render(<NavigatorPanel />);

    const logo = await screen.findByRole('img', { name: /Nexa Logo/i });
    expect(logo.getAttribute('src')).toBe('https://directory.example/api/v1/brokers/Nexa/logo');
    expect(logo.getAttribute('src')).not.toContain('https://nexa.orrnn.com/api/v1/brokers/Nexa/logo');
  });

  it('falls back to candidate discovery URL if initial image candidate errors', async () => {
    mockSavedAccounts = [
      { login: 200001, name: 'Trader', server: 'Nexa', isLive: true },
    ];
    brokerApiMocks.getServers.mockResolvedValue([
      { server_url: 'https://nexa.orrnn.com', broker_id: 'Nexa', broker_name: 'Nexa', logo_url: 'https://broken.example/nexa.png' },
    ]);

    render(<NavigatorPanel />);

    await waitFor(() => {
      expect(screen.getByRole('img', { name: /Nexa Logo/i })).toHaveAttribute(
        'src',
        'https://broken.example/nexa.png',
      );
    });

    const logo = screen.getByRole('img', { name: /Nexa Logo/i });
    fireEvent.error(logo);

    await waitFor(() => {
      expect(screen.getByRole('img', { name: /Nexa Logo/i })).toHaveAttribute(
        'src',
        'https://directory.example/api/v1/brokers/Nexa/logo',
      );
    });
  });

  it('renders Nexa logo on the placeholder row when savedAccounts is empty and stored server is nexa', async () => {
    mockSavedAccounts = [];
    mockStoredBrokerServer = 'https://nexa.orrnn.com';
    localStorage.setItem('rtx_broker_server', 'https://nexa.orrnn.com');
    localStorage.setItem('broker_id', 'Nexa');

    brokerApiMocks.getServers.mockResolvedValue([
      { server: 'nexa.orrnn.com:443', server_url: 'https://nexa.orrnn.com', broker_id: 'Nexa', broker_name: 'Nexa' },
    ]);
    brokerApiMocks.getBrokers.mockResolvedValue({
      brokers: [{ broker_id: 'Nexa', name: 'Nexa', logo_url: '/api/v1/brokers/Nexa/logo' }],
      count: 1,
    });

    render(<NavigatorPanel />);

    const logo = await screen.findByRole('img', { name: /Nexa Logo/i });
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute('src', 'https://directory.example/api/v1/brokers/Nexa/logo');
  });
});

/**
 * Server-name display (white-label, all brokers).
 *
 * The status bar, the window title and the Navigator show the server name the
 * broker publishes: `/api/v2/broker/config` `server_name`, or the selected
 * `/api/v2/broker/servers` entry. The value is always shown as the broker set
 * it. The only value ever suppressed is the build fallback DEFAULT_MT5_SERVER,
 * and only while the broker config is available. No word lists.
 *
 * Fixtures are neutral: no real broker, host or account literals.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { brokerDisplayName } from './brokerDisplayName';
import { useAppStore } from '../store/useAppStore';
import { formatTerminalTitle, getWebTerminalTitle, useTerminalBrokerInfo } from '../hooks/useTerminalTitle';
import { brokerV2Api } from '../api/trade';
import { configApi } from './api';
import type { BrokerServer } from '../types/api';

vi.mock('../startup/runAfterTerminalReady', () => ({
  runAfterTerminalReady: (task: () => void) => { task(); return () => undefined; },
}));

vi.mock('../api/trade', () => ({
  brokerV2Api: {
    getServers: vi.fn().mockResolvedValue([]),
    getBrokers: vi.fn().mockResolvedValue({ brokers: [], count: 0 }),
  },
}));

vi.mock('./api', () => ({
  configApi: { getConfig: vi.fn().mockResolvedValue({}) },
}));

type RuntimeWindow = Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };
type ConfigResult = Awaited<ReturnType<typeof configApi.getConfig>>;

const API_HOST = 'https://broker.example';
const BROKER_ID = 'example-broker';
const BUILD_FALLBACK = 'local-dev';

const setDeploymentWithBuildFallback = () => {
  // Same shape as a deployment whose BROKER_NAME is empty and whose
  // DEFAULT_MT5_SERVER is still the build fallback.
  (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = {
    CONFIG_SOURCE: 'build',
    BACKEND_TARGET: 'web',
    API_HOST,
    API_HOST_EXT: API_HOST,
    WS_HOST: 'wss://broker.example',
    BROKER_ID,
    FEED_BROKER_ID: BROKER_ID,
    BROKER_NAME: '',
    DEFAULT_MT5_SERVER: BUILD_FALLBACK,
    DISCOVERY_BASE_URL: API_HOST,
  };
};

const serverEntry = (server: string): BrokerServer => ({
  id: 1,
  broker_id: BROKER_ID,
  broker_name: BROKER_ID,
  server,
  protocol: 'http',
  region: 'public',
  enabled: true,
  created_at: 0,
} as BrokerServer);

const originalAccountId = useAppStore.getState().accountId;
const originalSavedAccounts = useAppStore.getState().savedAccounts;

beforeEach(() => {
  localStorage.clear();
  setDeploymentWithBuildFallback();
  // A started web session stores the deployment API host as its server.
  localStorage.setItem('rtx_broker_server', API_HOST);
  localStorage.setItem('broker_id', BROKER_ID);
  useAppStore.setState({ accountId: '100043', savedAccounts: [] });
  vi.mocked(brokerV2Api.getServers).mockResolvedValue([]);
  vi.mocked(brokerV2Api.getBrokers).mockResolvedValue({ brokers: [], count: 0 });
  vi.mocked(configApi.getConfig).mockResolvedValue({} as ConfigResult);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__;
  useAppStore.setState({ accountId: originalAccountId, savedAccounts: originalSavedAccounts });
});

describe('server name display comes from the broker API', () => {
  it('shows broker config server_name in the status bar and window title, not the build fallback', async () => {
    vi.mocked(configApi.getConfig).mockResolvedValue({
      server_name: 'Example Markets', broker_name: 'Example Markets',
    } as unknown as ConfigResult);
    vi.mocked(brokerV2Api.getServers).mockResolvedValue([serverEntry('broker-server-9')]);

    const { result } = renderHook(() => useTerminalBrokerInfo());

    await waitFor(() => expect(result.current.brokerName).toBe('Example Markets'));
    expect(getWebTerminalTitle()).toBe('Example Markets');
    const statusTitle = formatTerminalTitle(result.current, 'EURUSD', 'm15');
    expect(statusTitle).toBe('Example Markets - 100043 - Hedge - EURUSD,M15');
    expect(statusTitle).not.toContain(BUILD_FALLBACK);
    expect(brokerDisplayName(API_HOST)).toBe('Example Markets');
    expect(brokerDisplayName(BUILD_FALLBACK)).toBe('Example Markets');
  });

  it('displays a broker named "Test Markets" exactly as the broker set it', async () => {
    vi.mocked(configApi.getConfig).mockResolvedValue({
      server_name: 'Test Markets', broker_name: 'Test Markets',
    } as unknown as ConfigResult);

    const { result } = renderHook(() => useTerminalBrokerInfo());

    await waitFor(() => expect(result.current.brokerName).toBe('Test Markets'));
    expect(getWebTerminalTitle()).toBe('Test Markets');
    expect(brokerDisplayName(API_HOST)).toBe('Test Markets');
    expect(brokerDisplayName('Test Markets')).toBe('Test Markets');
  });

  it('displays a server literally named "test" from the /broker/servers entry', async () => {
    vi.mocked(configApi.getConfig).mockResolvedValue({} as ConfigResult);
    vi.mocked(brokerV2Api.getServers).mockResolvedValue([serverEntry('test')]);

    const { result } = renderHook(() => useTerminalBrokerInfo());

    await waitFor(() => expect(result.current.brokerName).toBe('test'));
    expect(getWebTerminalTitle()).toBe('test');
    expect(brokerDisplayName('test')).toBe('test');
  });

  it('displays a broker config server_name literally named "test"', async () => {
    vi.mocked(configApi.getConfig).mockResolvedValue({ server_name: 'test' } as unknown as ConfigResult);

    const { result } = renderHook(() => useTerminalBrokerInfo());

    await waitFor(() => expect(result.current.brokerName).toBe('test'));
    expect(brokerDisplayName(API_HOST)).toBe('test');
  });

  it('keeps the build fallback visible when the broker config is unavailable', async () => {
    vi.mocked(configApi.getConfig).mockRejectedValue(new TypeError('Failed to fetch'));
    vi.mocked(brokerV2Api.getServers).mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useTerminalBrokerInfo());
    await act(async () => {});
    await act(async () => {});

    expect(result.current.brokerName).toBe(BUILD_FALLBACK);
    expect(getWebTerminalTitle()).toBe(BUILD_FALLBACK);
    expect(brokerDisplayName(BUILD_FALLBACK)).toBe(BUILD_FALLBACK);
  });

  it('suppresses only the build fallback: every other broker value is shown verbatim', async () => {
    vi.mocked(configApi.getConfig).mockResolvedValue({ server_name: 'Example Markets' } as unknown as ConfigResult);

    const { result } = renderHook(() => useTerminalBrokerInfo());
    await waitFor(() => expect(result.current.brokerName).toBe('Example Markets'));

    for (const label of ['dev', 'local', 'development', 'localhost', '127.0.0.1', 'test', 'Dev Markets', 'test-server']) {
      expect(brokerDisplayName(label)).toBe(label);
    }
  });
});

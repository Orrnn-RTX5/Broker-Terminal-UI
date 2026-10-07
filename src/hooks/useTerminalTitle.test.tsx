import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAppStore } from '../store/useAppStore';
import { useTerminalBrokerInfo } from './useTerminalTitle';
import { brokerV2Api } from '../api/trade';
import { configApi } from '../services/api';
import { emitSessionChange } from '../services/brokerSession';

vi.mock('../startup/runAfterTerminalReady', () => ({
    runAfterTerminalReady: (task: () => void) => { task(); return () => undefined; },
}));

vi.mock('../api/trade', () => ({
    brokerV2Api: {
        getServers: vi.fn().mockResolvedValue([]),
        getBrokers: vi.fn().mockResolvedValue({ brokers: [], count: 0 }),
    },
}));

vi.mock('../services/api', () => ({
    configApi: {
        getConfig: vi.fn().mockResolvedValue({ brokerName: 'Account Test Broker' }),
    },
}));

const originalAccountId = useAppStore.getState().accountId;
const originalSavedAccounts = useAppStore.getState().savedAccounts;

beforeEach(() => {
    localStorage.clear();
    vi.mocked(brokerV2Api.getServers).mockResolvedValue([]);
    vi.mocked(brokerV2Api.getBrokers).mockResolvedValue({ brokers: [], count: 0 });
    vi.mocked(configApi.getConfig).mockResolvedValue({ brokerName: 'Account Test Broker' } as Awaited<ReturnType<typeof configApi.getConfig>>);
});

afterEach(() => {
    cleanup();
    useAppStore.setState({ accountId: originalAccountId, savedAccounts: originalSavedAccounts });
    localStorage.clear();
    vi.unstubAllGlobals();
});

it('replaces a cached discovery logo with fresh broker configuration branding', async () => {
    localStorage.setItem('broker_id', 'selected-broker');
    localStorage.setItem('logo_url', 'https://directory.example/api/v1/brokers/selected-broker/logo');
    vi.mocked(configApi.getConfig).mockResolvedValue({
        brokerName: 'Selected Broker', logo_url: 'https://selected.example/logo.svg',
        priceFeedLP: '', executionMode: 'BBOOK', defaultLeverage: 100,
        defaultBalance: 0, marginMode: 'HEDGING', maxTicksPerSymbol: 0,
    });
    const { result } = renderHook(useTerminalBrokerInfo);
    await waitFor(() => expect(result.current.logoUrl).toBe('https://selected.example/logo.svg'));
});

it('uses the selected broker ID to find a directory logo even when server labels differ', async () => {
    localStorage.setItem('broker_id', 'selected-broker');
    localStorage.setItem('rtx_broker_server', 'Selected-Live');
    vi.mocked(brokerV2Api.getBrokers).mockResolvedValue({ brokers: [{
        broker_id: 'selected-broker', name: 'Selected Broker', logo_url: 'https://selected.example/logo.svg',
        license_plan: 'test', modules_enabled: [], status: 'active', valid_from: 0, valid_until: 0,
    }], count: 1 });
    const { result } = renderHook(useTerminalBrokerInfo);
    await waitFor(() => expect(result.current.logoUrl).toBe('https://selected.example/logo.svg'));
});

it('uses the configured discovery logo immediately when no logo metadata is supplied', async () => {
    vi.stubGlobal('__RTX_RUNTIME_CONFIG__', {
        CONFIG_SOURCE: 'deployment', API_HOST: 'https://broker.example', WS_HOST: 'wss://broker.example',
        BROKER_ID: 'broker/selected', DEFAULT_MT5_SERVER: 'Selected-Live', DISCOVERY_BASE_URL: 'https://directory.example',
    });
    localStorage.setItem('broker_id', 'broker/selected');
    const { result } = renderHook(useTerminalBrokerInfo);
    expect(result.current.logoUrl).toBe('https://directory.example/api/v1/brokers/broker%2Fselected/logo');
    await act(async () => {});
});

it('refreshes on a broker switch with the same account number and ignores the old request', async () => {
    localStorage.setItem('broker_id', 'broker-a');
    localStorage.setItem('rtx_broker_server', 'https://broker-a.example');
    localStorage.setItem('logo_url', 'https://broker-a.example/logo.svg');
    useAppStore.setState({ accountId: '200032', savedAccounts: [{ login: 200032, name: 'Account A', server: 'https://broker-a.example', isLive: true }] });
    let resolveOld!: (value: Awaited<ReturnType<typeof configApi.getConfig>>) => void;
    vi.mocked(configApi.getConfig).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const { result } = renderHook(useTerminalBrokerInfo);
    act(() => {
        localStorage.setItem('broker_id', 'broker-b');
        localStorage.setItem('rtx_broker_server', 'https://broker-b.example');
        localStorage.setItem('logo_url', 'https://broker-b.example/logo.svg');
        emitSessionChange('login');
    });
    await waitFor(() => expect(result.current.logoUrl).toBe('https://broker-b.example/logo.svg'));
    expect(result.current.serverName).toBe('https://broker-b.example');
    const oldConfig = {
        brokerName: 'Broker A', priceFeedLP: '', executionMode: 'BBOOK' as const,
        defaultLeverage: 100, defaultBalance: 0, marginMode: 'HEDGING' as const, maxTicksPerSymbol: 0,
        logo_url: 'https://broker-a.example/late.svg',
    };
    await act(async () => resolveOld(oldConfig));
    expect(result.current.logoUrl).toBe('https://broker-b.example/logo.svg');
});

it('keeps the account name in sync with saved metadata and active-account changes', async () => {
    const savedAccounts = [
        { login: 200032, name: '  Raj Halder  ', server: 'https://account-title.example', isLive: true },
        { login: 200033, name: 'Second Account', server: 'https://account-title.example', isLive: true },
    ];
    useAppStore.setState({ accountId: '200032', savedAccounts });
    const { result } = renderHook(useTerminalBrokerInfo);

    expect(result.current.accountName).toBe('Raj Halder');
    await waitFor(() => expect(result.current.brokerName).toBe('Account Test Broker'));

    act(() => useAppStore.setState({
        savedAccounts: savedAccounts.map(account => account.login === 200032
            ? { ...account, name: '  Updated Account Name  ' } : account),
    }));
    expect(result.current.accountName).toBe('Updated Account Name');

    await act(async () => useAppStore.setState({ accountId: '200033' }));
    expect(result.current.accountName).toBe('Second Account');

    await act(async () => useAppStore.setState({ accountId: '200034' }));
    expect(result.current.accountName).toBe('');
});

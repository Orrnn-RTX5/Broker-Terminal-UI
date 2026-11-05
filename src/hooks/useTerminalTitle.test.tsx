import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAppStore } from '../store/useAppStore';
import { UNKNOWN_MARGIN_MODE, useTerminalBrokerInfo } from './useTerminalTitle';
import { brokerV2Api } from '../api/trade';
import { apiClient } from '../api/client';
import { API_V2_BASE_URL } from '../config/api';
import { configApi } from '../services/api';
import { emitSessionChange } from '../services/brokerSession';

vi.mock('../api/client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../api/client')>();
    return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn() } };
});

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
const originalIsAuthenticated = useAppStore.getState().isAuthenticated;
const originalSelectedSymbol = useAppStore.getState().selectedSymbol;

beforeEach(() => {
    localStorage.clear();
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.get).mockRejectedValue(new Error('unmocked account read'));
    vi.mocked(brokerV2Api.getServers).mockResolvedValue([]);
    vi.mocked(brokerV2Api.getBrokers).mockResolvedValue({ brokers: [], count: 0 });
    vi.mocked(configApi.getConfig).mockResolvedValue({ brokerName: 'Account Test Broker' } as Awaited<ReturnType<typeof configApi.getConfig>>);
});

afterEach(() => {
    cleanup();
    useAppStore.setState({
        accountId: originalAccountId,
        savedAccounts: originalSavedAccounts,
        isAuthenticated: originalIsAuthenticated,
        selectedSymbol: originalSelectedSymbol,
    });
    localStorage.clear();
    vi.unstubAllGlobals();
});

it('retains explicit deployment branding after login metadata arrives', async () => {
    vi.stubGlobal('__RTX_RUNTIME_CONFIG__', {
        CONFIG_SOURCE: 'deployment', API_HOST: 'https://selected.example', WS_HOST: 'wss://selected.example',
        BROKER_ID: 'selected-broker', DEFAULT_MT5_SERVER: 'Selected-Live',
        DISCOVERY_BASE_URL: 'https://directory.example', BROKER_LOGO_URL: 'https://branding.example/selected.png',
    });
    localStorage.setItem('broker_id', 'selected-broker');
    localStorage.setItem('logo_url', 'https://selected.example/stale.png');
    vi.mocked(configApi.getConfig).mockResolvedValue({ logo_url: '/assets/missing.png' } as Awaited<ReturnType<typeof configApi.getConfig>>);
    const { result } = renderHook(useTerminalBrokerInfo);
    expect(result.current.logoUrl).toBe('https://branding.example/selected.png');
    await act(async () => {});
    expect(result.current.logoUrl).toBe('https://branding.example/selected.png');
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

it('resolves snake_case broker_name from /api/v2/broker/config and ignores /assets/logo.png placeholder', async () => {
    vi.stubGlobal('__RTX_RUNTIME_CONFIG__', {
        CONFIG_SOURCE: 'deployment',
        API_HOST: 'https://broker.example',
        WS_HOST: 'wss://broker.example',
        BROKER_ID: 'alpha-markets',
        DEFAULT_MT5_SERVER: 'RTX5-PROD-01',
        DISCOVERY_BASE_URL: 'https://directory.example',
    });
    localStorage.setItem('broker_id', 'alpha-markets');
    localStorage.setItem('logo_url', '/assets/logo.png');
    vi.mocked(configApi.getConfig).mockResolvedValue({
        broker_name: 'Alpha Markets',
        logo_url: '/assets/logo.png',
    } as unknown as Awaited<ReturnType<typeof configApi.getConfig>>);

    const { result } = renderHook(useTerminalBrokerInfo);
    await waitFor(() => expect(result.current.brokerName).toBe('Alpha Markets'));
    expect(result.current.logoUrl).toBe('https://directory.example/api/v1/brokers/alpha-markets/logo');
});

const signInAccount = (login: string) => {
    // The store's selectedSymbol stays empty, as in the real app: the shown
    // symbol is passed in by App/StatusBar.
    useAppStore.setState({ accountId: login, isAuthenticated: true, selectedSymbol: '' });
};

const renderModeHook = (symbol = 'TESTSYM') => renderHook(
    ({ chartSymbol }: { chartSymbol: string }) => useTerminalBrokerInfo(chartSymbol),
    { initialProps: { chartSymbol: symbol } },
);

const capabilityReads = () => vi.mocked(apiClient.get).mock.calls
    .filter(([endpoint]) => String(endpoint).startsWith('/account/symbol-capabilities/'));

// Let every pending promise chain (read -> label -> notify) settle.
const flush = () => act(() => new Promise<void>(resolve => { setTimeout(resolve, 0); }));

it('reads the account mode for the shown symbol from the v2 API base while the store symbol is empty', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ account_login: '700010', account_mode: 'netting' });
    signInAccount('700010');

    const { result } = renderModeHook('SHOWNSYM');
    await waitFor(() => expect(result.current.marginMode).toBe('Netting'));
    expect(useAppStore.getState().selectedSymbol).toBe('');
    expect(capabilityReads()).toEqual([['/account/symbol-capabilities/SHOWNSYM', { baseUrl: API_V2_BASE_URL }]]);
});

it('makes no account read without a shown symbol', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ account_login: '700009', account_mode: 'netting' });
    signInAccount('700009');

    const { result } = renderHook(() => useTerminalBrokerInfo(''));
    await flush();
    expect(capabilityReads()).toHaveLength(0);
    expect(result.current.marginMode).toBe(UNKNOWN_MARGIN_MODE);
});

it('shows Netting for a netting account even when the broker config says hedging', async () => {
    vi.mocked(configApi.getConfig).mockResolvedValue({
        margin_mode: 'HEDGING',
    } as unknown as Awaited<ReturnType<typeof configApi.getConfig>>);
    vi.mocked(apiClient.get).mockResolvedValue({ account_login: '700001', account_mode: 'netting' });
    signInAccount('700001');

    const { result } = renderModeHook();
    await waitFor(() => expect(result.current.marginMode).toBe('Netting'));
    expect(capabilityReads()).toHaveLength(1);
});

it('shows Hedge for a hedging account even when the broker config says netting', async () => {
    vi.mocked(configApi.getConfig).mockResolvedValue({
        margin_mode: 'NETTING',
    } as unknown as Awaited<ReturnType<typeof configApi.getConfig>>);
    vi.mocked(apiClient.get).mockResolvedValue({ account_login: '700002', account_mode: 'hedging' });
    signInAccount('700002');

    const { result } = renderModeHook();
    await waitFor(() => expect(result.current.marginMode).toBe('Hedge'));
});

it('fails closed to the unknown mode when the account mode read errors', async () => {
    vi.mocked(configApi.getConfig).mockResolvedValue({
        margin_mode: 'HEDGING',
    } as unknown as Awaited<ReturnType<typeof configApi.getConfig>>);
    vi.mocked(apiClient.get).mockRejectedValue(new Error('503 CAPABILITY_UNAVAILABLE'));
    signInAccount('700003');

    const { result } = renderModeHook();
    await waitFor(() => expect(capabilityReads()).toHaveLength(1));
    await flush();
    expect(result.current.marginMode).toBe(UNKNOWN_MARGIN_MODE);
});

it('fails closed on an unrecognised mode or a snapshot for another login', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ account_login: '700004', account_mode: 'mystery' });
    signInAccount('700004');
    const first = renderModeHook();
    await waitFor(() => expect(capabilityReads()).toHaveLength(1));
    await flush();
    expect(first.result.current.marginMode).toBe(UNKNOWN_MARGIN_MODE);
    first.unmount();

    vi.mocked(apiClient.get).mockResolvedValueOnce({ account_login: '799999', account_mode: 'netting' });
    signInAccount('700005');
    const second = renderModeHook();
    await waitFor(() => expect(capabilityReads()).toHaveLength(2));
    await flush();
    expect(second.result.current.marginMode).toBe(UNKNOWN_MARGIN_MODE);
});

it('never guesses Hedge from the broker config and makes no account read for a guest', async () => {
    vi.mocked(configApi.getConfig).mockResolvedValue({
        margin_mode: 'HEDGING',
    } as unknown as Awaited<ReturnType<typeof configApi.getConfig>>);
    useAppStore.setState({ accountId: '700006', isAuthenticated: false, selectedSymbol: '' });

    const { result } = renderModeHook();
    await waitFor(() => expect(configApi.getConfig).toHaveBeenCalled());
    await flush();
    expect(result.current.marginMode).toBe(UNKNOWN_MARGIN_MODE);
    expect(capabilityReads()).toHaveLength(0);
});

it('does not re-read a known mode when the shown symbol changes', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ account_login: '700011', account_mode: 'hedging' });
    signInAccount('700011');

    const { result, rerender } = renderModeHook();
    await waitFor(() => expect(result.current.marginMode).toBe('Hedge'));
    rerender({ chartSymbol: 'OTHERSYM' });
    await flush();
    expect(capabilityReads()).toHaveLength(1);
    expect(result.current.marginMode).toBe('Hedge');
});

it('retries an unknown mode when the shown symbol changes', async () => {
    vi.mocked(apiClient.get)
        .mockRejectedValueOnce(new Error('403 SYMBOL_NOT_ALLOWED'))
        .mockResolvedValueOnce({ account_login: '700012', account_mode: 'netting' });
    signInAccount('700012');
    const { result, rerender } = renderModeHook();
    await waitFor(() => expect(capabilityReads()).toHaveLength(1));
    await flush();
    expect(result.current.marginMode).toBe(UNKNOWN_MARGIN_MODE);

    rerender({ chartSymbol: 'SCOPEDSYM' });
    await waitFor(() => expect(result.current.marginMode).toBe('Netting'));
    expect(capabilityReads()[1][0]).toBe('/account/symbol-capabilities/SCOPEDSYM');
});

it('stops reading an unknown mode after the read cap', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('503 CAPABILITY_UNAVAILABLE'));
    signInAccount('700013');
    const { result, rerender } = renderModeHook();
    for (const symbol of ['S1', 'S2', 'S3', 'S4', 'S5']) {
        await flush();
        rerender({ chartSymbol: symbol });
    }
    await flush();
    // TESTSYM on mount, then S1 and S2; S3-S5 are past the cap.
    expect(capabilityReads().map(([endpoint]) => endpoint)).toEqual([
        '/account/symbol-capabilities/TESTSYM',
        '/account/symbol-capabilities/S1',
        '/account/symbol-capabilities/S2',
    ]);
    expect(result.current.marginMode).toBe(UNKNOWN_MARGIN_MODE);
});

it('keeps a correct answer that lands after a symbol change, even if the next read fails', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    let rejectSecond: (error: Error) => void = () => undefined;
    vi.mocked(apiClient.get)
        .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
        .mockImplementationOnce(() => new Promise((_, reject) => { rejectSecond = reject; }));
    signInAccount('700014');
    const { result, rerender } = renderModeHook();
    await waitFor(() => expect(capabilityReads()).toHaveLength(1));

    rerender({ chartSymbol: 'OUTOFSCOPE' });
    await waitFor(() => expect(capabilityReads()).toHaveLength(2));
    // The first symbol's read answers after the symbol changed; the failed
    // second read lands last and must not replace the known mode.
    await act(async () => { resolveFirst({ account_login: '700014', account_mode: 'netting' }); });
    await waitFor(() => expect(result.current.marginMode).toBe('Netting'));
    await act(async () => { rejectSecond(new Error('404 NOT_FOUND')); });
    await flush();
    expect(result.current.marginMode).toBe('Netting');
});

it('shares one read between hook users, including one mounted later', async () => {
    let resolveRead: (value: unknown) => void = () => undefined;
    vi.mocked(apiClient.get).mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; }));
    signInAccount('700015');
    const header = renderModeHook();
    const status = renderModeHook();
    await waitFor(() => expect(capabilityReads()).toHaveLength(1));
    await act(async () => { resolveRead({ account_login: '700015', account_mode: 'netting' }); });
    await waitFor(() => expect(header.result.current.marginMode).toBe('Netting'));
    expect(status.result.current.marginMode).toBe('Netting');

    const late = renderModeHook('ANOTHERSYM');
    expect(late.result.current.marginMode).toBe('Netting');
    await flush();
    expect(capabilityReads()).toHaveLength(1);
});

it('uses the same key for a hook user that mounts after a login and re-reads after a re-login', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ account_login: '700016', account_mode: 'netting' });
    // App's hook user exists before the login event; StatusBar mounts after it.
    const header = renderModeHook();
    act(() => { signInAccount('700016'); emitSessionChange('login'); });
    await waitFor(() => expect(header.result.current.marginMode).toBe('Netting'));

    const status = renderModeHook();
    expect(status.result.current.marginMode).toBe('Netting');
    await flush();
    expect(capabilityReads()).toHaveLength(1);

    // Re-login of the same account after its group mode changed: no stale mode survives.
    vi.mocked(apiClient.get).mockResolvedValueOnce({ account_login: '700016', account_mode: 'hedging' });
    act(() => { useAppStore.setState({ isAuthenticated: false }); emitSessionChange('logout'); });
    expect(header.result.current.marginMode).toBe(UNKNOWN_MARGIN_MODE);
    expect(status.result.current.marginMode).toBe(UNKNOWN_MARGIN_MODE);
    act(() => { useAppStore.setState({ isAuthenticated: true }); emitSessionChange('login'); });
    await waitFor(() => expect(header.result.current.marginMode).toBe('Hedge'));
    expect(status.result.current.marginMode).toBe('Hedge');
    expect(capabilityReads()).toHaveLength(2);
});

it('drops the old mode at once on an account switch', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ account_login: '700017', account_mode: 'netting' });
    signInAccount('700017');
    const { result } = renderModeHook();
    await waitFor(() => expect(result.current.marginMode).toBe('Netting'));

    let resolveNext: (value: unknown) => void = () => undefined;
    vi.mocked(apiClient.get).mockImplementationOnce(() => new Promise(resolve => { resolveNext = resolve; }));
    act(() => { useAppStore.setState({ accountId: '700018' }); });
    expect(result.current.marginMode).toBe(UNKNOWN_MARGIN_MODE);
    await waitFor(() => expect(capabilityReads()).toHaveLength(2));
    await act(async () => { resolveNext({ account_login: '700018', account_mode: 'hedging' }); });
    await waitFor(() => expect(result.current.marginMode).toBe('Hedge'));
});

it('drops a known mode on logout', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ account_login: '700019', account_mode: 'netting' });
    signInAccount('700019');
    const { result } = renderModeHook();
    await waitFor(() => expect(result.current.marginMode).toBe('Netting'));

    act(() => { useAppStore.setState({ isAuthenticated: false }); });
    expect(result.current.marginMode).toBe(UNKNOWN_MARGIN_MODE);
});

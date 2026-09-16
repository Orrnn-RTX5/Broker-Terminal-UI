import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAppStore } from '../store/useAppStore';
import { useTerminalBrokerInfo } from './useTerminalTitle';

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

afterEach(() => {
    cleanup();
    useAppStore.setState({ accountId: originalAccountId, savedAccounts: originalSavedAccounts });
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

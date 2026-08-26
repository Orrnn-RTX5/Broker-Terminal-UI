import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JournalTab } from './JournalTab';
import {
    clearTradeOrderLatencySamples,
    recordTradeOrderLatency,
} from '../../services/orderLatencyTelemetry';

const journalHarness = vi.hoisted(() => ({
    getLogs: vi.fn(),
    isAuthenticated: true,
    sessionScope: 'broker-a:account-a',
}));

const clipboardWriteText = vi.fn();
const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

vi.mock('../../services/api', () => ({
    journalApi: {
        getLogs: journalHarness.getLogs,
    },
}));

vi.mock('../../hooks/useBrokerAccountSessionScope', () => ({
    useBrokerAccountSessionScope: () => journalHarness.sessionScope,
}));

vi.mock('../../store/useAppStore', () => ({
    useAppStore: (selector: (state: { isAuthenticated: boolean }) => unknown) => selector({
        isAuthenticated: journalHarness.isAuthenticated,
    }),
}));

vi.mock('../ui/Icon', () => ({
    Icon: ({ name }: { name: string }) => <span aria-hidden="true" data-icon={name} />,
}));

type JournalLog = {
    id: number | string;
    latency_ms?: number;
    client_order_id?: number | string;
    request_id?: number | string;
    order_ticket?: number | string;
    position_ticket?: number | string;
    code: number;
    code_text: string;
    type: number;
    type_text: string;
    datetime: number;
    source: string;
    message: string;
};

type JournalResponse = {
    count: number;
    logs: JournalLog[];
};

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const makeLog = (overrides: Partial<JournalLog> = {}): JournalLog => ({
    id: 'log-1',
    code: 0,
    code_text: 'OK',
    type: 2,
    type_text: 'System',
    datetime: nowSeconds(),
    source: 'Terminal',
    message: 'Journal message',
    ...overrides,
});

const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

describe('JournalTab', () => {
    beforeEach(() => {
        journalHarness.getLogs.mockReset();
        journalHarness.isAuthenticated = true;
        journalHarness.sessionScope = 'broker-a:account-a';
        clearTradeOrderLatencySamples();
        clipboardWriteText.mockReset();
        clipboardWriteText.mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: clipboardWriteText },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        if (originalClipboardDescriptor) {
            Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
        } else {
            Reflect.deleteProperty(navigator, 'clipboard');
        }
    });

    it('loads mode=2/type=0 by default and renders the server response', async () => {
        journalHarness.getLogs.mockResolvedValue({
            count: 1,
            logs: [makeLog({ id: 11, message: 'Connected to broker journal' })],
        });

        render(<JournalTab />);

        expect(await screen.findByText('Connected to broker journal')).toBeInTheDocument();
        expect(journalHarness.getLogs).toHaveBeenCalledTimes(1);
        expect(journalHarness.getLogs).toHaveBeenCalledWith(
            { mode: 2, type: 0 },
            { signal: expect.any(AbortSignal) },
        );
        expect(screen.getByText('1 entries')).toBeInTheDocument();
    });

    it('hydrates the last completed trade latency recorded before Journal mounts', async () => {
        journalHarness.getLogs.mockResolvedValue({ count: 0, logs: [] });
        recordTradeOrderLatency({
            phase: 'order_filled',
            transport: 'websocket',
            traceId: 'fill-a',
            sessionScope: journalHarness.sessionScope,
            terminalRttMs: 6.789,
            totalMs: 9,
        });

        render(<JournalTab />);

        const indicator = screen.getByTestId('last-trade-latency');
        expect(indicator).toHaveTextContent('Last trade latency: 9 ms');
        expect(indicator).toHaveAttribute('role', 'status');
        expect(indicator).toHaveAttribute('aria-live', 'polite');
        await screen.findByText('No journal entries for the selected filters');
        await act(async () => {
            await new Promise(resolve => window.setTimeout(resolve, 0));
        });
    });

    it('updates from terminal events and ignores other scopes and nonterminal samples', async () => {
        journalHarness.getLogs.mockResolvedValue({ count: 0, logs: [] });
        render(<JournalTab />);
        const indicator = screen.getByTestId('last-trade-latency');
        expect(indicator).toHaveTextContent('Last trade latency: \u2014');

        act(() => {
            recordTradeOrderLatency({
                phase: 'order_filled',
                transport: 'websocket',
                traceId: 'other-account',
                sessionScope: 'broker-b:account-b',
                terminalRttMs: 99,
            });
            recordTradeOrderLatency({
                phase: 'order_accepted',
                transport: 'websocket',
                traceId: 'not-terminal',
                sessionScope: journalHarness.sessionScope,
                acceptedRttMs: 88,
                totalMs: 88,
            });
        });

        await act(async () => {
            await new Promise(resolve => window.setTimeout(resolve, 0));
        });
        expect(indicator).toHaveTextContent('Last trade latency: \u2014');

        act(() => {
            recordTradeOrderLatency({
                phase: 'rest_completed',
                transport: 'rest',
                traceId: 'matching-account',
                sessionScope: journalHarness.sessionScope,
                restRttMs: 12.345,
                totalMs: 15,
            });
        });

        await waitFor(() => expect(indicator).toHaveTextContent('Last trade latency: 15 ms'));
    });

    it('keeps search and time filtering local while mode and type changes refetch', async () => {
        const recentTrade = makeLog({
            id: 'recent',
            type: 6,
            type_text: 'Trade',
            datetime: nowSeconds() - 5 * 60,
            source: 'Execution',
            message: 'Recent order filled',
        });
        const olderSystem = makeLog({
            id: 'older',
            type: 2,
            type_text: 'System',
            datetime: nowSeconds() - 2 * 60 * 60,
            source: 'Terminal',
            message: 'Older connection event',
        });
        journalHarness.getLogs.mockResolvedValue({ count: 2, logs: [recentTrade, olderSystem] });

        render(<JournalTab />);
        expect(await screen.findByText('Recent order filled')).toBeInTheDocument();
        expect(screen.getByText('Older connection event')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '1h' }));
        expect(screen.getByText('Recent order filled')).toBeInTheDocument();
        expect(screen.queryByText('Older connection event')).not.toBeInTheDocument();

        const search = screen.getByPlaceholderText(/Filter messages/i);
        fireEvent.change(search, { target: { value: 'no-match' } });
        expect(screen.getByText('No journal entries for the selected filters')).toBeInTheDocument();
        fireEvent.change(search, { target: { value: '' } });
        expect(screen.getByText('Recent order filled')).toBeInTheDocument();
        expect(journalHarness.getLogs).toHaveBeenCalledTimes(1);

        const [typeSelect, modeSelect] = screen.getAllByRole('combobox');
        fireEvent.change(modeSelect, { target: { value: '0' } });
        await waitFor(() => expect(journalHarness.getLogs).toHaveBeenCalledTimes(2));
        expect(journalHarness.getLogs).toHaveBeenNthCalledWith(
            2,
            { mode: 0, type: 0 },
            { signal: expect.any(AbortSignal) },
        );

        fireEvent.change(typeSelect, { target: { value: '6' } });
        await waitFor(() => expect(journalHarness.getLogs).toHaveBeenCalledTimes(3));
        expect(journalHarness.getLogs).toHaveBeenNthCalledWith(
            3,
            { mode: 0, type: 6 },
            { signal: expect.any(AbortSignal) },
        );
    });

    it('copies only rows inside the selected 1h, 6h, 24h, and 7d time filter', async () => {
        const now = nowSeconds();
        const logs = [
            makeLog({ id: '30m', datetime: now - 30 * 60, message: 'Journal row 30 minutes old' }),
            makeLog({ id: '2h', datetime: now - 2 * 60 * 60, message: 'Journal row 2 hours old' }),
            makeLog({ id: '12h', datetime: now - 12 * 60 * 60, message: 'Journal row 12 hours old' }),
            makeLog({ id: '48h', datetime: now - 48 * 60 * 60, message: 'Journal row 48 hours old' }),
            makeLog({ id: '8d', datetime: now - 8 * 24 * 60 * 60, message: 'Journal row 8 days old' }),
        ];
        journalHarness.getLogs.mockResolvedValue({ count: logs.length, logs });

        render(<JournalTab />);
        expect(await screen.findByText('Journal row 30 minutes old')).toBeInTheDocument();

        const cases = [
            { range: '1h', included: logs.slice(0, 1), excluded: logs.slice(1) },
            { range: '6h', included: logs.slice(0, 2), excluded: logs.slice(2) },
            { range: '24h', included: logs.slice(0, 3), excluded: logs.slice(3) },
            { range: '7d', included: logs.slice(0, 4), excluded: logs.slice(4) },
        ];

        for (const [index, testCase] of cases.entries()) {
            fireEvent.click(screen.getByRole('button', { name: testCase.range }));
            fireEvent.click(screen.getByRole('button', { name: 'Copy filtered journal' }));

            await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledTimes(index + 1));
            const copiedText = String(clipboardWriteText.mock.calls[index]?.[0]);
            expect(copiedText).toContain('Time\tCode\tType\tSource\tLatency\tMessage');
            for (const log of testCase.included) expect(copiedText).toContain(log.message);
            for (const log of testCase.excluded) expect(copiedText).not.toContain(log.message);
        }

        expect(journalHarness.getLogs).toHaveBeenCalledTimes(1);
    });

    it('copies the intersection of time, type, and search filters', async () => {
        const logs = [
            makeLog({ id: 'match', type: 6, type_text: 'Trade', datetime: nowSeconds() - 5 * 60, message: 'Needle trade accepted' }),
            makeLog({ id: 'trade-other', type: 6, type_text: 'Trade', datetime: nowSeconds() - 5 * 60, message: 'Other trade accepted' }),
            makeLog({ id: 'trade-old', type: 6, type_text: 'Trade', datetime: nowSeconds() - 2 * 60 * 60, message: 'Needle old trade' }),
            makeLog({ id: 'system-match', type: 2, type_text: 'System', datetime: nowSeconds() - 5 * 60, message: 'Needle system event' }),
        ];
        journalHarness.getLogs.mockResolvedValue({ count: logs.length, logs });

        render(<JournalTab />);
        expect(await screen.findByText('Needle trade accepted')).toBeInTheDocument();

        const [typeSelect] = screen.getAllByRole('combobox');
        fireEvent.change(typeSelect, { target: { value: '6' } });
        await waitFor(() => expect(journalHarness.getLogs).toHaveBeenCalledTimes(2));
        await screen.findByText('Needle trade accepted');
        fireEvent.click(screen.getByRole('button', { name: '1h' }));
        fireEvent.change(screen.getByPlaceholderText(/Filter messages/i), { target: { value: 'needle' } });
        fireEvent.click(screen.getByRole('button', { name: 'Copy filtered journal' }));

        await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledOnce());
        const copiedText = String(clipboardWriteText.mock.calls[0]?.[0]);
        expect(copiedText).toContain('Needle trade accepted');
        expect(copiedText).not.toContain('Other trade accepted');
        expect(copiedText).not.toContain('Needle old trade');
        expect(copiedText).not.toContain('Needle system event');
        expect(journalHarness.getLogs).toHaveBeenCalledTimes(2);
    });

    it('renders and copies distinct backend latencies for identical same-second rows', async () => {
        const datetime = nowSeconds();
        const message = 'Order sell XAUUSD 0.01 filled';
        const logs = [
            makeLog({
                id: 'fill-a',
                datetime,
                type: 6,
                type_text: 'Trade',
                source: 'Gateway',
                message,
                latency_ms: 8.125,
                client_order_id: 'client-a',
            }),
            makeLog({
                id: 'fill-b',
                datetime,
                type: 6,
                type_text: 'Trade',
                source: 'Gateway',
                message,
                latency_ms: 17.4,
                client_order_id: 'client-b',
            }),
            makeLog({
                id: 'fill-without-latency',
                datetime,
                type: 6,
                type_text: 'Trade',
                source: 'Gateway',
                message: 'Order filled without timing',
            }),
        ];
        journalHarness.getLogs.mockResolvedValue({ count: logs.length, logs });

        render(<JournalTab />);

        expect((await screen.findAllByText(message))).toHaveLength(2);
        expect(screen.getByRole('columnheader', { name: 'Latency' })).toBeInTheDocument();
        expect(screen.getByText('8.13 ms')).toBeInTheDocument();
        expect(screen.getByText('17.4 ms')).toBeInTheDocument();
        expect(screen.getByText('\u2014')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Copy filtered journal' }));
        await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledOnce());
        const copiedText = String(clipboardWriteText.mock.calls[0]?.[0]);
        expect(copiedText).toContain('Time\tCode\tType\tSource\tLatency\tMessage');
        expect(copiedText).toContain('Gateway\t8.13 ms\tOrder sell XAUUSD 0.01 filled');
        expect(copiedText).toContain('Gateway\t17.4 ms\tOrder sell XAUUSD 0.01 filled');
        expect(copiedText).toContain('Gateway\t\u2014\tOrder filled without timing');
    });

    it('copies only the newly loaded server-mode response', async () => {
        journalHarness.getLogs
            .mockResolvedValueOnce({ count: 1, logs: [makeLog({ id: 'full', message: 'Full mode journal row' })] })
            .mockResolvedValueOnce({ count: 1, logs: [makeLog({ id: 'standard', message: 'Standard mode journal row' })] });

        render(<JournalTab />);
        expect(await screen.findByText('Full mode journal row')).toBeInTheDocument();

        const [, modeSelect] = screen.getAllByRole('combobox');
        fireEvent.change(modeSelect, { target: { value: '0' } });
        expect(screen.getByRole('button', { name: 'Copy filtered journal' })).toBeDisabled();
        expect(await screen.findByText('Standard mode journal row')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Copy filtered journal' }));
        await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledOnce());
        const copiedText = String(clipboardWriteText.mock.calls[0]?.[0]);
        expect(copiedText).toContain('Standard mode journal row');
        expect(copiedText).not.toContain('Full mode journal row');
    });

    it('shows a cold-load error and retries on demand', async () => {
        journalHarness.getLogs
            .mockRejectedValueOnce(new Error('journal transport unavailable'))
            .mockResolvedValueOnce({
                count: 1,
                logs: [makeLog({ id: 22, message: 'Recovered journal row' })],
            });

        render(<JournalTab />);

        expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load the server journal');
        expect(screen.getByText('journal transport unavailable')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

        expect(await screen.findByText('Recovered journal row')).toBeInTheDocument();
        expect(journalHarness.getLogs).toHaveBeenCalledTimes(2);
    });

    it('clears rows on a session-scope change and ignores the old scope response', async () => {
        const oldRefresh = deferred<JournalResponse>();
        const newScopeLoad = deferred<JournalResponse>();
        journalHarness.getLogs
            .mockResolvedValueOnce({
                count: 1,
                logs: [makeLog({ id: 'account-a', message: 'Account A existing row' })],
            })
            .mockReturnValueOnce(oldRefresh.promise)
            .mockReturnValueOnce(newScopeLoad.promise);

        const view = render(<JournalTab />);
        expect(await screen.findByText('Account A existing row')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Refresh journal' }));
        await waitFor(() => expect(journalHarness.getLogs).toHaveBeenCalledTimes(2));
        const oldRefreshSignal = journalHarness.getLogs.mock.calls[1][1].signal as AbortSignal;

        journalHarness.sessionScope = 'broker-b:account-b';
        view.rerender(<JournalTab />);

        expect(screen.queryByText('Account A existing row')).not.toBeInTheDocument();
        await waitFor(() => expect(journalHarness.getLogs).toHaveBeenCalledTimes(3));
        expect(oldRefreshSignal.aborted).toBe(true);

        await act(async () => {
            oldRefresh.resolve({
                count: 1,
                logs: [makeLog({ id: 'stale-a', message: 'Stale Account A response' })],
            });
            await oldRefresh.promise;
        });
        expect(screen.queryByText('Stale Account A response')).not.toBeInTheDocument();

        await act(async () => {
            newScopeLoad.resolve({
                count: 1,
                logs: [makeLog({ id: 'account-b', message: 'Account B current row' })],
            });
            await newScopeLoad.promise;
        });
        expect(screen.getByText('Account B current row')).toBeInTheDocument();
    });

    it('polls serially and aborts the active request when unmounted', async () => {
        vi.useFakeTimers();
        const initialLoad = deferred<JournalResponse>();
        const pollLoad = deferred<JournalResponse>();
        journalHarness.getLogs
            .mockReturnValueOnce(initialLoad.promise)
            .mockReturnValueOnce(pollLoad.promise);

        const view = render(<JournalTab />);
        expect(journalHarness.getLogs).toHaveBeenCalledTimes(1);

        act(() => {
            vi.advanceTimersByTime(30000);
        });
        expect(journalHarness.getLogs).toHaveBeenCalledTimes(1);

        await act(async () => {
            initialLoad.resolve({ count: 0, logs: [] });
            await initialLoad.promise;
        });

        act(() => {
            vi.advanceTimersByTime(15000);
        });
        expect(journalHarness.getLogs).toHaveBeenCalledTimes(2);
        const pollSignal = journalHarness.getLogs.mock.calls[1][1].signal as AbortSignal;

        act(() => {
            vi.advanceTimersByTime(30000);
        });
        expect(journalHarness.getLogs).toHaveBeenCalledTimes(2);

        view.unmount();
        expect(pollSignal.aborted).toBe(true);

        await act(async () => {
            pollLoad.resolve({ count: 0, logs: [] });
            await pollLoad.promise;
        });
        act(() => {
            vi.advanceTimersByTime(30000);
        });
        expect(journalHarness.getLogs).toHaveBeenCalledTimes(2);
    });
});

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
const originalExecCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');

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
        if (originalExecCommandDescriptor) {
            Object.defineProperty(document, 'execCommand', originalExecCommandDescriptor);
        } else {
            Reflect.deleteProperty(document, 'execCommand');
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
        expect(screen.getByText('1 records')).toBeInTheDocument();
    });

    it('uses readable square desktop controls across the Journal toolbar', async () => {
        journalHarness.getLogs.mockResolvedValue({ count: 0, logs: [] });

        render(<JournalTab />);
        await screen.findByText('No journal entries for the selected filters');

        const typeSelect = screen.getByRole('combobox', { name: 'Journal type' });
        const modeSelect = screen.getByRole('combobox', { name: 'Journal mode' });
        const searchInput = screen.getByRole('textbox', { name: 'Filter journal messages' });
        const timeButton = screen.getByRole('button', { name: 'Today' });

        expect(typeSelect).toHaveClass('rtx-journal-control', 'h-7', 'text-[13px]');
        expect(modeSelect).toHaveClass('rtx-journal-control', 'h-7', 'text-[13px]');
        expect(searchInput).toHaveClass('rtx-journal-control', 'h-7', 'text-[13px]');
        expect(timeButton).toHaveClass('rtx-journal-control', 'h-[22px]', 'text-[12px]');
        expect(typeSelect.closest('.rtx-journal-toolbar')).not.toBeNull();
    });

    it('keeps Copy visible and falls back when the preview denies Clipboard API access', async () => {
        journalHarness.getLogs.mockResolvedValue({
            count: 1,
            logs: [makeLog({ message: 'Copy fallback row' })],
        });
        clipboardWriteText.mockRejectedValueOnce(new DOMException('Clipboard permission denied', 'NotAllowedError'));
        const execCommand = vi.fn((command: string) => {
            expect(command).toBe('copy');
            expect(document.querySelector<HTMLTextAreaElement>('textarea[readonly]')?.value).toContain('Copy fallback row');
            return true;
        });
        Object.defineProperty(document, 'execCommand', {
            configurable: true,
            value: execCommand,
        });

        render(<JournalTab />);
        expect(await screen.findByText('Copy fallback row')).toBeInTheDocument();

        const copyButton = screen.getByRole('button', { name: 'Copy filtered journal' });
        expect(copyButton).not.toHaveClass('rtx-journal-advanced-control');
        fireEvent.click(copyButton);

        await waitFor(() => expect(copyButton).toHaveTextContent('Copied'));
        expect(clipboardWriteText).toHaveBeenCalledOnce();
        expect(execCommand).toHaveBeenCalledOnce();
        expect(document.querySelector('textarea[readonly]')).not.toBeInTheDocument();
    });

    it('shows Failed when both clipboard paths reject the copy', async () => {
        journalHarness.getLogs.mockResolvedValue({
            count: 1,
            logs: [makeLog({ message: 'Uncopyable row' })],
        });
        clipboardWriteText.mockRejectedValueOnce(new DOMException('Clipboard permission denied', 'NotAllowedError'));
        Object.defineProperty(document, 'execCommand', {
            configurable: true,
            value: vi.fn().mockReturnValue(false),
        });

        render(<JournalTab />);
        expect(await screen.findByText('Uncopyable row')).toBeInTheDocument();
        const copyButton = screen.getByRole('button', { name: 'Copy filtered journal' });
        fireEvent.click(copyButton);

        await waitFor(() => expect(copyButton).toHaveTextContent('Failed'));
        expect(screen.getByText('Unable to copy the filtered journal')).toBeInTheDocument();
        expect(document.querySelector('textarea[readonly]')).not.toBeInTheDocument();
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

    it('restores server timing without local samples and retains it across filters', async () => {
        const now = nowSeconds();
        journalHarness.getLogs
            .mockResolvedValueOnce({ count: 5, logs: [
                makeLog({ id: 'older-fill', type: 6, type_text: 'Trade', datetime: now - 30,
                    message: 'Order buy BTCUSD 0.01 filled', latency_ms: 12 }),
                makeLog({ id: 'history', type: 4, type_text: 'History', datetime: now,
                    message: 'Position history loaded', latency_ms: 900 }),
                makeLog({ id: 'latest-fill', type: 6, type_text: 'Trade', datetime: now - 20,
                    message: 'Order sell BTCUSD 0.01 filled', latency_ms: 37.5 }),
                makeLog({ id: 'accepted', type: 6, type_text: 'Trade', datetime: now - 10,
                    message: 'Order buy BTCUSD 0.01 accepted', latency_ms: 99 }),
                makeLog({ id: 'invalid-fill', type: 6, type_text: 'Trade', datetime: now - 5,
                    message: 'Order buy BTCUSD 0.01 filled', latency_ms: -1 }),
            ] })
            .mockResolvedValueOnce({ count: 1, logs: [makeLog({
                id: 'filtered-history', type: 4, type_text: 'History', message: 'Filtered history response',
            })] });

        render(<JournalTab />);
        const indicator = screen.getByTestId('last-trade-latency');
        await waitFor(() => expect(indicator).toHaveTextContent('Last trade latency: 37.5 ms'));
        expect(indicator).toHaveAttribute('title', 'Latest server-recorded trade execution time for this broker and account');
        fireEvent.change(screen.getByLabelText('Journal type'), { target: { value: '4' } });
        await screen.findByText('Filtered history response');
        expect(indicator).toHaveTextContent('Last trade latency: 37.5 ms');
    });

    it('prefers a newly measured local attempt over server timing', async () => {
        journalHarness.getLogs.mockResolvedValue({ count: 1, logs: [makeLog({
            id: 'server-fill', type: 6, type_text: 'Trade', message: 'Order buy BTCUSD 0.01 filled',
            latency_ms: 133,
        })] });
        render(<JournalTab />);
        const indicator = screen.getByTestId('last-trade-latency');
        await waitFor(() => expect(indicator).toHaveTextContent('Last trade latency: 133 ms'));
        act(() => {
            recordTradeOrderLatency({
                phase: 'placement_terminal', transport: 'rest', traceId: 'local-new-fill',
                sessionScope: journalHarness.sessionScope, terminalStatus: 'filled', totalMs: 42,
            });
        });
        await waitFor(() => expect(indicator).toHaveTextContent('Last trade latency: 42 ms'));
        expect(indicator).toHaveAttribute('title', 'Latest locally measured total order-attempt time for this broker and account');
        fireEvent.click(screen.getByRole('button', { name: 'Refresh journal' }));
        await waitFor(() => expect(journalHarness.getLogs).toHaveBeenCalledTimes(2));
        expect(indicator).toHaveTextContent('Last trade latency: 42 ms');
    });

    it('does not expose the previous account server timing while the new account loads', async () => {
        const nextAccountLoad = deferred<JournalResponse>();
        journalHarness.getLogs
            .mockResolvedValueOnce({ count: 1, logs: [makeLog({
                id: 'account-a-fill', type: 6, type_text: 'Trade',
                message: 'Order buy BTCUSD 0.01 filled', latency_ms: 133,
            })] })
            .mockReturnValueOnce(nextAccountLoad.promise);
        const view = render(<JournalTab />);
        const indicator = screen.getByTestId('last-trade-latency');
        await waitFor(() => expect(indicator).toHaveTextContent('Last trade latency: 133 ms'));
        journalHarness.sessionScope = 'broker-b:account-b';
        view.rerender(<JournalTab />);
        expect(indicator).toHaveTextContent('Last trade latency: \u2014');
        await act(async () => {
            nextAccountLoad.resolve({ count: 0, logs: [] });
            await nextAccountLoad.promise;
        });
        expect(indicator).toHaveTextContent('Last trade latency: \u2014');
    });

    it('renders a correlated local Journal row for an executed order', async () => {
        journalHarness.getLogs.mockResolvedValue({ count: 0, logs: [] });
        recordTradeOrderLatency({
            phase: 'placement_terminal',
            transport: 'websocket',
            traceId: '174000',
            clientOrderId: '123e4567-e89b-42d3-a456-426614174000',
            sessionScope: journalHarness.sessionScope,
            symbol: 'XAUUSD',
            side: 'buy',
            volume: 0.01,
            terminalStatus: 'filled',
            totalMs: 14.625,
        });
        // Opening Journal after a burst must preserve the completed attempt
        // even when its transport sample has left the general diagnostics ring.
        for (let index = 0; index < 250; index += 1) {
            recordTradeOrderLatency({
                phase: 'ws_enqueued', transport: 'websocket', traceId: `queued-${index}`,
                sessionScope: journalHarness.sessionScope,
            });
        }

        render(<JournalTab />);

        expect(await screen.findByText('Order executed buy XAUUSD 0.01')).toBeInTheDocument();
        expect(screen.getByText('14.63 ms')).toBeInTheDocument();
        expect(screen.getByText('1 records')).toBeInTheDocument();
        expect(screen.getByTestId('last-trade-latency')).toHaveTextContent('Last trade latency: 14.63 ms');
    });

    it('shows local trade diagnostics while the first server Journal request is pending', async () => {
        const serverLoad = deferred<JournalResponse>();
        journalHarness.getLogs.mockReturnValue(serverLoad.promise);
        recordTradeOrderLatency({
            phase: 'placement_terminal',
            transport: 'websocket',
            traceId: 'pending-journal',
            clientOrderId: '123e4567-e89b-42d3-a456-426614174010',
            sessionScope: journalHarness.sessionScope,
            symbol: 'BTCUSD',
            side: 'buy',
            volume: 0.01,
            terminalStatus: 'filled',
            totalMs: 18.5,
        });

        render(<JournalTab />);

        expect(await screen.findByText('Order executed buy BTCUSD 0.01')).toBeInTheDocument();
        expect(screen.getByText('18.5 ms')).toBeInTheDocument();
        expect(screen.getByText('Loading server journal. Showing local trade diagnostics.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Copy filtered journal' })).toBeEnabled();
    });

    it('keeps local trade diagnostics visible when the first server Journal request fails', async () => {
        journalHarness.getLogs.mockRejectedValue(new Error('journal transport unavailable'));
        recordTradeOrderLatency({
            phase: 'placement_terminal',
            transport: 'rest',
            traceId: 'failed-journal',
            clientOrderId: '123e4567-e89b-42d3-a456-426614174011',
            sessionScope: journalHarness.sessionScope,
            symbol: 'EURUSD',
            side: 'sell',
            volume: 0.02,
            terminalStatus: 'rejected',
            errorCode: 'QUOTE_STALE',
            totalMs: 26,
        });

        render(<JournalTab />);

        expect(await screen.findByText('Order rejected sell EURUSD 0.02: QUOTE_STALE')).toBeInTheDocument();
        expect(screen.getByText('26 ms')).toBeInTheDocument();
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Unable to load the server journal. Showing local trade diagnostics.',
        );
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('adds a failed terminal attempt to the Journal when its event arrives', async () => {
        journalHarness.getLogs.mockResolvedValue({ count: 0, logs: [] });
        render(<JournalTab />);
        await screen.findByText('No journal entries for the selected filters');

        act(() => {
            recordTradeOrderLatency({
                phase: 'placement_terminal',
                transport: 'rest',
                traceId: '174001',
                clientOrderId: '123e4567-e89b-42d3-a456-426614174001',
                sessionScope: journalHarness.sessionScope,
                symbol: 'XAUUSD',
                side: 'sell',
                volume: 0.02,
                terminalStatus: 'failed',
                errorCode: 'HTTP_503',
                errorMessage: 'Gateway unavailable',
                totalMs: 27.4,
            });
        });

        expect(await screen.findByText(
            'Order failed sell XAUUSD 0.02: HTTP_503: Gateway unavailable',
        )).toBeInTheDocument();
        expect(screen.getByText('27.4 ms')).toBeInTheDocument();
        expect(screen.getByText('1 records')).toBeInTheDocument();
    });

    it('keeps only the latest terminal observation for one durable client_order_id', async () => {
        journalHarness.getLogs.mockResolvedValue({ count: 0, logs: [] });
        const clientOrderId = '123e4567-e89b-42d3-a456-426614174009';
        recordTradeOrderLatency({
            phase: 'placement_terminal',
            transport: 'websocket',
            traceId: '174009',
            clientOrderId,
            sessionScope: journalHarness.sessionScope,
            symbol: 'XAUUSD',
            side: 'buy',
            volume: 0.01,
            terminalStatus: 'failed',
            errorMessage: 'Status temporarily unavailable',
            totalMs: 30,
        });
        recordTradeOrderLatency({
            phase: 'placement_terminal',
            transport: 'websocket',
            traceId: '174009',
            clientOrderId,
            sessionScope: journalHarness.sessionScope,
            symbol: 'XAUUSD',
            side: 'buy',
            volume: 0.01,
            terminalStatus: 'filled',
            totalMs: 42,
        });

        render(<JournalTab />);

        expect(await screen.findByText('Order executed buy XAUUSD 0.01')).toBeInTheDocument();
        expect(screen.queryByText(/Status temporarily unavailable/)).not.toBeInTheDocument();
        expect(screen.getAllByTestId('journal-rendered-row')).toHaveLength(1);
        expect(screen.getByText('42 ms')).toBeInTheDocument();
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
            datetime: nowSeconds() - 2 * 24 * 60 * 60,
            source: 'Terminal',
            message: 'Older connection event',
        });
        journalHarness.getLogs.mockResolvedValue({ count: 2, logs: [recentTrade, olderSystem] });

        render(<JournalTab />);
        expect(await screen.findByText('Recent order filled')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'All' }));
        expect(screen.getByText('Older connection event')).toBeInTheDocument();

        const twoHourButton = screen.getByRole('button', { name: '2h' });
        fireEvent.click(twoHourButton);
        expect(twoHourButton).toHaveAttribute('aria-pressed', 'true');
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

    it('virtualizes a 1000-entry response while copy and scrolling still use the full result', async () => {
        const now = nowSeconds();
        const logs = Array.from({ length: 1000 }, (_, index) => makeLog({
            id: `large-${index}`,
            datetime: index < 40 ? now - index * 5 : now - 2 * 60 * 60 - index,
            message: `Journal row ${index}`,
        }));
        journalHarness.getLogs.mockResolvedValue({ count: logs.length, logs });

        render(<JournalTab />);

        expect(await screen.findByText('Journal row 0')).toBeInTheDocument();
        expect(screen.getByText('1000 records')).toBeInTheDocument();
        expect(screen.getAllByTestId('journal-rendered-row').length).toBeLessThan(50);
        expect(screen.queryByText('Journal row 999')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Copy filtered journal' }));
        await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledOnce());
        expect(String(clipboardWriteText.mock.calls[0]?.[0])).toContain('Journal row 999');

        const viewport = screen.getByTestId('journal-scroll-viewport');
        act(() => {
            viewport.scrollTop = 1000 * 30;
            fireEvent.scroll(viewport);
        });

        expect(await screen.findByText('Journal row 999')).toBeInTheDocument();
        expect(screen.getAllByTestId('journal-rendered-row').length).toBeLessThan(50);

        const allButton = screen.getByRole('button', { name: 'All' });
        fireEvent.click(allButton);
        expect(allButton).toHaveAttribute('aria-pressed', 'true');
        expect(await screen.findByText('1000 records')).toBeInTheDocument();
        expect(screen.getAllByTestId('journal-rendered-row').length).toBeLessThan(50);
        expect(journalHarness.getLogs).toHaveBeenCalledTimes(1);
    });

    it('uses measured row heights for compact scrolling and reacts to later size changes', async () => {
        let rowHeight = 26;
        const observers = new Set<() => void>();
        vi.stubGlobal('ResizeObserver', class {
            constructor(private callback: () => void) { observers.add(callback); }
            observe() {}
            disconnect() { observers.delete(this.callback); }
        });
        const getRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            const height = this.matches('.rtx-journal-row, .rtx-journal-table__head') ? rowHeight : 0;
            return { x: 0, y: 0, width: 0, height, top: 0, right: 0, bottom: height, left: 0, toJSON: () => ({}) };
        });
        const logs = Array.from({ length: 1000 }, (_, index) => makeLog({
            id: `compact-${index}`,
            datetime: nowSeconds() - index,
            message: `Compact row ${index}`,
        }));
        journalHarness.getLogs.mockResolvedValue({ count: logs.length, logs });

        try {
            const view = render(<JournalTab />);
            expect(await screen.findByText('Compact row 0')).toBeInTheDocument();
            const viewport = screen.getByTestId('journal-scroll-viewport');
            act(() => {
                viewport.scrollTop = 2600;
                fireEvent.scroll(viewport);
            });
            expect(screen.getAllByTestId('journal-rendered-row')[0]).toHaveTextContent('Compact row 92');
            expect(view.container.querySelector<HTMLElement>('.rtx-journal-spacer-row')?.style.height).toBe('2392px');
            expect(view.container.querySelector<HTMLElement>('.rtx-journal-spacer-cell')?.style.lineHeight).toBe('0');

            act(() => {
                rowHeight = 32;
                [...observers].forEach(measure => measure());
            });
            expect(screen.getAllByTestId('journal-rendered-row')[0]).toHaveTextContent('Compact row 73');
            expect(view.container.querySelector<HTMLElement>('.rtx-journal-spacer-row')?.style.height).toBe('2336px');
            act(() => {
                viewport.scrollTop = 32000;
                fireEvent.scroll(viewport);
            });
            expect(screen.getByText('Compact row 999')).toBeInTheDocument();
        } finally {
            getRect.mockRestore();
            vi.unstubAllGlobals();
        }
    });

    it('updates Mode immediately and keeps the current rows mounted during the refetch', async () => {
        const standardLoad = deferred<JournalResponse>();
        journalHarness.getLogs
            .mockResolvedValueOnce({
                count: 1,
                logs: [makeLog({ id: 'full-row', message: 'Existing full mode row' })],
            })
            .mockReturnValueOnce(standardLoad.promise);

        render(<JournalTab />);
        expect(await screen.findByText('Existing full mode row')).toBeInTheDocument();

        const [, modeSelect] = screen.getAllByRole('combobox');
        fireEvent.change(modeSelect, { target: { value: '0' } });

        expect(modeSelect).toHaveValue('0');
        expect(screen.getByText('Existing full mode row')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Copy filtered journal' })).toBeDisabled();
        await waitFor(() => expect(journalHarness.getLogs).toHaveBeenCalledTimes(2));

        await act(async () => {
            standardLoad.resolve({
                count: 1,
                logs: [makeLog({ id: 'standard-row', message: 'Loaded standard mode row' })],
            });
            await standardLoad.promise;
        });

        expect(screen.getByText('Loaded standard mode row')).toBeInTheDocument();
        expect(screen.queryByText('Existing full mode row')).not.toBeInTheDocument();
    });

    it('updates Type immediately without showing a false empty state during the refetch', async () => {
        const systemLoad = deferred<JournalResponse>();
        journalHarness.getLogs
            .mockResolvedValueOnce({
                count: 1,
                logs: [makeLog({ id: 'trade-row', type: 6, type_text: 'Trade', message: 'Existing trade row' })],
            })
            .mockReturnValueOnce(systemLoad.promise);

        render(<JournalTab />);
        expect(await screen.findByText('Existing trade row')).toBeInTheDocument();

        const typeSelect = screen.getByRole('combobox', { name: 'Journal type' });
        fireEvent.change(typeSelect, { target: { value: '2' } });

        expect(typeSelect).toHaveValue('2');
        expect(screen.getByText('Existing trade row')).toBeInTheDocument();
        expect(screen.queryByText('No journal entries for the selected filters')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Copy filtered journal' })).toBeDisabled();
        await waitFor(() => expect(journalHarness.getLogs).toHaveBeenCalledTimes(2));
        expect(journalHarness.getLogs).toHaveBeenNthCalledWith(
            2,
            { mode: 2, type: 2 },
            { signal: expect.any(AbortSignal) },
        );

        await act(async () => {
            systemLoad.resolve({
                count: 1,
                logs: [makeLog({ id: 'system-row', type: 2, type_text: 'System', message: 'Loaded system row' })],
            });
            await systemLoad.promise;
        });

        expect(screen.getByText('Loaded system row')).toBeInTheDocument();
        expect(screen.queryByText('Existing trade row')).not.toBeInTheDocument();
    });

    it('aborts superseded Mode requests and commits only the latest selection', async () => {
        const standardLoad = deferred<JournalResponse>();
        const errorsLoad = deferred<JournalResponse>();
        journalHarness.getLogs
            .mockResolvedValueOnce({
                count: 1,
                logs: [makeLog({ id: 'full-row', message: 'Initial full row' })],
            })
            .mockReturnValueOnce(standardLoad.promise)
            .mockReturnValueOnce(errorsLoad.promise);

        render(<JournalTab />);
        expect(await screen.findByText('Initial full row')).toBeInTheDocument();

        const [, modeSelect] = screen.getAllByRole('combobox');
        fireEvent.change(modeSelect, { target: { value: '0' } });
        await waitFor(() => expect(journalHarness.getLogs).toHaveBeenCalledTimes(2));
        const standardSignal = journalHarness.getLogs.mock.calls[1][1].signal as AbortSignal;

        fireEvent.change(modeSelect, { target: { value: '1' } });
        await waitFor(() => expect(journalHarness.getLogs).toHaveBeenCalledTimes(3));
        expect(standardSignal.aborted).toBe(true);

        await act(async () => {
            standardLoad.resolve({
                count: 1,
                logs: [makeLog({ id: 'stale-standard', message: 'Stale standard row' })],
            });
            await standardLoad.promise;
        });
        expect(screen.queryByText('Stale standard row')).not.toBeInTheDocument();

        await act(async () => {
            errorsLoad.resolve({
                count: 1,
                logs: [makeLog({ id: 'errors-row', code: 500, message: 'Latest errors row' })],
            });
            await errorsLoad.promise;
        });

        expect(modeSelect).toHaveValue('1');
        expect(screen.getByText('Latest errors row')).toBeInTheDocument();
        expect(screen.queryByText('Stale standard row')).not.toBeInTheDocument();
    });

    it('copies only rows inside each selected hourly and longer period', async () => {
        const now = nowSeconds();
        const logs = [
            makeLog({ id: '30m', datetime: now - 30 * 60, message: 'Journal row 30 minutes old' }),
            makeLog({ id: '90m', datetime: now - 90 * 60, message: 'Journal row 90 minutes old' }),
            makeLog({ id: '150m', datetime: now - 150 * 60, message: 'Journal row 150 minutes old' }),
            makeLog({ id: '5h', datetime: now - 5 * 60 * 60, message: 'Journal row 5 hours old' }),
            makeLog({ id: '10h', datetime: now - 10 * 60 * 60, message: 'Journal row 10 hours old' }),
            makeLog({ id: '20h', datetime: now - 20 * 60 * 60, message: 'Journal row 20 hours old' }),
            makeLog({ id: '48h', datetime: now - 48 * 60 * 60, message: 'Journal row 48 hours old' }),
            makeLog({ id: '8d', datetime: now - 8 * 24 * 60 * 60, message: 'Journal row 8 days old' }),
            makeLog({ id: '40d', datetime: now - 40 * 24 * 60 * 60, message: 'Journal row 40 days old' }),
        ];
        journalHarness.getLogs.mockResolvedValue({ count: logs.length, logs });

        render(<JournalTab />);
        expect(await screen.findByText('Journal row 30 minutes old')).toBeInTheDocument();

        expect(screen.queryByRole('button', { name: '3h' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '6h' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Month' })).not.toBeInTheDocument();

        const cases = [
            { range: '2h', included: logs.slice(0, 2), excluded: logs.slice(2) },
            { range: 'Today', included: logs.slice(0, 6), excluded: logs.slice(6) },
            { range: 'Week', included: logs.slice(0, 7), excluded: logs.slice(7) },
            { range: 'All', included: logs, excluded: [] },
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
            makeLog({ id: 'trade-old', type: 6, type_text: 'Trade', datetime: nowSeconds() - 2 * 24 * 60 * 60, message: 'Needle old trade' }),
            makeLog({ id: 'system-match', type: 2, type_text: 'System', datetime: nowSeconds() - 5 * 60, message: 'Needle system event' }),
        ];
        journalHarness.getLogs.mockResolvedValue({ count: logs.length, logs });

        render(<JournalTab />);
        expect(await screen.findByText('Needle trade accepted')).toBeInTheDocument();

        const [typeSelect] = screen.getAllByRole('combobox');
        fireEvent.change(typeSelect, { target: { value: '6' } });
        await waitFor(() => expect(journalHarness.getLogs).toHaveBeenCalledTimes(2));
        await screen.findByText('Needle trade accepted');
        fireEvent.click(screen.getByRole('button', { name: 'Today' }));
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

    it('merges local latency into a terminal server row only by exact client_order_id', async () => {
        const clientOrderId = '123e4567-e89b-42d3-a456-426614174002';
        const message = 'Order rejected buy XAUUSD 0.01: Quote is stale';
        journalHarness.getLogs.mockResolvedValue({
            count: 1,
            logs: [makeLog({
                id: 'server-rejection',
                client_order_id: clientOrderId,
                code: 1,
                code_text: 'ERROR',
                type: 6,
                type_text: 'Trade',
                source: 'Gateway',
                message,
            })],
        });
        recordTradeOrderLatency({
            phase: 'placement_terminal',
            transport: 'websocket',
            traceId: '174002',
            clientOrderId,
            sessionScope: journalHarness.sessionScope,
            symbol: 'XAUUSD',
            side: 'buy',
            volume: 0.01,
            terminalStatus: 'rejected',
            errorMessage: 'Quote is stale',
            totalMs: 31.25,
        });

        render(<JournalTab />);

        expect(await screen.findByTitle('Gateway')).toBeInTheDocument();
        expect(screen.getByText(message)).toBeInTheDocument();
        expect(screen.getAllByTestId('journal-rendered-row')).toHaveLength(1);
        expect(screen.getByText('31.25 ms')).toBeInTheDocument();
        expect(screen.queryByText('Order rejected buy XAUUSD 0.01: Quote is stale', { selector: '[title]' })).toBeInTheDocument();
    });

    it('defers to a contradictory authoritative terminal row without mislabeling its latency', async () => {
        const clientOrderId = '123e4567-e89b-42d3-a456-426614174003';
        journalHarness.getLogs.mockResolvedValue({
            count: 1,
            logs: [makeLog({
                id: 'server-fill',
                client_order_id: clientOrderId,
                type: 6,
                type_text: 'Trade',
                source: 'Gateway',
                message: 'Order buy XAUUSD 0.01 filled',
            })],
        });
        recordTradeOrderLatency({
            phase: 'placement_terminal',
            transport: 'websocket',
            traceId: '174003',
            clientOrderId,
            sessionScope: journalHarness.sessionScope,
            symbol: 'XAUUSD',
            side: 'buy',
            volume: 0.01,
            terminalStatus: 'failed',
            errorMessage: 'Local status timeout',
            totalMs: 30_000,
        });

        render(<JournalTab />);

        expect(await screen.findByText('Order buy XAUUSD 0.01 filled')).toBeInTheDocument();
        expect(screen.queryByText(/Local status timeout/)).not.toBeInTheDocument();
        expect(screen.getAllByTestId('journal-rendered-row')).toHaveLength(1);
        expect(screen.getByText('\u2014')).toBeInTheDocument();
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

    it('never exposes retained local rows after the account scope changes', async () => {
        const newScopeLoad = deferred<JournalResponse>();
        journalHarness.getLogs
            .mockResolvedValueOnce({ count: 0, logs: [] })
            .mockReturnValueOnce(newScopeLoad.promise);
        recordTradeOrderLatency({
            phase: 'placement_terminal',
            transport: 'websocket',
            traceId: 'old-account-trade',
            clientOrderId: '123e4567-e89b-42d3-a456-426614174012',
            sessionScope: journalHarness.sessionScope,
            symbol: 'XAUUSD',
            side: 'buy',
            volume: 0.01,
            terminalStatus: 'filled',
            totalMs: 12,
        });

        const view = render(<JournalTab />);
        expect(await screen.findByText('Order executed buy XAUUSD 0.01')).toBeInTheDocument();

        journalHarness.sessionScope = 'broker-b:account-b';
        view.rerender(<JournalTab />);

        expect(screen.queryByText('Order executed buy XAUUSD 0.01')).not.toBeInTheDocument();
        await waitFor(() => expect(journalHarness.getLogs).toHaveBeenCalledTimes(2));
        expect(screen.getByText(/Loading server journal/)).toBeInTheDocument();

        await act(async () => {
            newScopeLoad.resolve({ count: 0, logs: [] });
            await newScopeLoad.promise;
        });
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

    it('does not poll and aborts a manual refresh when unmounted', async () => {
        vi.useFakeTimers();
        const initialLoad = deferred<JournalResponse>();
        const manualLoad = deferred<JournalResponse>();
        journalHarness.getLogs
            .mockReturnValueOnce(initialLoad.promise)
            .mockReturnValueOnce(manualLoad.promise);

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
            vi.advanceTimersByTime(60000);
        });
        expect(journalHarness.getLogs).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Refresh journal' }));
        expect(journalHarness.getLogs).toHaveBeenCalledTimes(2);
        const manualSignal = journalHarness.getLogs.mock.calls[1][1].signal as AbortSignal;

        act(() => {
            vi.advanceTimersByTime(30000);
        });
        expect(journalHarness.getLogs).toHaveBeenCalledTimes(2);

        view.unmount();
        expect(manualSignal.aborted).toBe(true);

        await act(async () => {
            manualLoad.resolve({ count: 0, logs: [] });
            await manualLoad.promise;
        });
        act(() => {
            vi.advanceTimersByTime(30000);
        });
        expect(journalHarness.getLogs).toHaveBeenCalledTimes(2);
    });
});

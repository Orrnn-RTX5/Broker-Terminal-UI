import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModifyPositionDialog } from './ModifyPositionDialog';
import { commitBrokerAccountSessionScope } from '../services/brokerSession';

const mocks = vi.hoisted(() => ({
    closePosition: vi.fn(),
    modifyPendingOrder: vi.fn(),
    modifyPosition: vi.fn(),
    placeMarketOrder: vi.fn(),
    setPositions: vi.fn(),
    positions: [] as any[],
    tick: {
        symbol: 'GBPUSD', bid: 1.33981, ask: 1.33983, spread: 2,
        timestamp: 1_797_341_377_000,
    },
}));

vi.mock('../store/useMarketDataStore', () => ({
    useCurrentTick: () => mocks.tick,
}));

vi.mock('../store/useAppStore', () => ({
    useAppStore: {
        getState: () => ({
            positions: mocks.positions,
            setPositions: mocks.setPositions,
        }),
    },
}));

vi.mock('../services/api', () => ({
    default: {
        orders: {
            modifyPendingOrder: mocks.modifyPendingOrder,
            placeMarketOrder: mocks.placeMarketOrder,
        },
        positions: {
            closePosition: mocks.closePosition,
            modifyPosition: mocks.modifyPosition,
        },
    },
}));

const makePosition = (id = 165) => ({
    id,
    symbol: 'GBPUSD',
    side: 'BUY' as const,
    volume: 0.01,
    openPrice: 1.33981,
    sl: 0,
    tp: 0,
    comment: '',
});

describe('ModifyPositionDialog chart toolbar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.positions = [];
        mocks.tick = {
            symbol: 'GBPUSD', bid: 1.33981, ask: 1.33983, spread: 2,
            timestamp: 1_797_341_377_000,
        };
        mocks.modifyPosition.mockResolvedValue(undefined);
        mocks.modifyPendingOrder.mockResolvedValue(undefined);
        mocks.placeMarketOrder.mockResolvedValue(undefined);
        mocks.closePosition.mockResolvedValue(undefined);
        commitBrokerAccountSessionScope({
            authenticated: true,
            accountId: '77',
            brokerId: 'broker-a',
            serverUrl: 'https://broker.example',
        });
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
    });

    it('commits only the opening ticket values on first open, ticket switch, and reopen', () => {
        const commits: Array<{ title: string; sl: string; tp: string; volume: string; comment: string }> = [];
        const recordCommit = () => {
            const dialog = document.querySelector('[role="dialog"]');
            if (!dialog) return;
            const value = (field: string) => dialog.querySelector<HTMLInputElement>(`input[id$="-${field}"]`)!.value;
            commits.push({
                title: document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent!,
                sl: value('sl'), tp: value('tp'), volume: value('volume'), comment: value('comment'),
            });
        };
        const first = { ...makePosition(165), sl: 1.31, tp: 1.37, volume: 0.02, comment: 'First position' };
        const second = { ...makePosition(166), comment: 'Second position' };
        const renderDialog = (position: typeof first, isOpen = true) => (
            <Profiler id="modify-dialog" onRender={recordCommit}>
                <ModifyPositionDialog isOpen={isOpen} onClose={vi.fn()} position={position} />
            </Profiler>
        );
        const { rerender } = render(renderDialog(first));
        expect(commits[0]).toEqual({
            title: expect.stringContaining('#165'), sl: '1.31000', tp: '1.37000', volume: '0.02', comment: 'First position',
        });
        commits.length = 0;
        rerender(renderDialog(second));
        expect(commits.length).toBeGreaterThan(0);
        expect(commits.every(commit => commit.title.includes('#166') && commit.sl === '0.00' && commit.tp === '0.00'
            && commit.volume === '0.01' && commit.comment === 'Second position')).toBe(true);

        fireEvent.change(screen.getByLabelText(/stop loss:$/i), { target: { value: '1.28' } });
        rerender(renderDialog(second, false));
        commits.length = 0;
        rerender(renderDialog({ ...second, sl: 1.32, tp: 1.38 }));
        expect(commits[0]).toEqual({
            title: expect.stringContaining('#166'), sl: '1.32000', tp: '1.38000', volume: '0.01', comment: 'Second position',
        });
        expect(mocks.modifyPosition).not.toHaveBeenCalled();
    });

    it('preserves an edited draft when quotes and the same position object refresh', async () => {
        const position = { ...makePosition(167), sl: 1.31, tp: 1.37, comment: 'Original' };
        const { rerender } = render(<ModifyPositionDialog isOpen onClose={vi.fn()} position={position} />);
        fireEvent.change(screen.getByLabelText(/stop loss:$/i), { target: { value: '1.30' } });
        fireEvent.change(screen.getByLabelText(/comment/i), { target: { value: 'My draft' } });
        mocks.tick = { ...mocks.tick, bid: 1.34, ask: 1.34002, timestamp: mocks.tick.timestamp + 1_000 };
        rerender(<ModifyPositionDialog isOpen onClose={vi.fn()} position={{ ...position }} />);
        expect(screen.getByLabelText(/stop loss:$/i)).toHaveValue(1.3);
        expect(screen.getByLabelText(/take profit:$/i)).toHaveValue(1.37);
        expect(screen.getByLabelText(/comment/i)).toHaveValue('My draft');
        fireEvent.click(screen.getByRole('button', { name: /modify #167/i }));
        await waitFor(() => expect(mocks.modifyPosition).toHaveBeenCalledWith(167, { price_sl: 1.3, comment: 'My draft' }));
    });

    it('does not close or move focus when Escape/Tab belongs to a newer local dialog', async () => {
        const onClose = vi.fn();
        render(<ModifyPositionDialog isOpen onClose={onClose} position={{
            id: 164, symbol: 'GBPUSD', side: 'BUY', volume: 0.01,
            openPrice: 1.33981, sl: 0, tp: 0, comment: '',
        }} />);
        const dialog = screen.getByRole('dialog');
        await waitFor(() => expect(dialog).toHaveFocus());
        const help = document.createElement('div'); help.setAttribute('role', 'dialog'); help.dataset.shortcutScope = 'local';
        const button = document.createElement('button'); help.append(button); document.body.append(help); button.focus();
        const local = vi.fn(); help.addEventListener('keydown', local);
        try {
            fireEvent.keyDown(button, { key: 'Escape', cancelable: true });
            fireEvent.keyDown(button, { key: 'Tab', shiftKey: true, cancelable: true });
            expect(local).toHaveBeenCalledTimes(2);
            expect(button).toHaveFocus(); expect(onClose).not.toHaveBeenCalled();
        } finally { help.remove(); }
        dialog.focus(); fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
        expect(mocks.closePosition).not.toHaveBeenCalled();
        expect(mocks.modifyPosition).not.toHaveBeenCalled();
        expect(mocks.placeMarketOrder).not.toHaveBeenCalled();
    });

    it('hides and restores the mini chart from the chart toolbar button', async () => {
        const user = userEvent.setup();

        render(
            <ModifyPositionDialog
                isOpen
                onClose={vi.fn()}
                position={{
                    id: 164,
                    symbol: 'GBPUSD',
                    side: 'BUY',
                    volume: 0.01,
                    openPrice: 1.33981,
                    sl: 1.34004,
                    tp: 1.33931,
                    comment: '',
                }}
            />
        );

        expect(screen.getByRole('img', { name: /gbpusd bid and ask tick chart/i })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Hide chart' }));
        expect(screen.queryByRole('img', { name: /gbpusd bid and ask tick chart/i })).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Show chart' }));
        expect(screen.getByRole('img', { name: /gbpusd bid and ask tick chart/i })).toBeInTheDocument();
    });

    it('opens and closes the embedded market depth ladder from the first toolbar button', async () => {
        const user = userEvent.setup();

        render(
            <ModifyPositionDialog
                isOpen
                onClose={vi.fn()}
                position={{
                    id: 164,
                    symbol: 'GBPUSD',
                    side: 'BUY',
                    volume: 0.01,
                    openPrice: 1.33981,
                    sl: 1.34004,
                    tp: 1.33931,
                    comment: '',
                }}
            />
        );

        expect(screen.queryByRole('region', { name: /gbpusd market depth/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Pointer' })).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Show market depth' }));
        expect(screen.getByRole('region', { name: /gbpusd market depth/i })).toBeInTheDocument();
        expect(screen.getByText('Trade')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Hide market depth' }));
        expect(screen.queryByRole('region', { name: /gbpusd market depth/i })).not.toBeInTheDocument();
    });

    it('sends modified comments and returns them for the trade table override', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();

        render(
            <ModifyPositionDialog
                isOpen
                onClose={onClose}
                position={{
                    id: 165,
                    symbol: 'GBPUSD',
                    side: 'BUY',
                    volume: 0.01,
                    openPrice: 1.33981,
                    sl: 0,
                    tp: 0,
                    comment: '',
                }}
            />
        );

        await user.type(screen.getByLabelText(/comment/i), 'hiiii');
        await user.click(screen.getByRole('button', { name: /modify #165/i }));

        await waitFor(() => {
            expect(mocks.modifyPosition).toHaveBeenCalledWith(165, {
                comment: 'hiiii',
            });
        });
        await waitFor(() => expect(onClose).toHaveBeenCalledWith(0, 0, 'hiiii'));
    });

    it('blocks submission after the dialog trading scope becomes stale', () => {
        render(<ModifyPositionDialog isOpen onClose={vi.fn()} position={makePosition(168)} />);

        act(() => commitBrokerAccountSessionScope({
            authenticated: true,
            accountId: '88',
            brokerId: 'broker-a',
            serverUrl: 'https://broker.example',
        }));
        fireEvent.click(screen.getByRole('button', { name: /modify #168/i }));

        expect(mocks.modifyPosition).not.toHaveBeenCalled();
        expect(mocks.setPositions).not.toHaveBeenCalled();
        expect(screen.getByText('Trading session changed. Reopen the position and try again.')).toBeInTheDocument();
    });

    it('routes Close by Market through the shared fast-close coordinator and closes immediately', async () => {
        let resolveClose: ((value: boolean) => void) | null = null;
        const pendingClose = new Promise<boolean>(resolve => { resolveClose = resolve; });
        const onClosePosition = vi.fn(() => pendingClose);
        const onClose = vi.fn();

        render(
            <ModifyPositionDialog
                isOpen
                onClose={onClose}
                onClosePosition={onClosePosition}
                position={makePosition(171)}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /close #171 buy .* by market/i }));

        expect(onClosePosition).toHaveBeenCalledWith(171);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mocks.closePosition).not.toHaveBeenCalled();
        expect(mocks.setPositions).not.toHaveBeenCalled();

        await act(async () => {
            resolveClose?.(true);
            await pendingClose;
        });
    });

    it('ignores a modify acknowledgement that resolves after the trading scope changes', async () => {
        let resolveModify: (() => void) | null = null;
        const pendingModify = new Promise<void>(resolve => { resolveModify = resolve; });
        const position = makePosition(169);
        mocks.positions = [position];
        mocks.modifyPosition.mockReturnValueOnce(pendingModify);
        const onClose = vi.fn();
        const forceRefresh = vi.fn();
        window.addEventListener('rtx:force-refresh-positions', forceRefresh);

        try {
            render(<ModifyPositionDialog isOpen onClose={onClose} position={position} />);
            fireEvent.click(screen.getByRole('button', { name: /modify #169/i }));
            expect(mocks.modifyPosition).toHaveBeenCalledOnce();

            act(() => commitBrokerAccountSessionScope({
                authenticated: true,
                accountId: '88',
                brokerId: 'broker-a',
                serverUrl: 'https://broker.example',
            }));
            await act(async () => {
                resolveModify?.();
                await pendingModify;
            });

            expect(mocks.setPositions).not.toHaveBeenCalled();
            expect(forceRefresh).not.toHaveBeenCalled();
            expect(onClose).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener('rtx:force-refresh-positions', forceRefresh);
        }
    });

    it('cancels the delayed saved close when the trading scope changes', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const onClose = vi.fn();
        const position = makePosition(170);
        mocks.positions = [position];
        render(<ModifyPositionDialog isOpen onClose={onClose} position={position} />);
        act(() => vi.runOnlyPendingTimers());

        fireEvent.click(screen.getByRole('button', { name: /modify #170/i }));
        await act(async () => {
            await Promise.resolve();
        });
        // Moving focus makes jsdom fire `selectionchange` from its own 0ms
        // setTimeout; drain it so only the dialog's delayed close is counted.
        act(() => vi.advanceTimersByTime(0));
        expect(vi.getTimerCount()).toBe(1);

        act(() => commitBrokerAccountSessionScope({
            authenticated: true,
            accountId: '88',
            brokerId: 'broker-a',
            serverUrl: 'https://broker.example',
        }));
        act(() => vi.advanceTimersByTime(0));
        expect(vi.getTimerCount()).toBe(0);
        act(() => vi.advanceTimersByTime(600));
        expect(onClose).not.toHaveBeenCalled();
    });

    it.each([
        { label: /stop loss:$/i, value: '1.32', patch: { price_sl: 1.32 } },
        { label: /take profit:$/i, value: '1.38', patch: { price_tp: 1.38 } },
        { label: /stop loss:$/i, value: '0', patch: { price_sl: 0 } },
        { label: /take profit:$/i, value: '0', patch: { price_tp: 0 } },
    ])('sends only the edited level: $patch', async ({ label, value, patch }) => {
        const user = userEvent.setup();
        const position = {
            id: 166, symbol: 'GBPUSD', side: 'BUY' as const, volume: 0.01,
            openPrice: 1.34, sl: 1.31, tp: 1.37, comment: '',
            price_sl: 1.31, price_tp: 1.37,
            stopLoss: 1.31, stop_loss: 1.31, takeProfit: 1.37, take_profit: 1.37,
        };
        mocks.positions = [position];
        render(<ModifyPositionDialog isOpen onClose={vi.fn()} position={position} />);
        const input = screen.getByLabelText(label);
        await user.clear(input);
        await user.type(input, value);
        await user.click(screen.getByRole('button', { name: /modify #166/i }));
        await waitFor(() => expect(mocks.modifyPosition).toHaveBeenCalledWith(166, { ...patch, comment: '' }));
        const sl = patch.price_sl ?? position.sl;
        const tp = patch.price_tp ?? position.tp;
        expect(mocks.setPositions).toHaveBeenCalledWith([expect.objectContaining({
            sl, price_sl: sl, stopLoss: sl, stop_loss: sl,
            tp, price_tp: tp, takeProfit: tp, take_profit: tp,
        })]);
    });

    it('renders the 5 points difference notice and enhanced left chart elements', () => {
        render(
            <ModifyPositionDialog
                isOpen
                onClose={vi.fn()}
                position={{
                    id: 167,
                    symbol: 'BTCUSD',
                    side: 'BUY',
                    volume: 0.01,
                    openPrice: 85981.44,
                    sl: 0,
                    tp: 0,
                    comment: '',
                }}
            />
        );

        // Requirement 1: 5 points notice
        expect(screen.getByText(/Stop Loss or Take Profit you set must differ from market price by at least 5 points\./i)).toBeInTheDocument();
        expect(screen.getByText(/Stops processing is performed on the broker side\./i)).toBeInTheDocument();

        // Requirement 2: Left side chart elements
        expect(screen.getByText('TICK')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: /btcusd bid and ask tick chart/i })).toBeInTheDocument();
    });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModifyPositionDialog } from './ModifyPositionDialog';

const mocks = vi.hoisted(() => ({
    closePosition: vi.fn(),
    modifyPendingOrder: vi.fn(),
    modifyPosition: vi.fn(),
    placeMarketOrder: vi.fn(),
    setPositions: vi.fn(),
}));

vi.mock('../store/useMarketDataStore', () => ({
    useCurrentTick: () => ({
        symbol: 'GBPUSD',
        bid: 1.33981,
        ask: 1.33983,
        spread: 2,
        timestamp: 1_797_341_377_000,
    }),
}));

vi.mock('../store/useAppStore', () => ({
    useAppStore: {
        getState: () => ({
            positions: [],
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

describe('ModifyPositionDialog chart toolbar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.modifyPosition.mockResolvedValue(undefined);
        mocks.modifyPendingOrder.mockResolvedValue(undefined);
        mocks.placeMarketOrder.mockResolvedValue(undefined);
        mocks.closePosition.mockResolvedValue(undefined);
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

    it.each([
        { label: /stop loss:$/i, value: '1.32', patch: { price_sl: 1.32 } },
        { label: /take profit:$/i, value: '1.38', patch: { price_tp: 1.38 } },
        { label: /stop loss:$/i, value: '0', patch: { price_sl: 0 } },
        { label: /take profit:$/i, value: '0', patch: { price_tp: 0 } },
    ])('sends only the edited level: $patch', async ({ label, value, patch }) => {
        const user = userEvent.setup();
        render(<ModifyPositionDialog isOpen onClose={vi.fn()} position={{
            id: 166, symbol: 'GBPUSD', side: 'BUY', volume: 0.01,
            openPrice: 1.34, sl: 1.31, tp: 1.37, comment: '',
        }} />);
        const input = screen.getByLabelText(label);
        await user.clear(input);
        await user.type(input, value);
        await user.click(screen.getByRole('button', { name: /modify #166/i }));
        await waitFor(() => expect(mocks.modifyPosition).toHaveBeenCalledWith(166, { ...patch, comment: '' }));
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

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModifyPositionDialog } from './ModifyPositionDialog';
import { commitBrokerAccountSessionScope } from '../services/brokerSession';

const mocks = vi.hoisted(() => ({
    modifyPendingOrder: vi.fn(),
    modifyPosition: vi.fn(),
    tick: null as null | { symbol: string; bid: number; ask: number; spread: number; timestamp: number },
}));

vi.mock('../store/useMarketDataStore', () => ({
    useCurrentTick: () => mocks.tick,
}));

vi.mock('../store/useAppStore', () => ({
    useAppStore: {
        getState: () => ({ positions: [], accountId: '77' }),
    },
}));

vi.mock('../services/api', () => ({
    default: {
        orders: { modifyPendingOrder: mocks.modifyPendingOrder },
        positions: { modifyPosition: mocks.modifyPosition },
    },
}));

const makePosition = (overrides: Record<string, unknown> = {}) => ({
    id: 201,
    symbol: 'GBPUSD',
    side: 'BUY' as const,
    volume: 0.01,
    openPrice: 1.33981,
    sl: 0,
    tp: 0,
    comment: '',
    ...overrides,
});

const slInput = () => screen.getByLabelText(/stop loss:$/i) as HTMLInputElement;
const tpInput = () => screen.getByLabelText(/take profit:$/i) as HTMLInputElement;

describe('ModifyPositionDialog SL/TP seeding (no fake 0.00)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.tick = { symbol: 'GBPUSD', bid: 1.33981, ask: 1.33983, spread: 2, timestamp: 1_797_341_377_000 };
        commitBrokerAccountSessionScope({
            authenticated: true,
            accountId: '77',
            brokerId: 'broker-a',
            serverUrl: 'https://broker.example',
        });
    });

    afterEach(() => {
        cleanup();
        commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
    });

    it('seeds empty SL/TP on the valid side of the live quote', () => {
        render(<ModifyPositionDialog isOpen onClose={vi.fn()} position={makePosition()} />);
        // BUY: SL below Bid 1.33981, TP above Bid, 5-digit 5pt standoff.
        expect(slInput().value).toBe('1.33976');
        expect(tpInput().value).toBe('1.33986');
        expect(slInput().value).not.toBe('0.00');
        expect(tpInput().value).not.toBe('0.00');
    });

    it('seeds from the open price when no tick is available', () => {
        mocks.tick = null;
        render(<ModifyPositionDialog isOpen onClose={vi.fn()} position={makePosition()} />);
        // BUY open 1.33981: same geometry as the quote case.
        expect(slInput().value).toBe('1.33976');
        expect(tpInput().value).toBe('1.33986');
    });

    it('disables the inputs with a visible reason when no reference price exists', () => {
        mocks.tick = null;
        render(<ModifyPositionDialog isOpen onClose={vi.fn()} position={makePosition({ openPrice: 0 })} />);
        expect(slInput().value).not.toBe('0.00');
        expect(tpInput().value).not.toBe('0.00');
        expect(slInput().disabled).toBe(true);
        expect(tpInput().disabled).toBe(true);
        expect(screen.getByText('No live price is available to place Stop Loss or Take Profit levels')).not.toBeNull();
    });

    it('shows the position volume on the close button instead of a fake zero', () => {
        render(<ModifyPositionDialog isOpen onClose={vi.fn()} position={makePosition()} />);
        expect(screen.getByRole('button', { name: /close #201 buy 0\.01 gbpusd/i })).not.toBeNull();
    });
});

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModifyPositionDialog } from './ModifyPositionDialog';
import { commitBrokerAccountSessionScope } from '../services/brokerSession';
import {
    registerDailyChangePriceModes,
    resetDailyChangePriceModeRegistryForTests,
} from '../services/dailyChangePriceModeRegistry';

const mocks = vi.hoisted(() => ({
    modifyPendingOrder: vi.fn(),
    modifyPosition: vi.fn(),
    placeMarketOrder: vi.fn(),
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
        orders: { modifyPendingOrder: mocks.modifyPendingOrder, placeMarketOrder: mocks.placeMarketOrder },
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

describe('ModifyPositionDialog spec digits (position.digits over name table)', () => {
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

    it('spec digits win: TESTFIX position.digits=3 seeds and submits at 3 digits, not the name-table 5', async () => {
        // 'TESTFIX' matches none of the getSymbolDigits name-table keys
        // (JPY/BTC/ETH/XAU/XAG/XPT/XPD/NAS/SPX/DJ/US30/US500/NDX), so the
        // table alone would yield the default 5. The symbols API supplied
        // digits=3 on the position; the tick carries no digits field, so
        // initialDigits falls to position.digits (spec path).
        mocks.tick = { symbol: 'TESTFIX', bid: 1.234, ask: 1.236, spread: 2, timestamp: 1_797_341_377_000 };
        mocks.modifyPosition.mockResolvedValueOnce(undefined);
        render(<ModifyPositionDialog isOpen onClose={vi.fn()} position={makePosition({ symbol: 'TESTFIX', openPrice: 1.234, digits: 3 })} />);
        // BUY: SL below Bid 1.234, TP above Bid, 3-digit 5pt standoff.
        // A 5-digit fallback would seed '1.23395' / '1.23405' instead.
        expect(slInput().value).toBe('1.229');
        expect(tpInput().value).toBe('1.239');
        expect(slInput().value).not.toBe('1.23395');
        expect(tpInput().value).not.toBe('1.23405');
        // Free-typed levels arrive rounded to the 3-digit grid, not raw.
        fireEvent.change(slInput(), { target: { value: '1.22844' } });
        fireEvent.change(tpInput(), { target: { value: '1.23966' } });
        fireEvent.click(screen.getByRole('button', { name: /modify #201/i }));
        await waitFor(() => expect(mocks.modifyPosition).toHaveBeenCalled());
        const payload = mocks.modifyPosition.mock.calls[0][1] as { price_sl?: number; price_tp?: number };
        expect(payload.price_sl).toBe(1.228);
        expect(payload.price_tp).toBe(1.24);
        expect(payload.price_sl).not.toBe(1.22844);
        expect(payload.price_tp).not.toBe(1.23966);
    });

    it('no digits anywhere: blank seeds, no name-table guessing', () => {
        // Neither the position nor the tick carries digits. The dialog must
        // NOT guess via the name table: seeds stay blank (price reference
        // exists so the price inputs stay enabled), points inputs disable.
        mocks.tick = { symbol: 'TESTFIX', bid: 1.234, ask: 1.236, spread: 2, timestamp: 1_797_341_377_000 };
        render(<ModifyPositionDialog isOpen onClose={vi.fn()} position={makePosition({ symbol: 'TESTFIX', openPrice: 1.234 })} />);
        expect(slInput().value).not.toBe('0.00');
        expect(tpInput().value).not.toBe('0.00');
        expect(slInput().value).toBe('');
        expect(tpInput().value).toBe('');
        expect(slInput().disabled).toBe(false);
        expect(tpInput().disabled).toBe(false);
        expect(screen.getByRole('button', { name: /modify #201/i })).not.toBeNull();
    });

    it('unknown digits: submit sends the typed value UNROUNDED', async () => {
        mocks.modifyPosition.mockResolvedValueOnce(undefined);
        mocks.tick = { symbol: 'TESTFIX', bid: 1.234, ask: 1.236, spread: 2, timestamp: 1_797_341_377_000 };
        render(<ModifyPositionDialog isOpen onClose={vi.fn()} position={makePosition({ symbol: 'TESTFIX', openPrice: 1.234 })} />);
        fireEvent.change(slInput(), { target: { value: '1.228444' } });
        fireEvent.change(tpInput(), { target: { value: '1.239666' } });
        fireEvent.click(screen.getByRole('button', { name: /modify #201/i }));
        await waitFor(() => expect(mocks.modifyPosition).toHaveBeenCalled());
        const payload = mocks.modifyPosition.mock.calls[0][1] as { price_sl?: number; price_tp?: number };
        // Sent exactly as typed (no rounding by guessed precision).
        expect(payload.price_sl).toBe(1.228444);
        expect(payload.price_tp).toBe(1.239666);
    });
});

describe('ModifyPositionDialog broker catalog geometry (no name table, no default digits)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        commitBrokerAccountSessionScope({
            authenticated: true,
            accountId: '77',
            brokerId: 'broker-a',
            serverUrl: 'https://broker.example',
        });
        resetDailyChangePriceModeRegistryForTests();
    });

    afterEach(() => {
        cleanup();
        commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
        resetDailyChangePriceModeRegistryForTests();
    });

    it('digits present: catalog digits + tick size round typed levels to the broker grid', async () => {
        // Catalog spec wins over the quote/position fields (and over any name guess).
        registerDailyChangePriceModes([{ symbol: 'TESTFIX', digits: 2, tickSize: 0.05 }]);
        mocks.tick = { symbol: 'TESTFIX', bid: 100, ask: 100.1, spread: 10, timestamp: 1_797_341_377_000 };
        mocks.modifyPosition.mockResolvedValueOnce(undefined);
        render(<ModifyPositionDialog isOpen onClose={vi.fn()} position={makePosition({ symbol: 'TESTFIX', openPrice: 100, digits: 5 })} />);
        fireEvent.change(slInput(), { target: { value: '99.92' } });
        fireEvent.change(tpInput(), { target: { value: '101.13' } });
        fireEvent.click(screen.getByRole('button', { name: /modify #201/i }));
        await waitFor(() => expect(mocks.modifyPosition).toHaveBeenCalled());
        const payload = mocks.modifyPosition.mock.calls[0][1] as { price_sl?: number; price_tp?: number };
        expect(payload.price_sl).toBe(99.9);
        expect(payload.price_tp).toBe(101.15);
    });

    it('digits null: existing levels show as stored and a hedge order sends the typed value', async () => {
        mocks.tick = { symbol: 'TESTFIX', bid: 1.234, ask: 1.236, spread: 2, timestamp: 1_797_341_377_000 };
        mocks.placeMarketOrder.mockResolvedValueOnce(undefined);
        expect(() => render(
            <ModifyPositionDialog isOpen onClose={vi.fn()} position={makePosition({ symbol: 'TESTFIX', openPrice: 1.234, sl: 1.2283, tp: 1.24 })} />,
        )).not.toThrow();
        // No toFixed(null)/default-2 formatting: '1.2283' would become '1' or '1.23'.
        expect(slInput().value).toBe('1.2283');
        expect(tpInput().value).toBe('1.24');
        fireEvent.change(slInput(), { target: { value: '1.2283417' } });
        fireEvent.click(screen.getByRole('button', { name: /buy by market/i }));
        await waitFor(() => expect(mocks.placeMarketOrder).toHaveBeenCalled());
        const payload = mocks.placeMarketOrder.mock.calls[0][0] as { price_sl?: number };
        expect(payload.price_sl).toBe(1.2283417);
    });

    it('side check: wrong-side SL is marked invalid, one tick below Bid is valid (no distance rule)', () => {
        registerDailyChangePriceModes([{ symbol: 'TESTFIX', digits: 3 }]);
        mocks.tick = { symbol: 'TESTFIX', bid: 1.234, ask: 1.236, spread: 2, timestamp: 1_797_341_377_000 };
        render(<ModifyPositionDialog isOpen onClose={vi.fn()} position={makePosition({ symbol: 'TESTFIX', openPrice: 1.234 })} />);
        fireEvent.change(slInput(), { target: { value: '1.234' } });
        expect(slInput().getAttribute('aria-invalid')).toBe('true');
        expect(slInput().title).toMatch(/Stop loss must be below the current Bid 1\.234 for a BUY/);
        fireEvent.change(slInput(), { target: { value: '1.233' } });
        expect(slInput().getAttribute('aria-invalid')).toBeNull();
        fireEvent.change(tpInput(), { target: { value: '1.235' } });
        expect(tpInput().getAttribute('aria-invalid')).toBeNull();
    });
});

// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import type { GatewayClosedPosition, GatewayDeal } from '../api/tradeGateway';
import { useAppStore } from '../store/useAppStore';
import { BottomDock } from './BottomDock';

const toolboxMocks = vi.hoisted(() => ({
    refresh: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../hooks/useToolboxTradeData', () => ({
    useToolboxTradeData: () => ({
        account: null,
        positions: [],
        pendingPositions: [],
        loading: false,
        error: null,
        login: 200001,
        restBaseUrl: '',
        wsUrl: '',
        wsState: 'connected',
        lastRestAt: null,
        lastWsAt: null,
        debug: [],
        refresh: toolboxMocks.refresh,
        removePosition: vi.fn(),
        removePositionsByMode: vi.fn(),
    }),
}));

vi.mock('./ModifyPositionDialog', () => ({
    ModifyPositionDialog: () => null,
}));

vi.mock('./layout/CalendarTab', () => ({
    CalendarTab: () => null,
}));

vi.mock('./layout/ResearchTabs', () => ({
    CodeBaseTab: () => null,
    ArticlesTab: () => null,
    ExpertsTab: () => null,
}));

vi.mock('./layout/JournalTab', () => ({
    JournalTab: () => null,
}));

const LIVE_PAIR_COUNT = 72;
const BASE_TIME_SECONDS = 1_788_134_400;
const FALLBACK_POSITION_TICKET = 999_999;

const buildLiveShapedDeals = (): GatewayDeal[] => (
    Array.from({ length: LIVE_PAIR_COUNT }, (_, index) => {
        const isBuy = index % 2 === 0;
        const openTicket = 500_000 + index * 2;
        const closeTicket = openTicket + 1;
        const openTime = BASE_TIME_SECONDS + index * 120;
        const volume = 0.01 + (index % 3) * 0.01;

        return [
            {
                ticket: openTicket,
                order_ticket: 700_000 + index,
                account_login: 200001,
                symbol: 'GBPUSD',
                action: isBuy ? 'buy' : 'sell',
                entry: 'entry_in',
                volume,
                price: 1.34 + index / 100_000,
                profit: 0,
                commission: -0.05,
                swap: 0,
                time: openTime,
            },
            {
                ticket: closeTicket,
                order_ticket: index < 69 ? null : 800_000 + index,
                account_login: 200001,
                symbol: 'GBPUSD',
                action: isBuy ? 'sell' : 'buy',
                entry: 'entry_out',
                volume,
                price: 1.3405 + index / 100_000,
                profit: index + 0.25,
                commission: -0.05,
                swap: 0,
                time: openTime + 30,
            },
        ] satisfies GatewayDeal[];
    }).flat().reverse()
);

const closedPositionFallback: GatewayClosedPosition[] = [
    {
        position_id: FALLBACK_POSITION_TICKET,
        symbol: 'EURUSD',
        action: 'buy',
        volume: 0.01,
        price_open: 1.08,
        price_close: 1.09,
        profit: 10,
        time_open: BASE_TIME_SECONDS,
        time_close: BASE_TIME_SECONDS + 60,
    },
];

describe('BottomDock History live-deal integration', () => {
    beforeEach(() => {
        localStorage.clear();
        useAppStore.getState().reset();
        useAppStore.setState({ accountId: '200001' });
        toolboxMocks.refresh.mockClear();

        // BottomDock mounts the Trade tab once before History is selected. Keep
        // its existing row-key warning from obscuring this History-only contract.
        const originalConsoleError = console.error.bind(console);
        vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
            if (String(args[0] ?? '').includes('Each child in a list should have a unique "key" prop')) return;
            originalConsoleError(...args);
        });
    });

    afterEach(() => {
        cleanup();
        useAppStore.getState().reset();
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('renders 72 rows from 144 bare deal events without merging closed-position fallback rows', async () => {
        const liveDeals = buildLiveShapedDeals();
        expect(liveDeals).toHaveLength(144);

        const getSpy = vi.spyOn(apiClient, 'get');
        getSpy.mockImplementation(async <T,>(endpoint: string): Promise<T> => {
            if (endpoint === '/positions/200001/history') {
                return closedPositionFallback as T;
            }
            if (endpoint === '/deals/200001') {
                return liveDeals as T;
            }
            throw new Error(`Unexpected gateway request: ${endpoint}`);
        });

        const { container } = render(
            <BottomDock
                height={300}
                onClosePosition={vi.fn()}
                onModifyPosition={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Closed orders and account history' }));

        await waitFor(() => expect(screen.getByText('72 records')).toBeInTheDocument());

        expect(container.querySelectorAll('.rtx-history-tab tbody tr.rtx-trade-row')).toHaveLength(72);
        expect(container.querySelector(`[title="Ticket: ${FALLBACK_POSITION_TICKET}"]`)).toBeNull();
        expect(container.querySelector('[title="Ticket: 500000"]')).not.toBeNull();
        expect(getSpy).toHaveBeenCalledWith(
            '/positions/200001/history',
            expect.objectContaining({ params: { limit: 500, offset: 0 } }),
        );
        expect(getSpy).toHaveBeenCalledWith(
            '/deals/200001',
            expect.objectContaining({ params: { limit: 500, offset: 0 } }),
        );
    });
});

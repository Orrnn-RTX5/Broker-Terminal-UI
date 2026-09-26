// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import {
    tradeGatewayApi,
    type GatewayClosedPosition,
    type GatewayDeal,
    type TradeHistoryDataSet,
} from '../api/tradeGateway';
import { useAppStore, type Trade } from '../store/useAppStore';
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

const contextMenuHistoryTrade: Trade = {
    id: 610_001,
    positionId: 610_001,
    dealTicket: 710_001,
    symbol: 'EURUSD',
    type: 'position',
    side: 'buy',
    volume: 0.1,
    openPrice: 1.1,
    closePrice: 1.10125,
    openTime: '2026-09-25T06:08:27.123Z',
    closeTime: '2026-09-25T06:18:28.456Z',
    profit: 12.5,
    commission: -0.2,
    swap: 0,
    status: 'closed',
    historySource: 'closed-position',
};

const dealHistoryTrade: Trade = {
    ...contextMenuHistoryTrade,
    id: 710_002,
    positionId: 610_002,
    dealTicket: 710_002,
    symbol: 'GBPUSD',
    type: 'entry_out',
    side: 'sell',
    openTime: '2026-09-24T06:08:27.123Z',
    closeTime: '2026-09-24T06:08:27.123Z',
    historySource: 'deal',
};

const orderHistoryTrade: Trade = {
    ...contextMenuHistoryTrade,
    id: 810_003,
    positionId: undefined,
    dealTicket: undefined,
    orderTicket: 810_003,
    symbol: 'USDJPY',
    type: 'buy_limit',
    side: 'buy',
    openTime: '2026-09-23T06:08:27.123Z',
    closeTime: '2026-09-23T06:18:28.456Z',
    profit: 0,
    historySource: 'order',
};

const historyDataSet = ({
    positions = [contextMenuHistoryTrade],
    deals = [dealHistoryTrade],
    orders = [orderHistoryTrade],
}: Partial<Pick<TradeHistoryDataSet, 'positions' | 'deals' | 'orders'>> = {}): TradeHistoryDataSet => ({
    positions,
    deals,
    orders,
    errors: { positions: null, deals: null, orders: null },
});

const renderHistoryDock = (historyInstrumentCatalog?: readonly unknown[]) => render(
    <BottomDock
        height={300}
        onClosePosition={vi.fn()}
        onModifyPosition={vi.fn()}
        onCloseBulk={vi.fn()}
        historyInstrumentCatalog={historyInstrumentCatalog}
    />,
);

const getMenuLabels = (menu: HTMLElement): Array<string | undefined> => (
    within(menu).getAllByRole('menuitem').map(item => (
        item.querySelector('span.min-w-0')?.textContent?.trim()
    ))
);

const findSubmenuContaining = async (label: string): Promise<HTMLElement> => {
    return waitFor(() => {
        const menu = screen.getAllByRole('menu').find(candidate => within(candidate).queryByText(label));
        expect(menu).toBeDefined();
        return menu!;
    });
};

const openHistorySurfaceMenu = async (): Promise<HTMLElement> => {
    fireEvent.contextMenu(screen.getByLabelText('History records'), { clientX: 120, clientY: 140 });
    return screen.findByRole('menu', { name: 'Context menu' });
};

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
            if (endpoint === '/orders/200001') {
                return [] as T;
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
        expect(getSpy).toHaveBeenCalledWith(
            '/orders/200001',
            expect.objectContaining({ params: { limit: 500, offset: 0 } }),
        );
    });

    it('opens the exact MT5 History root menu on empty space and switches all four datasets', async () => {
        useAppStore.setState({ accountId: '300001', selectedSymbol: 'AUDUSD', positions: [] });
        vi.spyOn(tradeGatewayApi, 'getHistoryDataSet').mockResolvedValue(historyDataSet());

        renderHistoryDock();
        fireEvent.click(screen.getByRole('button', { name: 'Closed orders and account history' }));
        await screen.findByTitle('Ticket: 610001');

        let menu = await openHistorySurfaceMenu();
        expect(getMenuLabels(menu)).toEqual([
            'New Order',
            'Positions',
            'Deals',
            'Orders',
            'Orders & Deals',
            'Symbols',
            'Volumes',
            'All History',
            'Last 3 Months',
            'Last Month',
            'Custom Period',
            'Report',
            'Show on Charts',
            'Register as Signal',
            'Show Milliseconds',
            'Auto Arrange',
            'Grid',
            'Columns',
        ]);
        [
            'Close Position',
            'Modify or Delete',
            'Bulk Operations',
            'Depth of Market',
            'Open Chart',
            'Trailing Stop',
            'Profit',
        ].forEach(label => expect(within(menu).queryByText(label)).not.toBeInTheDocument());

        fireEvent.click(within(menu).getByText('Show on Charts'));
        const showOnChartsMenu = await findSubmenuContaining('Auto Update');
        const autoUpdateItem = within(showOnChartsMenu).getByText('Auto Update').closest('[role="menuitem"]');
        expect(autoUpdateItem?.querySelector('[aria-hidden="true"]')).toHaveTextContent('✓');
        expect(localStorage.getItem('rtx5_history_show_on_charts_auto_update_v2')).toBe('true');
        fireEvent.click(within(showOnChartsMenu).getByText('Auto Update'));
        await waitFor(() => expect(localStorage.getItem('rtx5_history_show_on_charts_auto_update_v2')).toBe('false'));
        expect(autoUpdateItem?.querySelector('[aria-hidden="true"]')?.textContent).toBe('');
        fireEvent.click(within(showOnChartsMenu).getByText('Auto Update'));
        await waitFor(() => expect(localStorage.getItem('rtx5_history_show_on_charts_auto_update_v2')).toBe('true'));

        fireEvent.click(within(menu).getByText('Deals'));
        await screen.findByTitle('Ticket: 710002');
        expect(screen.queryByTitle('Ticket: 610001')).not.toBeInTheDocument();
        expect(screen.getByText('1 records')).toBeInTheDocument();

        menu = await openHistorySurfaceMenu();
        fireEvent.click(within(menu).getByText('Orders'));
        await screen.findByTitle('Ticket: 810003');
        expect(screen.queryByTitle('Ticket: 710002')).not.toBeInTheDocument();

        menu = await openHistorySurfaceMenu();
        fireEvent.click(within(menu).getByText('Orders & Deals'));
        await waitFor(() => expect(screen.getByText('2 records')).toBeInTheDocument());
        expect(screen.getByTitle('Ticket: 710002')).toBeInTheDocument();
        expect(screen.getByTitle('Ticket: 810003')).toBeInTheDocument();

        menu = await openHistorySurfaceMenu();
        fireEvent.click(within(menu).getByText('Positions'));
        await screen.findByTitle('Ticket: 610001');
        expect(screen.queryByTitle('Ticket: 710002')).not.toBeInTheDocument();
        expect(screen.queryByTitle('Ticket: 810003')).not.toBeInTheDocument();
    });

    it('opens New Order from an empty-surface menu using the active chart symbol', async () => {
        useAppStore.setState({ accountId: '300002', selectedSymbol: 'AUDUSD', positions: [] });
        vi.spyOn(tradeGatewayApi, 'getHistoryDataSet').mockResolvedValue(historyDataSet({
            positions: [],
            deals: [],
            orders: [],
        }));
        const openOrder = vi.fn();
        window.addEventListener('openOrderDialog', openOrder);

        try {
            renderHistoryDock();
            fireEvent.click(screen.getByRole('button', { name: 'Closed orders and account history' }));
            await screen.findByText('0 records');

            const menu = await openHistorySurfaceMenu();
            const newOrderItem = within(menu).getByText('New Order').closest('[role="menuitem"]');
            expect(newOrderItem).toHaveAttribute('aria-disabled', 'false');
            fireEvent.click(within(menu).getByText('New Order'));

            expect(openOrder).toHaveBeenCalledTimes(1);
            expect((openOrder.mock.calls[0][0] as CustomEvent).detail).toEqual({ symbol: 'AUDUSD' });
        } finally {
            window.removeEventListener('openOrderDialog', openOrder);
        }
    });

    it('switches Volumes to authoritative Amounts and restores that mode after remount', async () => {
        useAppStore.setState({ accountId: '300003', positions: [] });
        vi.spyOn(tradeGatewayApi, 'getHistoryDataSet').mockResolvedValue(historyDataSet());
        const catalog = [{ symbol: 'EURUSD', contractSize: 100_000 }];

        const firstRender = renderHistoryDock(catalog);
        fireEvent.click(screen.getByRole('button', { name: 'Closed orders and account history' }));
        await screen.findByTitle('Ticket: 610001');
        expect(screen.getByRole('columnheader', { name: 'Volume' })).toBeInTheDocument();

        const menu = await openHistorySurfaceMenu();
        fireEvent.click(within(menu).getByText('Volumes'));
        const volumesMenu = await findSubmenuContaining('Amounts');
        expect(getMenuLabels(volumesMenu)).toEqual(['Lots', 'Amounts']);
        fireEvent.click(within(volumesMenu).getByText('Amounts'));

        await waitFor(() => expect(localStorage.getItem('rtx5_history_volume_mode')).toBe('amounts'));
        expect(screen.getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
        expect(screen.getByTitle('Amount: 10 000')).toHaveTextContent('10 000');

        firstRender.unmount();
        renderHistoryDock(catalog);
        fireEvent.click(screen.getByRole('button', { name: 'Closed orders and account history' }));
        await screen.findByTitle('Ticket: 610001');
        expect(screen.getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: 'Volume' })).not.toBeInTheDocument();
    });

    it('offers only the exact optional Columns and persists individual visibility', async () => {
        useAppStore.setState({ accountId: '300004', positions: [] });
        vi.spyOn(tradeGatewayApi, 'getHistoryDataSet').mockResolvedValue(historyDataSet());

        renderHistoryDock([{ symbol: 'EURUSD', contractSize: 100_000 }]);
        fireEvent.click(screen.getByRole('button', { name: 'Closed orders and account history' }));
        await screen.findByTitle('Ticket: 610001');

        expect(screen.getByRole('columnheader', { name: 'Ticket' })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: 'Change %' })).toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: 'Market Value' })).not.toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: 'Commission' })).not.toBeInTheDocument();

        const menu = await openHistorySurfaceMenu();
        fireEvent.click(within(menu).getByText('Columns'));
        let columnsMenu = await findSubmenuContaining('Market Value');
        expect(getMenuLabels(columnsMenu)).toEqual([
            'Ticket',
            'Market Value',
            'Commission',
            'Swap',
            'Fee',
            'Change %',
            'Magic Number',
            'Comment',
        ]);
        expect(within(columnsMenu).queryByText('Show All Columns')).not.toBeInTheDocument();
        expect(within(columnsMenu).queryByText('Reset Columns')).not.toBeInTheDocument();
        expect(within(columnsMenu).getByText('Ticket').closest('[role="menuitem"]')?.querySelector('[aria-hidden="true"]')).toHaveTextContent('✓');
        expect(within(columnsMenu).getByText('Change %').closest('[role="menuitem"]')?.querySelector('[aria-hidden="true"]')).toHaveTextContent('✓');
        expect(within(columnsMenu).getByText('Market Value').closest('[role="menuitem"]')?.querySelector('[aria-hidden="true"]')?.textContent).toBe('');

        fireEvent.click(within(columnsMenu).getByText('Market Value'));
        await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Market Value' })).toBeInTheDocument());

        columnsMenu = await findSubmenuContaining('Market Value');
        fireEvent.click(within(columnsMenu).getByText('Ticket'));
        await waitFor(() => expect(screen.queryByRole('columnheader', { name: 'Ticket' })).not.toBeInTheDocument());
        expect(JSON.parse(localStorage.getItem('rtx5_history_columns_v2') ?? '{}')).toEqual({
            ticket: false,
            marketValue: true,
            commission: false,
            swap: false,
            fee: false,
            changePercent: true,
            magicNumber: false,
            comment: false,
        });
    });

    it('validates and applies an inclusive local Custom Period', async () => {
        const localIso = (day: number) => new Date(2026, 8, day, 12, 0, 0, 0).toISOString();
        const periodRows: Trade[] = [
            { ...contextMenuHistoryTrade, id: 620_010, positionId: 620_010, openTime: localIso(10), closeTime: localIso(10) },
            { ...contextMenuHistoryTrade, id: 620_012, positionId: 620_012, openTime: localIso(12), closeTime: localIso(12) },
            { ...contextMenuHistoryTrade, id: 620_013, positionId: 620_013, openTime: localIso(13), closeTime: localIso(13) },
            { ...contextMenuHistoryTrade, id: 620_014, positionId: 620_014, openTime: localIso(11), closeTime: localIso(13) },
        ];
        useAppStore.setState({ accountId: '300005', positions: [] });
        vi.spyOn(tradeGatewayApi, 'getHistoryDataSet').mockResolvedValue(historyDataSet({ positions: periodRows }));

        renderHistoryDock();
        fireEvent.click(screen.getByRole('button', { name: 'Closed orders and account history' }));
        await screen.findByText('4 records');

        const menu = await openHistorySurfaceMenu();
        fireEvent.click(within(menu).getByText('Custom Period'));
        const dialog = await screen.findByRole('dialog', { name: 'Custom history period' });
        const fromInput = within(dialog).getByLabelText('From');
        const toInput = within(dialog).getByLabelText('To');

        fireEvent.change(fromInput, { target: { value: '2026-09-13' } });
        fireEvent.change(toInput, { target: { value: '2026-09-10' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('Choose a valid date range');

        fireEvent.change(fromInput, { target: { value: '2026-09-10' } });
        fireEvent.change(toInput, { target: { value: '2026-09-12' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));

        await waitFor(() => expect(screen.getByText('3 records')).toBeInTheDocument());
        expect(screen.getByTitle('Ticket: 620010')).toBeInTheDocument();
        expect(screen.getByTitle('Ticket: 620012')).toBeInTheDocument();
        expect(screen.getByTitle('Ticket: 620014')).toBeInTheDocument();
        expect(screen.queryByTitle('Ticket: 620013')).not.toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: 'Custom history period' })).not.toBeInTheDocument();
    });
});

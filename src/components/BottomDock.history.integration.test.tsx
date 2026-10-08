// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import {
    clearTradeHistoryRequestCache,
    tradeGatewayApi,
    type GatewayClosedPosition,
    type GatewayDeal,
    type TradeHistoryDataSet,
} from '../api/tradeGateway';
import { useAppStore, type Trade } from '../store/useAppStore';
import { resetTerminalHistorySession } from '../services/terminalHistory';
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
        resetTerminalHistorySession();
        clearTradeHistoryRequestCache();
        useAppStore.getState().reset();
        useAppStore.setState({ accountId: '200001' });
        toolboxMocks.refresh.mockClear();
        vi.spyOn(tradeGatewayApi, 'getBalanceHistory').mockResolvedValue([]);

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
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('continues the history table with native financial totals and updates the reported account balance', async () => {
        useAppStore.setState({ account: {
            balance: 99_264.73, equity: 99_264.73, margin: 0, freeMargin: 99_264.73,
            unrealizedPL: 0, marginLevel: 0, currency: 'USD', leverage: 100,
            hasBackendBalance: true,
        } });
        const exit = { ...dealHistoryTrade, profit: -730.28, swap: -4.99, commission: 0 };
        vi.spyOn(tradeGatewayApi, 'getHistoryDataSet').mockResolvedValue(historyDataSet({
            deals: [exit, exit, { ...exit, id: 3, dealTicket: 3, dealType: 'balance', profit: 100_000, swap: 0 }],
        }));
        vi.mocked(tradeGatewayApi.getBalanceHistory).mockResolvedValue([
            { id: 1, account_login: 200001, type: 'deposit', amount: 100_000, time: 1_790_836_200 },
        ]);
        const { container } = renderHistoryDock();
        fireEvent.click(screen.getByRole('button', { name: 'History — Closed orders and account history' }));
        // The first activation imports the real History panel and its dependencies.
        // Allow that cold mount to finish before asserting the financial behavior.
        const summary = await screen.findByRole('group', { name: 'History financial summary' }, { timeout: 5000 });
        await waitFor(() => expect(summary).toHaveTextContent('Profit: -735.27 Credit: 0.00 Deposit: 100 000.00 Withdrawal: 0.00 Balance: 99 264.73'));
        expect(container.querySelector('.rtx-history-table tfoot')?.previousElementSibling?.tagName).toBe('TBODY');
        expect(summary.querySelector('[class*="text-[#"]')).toBeNull();
        expect(screen.getByLabelText('Total gross profit')).toHaveTextContent('-730.28');

        // Switching from position aggregates to raw deals does not count totals twice.
        const menu = await openHistorySurfaceMenu();
        fireEvent.click(within(menu).getByRole('menuitem', { name: 'Deals' }));
        expect(summary).toHaveTextContent('Profit: -735.27');
        act(() => useAppStore.setState(state => ({ account: { ...state.account!, balance: 99_000 } })));
        await waitFor(() => expect(summary).toHaveTextContent('Balance: 99 000.00'));
    });

    it('filters executions and cash movements by period while keeping Balance current', async () => {
        vi.spyOn(tradeGatewayApi, 'getHistoryDataSet').mockResolvedValue(historyDataSet({ deals: [
            { ...dealHistoryTrade, id: 1, dealTicket: 1, openTime: '2020-01-01T00:00:00Z', closeTime: '2020-01-01T00:00:00Z', profit: 100, commission: 0 },
            { ...dealHistoryTrade, id: 2, dealTicket: 2, openTime: new Date().toISOString(), closeTime: new Date().toISOString(), profit: 5, commission: -1 },
        ] }));
        vi.mocked(tradeGatewayApi.getBalanceHistory).mockResolvedValue([
            { id: 1, type: 'deposit', amount: 1000, time: Date.parse('2020-01-01T00:00:00Z') / 1000 },
            { id: 2, type: 'withdrawal', amount: -20, time: Date.now() / 1000 },
        ]);
        renderHistoryDock();
        fireEvent.click(screen.getByRole('button', { name: 'History — Closed orders and account history' }));
        const summary = await screen.findByRole('group', { name: 'History financial summary' });
        await waitFor(() => expect(summary).toHaveTextContent('Profit: 104.00 Credit: 0.00 Deposit: 1 000.00 Withdrawal: -20.00 Balance: —'));
        fireEvent.click(screen.getByRole('button', { name: 'Last Month' }));
        expect(summary).toHaveTextContent('Profit: 4.00 Credit: 0.00 Deposit: 0.00 Withdrawal: -20.00 Balance: —');
    });

    it('keeps trade records usable when the ledger fails and shows unavailable financial sources as dashes', async () => {
        vi.spyOn(tradeGatewayApi, 'getHistoryDataSet').mockResolvedValue({
            ...historyDataSet(), deals: [], errors: { positions: null, deals: 'Deals unavailable', orders: null },
        });
        vi.mocked(tradeGatewayApi.getBalanceHistory).mockRejectedValue(new Error('Ledger unavailable'));
        renderHistoryDock();
        fireEvent.click(screen.getByRole('button', { name: 'History — Closed orders and account history' }));
        await screen.findByText('1 records');
        const summary = screen.getByRole('group', { name: 'History financial summary' });
        await waitFor(() => expect(summary).toHaveTextContent('Profit: — Credit: — Deposit: — Withdrawal: — Balance: —'));
        expect(within(summary).getByText('Deposit: —')).toHaveAttribute('title', 'Ledger unavailable');
    });

    it('rejects a late ledger response from the previous account', async () => {
        let resolveOld!: (rows: Record<string, unknown>[]) => void;
        vi.spyOn(tradeGatewayApi, 'getHistoryDataSet').mockResolvedValue(historyDataSet());
        vi.mocked(tradeGatewayApi.getBalanceHistory).mockImplementation(login => login === 200001
            ? new Promise(resolve => { resolveOld = resolve; })
            : Promise.resolve([{ id: 2, account_login: 200002, type: 'deposit', amount: 200 }]));
        renderHistoryDock();
        fireEvent.click(screen.getByRole('button', { name: 'History — Closed orders and account history' }));
        await screen.findByText('1 records');
        act(() => useAppStore.setState({ accountId: '200002' }));
        const summary = screen.getByRole('group', { name: 'History financial summary' });
        await waitFor(() => expect(summary).toHaveTextContent('Deposit: 200.00'));
        await act(async () => resolveOld([{ id: 1, type: 'deposit', amount: 9999 }]));
        expect(summary).toHaveTextContent('Deposit: 200.00');
        expect(summary).not.toHaveTextContent('9 999.00');
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

        fireEvent.click(screen.getByRole('button', { name: 'History — Closed orders and account history' }));

        await waitFor(() => expect(screen.getByText('72 records')).toBeInTheDocument());

        const renderedRows = () => container.querySelectorAll('.rtx-history-tab tbody tr.rtx-trade-row');
        expect(renderedRows().length).toBeGreaterThan(0);
        expect(renderedRows().length).toBeLessThan(LIVE_PAIR_COUNT);
        expect(container.querySelector(`[title="Ticket: ${FALLBACK_POSITION_TICKET}"]`)).toBeNull();
        expect(container.querySelector('[title="Ticket: 500142"]')).not.toBeNull();
        expect(container.querySelector('[title="Ticket: 500000"]')).toBeNull();

        const scroller = screen.getByLabelText('History records');
        scroller.scrollTop = 5_000;
        fireEvent.scroll(scroller);
        await waitFor(() => expect(container.querySelector('[title="Ticket: 500000"]')).not.toBeNull());
        expect(renderedRows().length).toBeLessThan(LIVE_PAIR_COUNT);
        expect(container.querySelector(`[title="Ticket: ${FALLBACK_POSITION_TICKET}"]`)).toBeNull();
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

    it('limits Today to local midnight through now, excluding yesterday and future records', async () => {
        const now = new Date(2026, 9, 1, 15, 45).getTime();
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const times = [
            new Date(2026, 9, 1, 0).toISOString(),
            new Date(2026, 9, 1, 15).toISOString(),
            new Date(2026, 8, 30, 23, 59, 59).toISOString(),
            new Date(2026, 9, 1, 16).toISOString(),
        ];
        vi.spyOn(tradeGatewayApi, 'getHistoryDataSet').mockResolvedValue(historyDataSet({
            positions: times.map((time, index) => ({
                ...contextMenuHistoryTrade, id: 640001 + index, positionId: 640001 + index,
                openTime: time, closeTime: time,
            })),
        }));
        renderHistoryDock();
        fireEvent.click(screen.getByRole('button', { name: 'History — Closed orders and account history' }));
        await screen.findByText('4 records');
        fireEvent.click(screen.getByRole('button', { name: 'Today' }));
        expect(screen.getByText('2 records')).toBeInTheDocument();
        expect(screen.getByTitle('Ticket: 640001')).toBeInTheDocument();
        expect(screen.getByTitle('Ticket: 640002')).toBeInTheDocument();
        expect(screen.queryByTitle('Ticket: 640003')).not.toBeInTheDocument();
        expect(screen.queryByTitle('Ticket: 640004')).not.toBeInTheDocument();
    });

    it('shows valid closed history when the broker repeats its first deal page', async () => {
        const deals = Array.from({ length: 500 }, (_, index): GatewayDeal => ({
            ticket: 900_000 + index, account_login: 200001,
            position_ticket: 800_000 + Math.floor(index / 2), symbol: 'EURUSD',
            action: index % 2 ? 'sell' : 'buy', entry: index % 2 ? 'entry_out' : 'entry_in',
            volume: 0.01, price: 1.1, profit: index % 2 ? 2 : 0,
            time: BASE_TIME_SECONDS + index,
        }));
        vi.spyOn(apiClient, 'get').mockImplementation(async <T,>(endpoint: string): Promise<T> => (
            endpoint === '/deals/200001' ? deals : []
        ) as T);
        const { container } = renderHistoryDock();
        fireEvent.click(screen.getByRole('button', { name: 'History — Closed orders and account history' }));
        await screen.findByText('250 records');
        expect(container.querySelectorAll('.rtx-history-tab tbody tr.rtx-trade-row').length).toBeGreaterThan(0);
        expect(screen.getByRole('status')).toHaveTextContent('Broker repeated a history page');
        expect(screen.getByRole('group', { name: 'History financial summary' })).toHaveTextContent('Profit: —');
        expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeDisabled();
    });

    it('filters recent positions, executions, and financial totals without reloading the broker history', async () => {
        const now = new Date(2026, 9, 1, 15, 45).getTime();
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const recent = new Date(now - 30 * 60_000).toISOString();
        const earlier = new Date(now - 3 * 3_600_000).toISOString();
        const older = new Date(now - 9 * 86_400_000).toISOString();
        const fiveMonthsAgo = new Date(2026, 4, 1, 12).toISOString();
        const eightMonthsAgo = new Date(2026, 1, 1, 12).toISOString();
        const rows = [recent, earlier, older, fiveMonthsAgo, eightMonthsAgo].map((time, index) => ({
            ...contextMenuHistoryTrade, id: 630001 + index, positionId: 630001 + index, dealTicket: 730001 + index,
            openTime: time, closeTime: time, profit: (index + 1) * 10, commission: 0,
        }));
        const load = vi.spyOn(tradeGatewayApi, 'getHistoryDataSet').mockResolvedValue(historyDataSet({
            positions: rows,
            deals: rows.map(row => ({ ...row, historySource: 'deal' as const, type: 'entry_out' as const })),
        }));
        const { container } = renderHistoryDock();
        fireEvent.click(screen.getByRole('button', { name: 'History — Closed orders and account history' }));
        await screen.findByText('5 records');
        const scroller = screen.getByLabelText('History records');
        scroller.scrollTop = 900;
        fireEvent.click(screen.getByRole('button', { name: 'Last Hour' }));
        expect(screen.getByText('1 records')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Last Hour' })).toHaveAttribute('aria-pressed', 'true');
        expect(scroller.scrollTop).toBe(0);
        expect(container.querySelector('[title="Ticket: 630001"]')).not.toBeNull();
        expect(container.querySelector('[title="Ticket: 630002"]')).toBeNull();
        expect(screen.getByRole('group', { name: 'History financial summary' })).toHaveTextContent('Profit: 10.00');
        fireEvent.click(screen.getByRole('button', { name: 'Last 3 Hours' }));
        expect(screen.getByText('2 records')).toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'History financial summary' })).toHaveTextContent('Profit: 30.00');
        fireEvent.click(screen.getByRole('button', { name: 'Last 24 Hours' }));
        expect(screen.getByText('2 records')).toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'History financial summary' })).toHaveTextContent('Profit: 30.00');
        fireEvent.click(screen.getByRole('button', { name: 'Last 7 Days' }));
        expect(screen.getByText('2 records')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Last 30 Days' }));
        expect(screen.getByText('3 records')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Last 3 Months' }));
        expect(screen.getByText('3 records')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Last 6 Months' }));
        expect(screen.getByText('4 records')).toBeInTheDocument();
        expect(container.querySelector('[title="Ticket: 630004"]')).not.toBeNull();
        expect(container.querySelector('[title="Ticket: 630005"]')).toBeNull();
        expect(screen.getByRole('group', { name: 'History financial summary' })).toHaveTextContent('Profit: 100.00');
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('loads full backend deal history for the session account and refreshes every financial amount', async () => {
        vi.stubGlobal('__RTX_RUNTIME_CONFIG__', {
            CONFIG_SOURCE: 'deployment',
            API_HOST: 'https://history-broker.example',
            WS_HOST: 'wss://history-broker.example',
            BROKER_ID: 'history-broker',
            DEFAULT_MT5_SERVER: 'History-Live',
        });
        // A session token is usable only within its configured broker scope.
        localStorage.setItem('broker_id', 'history-broker');
        localStorage.setItem('server_url', 'https://history-broker.example');
        const body = btoa(JSON.stringify({ account_login: 200001 })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        localStorage.setItem('auth_token', `header.${body}.sig`);
        useAppStore.setState({ account: {
            balance: 20_490, equity: 20_490, margin: 0, freeMargin: 20_490,
            unrealizedPL: 0, marginLevel: 0, currency: 'USD', leverage: 100, hasBackendBalance: true,
        } });
        const firstPage = Array.from({ length: 500 }, (_, index): GatewayDeal => ({
            ticket: index + 1, account_login: 200001, symbol: 'EURUSD', action: 'deal_buy', entry: 'entry_out',
            profit: 1, commission: 0, swap: 0, time: BASE_TIME_SECONDS + index,
        }));
        let afterRefresh = false;
        vi.spyOn(apiClient, 'get').mockImplementation(async <T,>(endpoint: string, options?: { params?: object }): Promise<T> => {
            if (endpoint === '/deals/200001') throw new Error('Use the paginated trader route');
            if (endpoint === '/account/deals') return (afterRefresh ? [{
                ticket: 999, account_login: 200001, symbol: 'EURUSD', action: 'deal_sell', entry: 'entry_out',
                profit: -5, commission: -1, swap: -0.5, time: BASE_TIME_SECONDS,
            }] : (options?.params as { offset?: number })?.offset === 0 ? firstPage : [{
                ticket: 501, account_login: 200001, symbol: 'EURUSD', action: 'deal_sell', entry: 'entry_out',
                profit: -10, commission: 0, swap: 0, time: BASE_TIME_SECONDS,
            }]) as T;
            return [] as T;
        });
        vi.mocked(tradeGatewayApi.getBalanceHistory).mockResolvedValue([
            { id: 1, account_login: 200001, type: 'deposit', amount: 20_000 },
            { id: 2, account_login: 200001, type: 'credit', amount: 50 },
            { id: 3, account_login: 200001, type: 'withdrawal', amount: 100 },
        ]);
        renderHistoryDock();
        fireEvent.click(screen.getByRole('button', { name: 'History — Closed orders and account history' }));
        const summary = await screen.findByRole('group', { name: 'History financial summary' });
        await screen.findByText('501 records');
        expect(apiClient.get).toHaveBeenCalledWith('/account/deals', expect.objectContaining({
            params: { limit: 500, offset: 500, to: expect.any(Number) },
        }));
        await waitFor(() => expect(summary).toHaveTextContent('Profit: 490.00 Credit: 50.00 Deposit: 20 000.00 Withdrawal: -100.00 Balance: 20 490.00'));
        afterRefresh = true;
        vi.mocked(tradeGatewayApi.getBalanceHistory).mockResolvedValue([
            { id: 4, account_login: 200001, type: 'deposit', amount: 30_000 },
        ]);
        act(() => useAppStore.setState(state => ({ account: { ...state.account!, balance: 29_993.5 } })));
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        await waitFor(() => expect(summary).toHaveTextContent('Profit: -6.50 Credit: 0.00 Deposit: 30 000.00 Withdrawal: 0.00 Balance: 29 993.50'));
    });

    it('opens the exact MT5 History root menu on empty space and switches all four datasets', async () => {
        useAppStore.setState({ accountId: '300001', selectedSymbol: 'AUDUSD', positions: [] });
        vi.spyOn(tradeGatewayApi, 'getHistoryDataSet').mockResolvedValue(historyDataSet());

        renderHistoryDock();
        fireEvent.click(screen.getByRole('button', { name: 'History — Closed orders and account history' }));
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
            'Today',
            'Last Hour',
            'Last 3 Hours',
            'Last 6 Hours',
            'Last 12 Hours',
            'Last 24 Hours',
            'Last 3 Days',
            'Last 7 Days',
            'Last 14 Days',
            'Last 30 Days',
            'Last Month',
            'Last 3 Months',
            'Last 6 Months',
            'All History',
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
        expect(autoUpdateItem?.querySelector('[aria-hidden="true"] svg')).toBeInTheDocument();
        expect(localStorage.getItem('rtx5_history_show_on_charts_auto_update_v2')).toBe('true');
        fireEvent.click(within(showOnChartsMenu).getByText('Auto Update'));
        await waitFor(() => expect(localStorage.getItem('rtx5_history_show_on_charts_auto_update_v2')).toBe('false'));
        expect(autoUpdateItem?.querySelector('[aria-hidden="true"] svg')).toBeNull();
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
            fireEvent.click(screen.getByRole('button', { name: 'History — Closed orders and account history' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'History — Closed orders and account history' }));
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
        fireEvent.click(screen.getByRole('button', { name: 'History — Closed orders and account history' }));
        await screen.findByTitle('Ticket: 610001');
        expect(screen.getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: 'Volume' })).not.toBeInTheDocument();
    });

    it('offers only the exact optional Columns and persists individual visibility', async () => {
        useAppStore.setState({ accountId: '300004', positions: [] });
        vi.spyOn(tradeGatewayApi, 'getHistoryDataSet').mockResolvedValue(historyDataSet());

        renderHistoryDock([{ symbol: 'EURUSD', contractSize: 100_000 }]);
        fireEvent.click(screen.getByRole('button', { name: 'History — Closed orders and account history' }));
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
        expect(within(columnsMenu).getByText('Ticket').closest('[role="menuitem"]')?.querySelector('[aria-hidden="true"] svg')).toBeInTheDocument();
        expect(within(columnsMenu).getByText('Change %').closest('[role="menuitem"]')?.querySelector('[aria-hidden="true"] svg')).toBeInTheDocument();
        expect(within(columnsMenu).getByText('Market Value').closest('[role="menuitem"]')?.querySelector('[aria-hidden="true"] svg')).toBeNull();

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
        fireEvent.click(screen.getByRole('button', { name: 'History — Closed orders and account history' }));
        await screen.findByText('4 records');

        const menu = await openHistorySurfaceMenu();
        fireEvent.click(within(menu).getByText('Custom Period'));
        const dialog = await screen.findByRole('dialog', { name: 'Custom history period' });
        const fromInput = within(dialog).getByLabelText('From');
        const toInput = within(dialog).getByLabelText('To');
        expect(dialog).toHaveFocus();
        fromInput.focus();
        fireEvent.keyDown(fromInput, { key: 'Tab', shiftKey: true });
        const applyButton = within(dialog).getByRole('button', { name: 'Apply' });
        expect(applyButton).toHaveFocus();
        fireEvent.keyDown(applyButton, { key: 'Tab' });
        expect(fromInput).toHaveFocus();

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

    it('opens a cached History tab again without requesting it a second time', async () => {
        useAppStore.setState({ accountId: '300006', positions: [] });
        const getHistory = vi.spyOn(tradeGatewayApi, 'getHistoryDataSet').mockResolvedValue(historyDataSet());

        renderHistoryDock();
        fireEvent.click(screen.getByRole('button', { name: 'History — Closed orders and account history' }));
        await screen.findByTitle('Ticket: 610001');
        expect(getHistory).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Trade — Open positions and live account summary' }));
        fireEvent.click(screen.getByRole('button', { name: 'History — Closed orders and account history' }));

        expect(screen.getByTitle('Ticket: 610001')).toBeInTheDocument();
        expect(screen.queryByText('Loading trade history…')).not.toBeInTheDocument();
        expect(getHistory).toHaveBeenCalledTimes(1);
    });
});

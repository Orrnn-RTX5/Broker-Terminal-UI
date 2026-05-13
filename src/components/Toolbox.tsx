/**
 * Toolbox Bottom Panel (MT5-style)
 * Collapsible panel with tabs: Trade, History, Orders, Alerts, Journal
 */

import { Icon } from './ui/Icon';
import { PriceDisplay } from './ui/PriceDisplay';
import { getSymbolDigits } from '../utils/symbolUtils';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api from '../services/api';
import { useAppStore } from '../store/useAppStore';
import { AlertManager } from './AlertManager';
import { useAlertStore } from '../store/useAlertStore';
import { tradeGatewayApi } from '../api/tradeGateway';
import { MarketSessions } from './MarketSessions';
import { CorrelationMatrix } from './CorrelationMatrix';
import { PositionsPanel } from './PositionsPanel';
import { StrategyTester } from './StrategyTester';
import { TradingSignals } from './TradingSignals';
import { RiskHeatmap } from './RiskHeatmap';
import { SentimentAnalysis } from './SentimentAnalysis';
import { SymbolScreener } from './SymbolScreener';
import { MultiTimeframeAnalysis } from './MultiTimeframeAnalysis';
import { PnLCalendar } from './PnLCalendar';
import { DrawingTools } from './DrawingTools';
import { TradeAnalytics } from './TradeAnalytics';
import AdvancedOrders from './AdvancedOrders';
import { MarketReplay } from './MarketReplay';
import { CopyTradingLeaderboard } from './CopyTradingLeaderboard';
import { NewsImpactAnalyzer } from './NewsImpactAnalyzer';
import { PositionSizeCalculator } from './PositionSizeCalculator';
import { EquityCurveTracker } from './EquityCurveTracker';
import { VolatilityAnalyzer } from './VolatilityAnalyzer';
import { CurrencyConverter } from './CurrencyConverter';
import { TradeJournalV2 } from './TradeJournalV2';
import { SessionHeatMap } from './SessionHeatMap';
import { RiskExposurePanel } from './RiskExposurePanel';
import { OrderFlowVisualizer } from './OrderFlowVisualizer';
import { MarketProfile } from './MarketProfile';
import { TradingSimulator } from './TradingSimulator';

interface ToolboxProps {
    accountId: string;
    wsConnection: WebSocket | null;
}

type TabType = 'Trade' | 'History' | 'Orders' | 'Alerts' | 'Sessions' | 'Correlation' | 'Tester' | 'Signals' | 'RiskMap' | 'Sentiment' | 'Screener' | 'MTA' | 'PnL' | 'Drawing' | 'Analytics' | 'AdvancedOrders' | 'Replay' | 'CopyTrading' | 'NewsImpact' | 'PositionSizer' | 'EquityCurve' | 'Volatility' | 'Currency' | 'Journal' | 'JournalV2' | 'SessionMap' | 'RiskExposure' | 'OrderFlow' | 'MarketProfile' | 'TradingSim';

interface Position {
    id: number;
    symbol: string;
    side: 'BUY' | 'SELL';
    volume: number;
    openPrice: number;
    currentPrice: number;
    openTime: string;
    sl: number;
    tp: number;
    swap: number;
    commission: number;
    unrealizedPnL: number;
}

type HistoryTrade = {
    order: number;
    symbol: string;
    type_text: string;
    state_text: string;
    volume_initial_lots: number;
    price_order: number;
    price_current: number;
    price_sl: number;
    price_tp: number;
    time_setup: number;
    time_done: number;
    comment: string;
};

interface PendingOrder {
    id: string;
    symbol: string;
    type: 'LIMIT' | 'STOP' | 'STOP_LIMIT';
    side: 'BUY' | 'SELL';
    volume: number;
    price: number;
    triggerPrice?: number;
    sl?: number;
    tp?: number;
    status: 'PENDING' | 'TRIGGERED' | 'FILLED' | 'CANCELLED';
    createdAt: string;
}

interface Alert {
    id: string;
    symbol: string;
    condition: string;
    price: number;
    status: 'ACTIVE' | 'TRIGGERED' | 'EXPIRED';
    createdAt: string;
}

interface JournalEntry {
    timestamp: string;
    message: string;
    type: 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS';
}

export function Toolbox({ accountId, wsConnection }: ToolboxProps) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [height, setHeight] = useState(() => {
        const saved = localStorage.getItem('toolbox-height');
        return saved ? parseInt(saved, 10) : 200;
    });
    const [activeTab, setActiveTab] = useState<TabType>(() => {
        const saved = localStorage.getItem('toolbox-active-tab');
        return (saved as TabType) || 'Journal';
    });
    const [isResizing, setIsResizing] = useState(false);

    // Data states
    const [positions, setPositions] = useState<Position[]>([]);
    const [history, setHistory] = useState<HistoryTrade[]>([]);
    const [orders, setOrders] = useState<PendingOrder[]>([]);
    const [journal, setJournal] = useState<JournalEntry[]>([]);

    // Get account from store
    const account = useAppStore((state) => state.account);
    const activeAccountIdRef = useRef(accountId);
    const accountLogin = useMemo(() => {
        const login = Number.parseInt(String(accountId || ''), 10);
        return Number.isFinite(login) && login > 0 ? login : undefined;
    }, [accountId]);
    activeAccountIdRef.current = accountId;

    // Get alerts from alert store
    const { alerts } = useAlertStore();

    const fetchPositions = useCallback(async (requestedAccountId = accountId) => {
        const login = Number.parseInt(String(requestedAccountId || ''), 10);
        if (!Number.isFinite(login) || login <= 0) {
            if (activeAccountIdRef.current === requestedAccountId) setPositions([]);
            return;
        }

        const data = await api.positions.getPositions(login);
        if (activeAccountIdRef.current === requestedAccountId) {
            setPositions((data || []) as unknown as Position[]);
        }
    }, [accountId]);

    const fetchOrders = useCallback(async (requestedAccountId = accountId) => {
        const login = Number.parseInt(String(requestedAccountId || ''), 10);
        if (!Number.isFinite(login) || login <= 0) {
            if (activeAccountIdRef.current === requestedAccountId) setOrders([]);
            return;
        }

        const data = await api.orders.getPendingOrders(login);
        if (activeAccountIdRef.current === requestedAccountId) {
            setOrders((data || []) as unknown as PendingOrder[]);
        }
    }, [accountId]);

    // Fetch positions
    useEffect(() => {
        const refreshPositions = async () => {
            try {
                await fetchPositions(accountId);
            } catch (err) {
                console.error('[Toolbox] Failed to fetch positions:', err);
            }
        };

        refreshPositions();
        const interval = setInterval(refreshPositions, 10000); // Poll every 10s (rely on WS for real-time)
        return () => clearInterval(interval);
    }, [accountId, fetchPositions]);

    // Fetch order history from the trade API
    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const login = accountLogin || 0;
                if (!login) return;
                const response = await tradeGatewayApi.getOrderHistory(login);
                setHistory(response.map((trade) => ({
                    order: trade.id,
                    symbol: trade.symbol,
                    type_text: String(trade.side || trade.type || ''),
                    state_text: trade.closeTime ? 'filled' : 'active',
                    volume_initial_lots: Number(trade.volume) || 0,
                    price_order: Number(trade.openPrice) || 0,
                    price_current: Number(trade.closePrice ?? trade.openPrice) || 0,
                    price_sl: 0,
                    price_tp: 0,
                    time_setup: trade.openTime ? Math.floor(new Date(trade.openTime).getTime() / 1000) : 0,
                    time_done: trade.closeTime ? Math.floor(new Date(trade.closeTime).getTime() / 1000) : 0,
                    comment: trade.type || '',
                })));
            } catch (err) {
                console.error('[Toolbox] Failed to fetch order history:', err);
            }
        };

        fetchHistory();
        const interval = setInterval(fetchHistory, 30000); // Refresh every 30s
        return () => clearInterval(interval);
    }, [accountLogin]);

    // Fetch pending orders
    useEffect(() => {
        const refreshOrders = async () => {
            try {
                await fetchOrders(accountId);
            } catch (err) {
                console.error('[Toolbox] Failed to fetch orders:', err);
            }
        };

        refreshOrders();
        const interval = setInterval(refreshOrders, 10000); // Poll every 10s
        return () => clearInterval(interval);
    }, [accountId, fetchOrders]);

    // Alerts are managed by useAlertStore (Zustand) - no fetch needed

    // WebSocket for real-time position updates
    useEffect(() => {
        if (!wsConnection) return;

        const handleMessage = (event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'position_update') {
                    // Update positions in real-time
                    setPositions((prev) => {
                        const index = prev.findIndex((p) => p.id === data.position.id);
                        if (index >= 0) {
                            const updated = [...prev];
                            updated[index] = { ...updated[index], ...data.position };
                            return updated;
                        }
                        return prev;
                    });

                    // Add journal entry
                    addJournalEntry(`Position ${data.position.id} updated`, 'INFO');
                } else if (data.type === 'order_filled') {
                    addJournalEntry(`Order filled: ${data.order.symbol} ${data.order.side} ${data.order.volume}`, 'SUCCESS');
                } else if (data.type === 'alert_triggered') {
                    addJournalEntry(`Alert triggered: ${data.alert.symbol} at ${data.alert.price}`, 'WARNING');
                }
            } catch (err) {
                console.error('[Toolbox] WS parse error:', err);
            }
        };

        wsConnection.addEventListener('message', handleMessage);
        return () => wsConnection.removeEventListener('message', handleMessage);
    }, [wsConnection]);

    // Add journal entry
    const addJournalEntry = (message: string, type: JournalEntry['type']) => {
        setJournal((prev) => [
            { timestamp: new Date().toISOString(), message, type },
            ...prev.slice(0, 99) // Keep last 100 entries
        ]);
    };

    // Resize handler
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isResizing) {
                const newHeight = window.innerHeight - e.clientY;
                const clampedHeight = Math.max(100, Math.min(newHeight, window.innerHeight * 0.5));
                setHeight(clampedHeight);
            }
        };
        const handleMouseUp = () => setIsResizing(false);

        if (isResizing) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing]);

    // Persist height
    useEffect(() => {
        localStorage.setItem('toolbox-height', height.toString());
    }, [height]);

    // Persist active tab
    useEffect(() => {
        localStorage.setItem('toolbox-active-tab', activeTab);
    }, [activeTab]);

    // Close position via the trade API
    const handleClosePosition = async (id: number) => {
        const requestedAccountId = accountId;
        try {
            await api.positions.closePosition(String(id));

            // Refresh positions
            await fetchPositions(requestedAccountId);

            addJournalEntry(`Closed position #${id}`, 'SUCCESS');
        } catch (err) {
            console.error('[Toolbox] Close position failed:', err);
            addJournalEntry(`Failed to close position #${id}`, 'ERROR');
        }
    };

    // Cancel order
    const handleCancelOrder = async (orderId: string) => {
        const requestedAccountId = accountId;
        try {
            await api.orders.cancelOrder(orderId);

            // Refresh orders
            await fetchOrders(requestedAccountId);

            addJournalEntry(`Cancelled order #${orderId}`, 'SUCCESS');
        } catch (err) {
            console.error('[Toolbox] Cancel order failed:', err);
            addJournalEntry(`Failed to cancel order #${orderId}`, 'ERROR');
        }
    };

    // Tab counts
    const tradeBadge = positions.length > 0 ? ` (${positions.length})` : '';
    const ordersBadge = orders.length > 0 ? ` (${orders.length})` : '';
    const alertsBadge = alerts.filter(a => a.status === 'active').length > 0
        ? ` (${alerts.filter(a => a.status === 'active').length})`
        : '';

    if (isCollapsed) {
        return (
            <div className="flex-shrink-0 bg-[#131316] border-t border-zinc-700 h-8 flex items-center px-2 justify-between select-none">
                <div className="text-xs text-zinc-400 font-medium">Toolbox</div>
                <button
                    onClick={() => setIsCollapsed(false)}
                    className="text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                    <Icon name="chevron-up" size="sm" />
                </button>
            </div>
        );
    }

    return (
        <div
            className="flex-shrink-0 bg-[#131316] border-t border-zinc-800/50 flex flex-col relative font-sans text-[12px] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.2)] select-none"
            style={{ height: `${height}px`, zIndex: 30 }}
        >
            {/* Resize Handle */}
            <div
                className="h-1 cursor-ns-resize hover:bg-zinc-600/50 transition-colors w-full absolute top-0 left-0 z-50"
                onMouseDown={() => setIsResizing(true)}
            />

            {/* Tab Bar */}
            <div className="flex items-center bg-[#131316] border-b border-zinc-800/50 select-none overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-700">
                <div className="flex items-center flex-1">
                    {(['Trade', 'History', 'Orders', 'Alerts', 'Sessions', 'Correlation', 'Tester', 'Signals', 'RiskMap', 'Sentiment', 'Screener', 'MTA', 'PnL', 'Drawing', 'Analytics', 'AdvancedOrders', 'Replay', 'CopyTrading', 'NewsImpact', 'PositionSizer', 'EquityCurve', 'Volatility', 'Currency', 'Journal', 'JournalV2', 'SessionMap', 'RiskExposure', 'OrderFlow', 'MarketProfile', 'TradingSim'] as TabType[]).map((tab) => {
                        const badge = tab === 'Trade' ? tradeBadge : tab === 'Orders' ? ordersBadge : tab === 'Alerts' ? alertsBadge : '';
                        return (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap relative
                                ${activeTab === tab
                                        ? 'text-white bg-[#191a1e] shadow-[inset_0_2px_0_0_#8a8a8f] font-semibold'
                                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#191a1e]/50'}`}
                            >
                                {tab}{badge}
                            </button>
                        );
                    })}
                </div>
                <button
                    onClick={() => setIsCollapsed(true)}
                    className="px-2 text-zinc-500 hover:text-zinc-300 transition-colors"
                    title="Collapse"
                >
                    <Icon name="chevron-down" size="sm" />
                </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden relative bg-[#131316] tabular-nums">
                {activeTab === 'Trade' && (
                    <PositionsPanel
                        accountId={accountId}
                        wsConnection={wsConnection}
                    />
                )}
                {activeTab === 'History' && (
                    <HistoryTab history={history} />
                )}
                {activeTab === 'Orders' && (
                    <OrdersTab orders={orders} onCancelOrder={handleCancelOrder} />
                )}
                {activeTab === 'Alerts' && (
                    <AlertManager />
                )}
                {activeTab === 'Sessions' && (
                    <MarketSessions />
                )}
                {activeTab === 'Correlation' && (
                    <CorrelationMatrix />
                )}
                {activeTab === 'Tester' && (
                    <StrategyTester />
                )}
                {activeTab === 'Signals' && (
                    <TradingSignals />
                )}
                {activeTab === 'RiskMap' && (
                    <RiskHeatmap accountId={accountId} />
                )}
                {activeTab === 'Sentiment' && (
                    <SentimentAnalysis />
                )}
                {activeTab === 'Screener' && (
                    <SymbolScreener />
                )}
                {activeTab === 'MTA' && (
                    <MultiTimeframeAnalysis />
                )}
                {activeTab === 'PnL' && (
                    <PnLCalendar />
                )}
                {activeTab === 'Drawing' && (
                    <DrawingTools />
                )}
                {activeTab === 'Analytics' && (
                    <TradeAnalytics />
                )}
                {activeTab === 'AdvancedOrders' && (
                    <AdvancedOrders />
                )}
                {activeTab === 'Replay' && (
                    <MarketReplay />
                )}
                {activeTab === 'CopyTrading' && (
                    <CopyTradingLeaderboard />
                )}
                {activeTab === 'NewsImpact' && (
                    <NewsImpactAnalyzer />
                )}
                {activeTab === 'PositionSizer' && (
                    <PositionSizeCalculator />
                )}
                {activeTab === 'EquityCurve' && (
                    <EquityCurveTracker />
                )}
                {activeTab === 'Volatility' && (
                    <VolatilityAnalyzer />
                )}
                {activeTab === 'Currency' && (
                    <CurrencyConverter />
                )}
                {activeTab === 'Journal' && (
                    <JournalTab entries={journal} />
                )}
                {activeTab === 'JournalV2' && (
                    <TradeJournalV2 />
                )}
                {activeTab === 'SessionMap' && (
                    <SessionHeatMap />
                )}
                {activeTab === 'RiskExposure' && (
                    <RiskExposurePanel />
                )}
                {activeTab === 'OrderFlow' && (
                    <OrderFlowVisualizer />
                )}
                {activeTab === 'MarketProfile' && (
                    <MarketProfile />
                )}
                {activeTab === 'TradingSim' && (
                    <TradingSimulator />
                )}
            </div>
        </div>
    );
}

// --- TAB COMPONENTS ---


function HistoryTab({ history }: { history: HistoryTrade[] }) {
    const formatPrice = (val: number, symbol: string) => {
        if (val === 0) return <span>-</span>;
        return <PriceDisplay price={val} symbol={symbol} />;
    };

    const formatTimestamp = (ts: number) => {
        if (!ts || ts === 0) return '-';
        try {
            return new Date(ts * 1000).toLocaleString('en-US', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
            }).replace(',', '');
        } catch {
            return '-';
        }
    };

    const isBuy = (typeText: string) => typeText.toLowerCase().includes('buy');

    const getStateColor = (stateText: string) => {
        switch (stateText.toLowerCase()) {
            case 'filled': return 'text-emerald-400 bg-emerald-900/20';
            case 'canceled': return 'text-red-400 bg-red-900/20';
            case 'expired': return 'text-yellow-400 bg-yellow-900/20';
            default: return 'text-zinc-400 bg-zinc-800';
        }
    };

    return (
        <div className="h-full overflow-auto scrollbar-thin scrollbar-thumb-zinc-700 bg-[#131316]">
            <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-[#191a1e] text-zinc-400 z-10 font-bold text-[10px] uppercase tracking-wider border-b border-zinc-600">
                    <tr>
                        <th className="p-1 pl-2 border-r border-zinc-700 w-16">Order</th>
                        <th className="p-1 border-r border-zinc-700 w-20">Symbol</th>
                        <th className="p-1 border-r border-zinc-700 w-14">Type</th>
                        <th className="p-1 border-r border-zinc-700 w-14">State</th>
                        <th className="p-1 border-r border-zinc-700 w-14 text-right">Volume</th>
                        <th className="p-1 border-r border-zinc-700 w-20 text-right">Price</th>
                        <th className="p-1 border-r border-zinc-700 w-20 text-right">Current</th>
                        <th className="p-1 border-r border-zinc-700 w-16 text-right">S/L</th>
                        <th className="p-1 border-r border-zinc-700 w-16 text-right">T/P</th>
                        <th className="p-1 border-r border-zinc-700 w-28">Setup Time</th>
                        <th className="p-1 border-r border-zinc-700 w-28">Done Time</th>
                        <th className="p-1 pr-4">Comment</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 text-zinc-300 font-mono text-[11px]">
                    {history.length === 0 ? (
                        <tr>
                            <td colSpan={12} className="p-8 text-center text-zinc-600 text-xs italic">
                                No order history
                            </td>
                        </tr>
                    ) : (
                        [...history].reverse().map((order, i) => (
                            <tr key={order.order} className={`${i % 2 === 0 ? 'bg-[#131316]' : 'bg-[#0f0f12]'} hover:bg-[#191a1e] transition-colors`}>
                                <td className="p-1 pl-2 border-r border-zinc-800 text-zinc-500">{order.order}</td>
                                <td className="p-1 border-r border-zinc-800 font-bold text-zinc-100">{order.symbol}</td>
                                <td className={`p-1 border-r border-zinc-800 font-bold text-[10px] ${isBuy(order.type_text) ? 'text-zinc-300' : 'text-red-400'}`}>
                                    {order.type_text.toUpperCase()}
                                </td>
                                <td className="p-1 border-r border-zinc-800">
                                    <span className={`text-[10px] px-1 rounded-sm ${getStateColor(order.state_text)}`}>
                                        {order.state_text}
                                    </span>
                                </td>
                                <td className="p-1 border-r border-zinc-800 text-right font-medium text-zinc-200">
                                    {order.volume_initial_lots.toFixed(2)}
                                </td>
                                <td className="p-1 border-r border-zinc-800 text-right text-zinc-400">
                                    {formatPrice(order.price_order, order.symbol)}
                                </td>
                                <td className="p-1 border-r border-zinc-800 text-right text-zinc-300">
                                    {formatPrice(order.price_current, order.symbol)}
                                </td>
                                <td className="p-1 border-r border-zinc-800 text-right">
                                    <span className={order.price_sl > 0 ? 'text-red-300 bg-red-900/20 px-1 rounded-sm' : 'text-zinc-600'}>
                                        {order.price_sl > 0 ? formatPrice(order.price_sl, order.symbol) : ''}
                                    </span>
                                </td>
                                <td className="p-1 border-r border-zinc-800 text-right">
                                    <span className={order.price_tp > 0 ? 'text-emerald-300 bg-emerald-900/20 px-1 rounded-sm' : 'text-zinc-600'}>
                                        {order.price_tp > 0 ? formatPrice(order.price_tp, order.symbol) : ''}
                                    </span>
                                </td>
                                <td className="p-1 border-r border-zinc-800 text-zinc-400 whitespace-nowrap text-[10px]">
                                    {formatTimestamp(order.time_setup)}
                                </td>
                                <td className="p-1 border-r border-zinc-800 text-zinc-400 whitespace-nowrap text-[10px]">
                                    {formatTimestamp(order.time_done)}
                                </td>
                                <td className="p-1 pr-4 text-zinc-500 text-[10px] truncate max-w-[120px]" title={order.comment}>
                                    {order.comment || '-'}
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}

function OrdersTab({ orders, onCancelOrder }: {
    orders: PendingOrder[];
    onCancelOrder: (orderId: string) => void;
}) {
    const formatDate = (dateStr: string) => {
        try {
            return new Date(dateStr).toLocaleString('en-US', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
            }).replace(',', '');
        } catch {
            return dateStr;
        }
    };

    return (
        <div className="h-full overflow-auto scrollbar-thin scrollbar-thumb-zinc-700 bg-[#131316]">
            <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-[#191a1e] text-zinc-400 z-10 font-bold text-[10px] uppercase tracking-wider border-b border-zinc-600">
                    <tr>
                        <th className="p-1 pl-2 border-r border-zinc-700 w-16">Ticket</th>
                        <th className="p-1 border-r border-zinc-700 w-20">Symbol</th>
                        <th className="p-1 border-r border-zinc-700 w-16">Type</th>
                        <th className="p-1 border-r border-zinc-700 w-12">Side</th>
                        <th className="p-1 border-r border-zinc-700 w-16 text-right">Volume</th>
                        <th className="p-1 border-r border-zinc-700 w-20 text-right">Price</th>
                        <th className="p-1 border-r border-zinc-700 w-16 text-right">S/L</th>
                        <th className="p-1 border-r border-zinc-700 w-16 text-right">T/P</th>
                        <th className="p-1 border-r border-zinc-700 w-16">Status</th>
                        <th className="p-1 pr-4">Created</th>
                        <th className="w-6"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 text-zinc-300 font-mono text-[11px]">
                    {orders.length === 0 ? (
                        <tr>
                            <td colSpan={11} className="p-8 text-center text-zinc-600 text-xs italic">
                                No pending orders
                            </td>
                        </tr>
                    ) : (
                        orders.map((order, i) => (
                            <tr key={order.id} className={`${i % 2 === 0 ? 'bg-[#131316]' : 'bg-[#0f0f12]'} hover:bg-[#191a1e] transition-colors group`}>
                                <td className="p-1 pl-2 border-r border-zinc-800 text-zinc-500">{order.id}</td>
                                <td className="p-1 border-r border-zinc-800 font-bold text-zinc-100">{order.symbol}</td>
                                <td className="p-1 border-r border-zinc-800 text-zinc-400 text-[10px]">{order.type}</td>
                                <td className={`p-1 border-r border-zinc-800 font-bold text-[10px] ${order.side === 'BUY' ? 'text-zinc-300' : 'text-red-400'}`}>
                                    {order.side}
                                </td>
                                <td className="p-1 border-r border-zinc-800 text-right font-medium text-zinc-200">{order.volume.toFixed(2)}</td>
                                <td className="p-1 border-r border-zinc-800 text-right text-zinc-400">{order.price.toFixed(5)}</td>
                                <td className="p-1 border-r border-zinc-800 text-right">
                                    <span className={order.sl && order.sl > 0 ? "text-red-300 bg-red-900/20 px-1 rounded-sm" : "text-zinc-600"}>
                                        {order.sl && order.sl > 0 ? order.sl.toFixed(5) : ''}
                                    </span>
                                </td>
                                <td className="p-1 border-r border-zinc-800 text-right">
                                    <span className={order.tp && order.tp > 0 ? "text-emerald-300 bg-emerald-900/20 px-1 rounded-sm" : "text-zinc-600"}>
                                        {order.tp && order.tp > 0 ? order.tp.toFixed(5) : ''}
                                    </span>
                                </td>
                                <td className="p-1 border-r border-zinc-800 text-zinc-400 text-[10px]">
                                    <span className="bg-yellow-900/20 text-yellow-300 px-1 rounded-sm">{order.status}</span>
                                </td>
                                <td className="p-1 border-r border-zinc-800 text-zinc-500 text-[10px] pr-4">{formatDate(order.createdAt)}</td>
                                <td className="p-1 text-center">
                                    <button
                                        onClick={() => onCancelOrder(order.id)}
                                        className="text-zinc-600 hover:text-white hover:bg-zinc-700 w-4 h-4 rounded flex items-center justify-center transition-colors"
                                        title="Cancel Order"
                                    >
                                        ×
                                    </button>
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}

function AlertsTab({ alerts }: { alerts: Alert[] }) {
    const formatDate = (dateStr: string) => {
        try {
            return new Date(dateStr).toLocaleString('en-US', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
            }).replace(',', '');
        } catch {
            return dateStr;
        }
    };

    return (
        <div className="h-full overflow-auto scrollbar-thin scrollbar-thumb-zinc-700 bg-[#131316]">
            <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-[#191a1e] text-zinc-400 z-10 font-bold text-[10px] uppercase tracking-wider border-b border-zinc-600">
                    <tr>
                        <th className="p-1 pl-2 border-r border-zinc-700 w-20">Symbol</th>
                        <th className="p-1 border-r border-zinc-700">Condition</th>
                        <th className="p-1 border-r border-zinc-700 w-20 text-right">Price</th>
                        <th className="p-1 border-r border-zinc-700 w-16">Status</th>
                        <th className="p-1 pr-4">Created</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 text-zinc-300 font-mono text-[11px]">
                    {alerts.length === 0 ? (
                        <tr>
                            <td colSpan={5} className="p-8 text-center text-zinc-600 text-xs italic">
                                No active alerts
                            </td>
                        </tr>
                    ) : (
                        alerts.map((alert, i) => (
                            <tr key={alert.id} className={`${i % 2 === 0 ? 'bg-[#131316]' : 'bg-[#0f0f12]'} hover:bg-[#191a1e] transition-colors`}>
                                <td className="p-1 pl-2 border-r border-zinc-800 font-bold text-zinc-100">{alert.symbol}</td>
                                <td className="p-1 border-r border-zinc-800 text-zinc-400">{alert.condition}</td>
                                <td className="p-1 border-r border-zinc-800 text-right text-zinc-300">{alert.price.toFixed(5)}</td>
                                <td className="p-1 border-r border-zinc-800">
                                    <span className={`text-[10px] px-1 rounded-sm ${alert.status === 'ACTIVE' ? 'bg-green-900/20 text-green-300' :
                                        alert.status === 'TRIGGERED' ? 'bg-yellow-900/20 text-yellow-300' :
                                            'bg-zinc-800 text-zinc-500'
                                        }`}>
                                        {alert.status}
                                    </span>
                                </td>
                                <td className="p-1 text-zinc-500 text-[10px] pr-4">{formatDate(alert.createdAt)}</td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}

function JournalTab({ entries }: { entries: JournalEntry[] }) {
    const formatTime = (timestamp: string) => {
        try {
            return new Date(timestamp).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
            });
        } catch {
            return timestamp;
        }
    };

    const getTypeColor = (type: JournalEntry['type']) => {
        switch (type) {
            case 'SUCCESS': return 'text-zinc-300';
            case 'WARNING': return 'text-yellow-400';
            case 'ERROR': return 'text-red-400';
            default: return 'text-zinc-400';
        }
    };

    const getTypeIcon = (type: JournalEntry['type']) => {
        switch (type) {
            case 'SUCCESS': return <Icon name="trending-up" size="xs" />;
            case 'WARNING': return <Icon name="alert-triangle" size="xs" />;
            case 'ERROR': return <Icon name="x-close" size="xs" />;
            default: return <Icon name="file-text" size="xs" />;
        }
    };

    return (
        <div className="h-full overflow-auto scrollbar-thin scrollbar-thumb-zinc-700 bg-[#131316] font-mono">
            <div className="p-2 space-y-1">
                {entries.length === 0 ? (
                    <div className="p-8 text-center text-zinc-600 text-xs italic">
                        No journal entries
                    </div>
                ) : (
                    entries.map((entry, i) => (
                        <div
                            key={i}
                            className="flex items-start gap-2 px-2 py-1 hover:bg-zinc-800/50 rounded text-[11px]"
                        >
                            <Icon name="clock" size="xs" className="text-zinc-600 mt-0.5 flex-shrink-0" />
                            <span className="text-zinc-500 tabular-nums min-w-[65px]">{formatTime(entry.timestamp)}</span>
                            <span className={`flex-shrink-0 ${getTypeColor(entry.type)}`}>
                                {getTypeIcon(entry.type)}
                            </span>
                            <span className="text-zinc-300 flex-1">{entry.message}</span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

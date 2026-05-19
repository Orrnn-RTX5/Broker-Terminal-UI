/**
 * Enhanced Positions/Orders Panel
 * Professional positions and orders management with inline editing
 * Features: SL/TP inline editing, close all, real-time P&L
 *
 * Positions are owned by useTradeFacingData → useAppStore.
 * This panel is a pure consumer: no position polling, no position WS handler.
 * Orders are fetched here independently (backend has no order-specific WS channel
 * that useTradeFacingData exposes to the store).
 */

import { Icon } from './ui/Icon';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import api from '../services/api';
import { useCurrentTick, useMarketDataStore } from '../store/useMarketDataStore';
import { useConfirmStore } from '../store/useConfirmStore';
import { useAppStore } from '../store/useAppStore';
import type { Position } from '../store/useAppStore';
import { ModifyPositionDialog } from './ModifyPositionDialog';
import { PriceDisplay } from './ui/PriceDisplay';

interface PendingOrder {
    id: string;
    symbol: string;
    type: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
    side: 'BUY' | 'SELL';
    volume: number;
    price: number;
    triggerPrice?: number;
    sl?: number;
    tp?: number;
    status: 'PENDING' | 'TRIGGERED' | 'FILLED' | 'CANCELLED';
    createdAt: string;
}

type TabType = 'Positions' | 'Orders';

interface PositionsPanelProps {
    accountId: string;
    wsConnection?: WebSocket | null;
}

interface EditingState {
    positionId: number;
    field: 'sl' | 'tp';
    value: string;
}

const toNumber = (value: unknown, fallback = 0): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const normalizeOrder = (raw: Record<string, any>, index: number): PendingOrder => {
    const rawType = String(raw.type ?? '').toUpperCase();
    const side = String(raw.side ?? '').toUpperCase() === 'SELL' || rawType.includes('SELL') ? 'SELL' : 'BUY';
    const type = rawType;
    const normalizedType: PendingOrder['type'] =
        type === 'STOP_LIMIT' ? 'STOP_LIMIT' :
            type === 'STOP' ? 'STOP' :
                type === 'LIMIT' ? 'LIMIT' : 'MARKET';
    const status = String(raw.status ?? '').toUpperCase();

    return {
        id: String(raw.ticket ?? raw.id ?? index + 1),
        symbol: String(raw.symbol ?? ''),
        type: normalizedType,
        side,
        volume: toNumber(raw.quantity ?? raw.volume, 0),
        price: toNumber(raw.price, 0),
        triggerPrice: toNumber(raw.stop_price ?? raw.triggerPrice, 0),
        sl: toNumber(raw.price_sl ?? raw.sl, 0),
        tp: toNumber(raw.price_tp ?? raw.tp, 0),
        status: status === 'PENDING' || status === 'TRIGGERED' || status === 'FILLED' || status === 'CANCELLED'
            ? status
            : 'PENDING',
        createdAt: String(raw.created_at ?? raw.createdAt ?? (raw.time_create ? new Date(toNumber(raw.time_create) * 1000).toISOString() : new Date().toISOString())),
    };
};

const getSymbolDigits = (symbol: string) => {
    if (symbol.includes('JPY')) return 3;
    if (symbol.startsWith('BTC') || symbol.startsWith('ETH') || symbol.startsWith('XAU')) return 2;
    if (symbol.startsWith('XAG')) return 3;
    return 5;
};

// High-frequency live Total PnL component
function LiveTotalPnL({ positions }: { positions: Position[] }) {

    const symbolsData = useMarketDataStore(state => state.symbolData);

    const liveTotalPnL = useMemo(() => {
        return positions.reduce((sum, pos) => {
            let livePnL = pos.unrealizedPnL;
            const tick = symbolsData[pos.symbol]?.currentTick;

            if (tick && pos.openPrice > 0) {
                const livePrice = pos.side === 'BUY' ? tick.bid : tick.ask;
                let multiplier = 100000;
                if (pos.symbol.includes('JPY')) multiplier = 1000;
                else if (pos.symbol.startsWith('BTC') || pos.symbol.startsWith('ETH')) multiplier = 1;
                else if (pos.symbol.startsWith('XAU')) multiplier = 100;
                else if (pos.symbol.startsWith('XAG')) multiplier = 5000;

                const pipDiff = pos.side === 'BUY' ? (livePrice - pos.openPrice) : (pos.openPrice - livePrice);
                livePnL = pipDiff * pos.volume * multiplier;
            }
            return sum + livePnL;
        }, 0);
    }, [positions, symbolsData]);

    const formatMoney = (val: number | undefined | null) => {
        const v = val ?? 0;
        if (isNaN(v)) return '0.00';
        const parts = v.toFixed(2).split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
        return parts.join('.');
    };

    return (
        <span>
            Total P&L: <span className={`${liveTotalPnL >= 0 ? "text-[#4ade80]" : "text-[#f87171]"} font-semibold px-1 rounded-sm`}>
                {formatMoney(liveTotalPnL)}
            </span>
        </span>
    );
}

// Component to handle individual live row updates efficiently
function PositionRow({
    pos,
    i,
    editing,
    setEditing,
    handleModifySLTP,
    handleClosePosition,
    loading,
    onDoubleClick
}: {
    pos: Position,
    i: number,
    editing: EditingState | null,
    setEditing: (state: EditingState | null) => void,
    handleModifySLTP: (id: number, field: 'sl' | 'tp', value: string) => void,
    handleClosePosition: (id: number) => void,
    loading: boolean,
    onDoubleClick: (pos: Position) => void
}) {
    const digits = getSymbolDigits(pos.symbol);

    const livePrice = pos.currentPrice;

    const priceColor = 'text-zinc-300';

    let livePnL = pos.unrealizedPnL;

    // Plain PnL color (no blink)
    const pnlColor = '';

    const formatMoney = (val: number | undefined | null) => {
        const v = val ?? 0;
        if (isNaN(v)) return '0.00';
        const parts = v.toFixed(2).split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
        return parts.join('.');
    };

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
        <tr className={`font-semibold ${i % 2 === 0 ? 'bg-[#131316] rtx-row-even' : 'bg-[#0f0f12] rtx-row-odd'} hover:bg-[#191a1e] transition-colors group cursor-pointer`} onDoubleClick={() => onDoubleClick(pos)}>
            <td className="px-1 py-[2px] pl-2 text-zinc-500">{pos.id}</td>
            <td className="px-1 py-[2px] font-semibold text-zinc-100">{pos.symbol}</td>
            <td className={`px-1 py-[2px] font-semibold text-[10px] ${pos.side === 'BUY' ? 'text-blue-400' : 'text-red-400'}`}>
                <div className="flex items-center gap-1">
                    {pos.side === 'BUY' ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
                    )}
                    <span>{pos.side}</span>
                </div>
            </td>
            <td className="px-1 py-[2px] text-right font-semibold text-zinc-200">{pos.volume.toFixed(2)}</td>
            <td className="px-1 py-[2px] text-right text-zinc-400"><PriceDisplay price={pos.openPrice} symbol={pos.symbol} /></td>
            <td className={`px-1 py-[2px] text-right ${priceColor}`}><PriceDisplay price={livePrice} symbol={pos.symbol} /></td>
            {/* SL - Inline Editing */}
            <td className="px-1 py-[2px] text-right">
                {editing?.positionId === pos.id && editing.field === 'sl' ? (
                    <input
                        type="number"
                        step="0.00001"
                        value={editing.value}
                        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                        onBlur={() => handleModifySLTP(pos.id, 'sl', editing.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleModifySLTP(pos.id, 'sl', editing.value);
                            if (e.key === 'Escape') setEditing(null);
                        }}
                        autoFocus
                        className="w-full bg-zinc-800 text-zinc-100 px-1 py-0.5 rounded text-[11px] font-mono"
                    />
                ) : (
                    <div
                        onClick={() => setEditing({ positionId: pos.id, field: 'sl', value: pos.sl.toString() })}
                        className="cursor-pointer hover:bg-zinc-700 rounded px-1"
                    >
                        <span className={pos.sl > 0 ? "text-red-300" : "text-zinc-600"}>
                            {pos.sl > 0 ? <PriceDisplay price={pos.sl} symbol={pos.symbol} /> : '—'}
                        </span>
                    </div>
                )}
            </td>
            {/* TP - Inline Editing */}
            <td className="px-1 py-[2px] text-right">
                {editing?.positionId === pos.id && editing.field === 'tp' ? (
                    <input
                        type="number"
                        step="0.00001"
                        value={editing.value}
                        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                        onBlur={() => handleModifySLTP(pos.id, 'tp', editing.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleModifySLTP(pos.id, 'tp', editing.value);
                            if (e.key === 'Escape') setEditing(null);
                        }}
                        autoFocus
                        className="w-full bg-zinc-800 text-zinc-100 px-1 py-0.5 rounded text-[11px] font-mono"
                    />
                ) : (
                    <div
                        onClick={() => setEditing({ positionId: pos.id, field: 'tp', value: pos.tp.toString() })}
                        className="cursor-pointer hover:bg-zinc-700 rounded px-1"
                    >
                        <span className={pos.tp > 0 ? "text-emerald-300" : "text-zinc-600"}>
                            {pos.tp > 0 ? <PriceDisplay price={pos.tp} symbol={pos.symbol} /> : '—'}
                        </span>
                    </div>
                )}
            </td>
            <td className={`px-1 py-[2px] text-right font-semibold ${livePnL >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'} ${pnlColor}`}>
                {formatMoney(livePnL)}
            </td>
            <td className="px-1 py-[2px] text-right text-zinc-500 text-[10px]">{formatMoney(pos.swap)}</td>
            <td className="px-1 py-[2px] text-zinc-500 text-[10px]">{formatDate(pos.openTime).split(' ')[1]}</td>
            <td className="px-1 py-[2px] pr-2">
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => handleClosePosition(pos.id)}
                        className="text-zinc-600 hover:text-white hover:bg-zinc-700 w-5 h-5 rounded flex items-center justify-center transition-colors"
                        title="Close Position"
                        disabled={loading}
                    >
                        <Icon name="x-close" size="xs" />
                    </button>
                </div>
            </td>
        </tr>
    );
}

function PendingOrderRow({
    order,
    i,
    handleCancelOrder,
    onModifyOrder,
    loading
}: {
    order: PendingOrder,
    i: number,
    handleCancelOrder: (id: string) => void,
    onModifyOrder: (order: PendingOrder) => void,
    loading: boolean
}) {
    const digits = getSymbolDigits(order.symbol);

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
        <tr className={`font-semibold ${i % 2 === 0 ? 'bg-[#131316] rtx-row-even' : 'bg-[#0f0f12] rtx-row-odd'} hover:bg-[#191a1e] transition-colors group`}>
            <td className="px-1 py-[2px] pl-2 text-zinc-500">{order.id}</td>
            <td className="px-1 py-[2px] font-semibold text-zinc-100">{order.symbol}</td>
            <td className="px-1 py-[2px] text-zinc-400 text-[10px]">{order.type}</td>
            <td className={`px-1 py-[2px] font-semibold text-[10px] ${order.side === 'BUY' ? 'text-blue-400' : 'text-red-400'}`}>
                <div className="flex items-center gap-1">
                    {order.side === 'BUY' ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
                    )}
                    <span>{order.side}</span>
                </div>
            </td>
            <td className="px-1 py-[2px] text-right font-semibold text-zinc-200">{order.volume.toFixed(2)}</td>
            <td className="px-1 py-[2px] text-right text-zinc-400"><PriceDisplay price={order.price} symbol={order.symbol} /></td>
            <td className="px-1 py-[2px] text-right">
                <span className={order.sl && order.sl > 0 ? "text-red-300" : "text-zinc-600"}>
                    {order.sl && order.sl > 0 ? <PriceDisplay price={order.sl} symbol={order.symbol} /> : '—'}
                </span>
            </td>
            <td className="px-1 py-[2px] text-right">
                <span className={order.tp && order.tp > 0 ? "text-emerald-300" : "text-zinc-600"}>
                    {order.tp && order.tp > 0 ? <PriceDisplay price={order.tp} symbol={order.symbol} /> : '—'}
                </span>
            </td>
            <td className="px-1 py-[2px]">
                <span className="bg-yellow-900/20 text-yellow-300 px-1 rounded-sm text-[10px]">{order.status}</span>
            </td>
            <td className="px-1 py-[2px] text-zinc-500 text-[10px]">{formatDate(order.createdAt)}</td>
            <td className="px-1 py-[2px] pr-2">
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => onModifyOrder(order)}
                        className="text-zinc-600 hover:text-blue-400 hover:bg-zinc-700 w-5 h-5 rounded flex items-center justify-center transition-colors"
                        title="Modify Order SL/TP"
                        disabled={loading}
                    >
                        <Icon name="edit" size="xs" />
                    </button>
                    <button
                        onClick={() => handleCancelOrder(order.id)}
                        className="text-zinc-600 hover:text-white hover:bg-zinc-700 w-5 h-5 rounded flex items-center justify-center transition-colors"
                        title="Cancel Order"
                        disabled={loading}
                    >
                        <Icon name="x-close" size="xs" />
                    </button>
                </div>
            </td>
        </tr>
    );
}

export function PositionsPanel({ accountId, wsConnection }: PositionsPanelProps) {
    const [activeTab, setActiveTab] = useState<TabType>('Positions');
    const [orders, setOrders] = useState<PendingOrder[]>([]);
    const [editing, setEditing] = useState<EditingState | null>(null);
    const [showCloseAllConfirm, setShowCloseAllConfirm] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const closingTicketsRef = useRef<Set<number>>(new Set());
    const ordersInFlightRef = useRef(false);
    const [modifyPosition, setModifyPosition] = useState<Position | null>(null);
    const [modifyOrder, setModifyOrder] = useState<PendingOrder | null>(null);

    // Positions come from the global store — populated and kept fresh by useTradeFacingData.
    // No local fetch or polling here to avoid racing with that hook.
    const positions = useAppStore(state => state.positions);

    // Fetch pending orders (not managed by useTradeFacingData)
    const fetchOrders = useCallback(async () => {
        if (ordersInFlightRef.current) return;
        ordersInFlightRef.current = true;
        try {
            const data = await api.orders.getPendingOrders();
            const list = Array.isArray(data) ? data : [];
            setOrders(list.map((item: Record<string, any>, index: number) => normalizeOrder(item, index)));
        } catch (err) {
            console.error('[PositionsPanel] Failed to fetch orders:', err);
            setError((err as Error)?.message || 'Failed to fetch orders');
        } finally {
            ordersInFlightRef.current = false;
        }
    }, [accountId]);

    // Fetch orders on mount and poll every 15s (orders change infrequently)
    useEffect(() => {
        fetchOrders();
        const ordInterval = setInterval(fetchOrders, 15000);
        return () => clearInterval(ordInterval);
    }, [fetchOrders]);

    // WebSocket — orders only (positions are handled by useTradeFacingData's own WS)
    useEffect(() => {
        if (!wsConnection) return;

        const handleMessage = (event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'order_update' || data.channel?.startsWith('orders.')) {
                    if (Array.isArray(data.data?.orders)) {
                        setOrders(data.data.orders.map((item: Record<string, any>, index: number) => normalizeOrder(item, index)));
                    } else if (data.order || data.data?.order || data.data) {
                        const payload = data.order || data.data?.order || data.data;
                        setOrders((prev) => {
                            const normalized = normalizeOrder(payload, prev.length);
                            if (normalized.status === 'CANCELLED' || normalized.status === 'TRIGGERED' || normalized.status === 'FILLED') {
                                return prev.filter((order) => order.id !== normalized.id);
                            }
                            const index = prev.findIndex((order) => order.id === normalized.id);
                            if (index >= 0) {
                                const updated = [...prev];
                                updated[index] = { ...updated[index], ...normalized };
                                return updated;
                            }
                            return [...prev, normalized];
                        });
                    }
                }
            } catch (err) {
                console.error('[PositionsPanel] WS parse error:', err);
            }
        };

        wsConnection.addEventListener('message', handleMessage);
        return () => wsConnection.removeEventListener('message', handleMessage);
    }, [wsConnection]);

    // Close position — optimistic store update then let useTradeFacingData re-sync
    const handleClosePosition = async (id: number) => {
        if (!(await useConfirmStore.getState().showConfirm('Close Position', `Close position #${id}?`))) return;
        if (closingTicketsRef.current.has(id)) return;
        closingTicketsRef.current.add(id);

        // Optimistic removal so the UI responds immediately
        useAppStore.getState().setPositions(useAppStore.getState().positions.filter(p => p.id !== id));
        window.dispatchEvent(new Event('rtx:force-refresh-positions'));

        try {
            setLoading(true);
            setError(null);
            await api.positions.closePosition(String(id));
            // useTradeFacingData will re-fetch via the rtx:force-refresh-positions event above
        } catch (err) {
            console.error('[PositionsPanel] Close position failed:', err);
            setError((err as Error)?.message || 'Failed to close position');
            // Re-sync on error so stale optimistic state doesn't linger
            window.dispatchEvent(new Event('rtx:force-refresh-positions'));
        } finally {
            closingTicketsRef.current.delete(id);
            setLoading(false);
        }
    };

    // Close all positions
    const handleCloseAll = async () => {
        try {
            setLoading(true);
            setError(null);
            const snapshot = useAppStore.getState().positions;

            // Optimistic clear
            useAppStore.getState().setPositions([]);
            window.dispatchEvent(new Event('rtx:force-refresh-positions'));

            await Promise.all(snapshot.map(pos => api.positions.closePosition(String(pos.id))));
            setShowCloseAllConfirm(false);
        } catch (err) {
            console.error('[PositionsPanel] Close all failed:', err);
            setError((err as Error)?.message || 'Failed to close all positions');
            window.dispatchEvent(new Event('rtx:force-refresh-positions'));
        } finally {
            setLoading(false);
        }
    };

    // Modify SL/TP
    const handleModifySLTP = async (positionId: number, field: 'sl' | 'tp', value: string) => {
        const numValue = parseFloat(value);
        if (isNaN(numValue) || numValue < 0) {
            alert('Invalid price value');
            return;
        }

        try {
            setLoading(true);
            setError(null);

            const pos = useAppStore.getState().positions.find(p => p.id === positionId);
            const currentSl = pos?.sl ?? 0;
            const currentTp = pos?.tp ?? 0;

            const newSl = field === 'sl' ? numValue : currentSl;
            const newTp = field === 'tp' ? numValue : currentTp;

            await api.positions.modifyPosition(positionId, { price_sl: newSl, price_tp: newTp });

            // Optimistic update then let useTradeFacingData confirm
            useAppStore.getState().setPositions(
                useAppStore.getState().positions.map(p =>
                    p.id === positionId ? { ...p, sl: newSl, tp: newTp } : p
                )
            );

            window.dispatchEvent(new Event('rtx:force-refresh-positions'));
            setEditing(null);
        } catch (err) {
            console.error('[PositionsPanel] Modify SL/TP failed:', err);
            setError((err as Error)?.message || 'Failed to modify SL/TP');
        } finally {
            setLoading(false);
        }
    };

    // Cancel order
    const handleCancelOrder = async (orderId: string) => {
        if (!(await useConfirmStore.getState().showConfirm('Cancel Order', `Cancel pending order #${orderId}?`))) return;

        try {
            setLoading(true);
            setError(null);
            await api.orders.cancelOrder(orderId);
            await fetchOrders();
        } catch (err) {
            console.error('[PositionsPanel] Cancel order failed:', err);
            setError((err as Error)?.message || 'Failed to cancel order');
        } finally {
            setLoading(false);
        }
    };

    const formatMoney = (val: number | undefined | null) => {
        const v = val ?? 0;
        return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
    };

    const displayPositions = positions;
    const displayOrders = Array.isArray(orders) ? orders : [];

    return (
        <div className="h-full flex flex-col bg-[#131316]">
            {/* Tab Bar */}
            <div className="flex items-center bg-[#131316] border-b border-zinc-800/50 flex-shrink-0">
                <div className="flex items-center flex-1">
                    {(['Positions', 'Orders'] as TabType[]).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap relative
                                ${activeTab === tab
                                    ? 'text-white bg-[#191a1e] shadow-[inset_0_2px_0_0_#8a8a8f] font-semibold'
                                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#191a1e]/50'}`}
                        >
                            {tab} {tab === 'Positions' && displayPositions.length > 0 ? `(${displayPositions.length})` : ''}
                            {tab === 'Orders' && displayOrders.length > 0 ? `(${displayOrders.length})` : ''}
                        </button>
                    ))}
                </div>
                {activeTab === 'Positions' && displayPositions.length > 0 && (
                    <button
                        onClick={() => setShowCloseAllConfirm(true)}
                        className="px-3 py-1 mr-2 text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded transition-colors"
                        disabled={loading}
                    >
                        Close All
                    </button>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden relative">
                {error && (
                    <div className="absolute top-0 left-0 right-0 z-20 px-3 py-2 bg-red-950/90 border-b border-red-800 text-xs text-red-300">
                        {error}
                    </div>
                )}
                {activeTab === 'Positions' && (
                    <div className="h-full overflow-auto scrollbar-thin scrollbar-thumb-zinc-700">
                        <table className="w-full text-left border-collapse">
                            <thead className="sticky top-0 bg-[#191a1e] text-zinc-400 z-10 font-bold text-[10px] uppercase tracking-wider border-b border-zinc-800/50">
                                <tr>
                                    <th className="px-1 py-[3px] pl-2">Ticket</th>
                                    <th className="px-1 py-[3px]">Symbol</th>
                                    <th className="px-1 py-[3px]">Type</th>
                                    <th className="px-1 py-[3px] text-right">Volume</th>
                                    <th className="px-1 py-[3px] text-right">Open</th>
                                    <th className="px-1 py-[3px] text-right">Current</th>
                                    <th className="px-1 py-[3px] text-right">S/L</th>
                                    <th className="px-1 py-[3px] text-right">T/P</th>
                                    <th className="px-1 py-[3px] text-right">P&L</th>
                                    <th className="px-1 py-[3px] text-right">Swap</th>
                                    <th className="px-1 py-[3px]">Time</th>
                                    <th className="px-1 py-[3px] pr-2">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="text-zinc-300 font-mono text-[11px]">
                                {displayPositions.length === 0 ? (
                                    <tr>
                                        <td colSpan={12} className="p-8 text-center text-zinc-600 text-xs italic">
                                            No open positions
                                        </td>
                                    </tr>
                                ) : (
                                    displayPositions.map((pos, i) => (
                                        <PositionRow
                                            key={pos.id}
                                            pos={pos}
                                            i={i}
                                            editing={editing}
                                            setEditing={setEditing}
                                            handleModifySLTP={handleModifySLTP}
                                            handleClosePosition={handleClosePosition}
                                            loading={loading}
                                            onDoubleClick={(p) => setModifyPosition(p)}
                                        />
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

                {activeTab === 'Orders' && (
                    <div className="h-full overflow-auto scrollbar-thin scrollbar-thumb-zinc-700">
                        <table className="w-full text-left border-collapse">
                            <thead className="sticky top-0 bg-[#191a1e] text-zinc-400 z-10 font-bold text-[10px] uppercase tracking-wider border-b border-zinc-800/50">
                                <tr>
                                    <th className="px-1 py-[3px] pl-2">Ticket</th>
                                    <th className="px-1 py-[3px]">Symbol</th>
                                    <th className="px-1 py-[3px]">Type</th>
                                    <th className="px-1 py-[3px]">Side</th>
                                    <th className="px-1 py-[3px] text-right">Volume</th>
                                    <th className="px-1 py-[3px] text-right">Price</th>
                                    <th className="px-1 py-[3px] text-right">S/L</th>
                                    <th className="px-1 py-[3px] text-right">T/P</th>
                                    <th className="px-1 py-[3px]">Status</th>
                                    <th className="px-1 py-[3px]">Created</th>
                                    <th className="px-1 py-[3px] pr-2">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="text-zinc-300 font-mono text-[11px]">
                                {displayOrders.length === 0 ? (
                                    <tr>
                                        <td colSpan={11} className="p-8 text-center text-zinc-600 text-xs italic">
                                            No pending orders
                                        </td>
                                    </tr>
                                ) : (
                                    displayOrders.map((order, i) => (
                                        <PendingOrderRow
                                            key={order.id}
                                            order={order}
                                            i={i}
                                            handleCancelOrder={handleCancelOrder}
                                            onModifyOrder={(o) => setModifyOrder(o)}
                                            loading={loading}
                                        />
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Bottom Summary */}
            {activeTab === 'Positions' && displayPositions.length > 0 && (
                <div className="bg-[#191a1e] border-t border-zinc-800/50 px-3 py-1 flex items-center gap-6 text-[11px] font-medium text-zinc-300 tabular-nums flex-shrink-0">
                    <LiveTotalPnL positions={displayPositions} />
                    <div className="flex-1"></div>
                    <span className="text-zinc-500">{displayPositions.length} position{displayPositions.length !== 1 ? 's' : ''}</span>
                </div>
            )}

            {/* Close All Confirmation Modal */}
            {showCloseAllConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-[#131316] border border-zinc-700 rounded-lg shadow-2xl p-6 max-w-md">
                        <div className="flex items-center gap-3 mb-4">
                            <Icon name="alert-triangle" size="sm" className="w-6 h-6 text-yellow-400" />
                            <h3 className="text-lg font-semibold text-zinc-100">Close All Positions?</h3>
                        </div>
                        <p className="text-sm text-zinc-400 mb-6">
                            This will close all {displayPositions.length} open positions. This action cannot be undone.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowCloseAllConfirm(false)}
                                className="flex-1 px-4 py-2 text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCloseAll}
                                disabled={loading}
                                className="flex-1 px-4 py-2 text-sm font-medium bg-red-500 hover:bg-red-600 text-white rounded transition-colors disabled:opacity-50"
                            >
                                {loading ? 'Closing...' : 'Close All'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modify Position Dialog */}
            <ModifyPositionDialog
                isOpen={modifyPosition !== null}
                onClose={() => {
                    setModifyPosition(null);
                    window.dispatchEvent(new Event('rtx:force-refresh-positions'));
                }}
                position={modifyPosition}
            />
            {/* Modify Order Dialog */}
            <ModifyPositionDialog
                isOpen={modifyOrder !== null}
                kind="pending-order"
                onClose={() => {
                    setModifyOrder(null);
                    fetchOrders();
                }}
                position={modifyOrder ? {
                    id: parseInt(modifyOrder.id, 10),
                    symbol: modifyOrder.symbol,
                    side: modifyOrder.side,
                    volume: modifyOrder.volume,
                    openPrice: modifyOrder.price,
                    sl: modifyOrder.sl || 0,
                    tp: modifyOrder.tp || 0,
                } as Position : null}
            />
        </div>
    );
}

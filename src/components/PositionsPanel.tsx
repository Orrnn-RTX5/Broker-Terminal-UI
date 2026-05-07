/**
 * Enhanced Positions/Orders Panel
 * Professional positions and orders management with inline editing
 * Features: SL/TP inline editing, partial close, close all, real-time P&L
 */

import { Icon } from './ui/Icon';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { API_ENDPOINTS } from '../config/api';
import api from '../services/api';
import { useMT5Store } from '../store/useMT5Store';
import { useCurrentTick, useMarketDataStore } from '../store/useMarketDataStore';
import { useConfirmStore } from '../store/useConfirmStore';
import { useAppStore } from '../store/useAppStore';
import apiClient from '../api/client';
import { ModifyPositionDialog } from './ModifyPositionDialog';
import { PriceDisplay } from './ui/PriceDisplay';

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
    wsConnection: WebSocket | null;
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

const normalizePosition = (raw: Record<string, any>, index: number): Position => {
    const parsedId = Number.parseInt(String(raw.id ?? index + 1), 10);
    const openPrice = toNumber(raw.open_price ?? raw.openPrice ?? raw.price, 0);
    const currentPrice = toNumber(raw.current_price ?? raw.currentPrice, openPrice);
    const rawSide = String(raw.side ?? '').toUpperCase();

    return {
        id: Number.isFinite(parsedId) ? parsedId : index + 1,
        symbol: String(raw.symbol ?? ''),
        side: rawSide === 'SELL' || rawSide === 'SHORT' ? 'SELL' : 'BUY',
        volume: toNumber(raw.quantity ?? raw.volume, 0),
        openPrice,
        currentPrice,
        openTime: String(raw.opened_at ?? raw.openTime ?? new Date().toISOString()),
        sl: toNumber(raw.sl, 0),
        tp: toNumber(raw.tp, 0),
        swap: toNumber(raw.swap, 0),
        commission: toNumber(raw.commission, 0),
        unrealizedPnL: toNumber(raw.unrealized_pl ?? raw.unrealizedPnL, 0),
    };
};

const normalizeOrder = (raw: Record<string, any>, index: number): PendingOrder => {
    const side = String(raw.side ?? '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
    const type = String(raw.type ?? '').toUpperCase();
    const normalizedType: PendingOrder['type'] =
        type === 'STOP_LIMIT' ? 'STOP_LIMIT' :
            type === 'STOP' ? 'STOP' :
                type === 'LIMIT' ? 'LIMIT' : 'MARKET';
    const status = String(raw.status ?? '').toUpperCase();

    return {
        id: String(raw.id ?? index + 1),
        symbol: String(raw.symbol ?? ''),
        type: normalizedType,
        side,
        volume: toNumber(raw.quantity ?? raw.volume, 0),
        price: toNumber(raw.price, 0),
        triggerPrice: toNumber(raw.stop_price ?? raw.triggerPrice, 0),
        sl: toNumber(raw.sl, 0),
        tp: toNumber(raw.tp, 0),
        status: status === 'PENDING' || status === 'TRIGGERED' || status === 'FILLED' || status === 'CANCELLED'
            ? status
            : 'PENDING',
        createdAt: String(raw.created_at ?? raw.createdAt ?? new Date().toISOString()),
    };
};

const getSymbolDigits = (symbol: string) => {
    if (symbol.includes('JPY')) return 3;
    if (symbol.startsWith('BTC') || symbol.startsWith('ETH') || symbol.startsWith('XAU')) return 2;
    if (symbol.startsWith('XAG')) return 3;
    return 5;
};

// Helper to get auth headers
const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('auth_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
};

// High-frequency live Total PnL component
function LiveTotalPnL({ positions }: { positions: Position[] }) {
    // Subscribe only to ticks, avoid re-rendering entire PositionsPanel
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
            Total P&L: <span className={`${liveTotalPnL >= 0 ? "text-[#4ade80]" : "text-[#f87171]"} font-bold px-1 rounded-sm`}>
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
    setShowPartialClose,
    handleClosePosition,
    loading,
    onDoubleClick
}: {
    pos: Position,
    i: number,
    editing: EditingState | null,
    setEditing: (state: EditingState | null) => void,
    handleModifySLTP: (id: number, field: 'sl' | 'tp', value: string) => void,
    setShowPartialClose: (state: { positionId: number; maxVolume: number } | null) => void,
    handleClosePosition: (id: number) => void,
    loading: boolean,
    onDoubleClick: (pos: Position) => void
}) {
    const tick = useCurrentTick(pos.symbol);
    const digits = getSymbolDigits(pos.symbol);

    // If we have a live tick, recalculate the price
    // BUY position closes at BID, SELL position closes at ASK
    const livePrice = tick ? (pos.side === 'BUY' ? tick.bid : tick.ask) : pos.currentPrice;

    // Simple text color based on price direction (no blink)
    const priceColor = 'text-zinc-300';

    // Use ratio to estimate live PnL if original PnL is non-zero
    // (Actual MT5 PnL requires contract sizes, so ratio from live price change is safer)
    let livePnL = pos.unrealizedPnL;
    if (tick && pos.openPrice > 0) {
        let multiplier = 100000;
        if (pos.symbol.includes('JPY')) multiplier = 1000;
        else if (pos.symbol.startsWith('BTC') || pos.symbol.startsWith('ETH')) multiplier = 1;
        else if (pos.symbol.startsWith('XAU')) multiplier = 100;
        else if (pos.symbol.startsWith('XAG')) multiplier = 5000;

        const pipDiff = pos.side === 'BUY' ? (livePrice - pos.openPrice) : (pos.openPrice - livePrice);
        livePnL = pipDiff * pos.volume * multiplier;
    }

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
        <tr className={`${i % 2 === 0 ? 'bg-[#131316]' : 'bg-[#0f0f12]'} hover:bg-[#191a1e] transition-colors group cursor-pointer`} onDoubleClick={() => onDoubleClick(pos)}>
            <td className="px-1 py-[2px] pl-2 text-zinc-500">{pos.id}</td>
            <td className="px-1 py-[2px] font-bold text-zinc-100">{pos.symbol}</td>
            <td className={`px-1 py-[2px] font-bold text-[10px] ${pos.side === 'BUY' ? 'text-blue-400' : 'text-red-400'}`}>
                <div className="flex items-center gap-1">
                    {pos.side === 'BUY' ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
                    )}
                    <span>{pos.side}</span>
                </div>
            </td>
            <td className="px-1 py-[2px] text-right font-medium text-zinc-200">{pos.volume.toFixed(2)}</td>
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
            <td className={`px-1 py-[2px] text-right font-bold ${livePnL >= 0 ? 'text-[#4ade80]' : 'text-[#f87171]'} ${pnlColor}`}>
                {formatMoney(livePnL)}
            </td>
            <td className="px-1 py-[2px] text-right text-zinc-500 text-[10px]">{formatMoney(pos.swap)}</td>
            <td className="px-1 py-[2px] text-zinc-500 text-[10px]">{formatDate(pos.openTime).split(' ')[1]}</td>
            <td className="px-1 py-[2px] pr-2">
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setShowPartialClose({ positionId: pos.id, maxVolume: pos.volume })}
                        className="text-zinc-600 hover:text-yellow-400 hover:bg-zinc-700 w-5 h-5 rounded flex items-center justify-center transition-colors"
                        title="Partial Close"
                        disabled={loading}
                    >
                        <Icon name="trending-down" size="xs" />
                    </button>
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
        <tr className={`${i % 2 === 0 ? 'bg-[#131316]' : 'bg-[#0f0f12]'} hover:bg-[#191a1e] transition-colors group`}>
            <td className="px-1 py-[2px] pl-2 text-zinc-500">{order.id}</td>
            <td className="px-1 py-[2px] font-bold text-zinc-100">{order.symbol}</td>
            <td className="px-1 py-[2px] text-zinc-400 text-[10px]">{order.type}</td>
            <td className={`px-1 py-[2px] font-bold text-[10px] ${order.side === 'BUY' ? 'text-blue-400' : 'text-red-400'}`}>
                <div className="flex items-center gap-1">
                    {order.side === 'BUY' ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
                    )}
                    <span>{order.side}</span>
                </div>
            </td>
            <td className="px-1 py-[2px] text-right font-medium text-zinc-200">{order.volume.toFixed(2)}</td>
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
    const [positions, setPositions] = useState<Position[]>([]);
    const [orders, setOrders] = useState<PendingOrder[]>([]);
    const [editing, setEditing] = useState<EditingState | null>(null);
    const [showCloseAllConfirm, setShowCloseAllConfirm] = useState(false);
    const [showPartialClose, setShowPartialClose] = useState<{ positionId: number; maxVolume: number } | null>(null);
    const [partialCloseVolume, setPartialCloseVolume] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const closingTicketsRef = useRef<Set<number>>(new Set()); // synchronous guard vs double-click
    const [modifyPosition, setModifyPosition] = useState<Position | null>(null);
    const [modifyOrder, setModifyOrder] = useState<PendingOrder | null>(null);

    // MT5 mode — use granular selectors to avoid re-renders on unrelated store updates
    const mt5Enabled = localStorage.getItem('rtx5_mt5_mode') === 'true';
    const mt5RawPositions = useMT5Store((s) => s.positions);
    const mt5RawOrders = useMT5Store((s) => s.orders);
    const mt5FetchPositions = useMT5Store((s) => s.fetchPositions);
    const mt5FetchOrders = useMT5Store((s) => s.fetchOrders);

    const mt5Positions = mt5RawPositions.map(p => ({
        id: p.ticket,
        symbol: p.symbol,
        side: p.action === 'BUY' ? 'BUY' as const : 'SELL' as const,
        volume: p.volume,
        openPrice: p.open_price,
        currentPrice: p.current_price,
        openTime: new Date(p.time_ms).toISOString(),
        sl: p.sl,
        tp: p.tp,
        swap: p.swap,
        commission: 0,
        unrealizedPnL: p.profit
    }));
    const mt5Orders = mt5RawOrders.map(o => ({
        id: String(o.ticket),
        symbol: o.symbol,
        type: o.type as any,
        side: o.type.includes('BUY') ? 'BUY' as const : 'SELL' as const,
        volume: o.volume,
        price: o.price,
        sl: o.sl,
        tp: o.tp,
        status: 'PENDING' as const,
        createdAt: new Date(o.time_ms).toISOString()
    }));

    // Fetch positions
    const fetchPositions = useCallback(async () => {
        try {
            const { apiClient } = await import('../api/client');
            const data = await apiClient.get<any>(`${API_ENDPOINTS.trading.positions}?accountId=${accountId}`, { headers: getAuthHeaders() });
            const list = Array.isArray(data?.positions) ? data.positions : [];
            setPositions(list.map((item: Record<string, any>, index: number) => normalizePosition(item, index)));
        } catch (err) {
            console.error('[PositionsPanel] Failed to fetch positions:', err);
        }
    }, [accountId]);

    // Fetch pending orders
    const fetchOrders = useCallback(async () => {
        try {
            const { apiClient } = await import('../api/client');
            const data = await apiClient.get<any>(`${API_ENDPOINTS.trading.orders}?accountId=${accountId}&status=PENDING`, { headers: getAuthHeaders() });
            const list = Array.isArray(data?.orders) ? data.orders : [];
            setOrders(list.map((item: Record<string, any>, index: number) => normalizeOrder(item, index)));
        } catch (err) {
            console.error('[PositionsPanel] Failed to fetch orders:', err);
        }
    }, [accountId]);

    // Fetch on mount and set intervals
    useEffect(() => {
        fetchPositions();
        fetchOrders();

        // Real-time updates every 3 seconds (1s was too aggressive causing crashes)
        const posInterval = setInterval(fetchPositions, 3000);
        const ordInterval = setInterval(fetchOrders, 5000);

        return () => {
            clearInterval(posInterval);
            clearInterval(ordInterval);
        };
    }, [fetchPositions, fetchOrders]);

    // WebSocket updates
    useEffect(() => {
        if (!wsConnection) return;

        const handleMessage = (event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'position_update') {
                    setPositions((prev) => {
                        const index = prev.findIndex((p) => p.id === data.position.id);
                        if (index >= 0) {
                            const updated = [...prev];
                            updated[index] = { ...updated[index], ...data.position };
                            return updated;
                        }
                        return prev;
                    });
                }
            } catch (err) {
                console.error('[PositionsPanel] WS parse error:', err);
            }
        };

        wsConnection.addEventListener('message', handleMessage);
        return () => wsConnection.removeEventListener('message', handleMessage);
    }, [wsConnection]);

    // Close position via MT5 Sync API
    const handleClosePosition = async (id: number) => {
        // Synchronous guard: prevents duplicate requests on rapid clicks
        if (closingTicketsRef.current.has(id)) return;
        closingTicketsRef.current.add(id);

        // Optimistically remove from both stores immediately for fast UI feedback
        useAppStore.getState().setPositions(useAppStore.getState().positions.filter(p => p.id !== id));
        useMT5Store.setState(prev => ({ positions: prev.positions.filter(p => p.ticket !== id) }));
        window.dispatchEvent(new Event('rtx:force-refresh-positions'));

        try {
            setLoading(true);
            const { default: mt5TradeService } = await import('../services/mt5TradeService');
            await mt5TradeService.closeTrade({ ticket: id });
            await fetchPositions();
        } catch (err) {
            console.error('[PositionsPanel] Close position failed:', err);
        } finally {
            closingTicketsRef.current.delete(id);
            setLoading(false);
        }
    };

    // Close all positions via MT5 Sync API
    const handleCloseAll = async () => {
        try {
            setLoading(true);
            const { default: mt5TradeService } = await import('../services/mt5TradeService');
            const allPositions = mt5Enabled ? mt5Positions : positions;
            
            // Optimistically remove all from both stores immediately
            useAppStore.getState().setPositions([]);
            useMT5Store.setState({ positions: [] });
            window.dispatchEvent(new Event('rtx:force-refresh-positions'));

            await Promise.all(allPositions.map(pos =>
                mt5TradeService.closeTrade({ ticket: pos.id })
            ));
            await fetchPositions();
            setShowCloseAllConfirm(false);
        } catch (err) {
            console.error('[PositionsPanel] Close all failed:', err);
        } finally {
            setLoading(false);
        }
    };

    // Partial close via MT5 Sync API
    const handlePartialClose = async () => {
        if (!showPartialClose) return;

        const volume = parseFloat(partialCloseVolume);
        if (isNaN(volume) || volume <= 0 || volume > showPartialClose.maxVolume) {
            alert(`Invalid volume. Must be between 0 and ${showPartialClose.maxVolume}`);
            return;
        }

        try {
            setLoading(true);
            const { default: mt5TradeService } = await import('../services/mt5TradeService');

            // Optimistically dispatch an event (volume updates usually wait for the backend, so full removal isn't done here)
            window.dispatchEvent(new Event('rtx:force-refresh-positions'));

            await mt5TradeService.closeTrade({ ticket: showPartialClose.positionId, volumeLots: volume });
            await fetchPositions();
            setShowPartialClose(null);
            setPartialCloseVolume('');
        } catch (err) {
            console.error('[PositionsPanel] Partial close failed:', err);
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

            // Get current position to preserve the other SL/TP value
            const allPositions = mt5Enabled ? mt5Positions : positions;
            const pos = allPositions.find(p => p.id === positionId);
            const currentSl = pos?.sl ?? 0;
            const currentTp = pos?.tp ?? 0;

            const newSl = field === 'sl' ? numValue : currentSl;
            const newTp = field === 'tp' ? numValue : currentTp;

            const { default: mt5TradeService } = await import('../services/mt5TradeService');
            const data = await mt5TradeService.modifyTrade({
                ticket: positionId,
                stopLoss: newSl,
                takeProfit: newTp,
            });

            if (!data.success) {
                throw new Error(data.retcode_text || 'Modify failed');
            }

            // Optimistically update the MT5 store immediately
            if (mt5Enabled) {
                const { useMT5Store } = await import('../store/useMT5Store');
                const store = useMT5Store.getState();
                const updatedPositions = store.positions.map(p =>
                    p.ticket === positionId ? { ...p, sl: newSl, tp: newTp } : p
                );
                store.setPositionsFromWS(updatedPositions);
            }

            await fetchPositions();

            // Dispatch refresh event so chart lines update
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new Event('rtx:force-refresh-positions'));
            }

            setEditing(null);
        } catch (err) {
            console.error('[PositionsPanel] Modify SL/TP failed:', err);
        } finally {
            setLoading(false);
        }
    };

    // Cancel order
    const handleCancelOrder = async (orderId: string) => {
        if (!confirm('Cancel this order?')) return;

        try {
            setLoading(true);
            const { apiClient } = await import('../api/client');
            await apiClient.delete(`${API_ENDPOINTS.trading.cancelOrder(orderId)}`, {
                headers: { ...getAuthHeaders() }
            });

            await fetchOrders();
        } catch (err) {
            console.error('[PositionsPanel] Cancel order failed:', err);
        } finally {
            setLoading(false);
        }
    };

    // Format functions
    const formatMoney = (val: number | undefined | null) => {
        const v = val ?? 0;
        return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
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

    // Use MT5 or B-Book positions/orders based on mode
    // Ensure arrays - handle edge cases where data might not be an array
    const displayPositions = Array.isArray(mt5Enabled ? mt5Positions : positions)
        ? (mt5Enabled ? mt5Positions : positions)
        : [];
    const displayOrders = Array.isArray(mt5Enabled ? mt5Orders : orders)
        ? (mt5Enabled ? mt5Orders : orders)
        : [];


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
                                            setShowPartialClose={setShowPartialClose}
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
                    {mt5Enabled && <span className="text-blue-400 text-[10px]">MT5</span>}
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

            {/* Partial Close Modal */}
            {showPartialClose && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-[#131316] border border-zinc-700 rounded-lg shadow-2xl p-6 max-w-md">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-zinc-100">Partial Close</h3>
                            <button onClick={() => setShowPartialClose(null)} className="text-zinc-500 hover:text-zinc-300">
                                <Icon name="x-close" size="lg" />
                            </button>
                        </div>
                        <p className="text-sm text-zinc-400 mb-4">
                            Enter volume to close (max: {showPartialClose.maxVolume.toFixed(2)} lots)
                        </p>
                        <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            max={showPartialClose.maxVolume}
                            value={partialCloseVolume}
                            onChange={(e) => setPartialCloseVolume(e.target.value)}
                            placeholder="0.00"
                            className="w-full bg-zinc-800 text-zinc-100 px-3 py-2 rounded text-sm font-mono mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            autoFocus
                        />
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowPartialClose(null)}
                                className="flex-1 px-4 py-2 text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handlePartialClose}
                                disabled={loading}
                                className="flex-1 px-4 py-2 text-sm font-medium bg-zinc-700 hover:bg-zinc-600 text-white rounded transition-colors disabled:opacity-50"
                            >
                                {loading ? 'Closing...' : 'Partial Close'}
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
                    fetchPositions();
                    // Also refresh MT5 store positions so updated SL/TP values appear
                    if (mt5Enabled) {
                        const login = parseInt(accountId, 10) || undefined;
                        mt5FetchPositions(login);
                    }
                    // Dispatch refresh event so chart lines update
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(new Event('rtx:force-refresh-positions'));
                    }
                }}
                position={modifyPosition}
            />
            {/* Modify Order Dialog (reuses same dialog for pending orders) */}
            <ModifyPositionDialog
                isOpen={modifyOrder !== null}
                onClose={() => {
                    setModifyOrder(null);
                    fetchOrders();
                    if (mt5Enabled) {
                        const login = parseInt(accountId, 10) || undefined;
                        mt5FetchOrders(login);
                    }
                }}
                position={modifyOrder ? {
                    id: parseInt(modifyOrder.id, 10),
                    symbol: modifyOrder.symbol,
                    side: modifyOrder.side,
                    volume: modifyOrder.volume,
                    openPrice: modifyOrder.price,
                    sl: modifyOrder.sl || 0,
                    tp: modifyOrder.tp || 0,
                } : null}
            />
        </div>
    );
}

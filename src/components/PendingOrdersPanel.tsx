import { useState, useEffect } from 'react';
import api from '../services/api';
import { useConfirmStore } from '../store/useConfirmStore';

interface PendingOrder {
    id: string;
    symbol: string;
    side: string;
    type: string;
    subtype: string;
    volume: number;
    entryPrice?: number;
    triggerPrice?: number;
    sl?: number;
    tp?: number;
    status: string;
    createdAt: string;
}

interface PendingOrdersPanelProps {
    symbol?: string; // Filter by symbol if provided
}

export function PendingOrdersPanel({ symbol }: PendingOrdersPanelProps) {
    const [orders, setOrders] = useState<PendingOrder[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch pending orders
    useEffect(() => {
        const fetchOrders = async () => {
            try {
                const data = await api.orders.getPendingOrders();
                setOrders((data || []).map((order: any) => ({
                    id: String(order.ticket ?? order.id),
                    symbol: String(order.symbol ?? ''),
                    side: String(order.side ?? '').toUpperCase(),
                    type: String(order.type ?? '').toUpperCase(),
                    subtype: String(order.type ?? '').toUpperCase(),
                    volume: Number(order.volume ?? order.quantity ?? 0),
                    entryPrice: Number(order.price ?? 0),
                    triggerPrice: Number(order.price ?? 0),
                    sl: Number(order.price_sl ?? order.sl ?? 0),
                    tp: Number(order.price_tp ?? order.tp ?? 0),
                    status: String(order.status ?? 'pending').toUpperCase(),
                    createdAt: order.createdAt ?? order.created_at ?? (order.time_create ? new Date(Number(order.time_create) * 1000).toISOString() : new Date().toISOString()),
                })));
            } catch (err) {
                console.error('Failed to fetch pending orders:', err);
                setError((err as Error)?.message || 'Failed to fetch pending orders');
            }
        };

        fetchOrders();
        const interval = setInterval(fetchOrders, 2000);
        return () => clearInterval(interval);
    }, []);

    const handleCancel = async (orderId: string) => {
        if (!(await useConfirmStore.getState().showConfirm('Cancel Order', `Cancel pending order #${orderId}?`))) return;
        setLoading(true);
        try {
            setError(null);
            await api.orders.cancelOrder(orderId);
            setOrders(orders.filter(o => o.id !== orderId));
        } catch (err) {
            console.error('Failed to cancel order:', err);
            setError((err as Error)?.message || 'Failed to cancel order');
        } finally {
            setLoading(false);
        }
    };

    const filteredOrders = symbol
        ? orders.filter(o => o.symbol === symbol)
        : orders;

    if (filteredOrders.length === 0) {
        return (
            <div className="text-xs text-zinc-500 text-center py-4">
                {error ? <span className="text-red-400">{error}</span> : 'No pending orders'}
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {error && (
                <div className="text-xs text-red-400 bg-red-950/40 border border-red-900 rounded p-2">
                    {error}
                </div>
            )}
            {filteredOrders.map((order) => (
                <div
                    key={order.id}
                    className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3"
                >
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <span className={`text-xs font-semibold ${order.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                                {order.subtype}
                            </span>
                            <span className="text-xs text-zinc-400">{order.symbol}</span>
                        </div>
                        <button
                            onClick={() => handleCancel(order.id)}
                            disabled={loading}
                            className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                        >
                            Cancel
                        </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                            <span className="text-zinc-500">Volume:</span>
                            <span className="text-zinc-300 ml-1">{order.volume}</span>
                        </div>
                        <div>
                            <span className="text-zinc-500">Price:</span>
                            <span className="text-zinc-300 ml-1">
                                {order.entryPrice?.toFixed(5) || order.triggerPrice?.toFixed(5)}
                            </span>
                        </div>
                        <div>
                            <span className="text-zinc-500">Status:</span>
                            <span className={`ml-1 ${order.status === 'PENDING' ? 'text-yellow-400' : order.status === 'TRIGGERED' ? 'text-emerald-400' : 'text-zinc-400'}`}>
                                {order.status}
                            </span>
                        </div>
                    </div>

                    {(order.sl || order.tp) && (
                        <div className="flex gap-4 mt-2 text-xs">
                            {order.sl && (
                                <div>
                                    <span className="text-zinc-500">SL:</span>
                                    <span className="text-red-400 ml-1">{order.sl}</span>
                                </div>
                            )}
                            {order.tp && (
                                <div>
                                    <span className="text-zinc-500">TP:</span>
                                    <span className="text-emerald-400 ml-1">{order.tp}</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

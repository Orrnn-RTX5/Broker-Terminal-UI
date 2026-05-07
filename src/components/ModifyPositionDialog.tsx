/**
 * MT5-style Modify Position Dialog (Dark Theme)
 * Opens on double-click of a position row
 * Matches the MT5 "Order" dialog visual style
 */

import { useState, useEffect, useRef } from 'react';
import { useCurrentTick } from '../store/useMarketDataStore';

interface ModifyPositionDialogProps {
    isOpen: boolean;
    onClose: (modifiedSl?: number, modifiedTp?: number) => void;
    position: {
        id: number;
        symbol: string;
        side: 'BUY' | 'SELL';
        volume: number;
        openPrice: number;
        sl: number;
        tp: number;
    } | null;
}

const getSymbolDigits = (symbol: string) => {
    if (symbol.includes('JPY')) return 3;
    if (symbol.startsWith('BTC') || symbol.startsWith('ETH')) return 2;
    if (symbol.startsWith('XAU')) return 2;
    if (symbol.startsWith('XAG')) return 3;
    return 5;
};

// Get pip size for a symbol (1 pip = 10^-(digits-1))
const getPipSize = (symbol: string) => {
    const digits = getSymbolDigits(symbol);
    // For 5-digit forex: pip = 0.0001, for 3-digit JPY: pip = 0.01, for 2-digit gold/crypto: pip = 0.1
    return Math.pow(10, -(digits - 1));
};

const getSymbolFullName = (symbol: string) => {
    const names: Record<string, string> = {
        'EURUSD': 'EURUSD, Euro vs US Dollar',
        'GBPUSD': 'GBPUSD, Great Britain Pound vs US Dollar',
        'USDJPY': 'USDJPY, US Dollar vs Japanese Yen',
        'XAUUSD': 'XAUUSD, Gold vs US Dollar',
        'XAGUSD': 'XAGUSD, Silver vs US Dollar',
        'BTCUSD': 'BTCUSD, Bitcoin vs US Dollar',
        'ETHUSD': 'ETHUSD, Ethereum vs US Dollar',
    };
    return names[symbol] || symbol;
};

export function ModifyPositionDialog({ isOpen, onClose, position }: ModifyPositionDialogProps) {
    const [sl, setSl] = useState('0.00');
    const [tp, setTp] = useState('0.00');
    const [comment, setComment] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const dialogRef = useRef<HTMLDivElement>(null);

    const tick = useCurrentTick(position?.symbol || '');

    // Price history for mini chart
    const bidHistoryRef = useRef<number[]>([]);
    const askHistoryRef = useRef<number[]>([]);

    useEffect(() => {
        if (isOpen && position) {
            const digits = getSymbolDigits(position.symbol);
            const pointSize = Math.pow(10, -digits);
            const pointsOffset = 50 * pointSize;

            // Use current tick price if available, otherwise use open price
            const currentBid = tick?.bid ?? position.openPrice;
            const currentAsk = tick?.ask ?? position.openPrice;

            if (position.sl > 0) {
                // Keep existing SL
                setSl(position.sl.toFixed(digits));
            } else {
                // Auto-fill 50 points (5 pips) below for BUY, 50 points above for SELL
                const autoSl = position.side === 'BUY'
                    ? currentBid - pointsOffset
                    : currentAsk + pointsOffset;
                setSl(autoSl.toFixed(digits));
            }

            if (position.tp > 0) {
                // Keep existing TP
                setTp(position.tp.toFixed(digits));
            } else {
                // Auto-fill 50 points (5 pips) above for BUY, 50 points below for SELL
                const autoTp = position.side === 'BUY'
                    ? currentAsk + pointsOffset
                    : currentBid - pointsOffset;
                setTp(autoTp.toFixed(digits));
            }

            setComment('');
            setError(null);
            setSuccess(false);
            bidHistoryRef.current = [];
            askHistoryRef.current = [];
        }
    }, [isOpen, position]);

    // Accumulate price history for mini chart
    useEffect(() => {
        if (tick && isOpen) {
            bidHistoryRef.current = [...bidHistoryRef.current.slice(-60), tick.bid];
            askHistoryRef.current = [...askHistoryRef.current.slice(-60), tick.ask];
        }
    }, [tick, isOpen]);

    if (!isOpen || !position) return null;

    const digits = getSymbolDigits(position.symbol);
    const bid = tick?.bid ?? position.openPrice;
    const ask = tick?.ask ?? position.openPrice;
    const spread = ((ask - bid) * Math.pow(10, digits)).toFixed(1);

    const handleSubmit = async () => {
        setIsSubmitting(true);
        setError(null);
        setSuccess(false);

        try {
            const slVal = parseFloat(sl) || 0;
            const tpVal = parseFloat(tp) || 0;
            console.log('[Modify] Sending modify request for ticket:', position.id, 'SL:', slVal, 'TP:', tpVal);

            // Use MT5 Trade Service for correct backend URL routing
            const { default: mt5TradeService } = await import('../services/mt5TradeService');
            const data = await mt5TradeService.modifyTrade({
                ticket: position.id,
                stopLoss: slVal,
                takeProfit: tpVal,
            });

            console.log('[Modify] Response data:', data);

            if (data.success) {
                setSuccess(true);
                // Optimistically update the position's SL/TP in the MT5 store immediately
                try {
                    const { useMT5Store } = await import('../store/useMT5Store');
                    const store = useMT5Store.getState();
                    const updated = store.positions.map(p =>
                        p.ticket === position.id ? { ...p, sl: slVal, tp: tpVal } : p
                    );
                    store.setPositionsFromWS(updated);
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(new Event('rtx:force-refresh-positions'));
                    }
                } catch { /* ignore */ }
                setTimeout(() => onClose(slVal, tpVal), 600);
            } else {
                setError(data.retcode_text || data.message || `Modification failed (code: ${data.retcode})`);
            }
        } catch (err: any) {
            console.error('[Modify] Error:', err);
            setError(err.message || 'Network error');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Mini chart renderer
    const renderMiniChart = () => {
        const bidData = bidHistoryRef.current;
        const askData = askHistoryRef.current;
        if (bidData.length < 2) {
            return (
                <div className="w-full h-full flex items-center justify-center text-zinc-600 text-[10px]">
                    <div className="text-center">
                        <div className="text-zinc-400 font-bold mb-1">{position.symbol}</div>
                        <div className="text-blue-400 font-mono">{bid.toFixed(digits)}</div>
                        <div className="text-red-400 font-mono">{ask.toFixed(digits)}</div>
                    </div>
                </div>
            );
        }

        const allPrices = [...bidData, ...askData];
        const min = Math.min(...allPrices);
        const max = Math.max(...allPrices);
        const range = max - min || 1;
        const w = 260;
        const h = 220;
        const pad = 20;

        const toPath = (data: number[]) => {
            return data.map((v, i) => {
                const x = pad + (i / (data.length - 1)) * (w - pad * 2);
                const y = h - pad - ((v - min) / range) * (h - pad * 2);
                return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(' ');
        };

        // Price labels on right
        const bidY = h - pad - ((bid - min) / range) * (h - pad * 2);
        const askY = h - pad - ((ask - min) / range) * (h - pad * 2);

        return (
            <svg width={w} height={h} className="w-full h-full">
                {/* Grid lines */}
                {[0.25, 0.5, 0.75].map(f => {
                    const y = pad + f * (h - pad * 2);
                    const price = max - f * range;
                    return (
                        <g key={f}>
                            <line x1={pad} y1={y} x2={w - pad} y2={y} stroke="#333" strokeWidth="0.5" />
                            <text x={w - pad + 4} y={y + 3} fill="#666" fontSize="8" fontFamily="monospace">{price.toFixed(digits)}</text>
                        </g>
                    );
                })}
                {/* Ask line (red) */}
                <path d={toPath(askData)} fill="none" stroke="#ef4444" strokeWidth="1.5" />
                {/* Bid line (blue) */}
                <path d={toPath(bidData)} fill="none" stroke="#8a8a8f" strokeWidth="1.5" />
                {/* Current price labels */}
                <rect x={w - pad - 55} y={askY - 8} width={55} height={16} rx={2} fill="#ef4444" />
                <text x={w - pad - 52} y={askY + 4} fill="white" fontSize="9" fontWeight="bold" fontFamily="monospace">{ask.toFixed(digits)}</text>
                <rect x={w - pad - 55} y={bidY - 8} width={55} height={16} rx={2} fill="#8a8a8f" />
                <text x={w - pad - 52} y={bidY + 4} fill="white" fontSize="9" fontWeight="bold" fontFamily="monospace">{bid.toFixed(digits)}</text>
                {/* Symbol label */}
                <text x={pad + 4} y={16} fill="#888" fontSize="10" fontWeight="bold">{position.symbol}</text>
                <text x={pad + 4} y={28} fill="#666" fontSize="8">{bid.toFixed(digits)} / {ask.toFixed(digits)}</text>
            </svg>
        );
    };

    // Format the big price with last digit enlarged
    const formatBigPrice = (price: number, color: string) => {
        const str = price.toFixed(digits);
        const main = str.slice(0, -1);
        const last = str.slice(-1);
        return (
            <span className={`font-mono font-bold ${color}`}>
                <span className="text-2xl">{main}</span>
                <span className="text-3xl">{last}</span>
            </span>
        );
    };

    // Calculate SL/TP in points from current price
    const slPoints = sl && parseFloat(sl) > 0
        ? Math.abs(Math.round((parseFloat(sl) - (position.side === 'BUY' ? bid : ask)) * Math.pow(10, digits)))
        : 0;
    const tpPoints = tp && parseFloat(tp) > 0
        ? Math.abs(Math.round((parseFloat(tp) - (position.side === 'BUY' ? ask : bid)) * Math.pow(10, digits)))
        : 0;

    // Update SL/TP from points input
    const handleSlPointsChange = (points: number) => {
        if (points <= 0) { setSl('0.00'); return; }
        const step = Math.pow(10, -digits);
        const ref = position.side === 'BUY' ? bid : ask;
        const val = position.side === 'BUY' ? ref - points * step : ref + points * step;
        setSl(val.toFixed(digits));
    };

    const handleTpPointsChange = (points: number) => {
        if (points <= 0) { setTp('0.00'); return; }
        const step = Math.pow(10, -digits);
        const ref = position.side === 'BUY' ? ask : bid;
        const val = position.side === 'BUY' ? ref + points * step : ref - points * step;
        setTp(val.toFixed(digits));
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div ref={dialogRef} className="bg-[#131316] rounded-lg shadow-2xl w-[680px] overflow-hidden border border-zinc-700">
                {/* Title Bar - MT5 style with position info */}
                <div className="bg-[#2d2d2d] px-4 py-2 flex items-center justify-between border-b border-zinc-700">
                    <span className="text-sm font-medium text-zinc-200">
                        Position: #{position.id} {position.side.toLowerCase()} {position.volume.toFixed(2)} {position.symbol} {position.openPrice.toFixed(digits)}
                    </span>
                    <button
                        onClick={() => onClose()}
                        className="p-1 hover:bg-zinc-600 rounded text-zinc-400 hover:text-white transition-colors text-lg leading-none"
                    >
                        ×
                    </button>
                </div>

                {/* Content */}
                <div className="flex">
                    {/* Left: Mini Chart */}
                    <div className="w-[280px] border-r border-zinc-700 flex flex-col">
                        <div className="px-3 py-1.5 text-[11px] text-zinc-300 border-b border-zinc-700 font-mono">
                            {position.symbol} <span className="text-blue-400">{bid.toFixed(digits)}</span> / <span className="text-red-400">{ask.toFixed(digits)}</span>
                        </div>
                        <div className="flex-1 bg-[#151515] p-1">
                            {renderMiniChart()}
                        </div>
                    </div>

                    {/* Right: Form */}
                    <div className="flex-1 p-4 space-y-3">
                        {/* Symbol */}
                        <div className="flex items-center gap-3">
                            <label className="text-[11px] w-[80px] text-right text-zinc-500">Symbol:</label>
                            <div className="flex-1 bg-[#2a2a2a] border border-zinc-600 px-2.5 py-1.5 text-xs text-zinc-200 rounded">
                                {getSymbolFullName(position.symbol)}
                            </div>
                        </div>

                        {/* Type */}
                        <div className="flex items-center gap-3">
                            <label className="text-[11px] w-[80px] text-right text-zinc-500">Type:</label>
                            <div className="flex-1 bg-[#2a2a2a] border border-zinc-600 px-2.5 py-1.5 text-xs text-zinc-200 rounded">
                                Modify Position
                            </div>
                        </div>

                        {/* Stop Loss with Points */}
                        <div className="flex items-center gap-2">
                            <label className="text-[11px] w-[80px] text-right text-red-400 font-medium">Stop Loss:</label>
                            <input
                                type="number"
                                step={Math.pow(10, -digits).toString()}
                                value={sl}
                                onChange={(e) => setSl(e.target.value)}
                                className="w-[90px] bg-[#2a2a2a] border border-zinc-600 px-2 py-1.5 text-xs text-zinc-200 rounded font-mono focus:border-zinc-600 focus:outline-none text-center"
                            />
                            <input
                                type="number"
                                value={slPoints}
                                onChange={(e) => handleSlPointsChange(parseInt(e.target.value) || 0)}
                                className="w-[60px] bg-[#2a2a2a] border border-zinc-600 px-2 py-1.5 text-xs text-zinc-200 rounded font-mono focus:border-zinc-600 focus:outline-none text-center"
                            />
                            <span className="text-[10px] text-zinc-500">points</span>
                        </div>

                        {/* Take Profit with Points */}
                        <div className="flex items-center gap-2">
                            <label className="text-[11px] w-[80px] text-right text-emerald-400 font-medium">Take Profit:</label>
                            <input
                                type="number"
                                step={Math.pow(10, -digits).toString()}
                                value={tp}
                                onChange={(e) => setTp(e.target.value)}
                                className="w-[90px] bg-[#2a2a2a] border border-zinc-600 px-2 py-1.5 text-xs text-zinc-200 rounded font-mono focus:border-zinc-600 focus:outline-none text-center"
                            />
                            <input
                                type="number"
                                value={tpPoints}
                                onChange={(e) => handleTpPointsChange(parseInt(e.target.value) || 0)}
                                className="w-[60px] bg-[#2a2a2a] border border-zinc-600 px-2 py-1.5 text-xs text-zinc-200 rounded font-mono focus:border-zinc-600 focus:outline-none text-center"
                            />
                            <span className="text-[10px] text-zinc-500">points</span>
                        </div>

                        {/* Live Price Display */}
                        <div className="text-center py-3 border-t border-zinc-700 mt-2">
                            <div className="flex items-center justify-center gap-3">
                                {formatBigPrice(bid, 'text-zinc-100')}
                                <span className="text-zinc-500 text-lg">/</span>
                                {formatBigPrice(ask, 'text-zinc-100')}
                            </div>
                        </div>

                        {/* Modify Button */}
                        <button
                            onClick={handleSubmit}
                            disabled={isSubmitting}
                            className="w-full py-2.5 text-xs font-bold rounded bg-zinc-700 hover:bg-zinc-600 text-white transition-colors disabled:opacity-50"
                        >
                            {isSubmitting ? 'Modifying...' : `Modify #${position.id} ${position.side.toLowerCase()} ${position.volume.toFixed(2)} ${position.symbol} ${position.openPrice.toFixed(digits)}`}
                        </button>

                        {/* Error / Success */}
                        {error && (
                            <div className="bg-red-900/30 border border-red-700 text-red-300 text-[11px] px-3 py-2 rounded text-center">
                                {error}
                            </div>
                        )}
                        {success && (
                            <div className="bg-emerald-900/30 border border-emerald-700 text-emerald-300 text-[11px] px-3 py-2 rounded text-center">
                                ✓ Position modified successfully
                            </div>
                        )}

                        {/* MT5 Quote Text */}
                        <div className="text-[10px] text-zinc-500 text-center leading-relaxed pt-1">
                            Stop Loss or Take Profit you set must differ from market price by at least 0 points.<br />
                            Stops processing is performed on the broker side.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

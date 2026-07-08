/**
 * Last Symbol Trading Panel
 * Floating panel that always trades the last used symbol.
 * Prevents wrong-symbol mistakes when multiple charts are open.
 * 
 * Features:
 * - Live BID/ASK display for last traded symbol
 * - One-click BUY LAST / SELL LAST 
 * - Close all positions on last symbol
 * - Volume control with risk-based sizing option
 * - Auto SL/TP (fixed pips)
 * - Keyboard shortcuts: Shift+B (Buy), Shift+S (Sell), Shift+X (Close)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Icon } from './ui/Icon';
import { useLastSymbolStore } from '../store/useLastSymbolStore';
import { useAppStore } from '../store/useAppStore';
import { api } from '../services/api';
import { formatSpreadDisplayWithUnit } from '../utils/spread';
import { fetchSymbolMarketStatus, useSymbolMarketStatus } from '../hooks/useSymbolMarketStatus';
import {
    createUnavailableMarketStatus,
    getMarketStatusTradeBlockMessage,
} from '../utils/marketStatus';

export function LastSymbolPanel() {
    const {
        lastSymbol,
        lastTradeSide,
        lastTradeTime,
        volume,
        useRiskSizing,
        riskPercent,
        autoSLTP,
        slPips,
        tpPips,
        setLastSymbol,
        setPanelVisible,
        setVolume,
        setUseRiskSizing,
        setRiskPercent,
        setAutoSLTP,
        setSLPips,
        setTPPips,
    } = useLastSymbolStore();

    const ticks = useAppStore((s) => s.ticks);
    const account = useAppStore((s) => s.account);
    const positions = useAppStore((s) => s.positions);
    const accountId = useAppStore((s) => s.accountId);

    const [isPlacing, setIsPlacing] = useState(false);
    const [isClosing, setIsClosing] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [statusType, setStatusType] = useState<'success' | 'error' | 'info'>('info');
    const [showSettings, setShowSettings] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [position, setPosition] = useState(() => {
        const saved = localStorage.getItem('lst_panel_pos');
        if (saved) {
            try { return JSON.parse(saved); } catch { /* ignore */ }
        }
        return { x: window.innerWidth - 280, y: 120 };
    });
    const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const marketStatus = useSymbolMarketStatus(lastSymbol, {
        enabled: Boolean(lastSymbol),
    });

    // Get live tick for last symbol (with robust normalized matching to match chart)
    const tick = (() => {
        if (!lastSymbol) return null;
        // 1. Try exact match
        if (ticks[lastSymbol]) return ticks[lastSymbol];
        // 2. Try uppercase
        if (ticks[lastSymbol.toUpperCase()]) return ticks[lastSymbol.toUpperCase()];
        // 3. Try normalized (remove .r, etc)
        const normalizedLast = lastSymbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        const match = Object.keys(ticks).find(k =>
            k.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() === normalizedLast
        );
        return match ? ticks[match] : null;
    })();

    const bid = tick?.bid ?? 0;
    const ask = tick?.ask ?? 0;
    const spread = ask - bid;

    /** Return decimal places for any symbol */
    const getSymbolDigits = (sym: string): number => {
        if (!sym) return 5;
        const s = sym.toUpperCase();
        if (s.includes('JPY')) return 3;
        if (s.includes('BTC')) return 2;
        if (s.includes('ETH')) return 2;
        if (s.includes('LTC') || s.includes('SOL') || s.includes('XRP') || s.includes('BNB') || s.includes('DOT') || s.includes('ADA')) return 4;
        if (s.includes('XAU') || s.includes('XAG') || s.includes('XPT') || s.includes('XPD')) return 2;
        if (s.includes('NAS') || s.includes('SPX') || s.includes('DJ') || s.includes('US30') || s.includes('US500') || s.includes('NDX')) return 2;
        return 5;
    };

    /** Return pip size for any symbol (used for spread display and SL/TP calculation) */
    const getSymbolPipSize = (sym: string): number => {
        if (!sym) return 0.0001;
        const s = sym.toUpperCase();
        if (s.includes('JPY')) return 0.01;
        if (s.includes('BTC')) return 1;
        if (s.includes('ETH')) return 0.1;
        if (s.includes('LTC') || s.includes('SOL')) return 0.01;
        if (s.includes('XRP') || s.includes('BNB') || s.includes('DOT') || s.includes('ADA')) return 0.0001;
        if (s.includes('XAU') || s.includes('XAG') || s.includes('XPT') || s.includes('XPD')) return 0.01;
        if (s.includes('NAS') || s.includes('SPX') || s.includes('DJ') || s.includes('US30') || s.includes('US500') || s.includes('NDX')) return 0.1;
        return 0.0001;
    };

    const pipSize = getSymbolPipSize(lastSymbol);
    const spreadDisplay = formatSpreadDisplayWithUnit(lastSymbol, tick?.spread ?? spread, bid, ask);
    const digits = tick?.digits || getSymbolDigits(lastSymbol);

    // Positions on last symbol
    const lastSymbolPositions = positions.filter(
        (p) => p.symbol.toUpperCase() === lastSymbol.toUpperCase()
    );
    const totalPnL = lastSymbolPositions.reduce((sum, p) => sum + (p.unrealizedPnL || 0), 0);

    const isJPY = lastSymbol.includes('JPY') || pipSize === 0.01;

    // Calculate risk-based lot
    const calculateRiskLot = useCallback(() => {
        if (!useRiskSizing || !account) return volume;
        const balance = account.balance || 0;
        const riskAmount = (balance * riskPercent) / 100;
        const slDistance = slPips * pipSize;
        if (slDistance <= 0) return volume;

        // Approximate pip value (simplified — real calculation needs contract size)
        const pipValue = isJPY ? 1000 : 10; // Per standard lot
        const lot = riskAmount / (slPips * pipValue);
        return Math.max(0.01, Math.round(lot * 100) / 100);
    }, [useRiskSizing, account, volume, riskPercent, slPips, pipSize, isJPY]);

    const effectiveLot = useRiskSizing ? calculateRiskLot() : volume;
    const tradeBlockedMessage = getMarketStatusTradeBlockMessage(marketStatus, lastSymbol);
    const canPlaceTrade = Boolean(lastSymbol) && !marketStatus.isTradeBlocked;

    // Flash status message
    const flash = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'info') => {
        setStatusMessage(msg);
        setStatusType(type);
        setTimeout(() => setStatusMessage(''), 4000);
    }, []);

    // Place order via MT5 Sync API
    const placeOrder = useCallback(
        async (side: 'BUY' | 'SELL') => {
            if (isPlacing || !lastSymbol) {
                if (!lastSymbol) flash('No last symbol — place a trade first', 'error');
                return;
            }
            setIsPlacing(true);
            try {
                const latestMarketStatus = await fetchSymbolMarketStatus(lastSymbol, { force: true })
                    .catch(() => createUnavailableMarketStatus(lastSymbol));
                if (latestMarketStatus.isTradeBlocked) {
                    flash(getMarketStatusTradeBlockMessage(latestMarketStatus, lastSymbol), 'error');
                    return;
                }

                const orderData: any = {
                    symbol: lastSymbol,
                    side: side.toLowerCase(),
                    volume: effectiveLot,
                    login: Number(accountId) || 0,
                    comment: 'RTX sync trade',
                };

                // Auto SL/TP
                if (autoSLTP && slPips > 0) {
                    const basePrice = side === 'BUY' ? ask : bid;
                    if (basePrice > 0) {
                        orderData.price_sl =
                            side === 'BUY'
                                ? basePrice - slPips * pipSize
                                : basePrice + slPips * pipSize;
                        if (tpPips > 0) {
                            orderData.price_tp =
                                side === 'BUY'
                                    ? basePrice + tpPips * pipSize
                                    : basePrice - tpPips * pipSize;
                        }
                    }
                }

                await api.orders.placeMarketOrder(orderData);
                setLastSymbol(lastSymbol, side);
                window.dispatchEvent(new Event('rtx:force-refresh-positions'));
                flash(`${side} ${effectiveLot} ${lastSymbol} ✓`, 'success');
            } catch (err: any) {
                console.error('LastSymbolPanel order failed:', err);
                flash(err.message || 'Order failed', 'error');
            } finally {
                setIsPlacing(false);
            }
        },
        [isPlacing, lastSymbol, effectiveLot, autoSLTP, slPips, tpPips, pipSize, bid, ask, accountId, setLastSymbol, flash]
    );

    // Close positions on last symbol via MT5 Sync API
    const closeLastPositions = useCallback(async () => {
        if (isClosing || !lastSymbol || lastSymbolPositions.length === 0) {
            if (lastSymbolPositions.length === 0) flash('No positions on ' + lastSymbol, 'info');
            return;
        }

        setIsClosing(true);
        try {
            let closed = 0;
            for (const pos of lastSymbolPositions) {
                try {
                    await api.positions.closePosition(String(pos.id));
                    closed++;
                } catch (e) {
                    console.error('Failed to close position', pos.id, e);
                }
            }
            useAppStore.getState().setPositions(useAppStore.getState().positions.filter(
                (pos) => pos.symbol.toUpperCase() !== lastSymbol.toUpperCase()
            ));
            window.dispatchEvent(new Event('rtx:force-refresh-positions'));
            flash(`Closed ${closed} position(s) on ${lastSymbol} ✓`, 'success');
        } catch (err: any) {
            flash(err.message || 'Close failed', 'error');
        } finally {
            setIsClosing(false);
        }
    }, [isClosing, lastSymbol, lastSymbolPositions, accountId, flash]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            // Only when panel is visible and Shift is held
            if (!e.shiftKey) return;
            // Don't trigger in input fields
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

            if (e.key === 'B' || e.key === 'b') {
                e.preventDefault();
                placeOrder('BUY');
            } else if (e.key === 'S' || e.key === 's') {
                e.preventDefault();
                placeOrder('SELL');
            } else if (e.key === 'X' || e.key === 'x') {
                e.preventDefault();
                closeLastPositions();
            }
        };

        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [placeOrder, closeLastPositions]);

    // Dragging
    const onMouseDown = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button, input, select')) return;
        setIsDragging(true);
        dragRef.current = { startX: e.clientX, startY: e.clientY, origX: position.x, origY: position.y };
    }, [position]);

    useEffect(() => {
        if (!isDragging) return;
        const onMove = (e: MouseEvent) => {
            if (!dragRef.current) return;
            const dx = e.clientX - dragRef.current.startX;
            const dy = e.clientY - dragRef.current.startY;
            const newPos = {
                x: Math.max(0, Math.min(window.innerWidth - 260, dragRef.current.origX + dx)),
                y: Math.max(0, Math.min(window.innerHeight - 100, dragRef.current.origY + dy)),
            };
            setPosition(newPos);
        };
        const onUp = () => {
            setIsDragging(false);
            localStorage.setItem('lst_panel_pos', JSON.stringify(position));
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [isDragging, position]);

    // Time since last trade
    const timeSince = lastTradeTime
        ? (() => {
            const diff = Math.floor((Date.now() - lastTradeTime) / 1000);
            if (diff < 60) return `${diff}s ago`;
            if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;

            return `${Math.floor(diff / 3600)}h ago`;
        })()
        : '';

    return (
        <div
            ref={panelRef}
            className="rtx-last-symbol-panel fixed z-[9999] select-none"
            style={{ left: position.x, top: position.y }}
        >
            <div
                className="w-[252px] bg-[#1a1a22] border border-[#2a2e39] rounded-lg shadow-2xl overflow-hidden"
                style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
            >

                {/* Header — draggable */}
                <div
                    className="flex items-center justify-between px-3 py-2 bg-[#22222d] border-b border-[#2a2e39] cursor-move"
                    onMouseDown={onMouseDown}
                >
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.5)] animate-pulse" />
                        <span className="text-[11px] font-bold text-blue-400 tracking-wide drop-shadow-[0_0_4px_rgba(59,130,246,0.4)]">
                            LAST SYMBOL TRADER
                        </span>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setShowSettings(!showSettings)}
                            className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 text-zinc-500 hover:text-zinc-300 transition-colors"
                            title="Settings"
                        >
                            <Icon name="settings" size="xs" />
                        </button>
                        <button
                            onClick={() => setPanelVisible(false)}
                            className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-colors"
                            title="Close Panel"
                        >
                            <Icon name="x-close" size="xs" />
                        </button>
                    </div>
                </div>

                {/* Symbol Display */}
                <div className="px-3 py-2 border-b border-[#2a2e39]/50">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Last Traded</div>
                            <div className="text-[18px] font-bold text-blue-400 font-mono leading-tight drop-shadow-[0_0_4px_rgba(59,130,246,0.25)]">
                                {lastSymbol || 'NONE'}
                            </div>
                        </div>
                        {lastTradeSide && (
                            <div className="flex flex-col items-end">
                                <span
                                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${lastTradeSide === 'BUY'
                                        ? 'bg-teal-500/20 text-teal-400'
                                        : 'bg-red-500/20 text-red-400'
                                        }`}
                                >
                                    {lastTradeSide}
                                </span>
                                <span className="text-[9px] text-zinc-600 mt-0.5">{timeSince}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* BID / ASK */}
                {lastSymbol && (
                    <div className="grid grid-cols-2 gap-0 border-b border-[#2a2e39]/50">
                        <div className="px-3 py-1.5 border-r border-[#2a2e39]/50">
                            <div className="text-[9px] text-zinc-500">BID</div>
                            <div className="text-[13px] font-mono font-bold text-red-400">
                                {bid > 0 ? bid.toFixed(digits) : '---'}
                            </div>
                        </div>
                        <div className="px-3 py-1.5">
                            <div className="text-[9px] text-zinc-500">ASK</div>
                            <div className="text-[13px] font-mono font-bold text-teal-400">
                                {ask > 0 ? ask.toFixed(digits) : '---'}
                            </div>
                        </div>
                    </div>
                )}

                {/* Spread & Info Row */}
                {lastSymbol && (
                    <div className="px-3 py-1.5 border-b border-[#2a2e39]/50 flex items-center justify-between text-[10px]">
                        <span className="text-zinc-500">
                            Spread: <span className="text-zinc-300 font-mono">{spreadDisplay}</span>
                        </span>
                        <span className="text-zinc-500">
                            Lot: <span className="text-zinc-300 font-mono">{effectiveLot.toFixed(2)}</span>
                            {useRiskSizing && (
                                <span className="text-blue-500/70 ml-1">({riskPercent}%)</span>
                            )}
                        </span>
                    </div>
                )}

                {/* Volume Control */}
                <div className="px-3 py-2 border-b border-[#2a2e39]/50">
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={() => setVolume(volume - 0.01)}
                            disabled={volume <= 0.01 || isPlacing || useRiskSizing}
                            className="w-6 h-6 flex items-center justify-center bg-[#2a2e39] hover:bg-[#353a47] disabled:opacity-30 disabled:cursor-not-allowed text-zinc-300 rounded text-xs transition-colors"
                        >
                            <Icon name="minus" size="xs" />
                        </button>
                        <input
                            type="number"
                            step={0.01}
                            min={0.01}
                            value={useRiskSizing ? effectiveLot : volume}
                            onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                if (!isNaN(val) && val >= 0.01) setVolume(val);
                            }}
                            disabled={isPlacing || useRiskSizing}
                            className="flex-1 px-2 py-1 bg-[#0d0d11] border border-[#2a2e39] rounded text-center text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-blue-500/50 disabled:opacity-50 w-0"
                        />
                        <button
                            onClick={() => setVolume(volume + 0.01)}
                            disabled={isPlacing || useRiskSizing}
                            className="w-6 h-6 flex items-center justify-center bg-[#2a2e39] hover:bg-[#353a47] disabled:opacity-30 disabled:cursor-not-allowed text-zinc-300 rounded text-xs transition-colors"
                        >
                            <Icon name="plus" size="xs" />
                        </button>
                    </div>
                    {/* Lot presets */}
                    <div className="flex gap-1 mt-1.5">
                        {[0.01, 0.05, 0.1, 0.5, 1.0].map((preset) => (
                            <button
                                key={preset}
                                onClick={() => setVolume(preset)}
                                disabled={useRiskSizing}
                                className={`flex-1 text-[9px] py-0.5 rounded border transition-colors ${Math.abs(volume - preset) < 0.001
                                    ? 'bg-blue-500/20 border-blue-500/40 text-blue-400 shadow-[0_0_4px_rgba(59,130,246,0.1)]'
                                    : 'bg-[#2a2e39] border-[#2a2e39] text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
                                    } disabled:opacity-30`}
                            >
                                {preset}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Auto SL/TP indicators */}
                {autoSLTP && (
                    <div className="px-3 py-1 border-b border-[#2a2e39]/50 flex items-center justify-between text-[9px]">
                        <span className="text-red-400/70">SL: {slPips} pips</span>
                        <span className="text-teal-400/70">TP: {tpPips} pips</span>
                    </div>
                )}
                {canPlaceTrade === false && lastSymbol && !statusMessage && (
                    <div className="px-3 py-1 border-b border-amber-500/20 bg-amber-500/10 text-[10px] text-amber-300">
                        {tradeBlockedMessage || marketStatus.label}
                    </div>
                )}

                {/* Buy / Sell Buttons */}
                <div className="grid grid-cols-2 gap-2 p-3">
                    <button
                        onClick={() => placeOrder('SELL')}
                        disabled={isPlacing || !canPlaceTrade || bid === 0}
                        className="flex flex-col items-center justify-center py-2 rounded-md bg-red-600/20 hover:bg-red-600/35 border border-red-500/30 hover:border-red-500/60 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-all group active:scale-95"
                    >
                        <Icon name="trending-down" size="lg" className="mb-0.5 group-hover:scale-110 transition-transform" />
                        <span className="text-[12px] font-mono font-bold mt-0.5 text-red-300 group-hover:text-red-200">
                            {bid > 0 ? bid.toFixed(digits) : '---'}
                        </span>
                    </button>

                    <button
                        onClick={() => placeOrder('BUY')}
                        disabled={isPlacing || !canPlaceTrade || ask === 0}
                        className="flex flex-col items-center justify-center py-2 rounded-md bg-teal-600/20 hover:bg-teal-600/35 border border-teal-500/30 hover:border-teal-500/60 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-all group active:scale-95"
                    >
                        <Icon name="trending-up" size="lg" className="mb-0.5 group-hover:scale-110 transition-transform" />
                        <span className="text-[12px] font-mono font-bold mt-0.5 text-teal-300 group-hover:text-teal-200">
                            {ask > 0 ? ask.toFixed(digits) : '---'}
                        </span>
                    </button>
                </div>

                {/* Close & Positions */}
                <div className="px-3 pb-2">
                    <button
                        onClick={closeLastPositions}
                        disabled={isClosing || lastSymbolPositions.length === 0}
                        className="w-full py-1.5 rounded bg-[#2a2e39] hover:bg-[#353a47] border border-[#3a3f4c] disabled:opacity-30 disabled:cursor-not-allowed text-[10px] font-semibold text-zinc-300 transition-colors"
                    >
                        CLOSE {lastSymbol} ({lastSymbolPositions.length}) •{' '}
                        <span className={totalPnL >= 0 ? 'text-teal-400' : 'text-red-400'}>
                            {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}
                        </span>
                    </button>
                </div>

                {/* Account Summary */}
                {account && (
                    <div className="px-3 py-1.5 border-t border-[#2a2e39]/50 flex items-center justify-between text-[9px] text-zinc-500">
                        <span>Bal: ${account.balance?.toFixed(2)}</span>
                        <span>Eq: ${account.equity?.toFixed(2)}</span>
                    </div>
                )}

                {/* Status Message */}
                {statusMessage && (
                    <div
                        className={`px-3 py-1.5 text-[10px] font-medium text-center transition-all ${statusType === 'success'
                            ? 'bg-teal-500/10 text-teal-400'
                            : statusType === 'error'
                                ? 'bg-red-500/10 text-red-400'
                                : 'bg-zinc-700/20 text-blue-400'
                            }`}
                    >
                        {statusMessage}
                    </div>
                )}

                {/* Hotkey Hint */}
                <div className="px-3 py-1 border-t border-[#2a2e39]/30 text-[8px] text-zinc-600 text-center">
                    Shift+B Buy • Shift+S Sell • Shift+X Close
                </div>

                {/* Settings Panel */}
                {showSettings && (
                    <div className="border-t border-[#2a2e39] bg-[#16161e] px-3 py-2 space-y-2">
                        <div className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Settings</div>

                        {/* Risk-based sizing */}
                        <label className="flex items-center justify-between text-[10px] text-zinc-300 cursor-pointer">
                            <span>Risk-based lots</span>
                            <input
                                type="checkbox"
                                checked={useRiskSizing}
                                onChange={(e) => setUseRiskSizing(e.target.checked)}
                                className="accent-blue-500"
                            />
                        </label>
                        {useRiskSizing && (
                            <div className="flex items-center gap-2">
                                <span className="text-[9px] text-zinc-500 w-12">Risk %</span>
                                <input
                                    type="number"
                                    step={0.1}
                                    min={0.1}
                                    max={100}
                                    value={riskPercent}
                                    onChange={(e) => setRiskPercent(parseFloat(e.target.value) || 1)}
                                    className="flex-1 px-1.5 py-0.5 bg-[#0d0d11] border border-[#2a2e39] rounded text-[10px] font-mono text-zinc-200 focus:outline-none focus:border-blue-500/50"
                                />
                            </div>
                        )}

                        {/* Auto SL/TP */}
                        <label className="flex items-center justify-between text-[10px] text-zinc-300 cursor-pointer">
                            <span>Auto SL/TP</span>
                            <input
                                type="checkbox"
                                checked={autoSLTP}
                                onChange={(e) => setAutoSLTP(e.target.checked)}
                                className="accent-blue-500"
                            />
                        </label>
                        {autoSLTP && (
                            <div className="grid grid-cols-2 gap-2">
                                <div className="flex items-center gap-1">
                                    <span className="text-[9px] text-red-400/70 w-6">SL</span>
                                    <input
                                        type="number"
                                        min={1}
                                        value={slPips}
                                        onChange={(e) => setSLPips(parseInt(e.target.value) || 30)}
                                        className="w-full px-1.5 py-0.5 bg-[#0d0d11] border border-[#2a2e39] rounded text-[10px] font-mono text-zinc-200 focus:outline-none focus:border-red-500/50"
                                    />
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className="text-[9px] text-teal-400/70 w-6">TP</span>
                                    <input
                                        type="number"
                                        min={1}
                                        value={tpPips}
                                        onChange={(e) => setTPPips(parseInt(e.target.value) || 60)}
                                        className="w-full px-1.5 py-0.5 bg-[#0d0d11] border border-[#2a2e39] rounded text-[10px] font-mono text-zinc-200 focus:outline-none focus:border-teal-500/50"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

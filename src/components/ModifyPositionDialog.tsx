/**
 * MT5-style Modify Position Dialog (Dark Theme)
 * Opens on double-click of a position row
 * Matches the MT5 "Order" dialog visual style
 */

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useCurrentTick } from '../store/useMarketDataStore';
import { useAppStore } from '../store/useAppStore';
import api from '../services/api';

interface ModifyPositionDialogProps {
    isOpen: boolean;
    onClose: (modifiedSl?: number, modifiedTp?: number) => void;
    kind?: 'position' | 'pending-order';
    position: {
        id: number;
        symbol: string;
        side: 'BUY' | 'SELL';
        volume: number;
        openPrice: number;
        sl: number;
        tp: number;
        comment?: string;
    } | null;
}

const getSymbolDigits = (symbol: string) => {
    if (symbol.includes('JPY')) return 3;
    if (symbol.startsWith('BTC') || symbol.startsWith('ETH')) return 2;
    if (symbol.startsWith('XAU')) return 2;
    if (symbol.startsWith('XAG')) return 3;
    return 5;
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

const getContractSize = (symbol: string) => {
    if (symbol.startsWith('XAU')) return 100;
    if (symbol.startsWith('XAG')) return 5000;
    if (symbol.startsWith('BTC') || symbol.startsWith('ETH')) return 1;
    return 100000;
};

const getContractUnit = (symbol: string) => {
    if (symbol.length >= 3) return symbol.slice(0, 3);
    return symbol;
};

const getErrorMessage = (err: unknown) => {
    if (err instanceof Error) return err.message;
    return 'Network error';
};

const focusableSelector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

const getFocusableElements = (container: HTMLElement) => {
    return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
        if (element.getAttribute('aria-disabled') === 'true') return false;
        if (element.closest('[aria-hidden="true"], [inert]')) return false;
        return element.tabIndex >= 0 && element.getClientRects().length > 0;
    });
};

export function ModifyPositionDialog({ isOpen, onClose, position, kind = 'position' }: ModifyPositionDialogProps) {
    const [sl, setSl] = useState('0.00');
    const [tp, setTp] = useState('0.00');
    const [volumeStr, setVolumeStr] = useState('0.01');
    const [comment, setComment] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const onCloseRef = useRef(onClose);
    const isDialogVisible = isOpen && position !== null;

    const tick = useCurrentTick(position?.symbol || '');

    // Price history for mini chart
    const bidHistoryRef = useRef<number[]>([]);
    const askHistoryRef = useRef<number[]>([]);

    useEffect(() => {
        if (isOpen && position) {
            const digits = getSymbolDigits(position.symbol);
            setSl(position.sl > 0 ? position.sl.toFixed(digits) : '0.00');
            setTp(position.tp > 0 ? position.tp.toFixed(digits) : '0.00');

            setVolumeStr(position.volume.toFixed(2));
            setComment(position.comment ?? '');
            setError(null);
            setSuccessMessage(null);
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

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!isDialogVisible) return;

        const previousFocusedElement = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;

        const focusDialog = () => {
            const dialog = dialogRef.current;
            if (!dialog) return;
            dialog.focus({ preventScroll: true });
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
                return;
            }

            if (event.key !== 'Tab') {
                return;
            }

            const dialog = dialogRef.current;
            if (!dialog) return;

            const focusableElements = getFocusableElements(dialog);
            if (focusableElements.length === 0) {
                event.preventDefault();
                dialog.focus({ preventScroll: true });
                return;
            }

            const activeElement = document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            const activeIndex = activeElement ? focusableElements.indexOf(activeElement) : -1;
            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];

            if (event.shiftKey && activeIndex <= 0) {
                event.preventDefault();
                lastElement.focus({ preventScroll: true });
                return;
            }

            if (!event.shiftKey && activeIndex === focusableElements.length - 1) {
                event.preventDefault();
                firstElement.focus({ preventScroll: true });
                return;
            }

            if (!event.shiftKey && activeIndex === -1) {
                event.preventDefault();
                firstElement.focus({ preventScroll: true });
            }
        };

        const animationFrameId = window.requestAnimationFrame(focusDialog);
        document.addEventListener('keydown', handleKeyDown, true);

        return () => {
            window.cancelAnimationFrame(animationFrameId);
            document.removeEventListener('keydown', handleKeyDown, true);
            if (
                previousFocusedElement
                && previousFocusedElement !== document.body
                && document.contains(previousFocusedElement)
            ) {
                previousFocusedElement.focus({ preventScroll: true });
            }
        };
    }, [isDialogVisible]);

    if (!isOpen || !position) return null;

    const digits = getSymbolDigits(position.symbol);
    const bid = tick?.bid ?? position.openPrice;
    const ask = tick?.ask ?? position.openPrice;
    const dialogTitleId = `modify-position-${position.id}-title`;
    const symbolFieldId = `modify-position-${position.id}-symbol`;
    const typeLabelId = `modify-position-${position.id}-type-label`;
    const typeValueId = `modify-position-${position.id}-type-value`;
    const volumeFieldId = `modify-position-${position.id}-volume`;
    const slFieldId = `modify-position-${position.id}-sl`;
    const slPointsFieldId = `modify-position-${position.id}-sl-points`;
    const tpFieldId = `modify-position-${position.id}-tp`;
    const tpPointsFieldId = `modify-position-${position.id}-tp-points`;
    const commentFieldId = `modify-position-${position.id}-comment`;

    const handleSubmit = async () => {
        setIsSubmitting(true);
        setError(null);
        setSuccessMessage(null);

        try {
            const slVal = parseFloat(sl) || 0;
            const tpVal = parseFloat(tp) || 0;
            console.log('[Modify] Sending modify request for ticket:', position.id, 'SL:', slVal, 'TP:', tpVal);

            if (kind === 'pending-order') {
                await api.orders.modifyPendingOrder(position.id, {
                    price: position.openPrice,
                    price_sl: slVal,
                    price_tp: tpVal,
                });
            } else {
                await api.positions.modifyPosition(position.id, { price_sl: slVal, price_tp: tpVal });
            }

            setSuccessMessage(kind === 'pending-order' ? 'Pending order modified successfully' : 'Position modified successfully');
            const store = useAppStore.getState();
            store.setPositions(store.positions.map(p =>
                p.id === position.id ? { ...p, sl: slVal, tp: tpVal } : p
            ));
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new Event('rtx:force-refresh-positions'));
            }
            setTimeout(() => onClose(slVal, tpVal), 600);
        } catch (err: unknown) {
            console.error('[Modify] Error:', err);
            setError(getErrorMessage(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    const parsedVolume = Number.parseFloat(volumeStr);
    const actionVolume = Number.isFinite(parsedVolume) && parsedVolume > 0 ? parsedVolume : 0;
    const contractAmount = actionVolume * getContractSize(position.symbol);
    const volumeDescription = `${Number.isInteger(contractAmount) ? contractAmount.toFixed(0) : contractAmount.toFixed(2)} ${getContractUnit(position.symbol)}`;

    const normalizeVolume = (value: string) => {
        const parsed = Number.parseFloat(value);
        if (!Number.isFinite(parsed) || parsed <= 0) return '0.01';
        return Math.max(0.01, Math.round(parsed * 100) / 100).toFixed(2);
    };

    const adjustVolume = (delta: number) => {
        const current = Number.parseFloat(volumeStr) || 0.01;
        const next = Math.max(0.01, Math.round((current + delta) * 100) / 100);
        setVolumeStr(next.toFixed(2));
    };

    const refreshPositionsAfterTrade = () => {
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('rtx:force-refresh-positions'));
            window.dispatchEvent(new CustomEvent('rtx:new-trade-placed'));
        }
    };

    const handleMarketOrder = async (side: 'BUY' | 'SELL') => {
        if (isSubmitting) return;
        if (actionVolume <= 0) {
            setError('Volume must be greater than zero');
            return;
        }

        setIsSubmitting(true);
        setError(null);
        setSuccessMessage(null);

        try {
            const slVal = Number.parseFloat(sl) || 0;
            const tpVal = Number.parseFloat(tp) || 0;
            await api.orders.placeMarketOrder({
                symbol: position.symbol,
                side,
                volume: actionVolume,
                price_sl: slVal > 0 ? slVal : undefined,
                price_tp: tpVal > 0 ? tpVal : undefined,
                comment: comment.trim() || undefined,
            });
            setSuccessMessage(`${side === 'BUY' ? 'Buy' : 'Sell'} market order placed successfully`);
            refreshPositionsAfterTrade();
            setTimeout(() => onClose(), 600);
        } catch (err: unknown) {
            console.error('[Market Order] Error:', err);
            setError(getErrorMessage(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCloseByMarket = async () => {
        if (isSubmitting) return;
        if (kind === 'pending-order') {
            setError('Close by market is only available for open positions');
            return;
        }
        if (actionVolume <= 0) {
            setError('Volume must be greater than zero');
            return;
        }
        if (actionVolume > position.volume + 0.0000001) {
            setError('Close volume cannot be greater than position volume');
            return;
        }
        if (Math.abs(actionVolume - position.volume) > 0.0000001) {
            setError('Partial close by volume is not supported by the backend yet');
            return;
        }

        setIsSubmitting(true);
        setError(null);
        setSuccessMessage(null);

        try {
            await api.positions.closePosition(String(position.id));
            const store = useAppStore.getState();
            store.setPositions(store.positions.filter(p => p.id !== position.id));
            setSuccessMessage('Position closed successfully');
            refreshPositionsAfterTrade();
            setTimeout(() => onClose(), 600);
        } catch (err: unknown) {
            console.error('[Close by Market] Error:', err);
            setError(getErrorMessage(err));
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
                {/* Grid lines */}
                {[0.25, 0.5, 0.75].map(f => {
                    const y = pad + f * (h - pad * 2);
                    const price = max - f * range;
                    return (
                        <g key={f}>
                            <line x1={pad} y1={y} x2={w - pad} y2={y} stroke="var(--chart-grid, #333)" strokeWidth="0.5" />
                            <text x={w - pad + 4} y={y + 3} fill="var(--chart-axis, #666)" fontSize="8" fontFamily="monospace">{price.toFixed(digits)}</text>
                        </g>
                    );
                })}
                {/* Ask line (red) */}
                <path d={toPath(askData)} fill="none" stroke="var(--chart-ask, #ef4444)" strokeWidth="1.5" />
                {/* Bid line (blue) */}
                <path d={toPath(bidData)} fill="none" stroke="var(--chart-bid, #8a8a8f)" strokeWidth="1.5" />
                {/* Current price labels */}
                <rect x={w - pad - 55} y={askY - 8} width={55} height={16} rx={2} fill="var(--chart-ask, #ef4444)" />
                <text x={w - pad - 52} y={askY + 4} fill="white" fontSize="9" fontWeight="bold" fontFamily="monospace">{ask.toFixed(digits)}</text>
                <rect x={w - pad - 55} y={bidY - 8} width={55} height={16} rx={2} fill="var(--chart-bid, #8a8a8f)" />
                <text x={w - pad - 52} y={bidY + 4} fill="white" fontSize="9" fontWeight="bold" fontFamily="monospace">{bid.toFixed(digits)}</text>
                {/* Symbol label */}
                <text x={pad + 4} y={16} fill="var(--chart-text-bold, #888)" fontSize="10" fontWeight="bold">{position.symbol}</text>
                <text x={pad + 4} y={28} fill="var(--chart-text-muted, #666)" fontSize="8">{bid.toFixed(digits)} / {ask.toFixed(digits)}</text>
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

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 p-3 backdrop-blur-[3px] rtx-modify-dialog-overlay sm:p-4">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={dialogTitleId}
                tabIndex={-1}
                className="rtx-modify-dialog flex max-h-[calc(100vh-24px)] w-[720px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-md border border-[#3f424a] bg-[#111217] shadow-[0_22px_70px_rgba(0,0,0,0.65)] sm:max-h-[calc(100vh-48px)] sm:max-w-[calc(100vw-32px)]"
            >
                {/* Title Bar - MT5 style with position info */}
                <div className="flex h-[43px] shrink-0 items-center justify-between border-b border-[#3f424a] bg-[#2b2b2e] px-4">
                    <span id={dialogTitleId} className="min-w-0 truncate text-[13px] font-semibold text-[#d9dde5]">
                        Position: #{position.id} {position.side.toLowerCase()} {position.volume.toFixed(2)} {position.symbol} {position.openPrice.toFixed(digits)}
                    </span>
                    <button
                        onClick={() => onClose()}
                        className="ml-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-lg leading-none text-zinc-400 transition-colors hover:bg-[#3b3d42] hover:text-white"
                        aria-label="Close modify position dialog"
                    >
                        &times;
                    </button>
                </div>

                {/* Content */}
                <div className="flex min-h-0 flex-1 overflow-hidden max-[640px]:flex-col">
                    {/* Left: Mini Chart */}
                    <div className="flex w-[300px] shrink-0 flex-col border-r border-[#353842] bg-[#151518] max-[640px]:h-[180px] max-[640px]:w-full max-[640px]:border-r-0 max-[640px]:border-b">
                        <div className="flex h-[30px] min-w-0 items-center border-b border-[#353842] px-3 font-mono text-[11px] text-zinc-300">
                            <span className="min-w-0 truncate font-semibold text-zinc-200">{position.symbol}</span>
                            <span className="ml-2 shrink-0 text-[#4ea4ff]">{bid.toFixed(digits)}</span>
                            <span className="mx-1 text-zinc-500">/</span>
                            <span className="shrink-0 text-[#ff5d66]">{ask.toFixed(digits)}</span>
                        </div>
                        <div className="flex-1 bg-[#141416] p-2">
                            {renderMiniChart()}
                        </div>
                    </div>

                    {/* Right: Form */}
                    <div className="min-w-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain bg-[#101116] p-4 max-[420px]:p-3">
                        {/* Symbol */}
                        <div className="flex min-w-0 items-center gap-3 max-[420px]:flex-wrap max-[420px]:gap-y-1">
                            <label htmlFor={symbolFieldId} className="w-[84px] shrink-0 text-right text-[11px] font-medium text-[#8d94a3] max-[420px]:w-full max-[420px]:text-left">Symbol:</label>
                            <select
                                id={symbolFieldId}
                                value={position.symbol}
                                onChange={() => undefined}
                                className="h-[31px] min-w-0 flex-1 rounded-sm border border-[#434650] bg-[#1f2026] px-3 text-xs font-semibold text-[#e4e7ee] shadow-inner shadow-black/20 outline-none transition-colors focus:border-[#666b78]"
                            >
                                <option value={position.symbol}>{getSymbolFullName(position.symbol)}</option>
                            </select>
                        </div>

                        {/* Type */}
                        <div className="flex min-w-0 items-center gap-3 max-[420px]:flex-wrap max-[420px]:gap-y-1">
                            <span id={typeLabelId} className="w-[84px] shrink-0 text-right text-[11px] font-medium text-[#8d94a3] max-[420px]:w-full max-[420px]:text-left">Type:</span>
                            <div id={typeValueId} aria-labelledby={`${typeLabelId} ${typeValueId}`} className="flex h-[31px] min-w-0 flex-1 items-center truncate rounded-sm border border-[#434650] bg-[#1f2026] px-3 text-xs font-semibold text-[#e4e7ee] shadow-inner shadow-black/20">
                                {kind === 'pending-order' ? 'Modify Pending Order' : 'Modify Position'}
                            </div>
                        </div>

                        {/* Volume */}
                        <div className="flex min-w-0 items-center gap-3 max-[420px]:flex-wrap max-[420px]:gap-y-1">
                            <label htmlFor={volumeFieldId} className="w-[84px] shrink-0 text-right text-[11px] font-medium text-[#aeb5c3] max-[420px]:w-full max-[420px]:text-left">Volume:</label>
                            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                                <div className="flex h-[31px] w-[96px] items-stretch overflow-hidden rounded-sm border border-[#434650] bg-[#1f2026] shadow-inner shadow-black/20">
                                    <input
                                        id={volumeFieldId}
                                        type="text"
                                        inputMode="decimal"
                                        value={volumeStr}
                                        onChange={(e) => {
                                            const value = e.target.value;
                                            if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                                setVolumeStr(value);
                                            }
                                        }}
                                        onBlur={() => setVolumeStr(normalizeVolume(volumeStr))}
                                        className="min-w-0 flex-1 bg-transparent px-2 text-right font-mono text-xs text-[#f3f4f6] focus:outline-none"
                                    />
                                    <div className="flex w-[18px] flex-col border-l border-[#434650] bg-[#272931]">
                                        <button
                                            type="button"
                                            onClick={() => adjustVolume(0.01)}
                                            className="h-1/2 text-[8px] leading-none text-zinc-400 hover:bg-[#3c404b] hover:text-white"
                                            aria-label="Increase volume"
                                        >
                                            &#9650;
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => adjustVolume(-0.01)}
                                            className="h-1/2 text-[8px] leading-none text-zinc-400 hover:bg-[#3c404b] hover:text-white"
                                            aria-label="Decrease volume"
                                        >
                                            &#9660;
                                        </button>
                                    </div>
                                </div>
                                <span className="min-w-0 break-words text-[11px] text-[#aeb5c3]">{volumeDescription}</span>
                            </div>
                        </div>

                        {/* Stop Loss with Points */}
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <label htmlFor={slFieldId} className="w-[84px] shrink-0 text-right text-[11px] font-semibold text-[#ff626a] max-[420px]:w-full max-[420px]:text-left">Stop Loss:</label>
                            <input
                                id={slFieldId}
                                type="number"
                                step={Math.pow(10, -digits).toString()}
                                value={sl}
                                onChange={(e) => setSl(e.target.value)}
                                className="h-[31px] w-[96px] rounded-sm border border-[#434650] bg-[#1f2026] px-2 text-center font-mono text-xs text-[#f3f4f6] shadow-inner shadow-black/20 outline-none focus:border-[#666b78]"
                            />
                            <input
                                id={slPointsFieldId}
                                aria-label="Stop Loss points"
                                type="number"
                                value={slPoints}
                                onChange={(e) => handleSlPointsChange(parseInt(e.target.value) || 0)}
                                className="h-[31px] w-[62px] rounded-sm border border-[#434650] bg-[#1f2026] px-2 text-center font-mono text-xs text-[#f3f4f6] shadow-inner shadow-black/20 outline-none focus:border-[#666b78]"
                            />
                            <span className="text-[10px] text-[#7f8796]">points</span>
                        </div>

                        {/* Take Profit with Points */}
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <label htmlFor={tpFieldId} className="w-[84px] shrink-0 text-right text-[11px] font-semibold text-[#1fd79b] max-[420px]:w-full max-[420px]:text-left">Take Profit:</label>
                            <input
                                id={tpFieldId}
                                type="number"
                                step={Math.pow(10, -digits).toString()}
                                value={tp}
                                onChange={(e) => setTp(e.target.value)}
                                className="h-[31px] w-[96px] rounded-sm border border-[#434650] bg-[#1f2026] px-2 text-center font-mono text-xs text-[#f3f4f6] shadow-inner shadow-black/20 outline-none focus:border-[#666b78]"
                            />
                            <input
                                id={tpPointsFieldId}
                                aria-label="Take Profit points"
                                type="number"
                                value={tpPoints}
                                onChange={(e) => handleTpPointsChange(parseInt(e.target.value) || 0)}
                                className="h-[31px] w-[62px] rounded-sm border border-[#434650] bg-[#1f2026] px-2 text-center font-mono text-xs text-[#f3f4f6] shadow-inner shadow-black/20 outline-none focus:border-[#666b78]"
                            />
                            <span className="text-[10px] text-[#7f8796]">points</span>
                        </div>

                        {/* Comment */}
                        <div className="flex min-w-0 items-center gap-3 max-[420px]:flex-wrap max-[420px]:gap-y-1">
                            <label htmlFor={commentFieldId} className="w-[84px] shrink-0 text-right text-[11px] font-medium text-[#aeb5c3] max-[420px]:w-full max-[420px]:text-left">Comment:</label>
                            <input
                                id={commentFieldId}
                                type="text"
                                maxLength={64}
                                value={comment}
                                onChange={(e) => setComment(e.target.value)}
                                className="h-[31px] min-w-0 flex-1 rounded-sm border border-[#434650] bg-[#1f2026] px-3 text-xs text-[#e4e7ee] shadow-inner shadow-black/20 outline-none transition-colors focus:border-[#666b78]"
                            />
                        </div>

                        {/* Live Price Display */}
                        <div className="mt-3 border-t border-[#3a3d45] py-4 text-center">
                            <div className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1">
                                {formatBigPrice(bid, 'text-zinc-100')}
                                <span className="text-lg text-[#707784]">/</span>
                                {formatBigPrice(ask, 'text-zinc-100')}
                            </div>
                        </div>

                        {/* Modify Button */}
                        <button
                            onClick={handleSubmit}
                            disabled={isSubmitting}
                            className="min-h-[36px] w-full break-words rounded-sm border border-[#51535d] bg-[#4a4b53] px-2 py-2 text-xs font-bold leading-tight text-white transition-colors hover:bg-[#565861] active:bg-[#3f4047] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isSubmitting ? 'Processing...' : `Modify #${position.id} ${position.side.toLowerCase()} ${position.volume.toFixed(2)} ${position.symbol} ${position.openPrice.toFixed(digits)}`}
                        </button>

                        {kind === 'position' && (
                            <div className="space-y-2">
                                <div className="grid grid-cols-2 gap-3 max-[420px]:grid-cols-1 max-[420px]:gap-2">
                                    <button
                                        type="button"
                                        onClick={() => handleMarketOrder('SELL')}
                                        disabled={isSubmitting || bid <= 0}
                                        className="min-h-[34px] rounded-sm bg-[#f23f45] px-2 py-2 text-xs font-bold leading-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition-colors hover:bg-[#ff5258] active:bg-[#d8393f] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Sell by Market
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleMarketOrder('BUY')}
                                        disabled={isSubmitting || ask <= 0}
                                        className="min-h-[34px] rounded-sm bg-[#3f73f1] px-2 py-2 text-xs font-bold leading-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition-colors hover:bg-[#5486ff] active:bg-[#315fd1] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Buy by Market
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleCloseByMarket}
                                    disabled={isSubmitting}
                                    className="min-h-[31px] w-full break-words rounded-sm border border-[#d8c889] bg-[#fff8dc] px-2 py-2 text-xs font-semibold leading-tight text-zinc-900 transition-colors hover:bg-[#fff1b8] active:bg-[#f1df9b] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Close #{position.id} {position.side.toLowerCase()} {actionVolume > 0 ? actionVolume.toFixed(2) : '0.00'} {position.symbol} {position.openPrice.toFixed(digits)} by Market
                                </button>
                            </div>
                        )}

                        {/* Error / Success */}
                        {error && (
                            <div className="break-words rounded-sm border border-red-700/80 bg-red-950/40 px-3 py-2 text-center text-[11px] text-red-200">
                                {error}
                            </div>
                        )}
                        {successMessage && (
                            <div className="break-words rounded-sm border border-emerald-700/80 bg-emerald-950/35 px-3 py-2 text-center text-[11px] text-emerald-200">
                                {successMessage}
                            </div>
                        )}

                        {/* MT5 Quote Text */}
                        <div className="px-2 pt-1 text-center text-[10px] leading-relaxed text-[#777f8d]">
                            Stop Loss or Take Profit you set must differ from market price by at least 0 points.<br />
                            Stops processing is performed on the broker side.
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}

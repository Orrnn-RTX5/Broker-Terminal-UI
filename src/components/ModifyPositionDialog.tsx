/**
 * MT5-style Modify Position Dialog (Dark Theme)
 * Opens on double-click of a position row
 * Matches the MT5 "Order" dialog visual style
 */

import { useState, useEffect, useReducer, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
    Activity,
    ChartCandlestick,
    Crosshair,
    Grid3X3,
    RotateCcw,
    ZoomIn,
    ZoomOut,
} from 'lucide-react';
import { useCurrentTick } from '../store/useMarketDataStore';
import { useAppStore } from '../store/useAppStore';
import api from '../services/api';

interface ModifyPositionDialogProps {
    isOpen: boolean;
    onClose: (modifiedSl?: number, modifiedTp?: number, modifiedComment?: string) => void;
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

type ModifyDialogKind = NonNullable<ModifyPositionDialogProps['kind']>;
type ModifyPosition = NonNullable<ModifyPositionDialogProps['position']>;

interface MiniChartSample {
    bid: number;
    ask: number;
    timestamp: number;
}

interface MiniChartState {
    key: string | null;
    samples: MiniChartSample[];
}

interface MiniMarketDepthLevel {
    side: 'ASK' | 'BID';
    price: number;
    volume: number;
    intensity: number;
    isBest: boolean;
}

type MiniChartAction =
    | { type: 'reset'; key: string }
    | { type: 'clear' }
    | { type: 'append'; key: string; sample: MiniChartSample };

const MAX_MINI_CHART_SAMPLES = 60;
const MINI_CHART_ZOOM_LEVELS = [1, 1.35, 1.8, 2.4] as const;
const initialMiniChartState: MiniChartState = { key: null, samples: [] };

const getMiniChartKey = (position: ModifyPosition, kind: ModifyDialogKind) => {
    return `${kind}:${position.id}:${position.symbol}`;
};

const isSameMiniChartSample = (left: MiniChartSample, right: MiniChartSample) => {
    return left.bid === right.bid && left.ask === right.ask && left.timestamp === right.timestamp;
};

const appendMiniChartSample = (samples: MiniChartSample[], sample: MiniChartSample) => {
    const lastSample = samples[samples.length - 1];
    if (lastSample && isSameMiniChartSample(lastSample, sample)) {
        return samples;
    }

    return [...samples, sample].slice(-MAX_MINI_CHART_SAMPLES);
};

const miniChartReducer = (state: MiniChartState, action: MiniChartAction): MiniChartState => {
    switch (action.type) {
        case 'clear':
            if (state.key === null && state.samples.length === 0) return state;
            return initialMiniChartState;
        case 'reset':
            if (state.key === action.key && state.samples.length === 0) return state;
            return { key: action.key, samples: [] };
        case 'append': {
            const baseSamples = state.key === action.key ? state.samples : [];
            const nextSamples = appendMiniChartSample(baseSamples, action.sample);
            if (state.key === action.key && nextSamples === state.samples) return state;
            return { key: action.key, samples: nextSamples };
        }
        default:
            return state;
    }
};

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

const clamp = (value: number, min: number, max: number) => {
    return Math.min(Math.max(value, min), max);
};

const formatChartTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
};

const normalizeChartTimestamp = (timestamp: number | undefined, fallbackTimestamp?: number) => {
    const rawTimestamp = typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0
        ? timestamp
        : fallbackTimestamp ?? Date.now();

    return rawTimestamp > 1_000_000_000_000 ? rawTimestamp : rawTimestamp * 1000;
};

const buildMiniMarketDepthLevels = (
    bid: number,
    ask: number,
    volume: number,
    digits: number
) => {
    const point = Math.pow(10, -digits);
    const baseVolume = Math.max(volume, 0.01);
    const largeVolume = Math.max(2, baseVolume * 17_000);
    const smallVolume = Math.max(0.01, baseVolume * 200);
    const volumes = [largeVolume, smallVolume, smallVolume, largeVolume];
    const maxVolume = Math.max(...volumes);

    const createLevel = (
        side: MiniMarketDepthLevel['side'],
        price: number,
        levelVolume: number,
        index: number
    ): MiniMarketDepthLevel => ({
        side,
        price,
        volume: levelVolume,
        intensity: Math.max(8, (levelVolume / maxVolume) * 100),
        isBest: index === 0,
    });

    const asks = volumes.map((levelVolume, index) => (
        createLevel('ASK', ask + (volumes.length - 1 - index) * point, levelVolume, index)
    ));
    const bids = volumes.map((levelVolume, index) => (
        createLevel('BID', bid - index * point, levelVolume, index)
    ));

    return { asks, bids };
};

const MarketDepthIcon = () => (
    <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
    >
        <rect x="1.5" y="1.5" width="3" height="3" rx="0.6" fill="#ff4d57" />
        <rect x="1.5" y="5.5" width="3" height="3" rx="0.6" fill="#ff4d57" opacity="0.75" />
        <rect x="1.5" y="9.5" width="3" height="3" rx="0.6" fill="#ff4d57" opacity="0.5" />
        <rect x="9.5" y="1.5" width="3" height="3" rx="0.6" fill="#2f8cff" opacity="0.5" />
        <rect x="9.5" y="5.5" width="3" height="3" rx="0.6" fill="#2f8cff" opacity="0.75" />
        <rect x="9.5" y="9.5" width="3" height="3" rx="0.6" fill="#2f8cff" />
        <path d="M6.1 2.8H7.9M6.1 7H7.9M6.1 11.2H7.9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
);

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
    const [showMiniChart, setShowMiniChart] = useState(true);
    const [showMiniMarketDepth, setShowMiniMarketDepth] = useState(false);
    const [miniChartZoomIndex, setMiniChartZoomIndex] = useState(0);
    const [showMiniChartGrid, setShowMiniChartGrid] = useState(true);
    const [showMiniChartPriceLines, setShowMiniChartPriceLines] = useState(true);
    const dialogRef = useRef<HTMLDivElement>(null);
    const onCloseRef = useRef(onClose);
    const isDialogVisible = isOpen && position !== null;

    const tick = useCurrentTick(position?.symbol || '');
    const miniChartKey = isOpen && position ? getMiniChartKey(position, kind) : null;
    const [miniChartState, dispatchMiniChart] = useReducer(miniChartReducer, initialMiniChartState);

    useEffect(() => {
        if (isOpen && position) {
            const digits = getSymbolDigits(position.symbol);
            setSl(position.sl > 0 ? position.sl.toFixed(digits) : '0.00');
            setTp(position.tp > 0 ? position.tp.toFixed(digits) : '0.00');

            setVolumeStr(position.volume.toFixed(2));
            setComment(position.comment ?? '');
            setError(null);
            setSuccessMessage(null);
            setShowMiniChart(true);
            setShowMiniMarketDepth(false);
            setMiniChartZoomIndex(0);
            setShowMiniChartGrid(true);
            setShowMiniChartPriceLines(true);
        }
    }, [isOpen, position]);

    useEffect(() => {
        if (!miniChartKey) {
            dispatchMiniChart({ type: 'clear' });
            return;
        }

        dispatchMiniChart({ type: 'reset', key: miniChartKey });
    }, [miniChartKey]);

    useEffect(() => {
        if (!miniChartKey || !tick || !Number.isFinite(tick.bid) || !Number.isFinite(tick.ask)) {
            return;
        }

        dispatchMiniChart({
            type: 'append',
            key: miniChartKey,
            sample: {
                bid: tick.bid,
                ask: tick.ask,
                timestamp: normalizeChartTimestamp(tick.timestamp),
            },
        });
    }, [miniChartKey, tick]);

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
    const previousMiniChartSample = miniChartKey && miniChartState.key === miniChartKey
        ? miniChartState.samples[miniChartState.samples.length - 1]
        : undefined;
    const currentMiniChartSample: MiniChartSample = tick && Number.isFinite(tick.bid) && Number.isFinite(tick.ask)
        ? {
            bid: tick.bid,
            ask: tick.ask,
            timestamp: normalizeChartTimestamp(tick.timestamp, previousMiniChartSample?.timestamp),
        }
        : previousMiniChartSample ?? {
            bid: position.openPrice,
            ask: position.openPrice,
            timestamp: Date.now(),
        };
    const miniChartSamples = miniChartKey
        ? appendMiniChartSample(
            miniChartState.key === miniChartKey ? miniChartState.samples : [],
            currentMiniChartSample
        )
        : [currentMiniChartSample];
    const latestMiniChartSample = miniChartSamples[miniChartSamples.length - 1] ?? currentMiniChartSample;
    const bid = latestMiniChartSample.bid;
    const ask = latestMiniChartSample.ask;
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
            const nextComment = comment.trim();

            if (kind === 'pending-order') {
                await api.orders.modifyPendingOrder(position.id, {
                    price: position.openPrice,
                    price_sl: slVal,
                    price_tp: tpVal,
                    comment: nextComment,
                });
            } else {
                await api.positions.modifyPosition(position.id, { price_sl: slVal, price_tp: tpVal, comment: nextComment });
            }

            setSuccessMessage(kind === 'pending-order' ? 'Pending order modified successfully' : 'Position modified successfully');
            const store = useAppStore.getState();
            store.setPositions(store.positions.map(p =>
                p.id === position.id ? { ...p, sl: slVal, tp: tpVal, comment: nextComment } : p
            ));
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new Event('rtx:force-refresh-positions'));
            }
            setTimeout(() => onClose(slVal, tpVal, nextComment), 600);
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

    const canZoomInMiniChart = miniChartZoomIndex < MINI_CHART_ZOOM_LEVELS.length - 1;
    const canZoomOutMiniChart = miniChartZoomIndex > 0;
    const resetMiniChartView = () => {
        setShowMiniChart(true);
        setMiniChartZoomIndex(0);
        setShowMiniChartGrid(true);
        setShowMiniChartPriceLines(true);
    };

    const renderChartToolButton = (
        label: string,
        icon: ReactNode,
        onClick?: () => void,
        options?: { active?: boolean; disabled?: boolean }
    ) => {
        const active = options?.active ?? false;
        const disabled = options?.disabled ?? false;

        return (
            <button
                key={label}
                type="button"
                onClick={onClick}
                disabled={disabled}
                title={label}
                aria-label={label}
                aria-pressed={active}
                className={[
                    'flex h-[23px] w-[24px] shrink-0 items-center justify-center border text-[11px] transition-colors',
                    active
                        ? 'border-[#334f7d] bg-[#193a63] text-[#78b8ff] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                        : 'border-transparent bg-transparent text-[#9aa5b5] hover:border-[#314057] hover:bg-[#182130] hover:text-[#e5eefc]',
                    disabled ? 'cursor-not-allowed opacity-35 hover:border-transparent hover:bg-transparent hover:text-[#9aa5b5]' : '',
                ].join(' ')}
            >
                {icon}
            </button>
        );
    };

    const renderMiniChartToolbar = () => (
        <div className="flex h-[31px] shrink-0 items-center gap-1 border-b border-[#263142] bg-[#111827] px-2">
            {renderChartToolButton(
                showMiniMarketDepth ? 'Hide market depth' : 'Show market depth',
                <MarketDepthIcon />,
                () => setShowMiniMarketDepth(value => !value),
                { active: showMiniMarketDepth }
            )}
            {renderChartToolButton(
                showMiniChart ? 'Hide chart' : 'Show chart',
                <Activity size={14} strokeWidth={1.8} />,
                () => setShowMiniChart(value => !value),
                { active: showMiniChart }
            )}
            {renderChartToolButton('Candlestick chart', <ChartCandlestick size={14} strokeWidth={1.8} />, undefined, { disabled: true })}
            <div className="mx-1 h-5 w-px bg-[#2d3a4f]" />
            {renderChartToolButton(
                showMiniChartGrid ? 'Hide grid' : 'Show grid',
                <Grid3X3 size={14} strokeWidth={1.8} />,
                () => setShowMiniChartGrid(value => !value),
                { active: showMiniChartGrid, disabled: !showMiniChart }
            )}
            {renderChartToolButton(
                showMiniChartPriceLines ? 'Hide price lines' : 'Show price lines',
                <Crosshair size={14} strokeWidth={1.8} />,
                () => setShowMiniChartPriceLines(value => !value),
                { active: showMiniChartPriceLines, disabled: !showMiniChart }
            )}
            <div className="mx-1 h-5 w-px bg-[#2d3a4f]" />
            {renderChartToolButton(
                'Zoom in',
                <ZoomIn size={14} strokeWidth={1.8} />,
                () => setMiniChartZoomIndex(index => Math.min(index + 1, MINI_CHART_ZOOM_LEVELS.length - 1)),
                { disabled: !showMiniChart || !canZoomInMiniChart }
            )}
            {renderChartToolButton(
                'Zoom out',
                <ZoomOut size={14} strokeWidth={1.8} />,
                () => setMiniChartZoomIndex(index => Math.max(index - 1, 0)),
                { disabled: !showMiniChart || !canZoomOutMiniChart }
            )}
            {renderChartToolButton('Fit chart', <RotateCcw size={14} strokeWidth={1.8} />, resetMiniChartView)}
            <div className="ml-auto min-w-0 truncate font-mono text-[10px] text-[#718096]">
                {MINI_CHART_ZOOM_LEVELS[miniChartZoomIndex].toFixed(2)}x
            </div>
        </div>
    );

    const renderMiniMarketDepth = () => {
        const { asks, bids } = buildMiniMarketDepthLevels(bid, ask, actionVolume || position.volume, digits);
        const spreadPoints = Math.max(0, Math.round((ask - bid) * Math.pow(10, digits)));

        const renderDepthLevel = (level: MiniMarketDepthLevel) => {
            const isAsk = level.side === 'ASK';
            const barColor = isAsk ? 'rgba(255,77,87,0.32)' : 'rgba(47,140,255,0.32)';
            const rowBackground = isAsk
                ? level.isBest ? 'bg-[#351821]' : 'bg-[#201721]'
                : level.isBest ? 'bg-[#14243f]' : 'bg-[#111c2c]';
            const textColor = isAsk ? 'text-[#ff6a72]' : 'text-[#66a8ff]';
            const tradeBorder = isAsk ? 'border-[#6b3239]' : 'border-[#2e527f]';
            const tradeColor = isAsk ? 'border-t-[#ff7b82]' : 'border-t-[#79b3ff]';

            return (
                <div
                    key={`${level.side}-${level.price}`}
                    className={`grid h-[19px] grid-cols-[58px_minmax(0,1fr)_28px] border-b border-[#29344a] text-[10px] ${rowBackground}`}
                >
                    <div className="relative flex min-w-0 items-center justify-end overflow-hidden border-r border-[#29344a] pr-1 font-mono text-[#d7e2f2]">
                        <div
                            className="absolute inset-y-0 left-0"
                            style={{ width: `${level.intensity}%`, backgroundColor: barColor }}
                        />
                        <span className="relative z-10">{level.volume.toFixed(2)}</span>
                    </div>
                    <div className={`flex min-w-0 items-center justify-end border-r border-[#29344a] pr-1.5 font-mono ${textColor}`}>
                        {level.price.toFixed(digits)}
                    </div>
                    <div className="flex items-center justify-center">
                        <button
                            type="button"
                            className={`flex h-[16px] w-[18px] items-center justify-center border bg-[#162030] ${tradeBorder}`}
                            title="Use the Sell or Buy by Market buttons to trade"
                            aria-label={`${level.side === 'ASK' ? 'Ask' : 'Bid'} depth level ${level.price.toFixed(digits)}`}
                            onClick={() => setError('Use the Sell by Market or Buy by Market buttons to trade from this dialog.')}
                        >
                            <span className={`h-0 w-0 border-x-[4px] border-t-[5px] border-x-transparent ${tradeColor}`} />
                        </button>
                    </div>
                </div>
            );
        };

        return (
            <div
                role="region"
                aria-label={`${position.symbol} market depth`}
                className="flex h-full min-h-0 flex-col overflow-hidden border border-[#334057] bg-[#0d1420]"
            >
                <div className="grid h-[24px] shrink-0 grid-cols-[58px_minmax(0,1fr)_28px] border-b border-[#334057] bg-[#121b2a] text-[10px] text-[#b8c4d6]">
                    <div className="flex items-center justify-center border-r border-[#334057]">Volume</div>
                    <div className="flex items-center justify-center border-r border-[#334057]">Price</div>
                    <div className="flex items-center justify-center">Trade</div>
                </div>
                <div className="flex-1 overflow-hidden">
                    <div className="h-[18px] border-b border-[#29344a] bg-[#0d1420]" />
                    {asks.map(renderDepthLevel)}
                    <div className="flex h-[22px] items-center justify-center border-y border-[#3d4b64] bg-[#111827] font-mono text-[10px] text-[#8fa2bd]">
                        Spread {spreadPoints}
                    </div>
                    {bids.map(renderDepthLevel)}
                    <div className="h-[18px] border-b border-[#29344a] bg-[#0d1420]" />
                    <div className="h-[18px] border-b border-[#29344a] bg-[#0d1420]" />
                    <div className="h-[18px] border-b border-[#29344a] bg-[#0d1420]" />
                </div>
            </div>
        );
    };

    // Mini chart renderer
    const renderMiniChart = () => {
        const zoomLevel = MINI_CHART_ZOOM_LEVELS[miniChartZoomIndex];
        const visibleSampleCount = zoomLevel > 1
            ? Math.max(12, Math.ceil(miniChartSamples.length / zoomLevel))
            : miniChartSamples.length;
        const visibleMiniChartSamples = miniChartSamples.slice(-visibleSampleCount);
        const bidData = visibleMiniChartSamples.map(sample => sample.bid);
        const askData = visibleMiniChartSamples.map(sample => sample.ask);
        const timeData = visibleMiniChartSamples.map(sample => sample.timestamp);
        const hasHistory = visibleMiniChartSamples.length >= 2;
        const effectiveBidData = hasHistory ? bidData : [bid, bid];
        const effectiveAskData = hasHistory ? askData : [ask, ask];
        const effectiveTimeData = hasHistory
            ? timeData
            : [latestMiniChartSample.timestamp - 60_000, latestMiniChartSample.timestamp];

        const allPrices = [...effectiveBidData, ...effectiveAskData, bid, ask];
        const rawMin = Math.min(...allPrices);
        const rawMax = Math.max(...allPrices);
        const rawRange = rawMax - rawMin;
        const minimumRangePadding = Math.pow(10, -digits) * 6;
        const rangePadding = Math.max(rawRange * 0.18, minimumRangePadding);
        const min = rawMin - rangePadding;
        const max = rawMax + rangePadding;
        const range = max - min || 1;

        const w = 280;
        const h = 430;
        const plotLeft = 10;
        const plotTop = 12;
        const plotRight = 208;
        const plotBottom = h - 28;
        const plotWidth = plotRight - plotLeft;
        const plotHeight = plotBottom - plotTop;
        const timeAxisY = h - 12;
        const tagX = plotRight + 6;
        const tagWidth = 62;
        const tagHeight = 16;
        const minTagY = plotTop + 1;
        const maxTagY = plotBottom - tagHeight - 1;
        const gridFractions = [0, 0.25, 0.5, 0.75, 1];
        const timeFractions = [0, 0.5, 1];
        const chartBackground = '#0a0f18';
        const plotBackground = '#0d1420';
        const gridColor = '#263244';
        const axisColor = '#8da0bb';
        const borderColor = '#40506a';
        const askColor = '#ff4d57';
        const bidColor = '#2f8cff';
        const labelColor = '#d7e2f2';
        const mutedLabelColor = '#8fa2bd';

        const toPath = (data: number[]) => {
            return data.map((v, i) => {
                const x = plotLeft + (i / (data.length - 1)) * plotWidth;
                const y = plotBottom - ((v - min) / range) * plotHeight;
                return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(' ');
        };

        const toY = (price: number) => plotBottom - ((price - min) / range) * plotHeight;
        const bidY = clamp(toY(bid), plotTop, plotBottom);
        const askY = clamp(toY(ask), plotTop, plotBottom);
        const askTagY = clamp(askY - tagHeight / 2, minTagY, maxTagY);
        const preferredBidTagY = clamp(bidY - tagHeight / 2, minTagY, maxTagY);
        const minTagGap = tagHeight + 2;
        const bidTagY = Math.abs(preferredBidTagY - askTagY) < minTagGap
            ? clamp(
                askTagY + minTagGap <= maxTagY ? askTagY + minTagGap : askTagY - minTagGap,
                minTagY,
                maxTagY
            )
            : preferredBidTagY;

        const getAxisTime = (fraction: number) => {
            const index = Math.round(fraction * (effectiveTimeData.length - 1));
            return formatChartTime(effectiveTimeData[index]);
        };

        const renderPriceTag = (
            label: string,
            y: number,
            tagY: number,
            fill: string,
            textColor = '#ffffff'
        ) => (
            <g key={fill}>
                <line x1={plotRight} y1={y} x2={tagX} y2={tagY + tagHeight / 2} stroke={fill} strokeWidth="1" />
                <rect x={tagX} y={tagY} width={tagWidth} height={tagHeight} rx={1} fill={fill} />
                <text
                    x={tagX + tagWidth / 2}
                    y={tagY + 11}
                    fill={textColor}
                    fontSize="9"
                    fontWeight="700"
                    fontFamily="Consolas, monospace"
                    textAnchor="middle"
                >
                    {label}
                </text>
            </g>
        );

        return (
            <svg
                width={w}
                height={h}
                viewBox={`0 0 ${w} ${h}`}
                className="h-full w-full"
                role="img"
                aria-label={`${position.symbol} bid and ask tick chart`}
                preserveAspectRatio="xMidYMid meet"
            >
                <rect x={0} y={0} width={w} height={h} fill={chartBackground} />
                <rect x={plotLeft} y={plotTop} width={plotWidth} height={plotHeight} fill={plotBackground} stroke={borderColor} strokeWidth="1" />

                {gridFractions.map(f => {
                    const y = plotTop + f * plotHeight;
                    const price = max - f * range;
                    return (
                        <g key={`price-${f}`}>
                            {showMiniChartGrid && (
                                <line x1={plotLeft} y1={y} x2={plotRight} y2={y} stroke={gridColor} strokeWidth="0.75" strokeDasharray="3 3" />
                            )}
                            <text
                                x={plotRight + 5}
                                y={clamp(y + 3, plotTop + 7, plotBottom - 2)}
                                fill={axisColor}
                                fontSize="8"
                                fontFamily="Consolas, monospace"
                            >
                                {price.toFixed(digits)}
                            </text>
                        </g>
                    );
                })}

                {showMiniChartGrid && gridFractions.map(f => {
                    const x = plotLeft + f * plotWidth;
                    return (
                        <line
                            key={`time-grid-${f}`}
                            x1={x}
                            y1={plotTop}
                            x2={x}
                            y2={plotBottom}
                            stroke={gridColor}
                            strokeWidth="0.75"
                            strokeDasharray="3 3"
                        />
                    );
                })}

                <line x1={plotRight} y1={plotTop} x2={plotRight} y2={plotBottom} stroke={borderColor} strokeWidth="1" />
                <line x1={plotLeft} y1={plotBottom} x2={plotRight} y2={plotBottom} stroke={borderColor} strokeWidth="1" />

                {showMiniChartPriceLines && (
                    <>
                        <line x1={plotLeft} y1={askY} x2={plotRight} y2={askY} stroke={askColor} strokeWidth="1" strokeDasharray="4 2" opacity="0.85" />
                        <line x1={plotLeft} y1={bidY} x2={plotRight} y2={bidY} stroke={bidColor} strokeWidth="1" strokeDasharray="4 2" opacity="0.85" />
                    </>
                )}

                <path d={toPath(effectiveAskData)} fill="none" stroke={askColor} strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
                <path d={toPath(effectiveBidData)} fill="none" stroke={bidColor} strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />

                {showMiniChartPriceLines && (
                    <>
                        {renderPriceTag(ask.toFixed(digits), askY, askTagY, askColor)}
                        {renderPriceTag(bid.toFixed(digits), bidY, bidTagY, bidColor)}
                    </>
                )}

                {timeFractions.map(f => {
                    const x = plotLeft + f * plotWidth;
                    const anchor = f === 0 ? 'start' : f === 1 ? 'end' : 'middle';
                    return (
                        <text
                            key={`time-${f}`}
                            x={x}
                            y={timeAxisY}
                            fill={axisColor}
                            fontSize="8"
                            fontFamily="Consolas, monospace"
                            textAnchor={anchor}
                        >
                            {getAxisTime(f)}
                        </text>
                    );
                })}

                <text x={plotLeft + 3} y={plotTop + 10} fill={labelColor} fontSize="9" fontWeight="700" fontFamily="Consolas, monospace">
                    {position.symbol}
                </text>
                <text x={plotLeft + 3} y={plotTop + 21} fill={mutedLabelColor} fontSize="8" fontFamily="Consolas, monospace">
                    {bid.toFixed(digits)} / {ask.toFixed(digits)}
                </text>
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

    const dialogWidthClass = showMiniMarketDepth ? 'w-[860px]' : 'w-[720px]';
    const chartPanelWidthClass = showMiniMarketDepth ? 'w-[430px]' : 'w-[300px]';

    return createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 p-3 backdrop-blur-[3px] rtx-modify-dialog-overlay sm:p-4">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={dialogTitleId}
                tabIndex={-1}
                className={`rtx-modify-dialog flex max-h-[calc(100vh-24px)] ${dialogWidthClass} max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-md border border-[#3f424a] bg-[#111217] shadow-[0_22px_70px_rgba(0,0,0,0.65)] sm:max-h-[calc(100vh-48px)] sm:max-w-[calc(100vw-32px)]`}
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
                    <div className={`flex ${chartPanelWidthClass} shrink-0 flex-col border-r border-[#353842] bg-[#0a0f18] max-[640px]:h-[220px] max-[640px]:w-full max-[640px]:border-r-0 max-[640px]:border-b`}>
                        <div className="flex h-[30px] min-w-0 items-center border-b border-[#263142] bg-[#0f1724] px-3 font-mono text-[11px] text-[#b8c4d6]">
                            <span className="min-w-0 truncate font-semibold text-[#e6eefb]">{position.symbol}</span>
                            <span className="ml-2 shrink-0 text-[#4ea4ff]">{bid.toFixed(digits)}</span>
                            <span className="mx-1 text-[#697891]">/</span>
                            <span className="shrink-0 text-[#ff5d66]">{ask.toFixed(digits)}</span>
                        </div>
                        {renderMiniChartToolbar()}
                        <div className="min-h-0 flex-1 bg-[#0a0f18] p-1.5">
                            {showMiniMarketDepth ? (
                                <div className={showMiniChart ? 'grid h-full min-h-0 grid-cols-[minmax(0,1fr)_154px] gap-1.5' : 'h-full'}>
                                    {showMiniChart && (
                                        <div className="min-h-0 overflow-hidden">
                                            {renderMiniChart()}
                                        </div>
                                    )}
                                    {renderMiniMarketDepth()}
                                </div>
                            ) : (
                                showMiniChart ? renderMiniChart() : null
                            )}
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

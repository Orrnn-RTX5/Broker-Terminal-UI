import { useUiTranslation } from '../hooks/useUiTranslation';
/**
 * MT5-style Modify Position Dialog
 * Opens from position Modify actions and S/L or T/P controls
 * Matches the MT5 "Order" dialog visual style
 */

import { useState, useEffect, useReducer, useRef, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
    Activity,
    ChevronDown,
    ChevronUp,
    Crosshair,
    Grid3X3,
    Info,
    RotateCcw,
    X,
    ZoomIn,
    ZoomOut,
} from 'lucide-react';
import '../styles/modify-position-dialog.css';
import { useCurrentTick } from '../store/useMarketDataStore';
import { useAppStore } from '../store/useAppStore';
import api from '../services/api';
import { captureTradeOrderIntent } from '../services/orderLatencyTelemetry';
import { describeProtectionRefusal, formatOrderError } from '../utils/orderError';
import {
    defaultProtectionLevel,
    protectionLevelViolation,
    readKnownPriceDigits,
    roundProtectionLevelToGrid,
} from '../utils/tradeLevelDrag';
import { readRegisteredSymbolPriceSpec } from '../services/dailyChangePriceModeRegistry';
import { getFallbackSymbolDescription } from '../utils/symbolDescription';
import {
    getCommittedBrokerAccountSessionScope,
    getCommittedBrokerAccountSessionScopeKey,
    onCommittedBrokerAccountSessionScopeChange,
} from '../services/brokerSession';

interface ModifyPositionDialogProps {
    isOpen: boolean;
    onClose: (modifiedSl?: number, modifiedTp?: number, modifiedComment?: string) => void;
    /** Shared App close coordinator; keeps every single-close entry point consistent. */
    onClosePosition?: (id: number) => Promise<boolean> | boolean | void;
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

type ModifyDialogSessionContext = {
    dialogKey: string;
    sessionScope: string;
};

const getCurrentBrokerAccountSessionScopeKey = (): string => (
    getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope())
);

const getModifyDialogKey = (position: ModifyPosition, kind: ModifyDialogKind): string => (
    `${kind}:${position.id}:${String(position.symbol).trim().toUpperCase()}`
);

const STALE_MODIFY_DIALOG_ERROR = 'Trading session changed. Reopen the position and try again.';

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

const getSymbolFullName = (symbol: string) => {
    const desc = getFallbackSymbolDescription(symbol);
    return desc ? `${symbol}, ${desc}` : symbol;
};

const getContractSize = (symbol: string) => {
    const sym = symbol.toUpperCase();
    if (sym.includes('XAU')) return 100;
    if (sym.includes('XAG')) return 5000;
    if (sym.includes('BTC') || sym.includes('ETH')) return 1;
    if (sym.includes('OIL')) return 1000;
    return 100000;
};

const getContractUnit = (symbol: string) => {
    if (symbol.length >= 3) return symbol.slice(0, 3);
    return symbol;
};

const getErrorMessage = (err: unknown) => formatOrderError(err);

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
    digits: number | null
) => {
    // Illustrative ladder only. Unknown broker precision collapses it onto
    // the live best quotes instead of spacing it by a guessed point.
    const point = digits === null ? 0 : Math.pow(10, -digits);
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

export function ModifyPositionDialog(props: ModifyPositionDialogProps) {
    if (!props.isOpen || !props.position) return null;
    // A new opening or position identity owns a fresh draft before its first
    // commit. Quote/position refreshes for the same identity preserve edits.
    return <ModifyPositionDialogContent
        key={getModifyDialogKey(props.position, props.kind ?? 'position')}
        {...props}
        position={props.position}
    />;
}

function ModifyPositionDialogContent({ isOpen, onClose, onClosePosition, position, kind = 'position' }: Omit<ModifyPositionDialogProps, 'position'> & { position: ModifyPosition }) {
    const tr = useUiTranslation();
    const tick = useCurrentTick(position.symbol);
    // Price geometry from the symbol's own broker data only: the loaded
    // instrument catalog (scoped registry), then the position row. Never
    // the symbol-name table nor quote digits (the tick normalizer may fill
    // those from the name table): when precision is unknown every path below
    // shows and sends the value exactly as typed (no rounding).
    const registeredPriceSpec = readRegisteredSymbolPriceSpec(position.symbol);
    const specDigits = registeredPriceSpec.digits
        ?? readKnownPriceDigits((position as { digits?: unknown })?.digits);
    const specTickSize = registeredPriceSpec.digits === null ? null : registeredPriceSpec.tickSize;
    // Seed an empty SL/TP on the VALID side (never '0.00'): live quote first,
    // else the open price as reference (degraded but side-correct; the
    // server stays final authority and the mapped error names any residual).
    // With no reference price at all the inputs stay blank AND disabled with
    // a visible reason (fail-closed: no fake zero is ever shown or sent).
    const tickBid = Number((tick as { bid?: unknown } | null)?.bid) || 0;
    const tickAsk = Number((tick as { ask?: unknown } | null)?.ask) || 0;
    const hasProtectionReference = tickBid > 0 || tickAsk > 0 || position.openPrice > 0;
    const seedProtectionLevel = (role: 'SL' | 'TP'): string => {
      // No spec digits: cannot round or step, so seed nothing (blank). The
      // submit path sends UNROUNDED and the server validates the grid.
      if (specDigits === null) return '';
      const refPrice = position.openPrice > 0 ? position.openPrice : 0;
      const seeded = defaultProtectionLevel({
        side: String(position.side).toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
        role,
        bid: tickBid > 0 ? tickBid : refPrice,
        ask: tickAsk > 0 ? tickAsk : refPrice,
        digits: specDigits,
        distancePoints: (position as { stopsLevel?: unknown })?.stopsLevel
          ?? (position as { stops_level?: unknown })?.stops_level
          ?? (tick as { stopsLevel?: unknown } | null)?.stopsLevel,
      });
      return seeded !== null ? roundProtectionLevelToGrid(seeded, specDigits, specTickSize).toFixed(specDigits) : '';
    };
    const fmtExisting = (value: number): string => (specDigits === null ? String(value) : value.toFixed(specDigits));
    const [sl, setSl] = useState(() => position.sl > 0 ? fmtExisting(position.sl) : seedProtectionLevel('SL'));
    const [tp, setTp] = useState(() => position.tp > 0 ? fmtExisting(position.tp) : seedProtectionLevel('TP'));
    // Pending-order entry price + expiry (pending kind only; positions keep
    // their fill price and have no expiry).
    const [priceStr, setPriceStr] = useState(() => position.openPrice > 0 ? fmtExisting(position.openPrice) : '');
    const [expiryStr, setExpiryStr] = useState('');
    const [volumeStr, setVolumeStr] = useState(() => position.volume.toFixed(2));
    const [comment, setComment] = useState(() => position.comment ?? '');
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
    const initialLevelsRef = useRef({ sl: Number.parseFloat(sl) || 0, tp: Number.parseFloat(tp) || 0 });
    const isDialogVisible = isOpen && position !== null;
    const dialogKey = isDialogVisible && position ? getModifyDialogKey(position, kind) : null;
    const dialogSessionContextRef = useRef<ModifyDialogSessionContext | null>(null);
    const scheduledCloseTimerRef = useRef<number | null>(null);

    const clearScheduledClose = useCallback(() => {
        if (scheduledCloseTimerRef.current === null) return;
        window.clearTimeout(scheduledCloseTimerRef.current);
        scheduledCloseTimerRef.current = null;
    }, []);

    const isCurrentDialogSession = useCallback((context: ModifyDialogSessionContext | null): context is ModifyDialogSessionContext => (
        context !== null
        && dialogSessionContextRef.current === context
        && getCurrentBrokerAccountSessionScopeKey() === context.sessionScope
    ), []);

    const getCurrentMutationContext = useCallback((): ModifyDialogSessionContext | null => {
        const context = dialogSessionContextRef.current;
        if (isCurrentDialogSession(context)) return context;
        setSuccessMessage(null);
        setError(STALE_MODIFY_DIALOG_ERROR);
        return null;
    }, [isCurrentDialogSession]);

    const scheduleClose = useCallback((
        context: ModifyDialogSessionContext,
        close: () => void,
    ) => {
        clearScheduledClose();
        const timerId = window.setTimeout(() => {
            if (scheduledCloseTimerRef.current === timerId) {
                scheduledCloseTimerRef.current = null;
            }
            if (!isCurrentDialogSession(context)) return;
            close();
        }, 600);
        scheduledCloseTimerRef.current = timerId;
    }, [clearScheduledClose, isCurrentDialogSession]);

    const miniChartKey = isOpen && position ? getMiniChartKey(position, kind) : null;
    const [miniChartState, dispatchMiniChart] = useReducer(miniChartReducer, initialMiniChartState);

    const chartContainerRef = useRef<HTMLDivElement | null>(null);
    const [chartDimensions, setChartDimensions] = useState({ width: 450, height: 460 });

    useEffect(() => {
        clearScheduledClose();
        if (!dialogKey) {
            dialogSessionContextRef.current = null;
            return;
        }

        const context: ModifyDialogSessionContext = {
            dialogKey,
            sessionScope: getCurrentBrokerAccountSessionScopeKey(),
        };
        dialogSessionContextRef.current = context;

        return () => {
            clearScheduledClose();
            if (dialogSessionContextRef.current === context) {
                dialogSessionContextRef.current = null;
            }
        };
    }, [clearScheduledClose, dialogKey]);

    useEffect(() => onCommittedBrokerAccountSessionScopeChange(() => {
        clearScheduledClose();
        dialogSessionContextRef.current = null;
    }), [clearScheduledClose]);

    useEffect(() => {
        const container = chartContainerRef.current;
        if (!container || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 50 && height > 50) {
                    setChartDimensions({ width: Math.round(width), height: Math.round(height) });
                }
            }
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, [isDialogVisible, showMiniChart, showMiniMarketDepth]);

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
            if (shouldIgnoreShortcutEvent(event) || !isShortcutOwnedBy(event, dialogRef.current)) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
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

    // Render-path digits: the same broker spec digits, nullable. Display
    // helpers below render raw values when precision is unknown.
    const digits = specDigits;
    // No minimum-distance notice: the gateway checks side + grid only
    // (rules_modify.go), so the dialog does not advertise a points distance.
    const fmtPrice = (value: number): string => (digits === null ? String(value) : value.toFixed(digits));
    const priceStepAttr = digits === null ? 'any' : Math.pow(10, -digits).toString();
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
    // Spread in points needs the broker point; unknown precision shows a dash.
    const spreadPointsLabel = digits === null
        ? '—'
        : String(Math.max(0, Math.round((ask - bid) * Math.pow(10, digits))));
    // Live red marking while typing: a level on the broker-invalid side or
    // off the price grid is marked with the reason before submit.
    const dialogSide = String(position.side).toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
    const slViolation = protectionLevelViolation({
        side: dialogSide, role: 'SL', price: parseFloat(sl) || 0,
        bid, ask, digits: specDigits, tickSize: specTickSize,
    });
    const tpViolation = protectionLevelViolation({
        side: dialogSide, role: 'TP', price: parseFloat(tp) || 0,
        bid, ask, digits: specDigits, tickSize: specTickSize,
    });
    const dialogTitleId = `modify-position-${position.id}-title`;
    const symbolFieldId = `modify-position-${position.id}-symbol`;
    const typeLabelId = `modify-position-${position.id}-type-label`;
    const typeValueId = `modify-position-${position.id}-type-value`;
    const volumeFieldId = `modify-position-${position.id}-volume`;
    const slFieldId = `modify-position-${position.id}-sl`;
    const slPointsFieldId = `modify-position-${position.id}-sl-points`;
    const tpFieldId = `modify-position-${position.id}-tp`;
    const tpPointsFieldId = `modify-position-${position.id}-tp-points`;
    const priceFieldId = `modify-position-${position.id}-price`;
    const expiryFieldId = `modify-position-${position.id}-expiry`;
    const commentFieldId = `modify-position-${position.id}-comment`;

    // Shared grid rounding for every submit path (modify + hedge market
    // order): spec digits only. Unknown precision sends UNROUNDED — the
    // server validates the grid; the client never guesses by symbol name.
    const roundProtectionLevel = (value: number): number => (
        value > 0 ? roundProtectionLevelToGrid(value, specDigits, specTickSize) : 0
    );

    const handleSubmit = async () => {
        const mutationContext = getCurrentMutationContext();
        if (!mutationContext) return;

        // No reference price: SL/TP inputs are disabled, and submitting is
        // blocked (fail-closed — never send a blind zero).
        if (!hasProtectionReference) {
            setError(tr("No live price is available to place Stop Loss or Take Profit levels"));
            return;
        }
        setIsSubmitting(true);
        setError(null);
        setSuccessMessage(null);

        // Round free-typed levels to the symbol grid before sending
        // (same normalization the drag path applies; the backend
        // requires on-grid values). Declared outside try so the catch can
        // name the offending level. Shared with handleMarketOrder below.
        const roundLevel = roundProtectionLevel;
        const slVal = roundLevel(parseFloat(sl) || 0);
        const tpVal = roundLevel(parseFloat(tp) || 0);
        try {
            const nextComment = comment.trim();
            const levelChanges = {
                ...(slVal !== initialLevelsRef.current.sl ? { price_sl: slVal } : {}),
                ...(tpVal !== initialLevelsRef.current.tp ? { price_tp: tpVal } : {}),
            };

            if (kind === 'pending-order') {
                const priceVal = parseFloat(priceStr) || 0;
                if (!(priceVal > 0)) {
                    setError('Enter a valid order price');
                    setIsSubmitting(false);
                    return;
                }
                const expiryVal = Number.parseInt(expiryStr.trim(), 10);
                await api.orders.modifyPendingOrder(position.id, {
                    price: priceVal,
                    price_sl: slVal,
                    price_tp: tpVal,
                    ...(Number.isFinite(expiryVal) && expiryVal > 0 ? { expiry: expiryVal } : {}),
                });
                // Refresh the pending list from the backend (the positions
                // patch below does not apply to pending rows).
                try {
                    const loginId = Number.parseInt(String(useAppStore.getState().accountId ?? ''), 10);
                    if (Number.isFinite(loginId) && loginId > 0) {
                        const latest = await api.orders.getPendingOrders(loginId);
                        useAppStore.getState().setOrders(latest as unknown as Parameters<ReturnType<typeof useAppStore.getState>['setOrders']>[0]);
                    }
                } catch {
                    // The success message stands; the next poll refreshes.
                }
            } else {
                await api.positions.modifyPosition(position.id, { ...levelChanges, comment: nextComment });
            }

            if (!isCurrentDialogSession(mutationContext)) return;
            setSuccessMessage(kind === 'pending-order' ? 'Pending order modified successfully' : 'Position modified successfully');
            const store = useAppStore.getState();
            store.setPositions(store.positions.map(p =>
                p.id === position.id ? {
                    ...p,
                    ...(levelChanges.price_sl !== undefined
                        ? { sl: slVal, price_sl: slVal, stopLoss: slVal, stop_loss: slVal } : {}),
                    ...(levelChanges.price_tp !== undefined
                        ? { tp: tpVal, price_tp: tpVal, takeProfit: tpVal, take_profit: tpVal } : {}),
                    comment: nextComment,
                } : p
            ));
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new Event('rtx:force-refresh-positions'));
            }
            const latest = store.positions.find(p => p.id === position.id);
            const savedSl = levelChanges.price_sl ?? latest?.sl ?? position.sl;
            const savedTp = levelChanges.price_tp ?? latest?.tp ?? position.tp;
            scheduleClose(mutationContext, () => onCloseRef.current(savedSl, savedTp, nextComment));
        } catch (err: unknown) {
            if (!isCurrentDialogSession(mutationContext)) return;
            console.error('[Modify] Error:', err);
            // Name the offending level against the live quote when the
            // server refused the geometry (never a bare failure message).
            const refusal = kind === 'position' ? describeProtectionRefusal(err, {
                side: String(position.side).toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
                sl: slVal,
                tp: tpVal,
                bid: Number((tick as { bid?: unknown } | null)?.bid) || 0,
                ask: Number((tick as { ask?: unknown } | null)?.ask) || 0,
                digits: specDigits,
            }) : null;
            setError(refusal ?? getErrorMessage(err));
        } finally {
            if (isCurrentDialogSession(mutationContext)) {
                setIsSubmitting(false);
            }
        }
    };

    const parsedVolume = Number.parseFloat(volumeStr);
    const actionVolume = Number.isFinite(parsedVolume) && parsedVolume > 0 ? parsedVolume : 0;
    // Validated-only close label: an invalid volume disables the button
    // (submit guards the same conditions with messages).
    const closeVolumeInvalid = actionVolume <= 0 || actionVolume > position.volume + 0.0000001;
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
        const mutationContext = getCurrentMutationContext();
        if (!mutationContext) return;
        const intentAtMs = captureTradeOrderIntent();
        if (actionVolume <= 0) {
            setError('Volume must be greater than zero');
            return;
        }

        setIsSubmitting(true);
        setError(null);
        setSuccessMessage(null);

        try {
            const slVal = roundProtectionLevel(Number.parseFloat(sl) || 0);
            const tpVal = roundProtectionLevel(Number.parseFloat(tp) || 0);
            await api.orders.placeMarketOrder({
                symbol: position.symbol,
                side,
                volume: actionVolume,
                price_sl: slVal > 0 ? slVal : undefined,
                price_tp: tpVal > 0 ? tpVal : undefined,
                comment: comment.trim() || undefined,
            }, { intentAtMs });
            if (!isCurrentDialogSession(mutationContext)) return;
            setSuccessMessage(`${side === 'BUY' ? 'Buy' : 'Sell'} market order placed successfully`);
            refreshPositionsAfterTrade();
            scheduleClose(mutationContext, () => onCloseRef.current());
        } catch (err: unknown) {
            if (!isCurrentDialogSession(mutationContext)) return;
            console.error('[Market Order] Error:', err);
            setError(getErrorMessage(err));
        } finally {
            if (isCurrentDialogSession(mutationContext)) {
                setIsSubmitting(false);
            }
        }
    };

    const handleCloseByMarket = async () => {
        if (isSubmitting) return;
        const mutationContext = getCurrentMutationContext();
        if (!mutationContext) return;
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
        // The close endpoint takes a volume; a smaller volume is a partial close.
        const isPartialClose = Math.abs(actionVolume - position.volume) > 0.0000001;

        setIsSubmitting(true);
        setError(null);
        setSuccessMessage(null);

        try {
            if (onClosePosition && !isPartialClose) {
                const closeOperation = Promise.resolve(onClosePosition(position.id));
                // The shared coordinator removes the pending row immediately
                // and owns failure feedback/rollback, so this dialog need not
                // wait on the broker round trip before leaving the workspace.
                onCloseRef.current();
                await closeOperation;
                return;
            }
            await api.positions.closePosition(String(position.id), isPartialClose ? { volume: actionVolume } : undefined);
            if (!isCurrentDialogSession(mutationContext)) return;
            if (!isPartialClose) {
                const store = useAppStore.getState();
                store.setPositions(store.positions.filter(p => p.id !== position.id), { closedTickets: [position.id] });
                refreshPositionsAfterTrade();
            } else {
                // A partial close already has an authoritative response. Patch
                // the displayed volume locally instead of forcing a full
                // positions/account/metrics refresh before confirmation.
                const remainingVolume = Math.max(0, Math.round((position.volume - actionVolume) * 1e8) / 1e8);
                const store = useAppStore.getState();
                store.setPositions(store.positions.map((p) => (
                    p.id === position.id ? { ...p, volume: remainingVolume } : p
                )));
            }
            setSuccessMessage(isPartialClose ? `Closed ${actionVolume} of #${position.id}` : 'Position closed successfully');
            onCloseRef.current();
        } catch (err: unknown) {
            if (!isCurrentDialogSession(mutationContext)) return;
            console.error('[Close by Market] Error:', err);
            setError(getErrorMessage(err));
        } finally {
            if (isCurrentDialogSession(mutationContext)) {
                setIsSubmitting(false);
            }
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
                title={tr(label)}
                aria-label={tr(label)}
                aria-pressed={active}
                className="rtx-modify-tool-btn"
            >
                {icon}
            </button>
        );
    };

    const renderMiniChartToolbar = () => (
        <div className="rtx-modify-chart-toolbar">
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
            <div className="rtx-modify-tool-divider" />
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
            <div className="rtx-modify-tool-divider" />
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
            <div className="rtx-modify-tool-zoom">
                {MINI_CHART_ZOOM_LEVELS[miniChartZoomIndex].toFixed(2)}x
            </div>
        </div>
    );

    const renderMiniMarketDepth = () => {
        const { asks, bids } = buildMiniMarketDepthLevels(bid, ask, actionVolume || position.volume, digits);
        const spreadPoints = spreadPointsLabel;

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
                    className={`rtx-modify-depth-row rtx-modify-depth-row--${isAsk ? 'ask' : 'bid'}${level.isBest ? ' rtx-modify-depth-row--best' : ''} grid h-[19px] grid-cols-[58px_minmax(0,1fr)_28px] border-b border-[#29344a] text-[14px] font-normal ${rowBackground}`}
                >
                    <div className="rtx-modify-depth-volume relative flex min-w-0 items-center justify-end overflow-hidden border-r border-[#29344a] pr-1 font-mono text-[#d7e2f2]">
                        <div
                            className="rtx-modify-depth-bar absolute inset-y-0 left-0"
                            style={{ width: `${level.intensity}%`, backgroundColor: barColor }}
                        />
                        <span className="relative z-10">{level.volume.toFixed(2)}</span>
                    </div>
                    <div className={`rtx-modify-depth-price flex min-w-0 items-center justify-end border-r border-[#29344a] pr-1.5 font-mono ${textColor}`}>
                        {fmtPrice(level.price)}
                    </div>
                    <div className="flex items-center justify-center">
                        <button
                            type="button"
                            className={`rtx-modify-depth-action flex h-[16px] w-[18px] items-center justify-center border bg-[#162030] ${tradeBorder}`}
                            title={tr("Use the Sell or Buy by Market buttons to trade")}
                            aria-label={tr("{{value0}} depth level {{value1}}", { value0: level.side === 'ASK' ? 'Ask' : 'Bid', value1: fmtPrice(level.price) })}
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
                aria-label={tr("{{value0}} market depth", { value0: position.symbol })}
                className="rtx-modify-depth flex h-full min-h-0 flex-col overflow-hidden border border-[#334057] bg-[#0d1420]"
            >
                <div className="rtx-modify-depth-header grid h-[24px] shrink-0 grid-cols-[58px_minmax(0,1fr)_28px] border-b border-[#334057] bg-[#121b2a] text-[12px] font-normal text-[#b8c4d6]">
                    <div className="flex items-center justify-center border-r border-[#334057]">{tr("Volume")}</div>
                    <div className="flex items-center justify-center border-r border-[#334057]">{tr("Price")}</div>
                    <div className="flex items-center justify-center">{tr("Trade")}</div>
                </div>
                <div className="flex-1 overflow-hidden">
                    <div className="rtx-modify-depth-empty h-[18px] border-b border-[#29344a] bg-[#0d1420]" />
                    {asks.map(renderDepthLevel)}
                    <div className="rtx-modify-depth-spread flex h-[22px] items-center justify-center border-y border-[#3d4b64] bg-[#111827] font-mono text-[12px] font-normal text-[#8fa2bd]">
                        {tr("Spread ")}{spreadPoints}
                    </div>
                    {bids.map(renderDepthLevel)}
                    <div className="rtx-modify-depth-empty h-[18px] border-b border-[#29344a] bg-[#0d1420]" />
                    <div className="rtx-modify-depth-empty h-[18px] border-b border-[#29344a] bg-[#0d1420]" />
                    <div className="rtx-modify-depth-empty h-[18px] border-b border-[#29344a] bg-[#0d1420]" />
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
        let rawMin = Math.min(...allPrices);
        let rawMax = Math.max(...allPrices);
        // Display scaling only: broker step when known; unknown precision
        // scales by the live spread / quote magnitude (never a guessed digit).
        const priceStep = digits !== null
            ? Math.pow(10, -digits)
            : Math.max(ask - bid, Math.abs(ask || bid) * 1e-6, Number.EPSILON);
        const observedRange = rawMax - rawMin;
        const currentSpread = Math.max(priceStep, ask - bid);
        const minimumRange = Math.max(priceStep * 10, currentSpread * 3.2);
        if (observedRange < minimumRange) {
            const midpoint = (rawMax + rawMin) / 2;
            rawMin = midpoint - minimumRange / 2;
            rawMax = midpoint + minimumRange / 2;
        }
        const rangePadding = Math.max((rawMax - rawMin) * 0.12, priceStep * 4);
        const min = rawMin - rangePadding;
        const max = rawMax + rangePadding;
        const range = max - min || 1;

        const w = Math.max(220, chartDimensions.width);
        const h = Math.max(180, chartDimensions.height);
        const plotLeft = 6;
        const plotTop = 8;
        const samplePriceStr = fmtPrice(max);
        const tagWidth = Math.max(80, Math.round(samplePriceStr.length * 8.2) + 16);
        const plotRight = Math.max(plotLeft + 60, w - tagWidth - 8);
        const plotBottom = Math.max(plotTop + 60, h - 28);
        const plotWidth = plotRight - plotLeft;
        const plotHeight = plotBottom - plotTop;
        const timeAxisY = h - 9;
        const tagX = plotRight + 4;
        const tagHeight = 22;
        const minTagY = plotTop + 1;
        const maxTagY = plotBottom - tagHeight - 1;
        const gridFractions = [0, 0.25, 0.5, 0.75, 1];
        const timeFractions = [0, 0.5, 1];
        const chartBackground = 'var(--modify-chart-background, #101216)';
        const plotBackground = 'var(--modify-chart-plot, #0c0e12)';
        const gridColor = 'var(--modify-chart-grid, #222632)';
        const axisColor = 'var(--modify-chart-text, #cbd2dc)';
        const axisBg = 'var(--modify-chart-axis, #121519)';
        const borderColor = 'var(--modify-chart-border, #252932)';
        const tickColor = 'var(--modify-chart-tick, #3b4049)';
        const askColor = 'var(--modify-chart-ask, #ff5b6b)';
        const bidColor = 'var(--modify-chart-bid, #00d2ff)';

        const toPath = (data: number[]) => {
            return data.map((v, i) => {
                const x = plotLeft + (i / (data.length - 1)) * plotWidth;
                const y = plotBottom - ((v - min) / range) * plotHeight;
                return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(' ');
        };

        const toSpreadBandPath = (asks: number[], bids: number[]) => {
            if (asks.length === 0 || bids.length === 0) return '';
            const n = Math.min(asks.length, bids.length);
            const askPoints = asks.slice(0, n).map((v, i) => {
                const x = plotLeft + (i / (n - 1)) * plotWidth;
                const y = plotBottom - ((v - min) / range) * plotHeight;
                return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(' ');
            const bidReversePoints = bids.slice(0, n).reverse().map((v, i) => {
                const origIndex = n - 1 - i;
                const x = plotLeft + (origIndex / (n - 1)) * plotWidth;
                const y = plotBottom - ((v - min) / range) * plotHeight;
                return `L${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(' ');
            return `${askPoints} ${bidReversePoints} Z`;
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
        ) => {
            const centerY = tagY + tagHeight / 2;
            const arrowTipX = plotRight;
            const arrowBaseX = tagX;
            return (
                <g key={fill}>
                    {Math.abs(centerY - y) > 3 && (
                        <line x1={plotRight} y1={y} x2={arrowBaseX} y2={centerY} stroke={fill} strokeWidth="1" strokeOpacity="0.7" strokeDasharray="2 2" />
                    )}
                    <polygon
                        points={`${arrowTipX},${y} ${arrowBaseX},${clamp(y - 4, tagY + 1, tagY + tagHeight - 1)} ${arrowBaseX},${clamp(y + 4, tagY + 1, tagY + tagHeight - 1)}`}
                        fill={fill}
                    />
                    <rect x={tagX} y={tagY} width={tagWidth} height={tagHeight} rx={3} fill={fill} />
                    <text
                        x={tagX + tagWidth / 2}
                        y={tagY + 15}
                        fill={textColor}
                        fontSize="12"
                        fontWeight="700"
                        fontFamily="Consolas, monospace"
                        textAnchor="middle"
                    >
                        {tr(label)}
                    </text>
                </g>
            );
        };

        return (
            <svg
                width={w}
                height={h}
                viewBox={`0 0 ${w} ${h}`}
                className="h-full w-full"
                role="img"
                aria-label={tr("{{value0}} bid and ask tick chart", { value0: position.symbol })}
                preserveAspectRatio="none"
            >
                <defs>
                    <linearGradient id="rtx-spread-corridor-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={askColor} stopOpacity="0.22" />
                        <stop offset="100%" stopColor={bidColor} stopOpacity="0.16" />
                    </linearGradient>
                    <clipPath id="rtx-plot-clip">
                        <rect x={plotLeft} y={plotTop} width={plotWidth} height={plotHeight} />
                    </clipPath>
                </defs>

                <rect x={0} y={0} width={w} height={h} fill={chartBackground} />
                <rect x={plotLeft} y={plotTop} width={plotWidth} height={plotHeight} fill={plotBackground} stroke={borderColor} strokeWidth="1" rx={3} />

                {/* Right Axis Background */}
                <rect x={plotRight} y={plotTop} width={w - plotRight} height={plotHeight} fill={axisBg} />

                {/* Grid Lines */}
                {gridFractions.map(f => {
                    const y = plotTop + f * plotHeight;
                    const price = max - f * range;
                    return (
                        <g key={`price-${f}`}>
                            {showMiniChartGrid && (
                                <line x1={plotLeft} y1={y} x2={plotRight} y2={y} stroke={gridColor} strokeWidth="0.8" strokeDasharray="3 3" />
                            )}
                            <line x1={plotRight} y1={y} x2={plotRight + 4} y2={y} stroke={tickColor} strokeWidth="1" />
                            <text
                                x={plotRight + 6}
                                y={clamp(y + 4, plotTop + 12, plotBottom - 4)}
                                fill={axisColor}
                                fontSize="12"
                                fontWeight="600"
                                fontFamily="Consolas, monospace"
                            >
                                {fmtPrice(price)}
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
                            strokeWidth="0.8"
                            strokeDasharray="3 3"
                        />
                    );
                })}

                <line x1={plotRight} y1={plotTop} x2={plotRight} y2={plotBottom} stroke={borderColor} strokeWidth="1" />
                <line x1={plotLeft} y1={plotBottom} x2={plotRight} y2={plotBottom} stroke={borderColor} strokeWidth="1" />

                {/* Clipped curves & area fills */}
                <g clipPath="url(#rtx-plot-clip)">
                    {/* Clear, subtle Spread Corridor Band between Ask & Bid */}
                    <path d={toSpreadBandPath(effectiveAskData, effectiveBidData)} fill="url(#rtx-spread-corridor-grad)" />

                    {/* Reference Price Horizontal Dashed Lines */}
                    {showMiniChartPriceLines && (
                        <>
                            <line x1={plotLeft} y1={askY} x2={plotRight} y2={askY} stroke={askColor} strokeWidth="1.2" strokeDasharray="3 3" opacity="0.9" />
                            <line x1={plotLeft} y1={bidY} x2={plotRight} y2={bidY} stroke={bidColor} strokeWidth="1.2" strokeDasharray="3 3" opacity="0.9" />
                        </>
                    )}

                    {/* Price Curves */}
                    <path d={toPath(effectiveAskData)} fill="none" stroke={askColor} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d={toPath(effectiveBidData)} fill="none" stroke={bidColor} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />

                    {/* Live Current Tick Dots with soft glowing halo */}
                    <circle cx={plotRight} cy={askY} r="3.5" fill={askColor} />
                    <circle cx={plotRight} cy={askY} r="8" fill={askColor} fillOpacity="0.32" />
                    <circle cx={plotRight} cy={bidY} r="3.5" fill={bidColor} />
                    <circle cx={plotRight} cy={bidY} r="8" fill={bidColor} fillOpacity="0.32" />
                </g>

                {/* Price Tags on Right Axis */}
                {showMiniChartPriceLines && (
                    <>
                        {renderPriceTag(fmtPrice(ask), askY, askTagY, askColor)}
                        {renderPriceTag(fmtPrice(bid), bidY, bidTagY, bidColor)}
                    </>
                )}

                {/* Time Axis */}
                {timeFractions.map(f => {
                    const x = plotLeft + f * plotWidth;
                    const anchor = f === 0 ? 'start' : f === 1 ? 'end' : 'middle';
                    return (
                        <g key={`time-${f}`}>
                            <line x1={x} y1={plotBottom} x2={x} y2={plotBottom + 5} stroke={tickColor} strokeWidth="1" />
                            <text
                                x={x}
                                y={timeAxisY}
                                fill={axisColor}
                                fontSize="12"
                                fontWeight="600"
                                fontFamily="Consolas, monospace"
                                textAnchor={anchor}
                            >
                                {getAxisTime(f)}
                            </text>
                        </g>
                    );
                })}
            </svg>
        );
    };

    // Format the big price with last digits emphasized
    const formatBigPrice = (price: number, colorClass = '') => {
        const str = fmtPrice(price);
        const splitIdx = digits !== null && digits >= 2 ? str.length - 2 : Math.max(0, str.length - 1);
        const main = str.slice(0, splitIdx);
        const pips = str.slice(splitIdx);
        return (
            <span className={`font-mono ${colorClass}`}>
                <span>{main}</span>
                <strong>{pips}</strong>
            </span>
        );
    };

    // Calculate SL/TP in points from current price
    // Points math needs real digits; unknown precision shows 0 and disables
    // the points inputs (the price inputs stay usable; submit sends raw).
    const pointsDigitsKnown = digits !== null;
    const slPoints = pointsDigitsKnown && sl && parseFloat(sl) > 0
        ? Math.abs(Math.round((parseFloat(sl) - (position.side === 'BUY' ? bid : ask)) * Math.pow(10, digits as number)))
        : 0;
    const tpPoints = pointsDigitsKnown && tp && parseFloat(tp) > 0
        ? Math.abs(Math.round((parseFloat(tp) - (position.side === 'BUY' ? ask : bid)) * Math.pow(10, digits as number)))
        : 0;

    // Update SL/TP from points input
    const handleSlPointsChange = (points: number) => {
        if (points <= 0) { setSl(''); return; }
        if (digits === null) return;
        const step = Math.pow(10, -digits);
        const ref = position.side === 'BUY' ? bid : ask;
        const val = position.side === 'BUY' ? ref - points * step : ref + points * step;
        setSl(fmtPrice(val));
    };

    const handleTpPointsChange = (points: number) => {
        if (points <= 0) { setTp(''); return; }
        if (digits === null) return;
        const step = Math.pow(10, -digits);
        const ref = position.side === 'BUY' ? ask : bid;
        const val = position.side === 'BUY' ? ref + points * step : ref - points * step;
        setTp(fmtPrice(val));
    };

    if (typeof document === 'undefined') return null;

    const dialogWidthClass = showMiniMarketDepth ? 'w-[980px]' : 'w-[880px]';
    const chartPanelWidthClass = showMiniMarketDepth ? 'w-[520px]' : 'w-[450px]';

    return createPortal(
        <div className="rtx-modify-overlay sm:p-4">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={dialogTitleId}
                tabIndex={-1}
                className={`rtx-modify-dialog ${dialogWidthClass}`}
            >
                {/* Title Bar */}
                <div className="rtx-modify-header">
                    <div className="rtx-modify-title-group">
                        <span id={dialogTitleId} className="rtx-modify-title text-[14px] font-normal">
                            {tr("Position: #")}{position.id}
                        </span>
                        <span className={`rtx-modify-badge-side ${position.side === 'SELL' ? 'rtx-modify-badge-side--sell' : 'rtx-modify-badge-side--buy'}`}>
                            {position.side}
                        </span>
                        <span className="rtx-modify-meta-detail">
                            {position.volume.toFixed(2)} {position.symbol} @ {fmtPrice(position.openPrice)}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={() => onClose()}
                        className="rtx-modify-close-btn"
                        aria-label={tr("Close modify position dialog")}
                    >
                        <X size={16} strokeWidth={2} />
                    </button>
                </div>

                {/* Content */}
                <div className="rtx-modify-body">
                    {/* Left: Mini Chart */}
                    <div className={`rtx-modify-chart-panel ${chartPanelWidthClass}`}>
                        <div className="rtx-modify-chart-header">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="rtx-modify-chart-symbol">{position.symbol}</span>
                                <span className="rtx-modify-chart-badge">TICK</span>
                                <span className="rtx-modify-chart-spread-pill">
                                    {tr("Spread ")}{spreadPointsLabel} pts
                                </span>
                            </div>
                            <div className="rtx-modify-chart-quote-pills">
                                <span className="rtx-modify-chart-quote--bid">{fmtPrice(bid)}</span>
                                <span className="rtx-modify-chart-quote-separator text-[#555a64]">/</span>
                                <span className="rtx-modify-chart-quote--ask">{fmtPrice(ask)}</span>
                            </div>
                        </div>
                        {renderMiniChartToolbar()}
                        <div className="rtx-modify-chart-canvas min-h-0 flex-1 bg-[#101216] p-0 flex flex-col items-stretch overflow-hidden">
                            {showMiniMarketDepth ? (
                                <div className={showMiniChart ? 'grid h-full min-h-0 grid-cols-[minmax(0,1fr)_154px] gap-1.5' : 'h-full'}>
                                    {showMiniChart && (
                                        <div ref={chartContainerRef} className="h-full min-h-0 w-full overflow-hidden">
                                            {renderMiniChart()}
                                        </div>
                                    )}
                                    {renderMiniMarketDepth()}
                                </div>
                            ) : (
                                showMiniChart ? (
                                    <div ref={chartContainerRef} className="h-full min-h-0 w-full overflow-hidden">
                                        {renderMiniChart()}
                                    </div>
                                ) : null
                            )}
                        </div>
                    </div>

                    {/* Right: Form */}
                    <div className="rtx-modify-form-panel">
                        {/* Symbol */}
                        <div className="rtx-modify-field-row">
                            <label htmlFor={symbolFieldId} className="rtx-modify-label text-[14px] font-normal">{tr("Symbol:")}</label>
                            <select
                                id={symbolFieldId}
                                value={position.symbol}
                                onChange={() => undefined}
                                className="rtx-modify-input"
                            >
                                <option value={position.symbol}>{getSymbolFullName(position.symbol)}</option>
                            </select>
                        </div>

                        {/* Type */}
                        <div className="rtx-modify-field-row">
                            <span id={typeLabelId} className="rtx-modify-label text-[14px] font-normal">{tr("Type:")}</span>
                            <div id={typeValueId} aria-labelledby={`${typeLabelId} ${typeValueId}`} className="rtx-modify-input rtx-modify-input--static">
                                {kind === 'pending-order' ? tr("Modify Pending Order") : tr("Modify Position")}
                            </div>
                        </div>

                        {/* Volume */}
                        <div className="rtx-modify-field-row">
                            <label htmlFor={volumeFieldId} className="rtx-modify-label text-[14px] font-normal">{tr("Volume:")}</label>
                            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                                <div className="rtx-modify-volume-compound">
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
                                        className="rtx-modify-volume-input"
                                    />
                                    <div className="rtx-modify-volume-stepper">
                                        <button
                                            type="button"
                                            onClick={() => adjustVolume(0.01)}
                                            className="rtx-modify-stepper-btn"
                                            aria-label={tr("Increase volume")}
                                        >
                                            <ChevronUp size={11} strokeWidth={2.5} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => adjustVolume(-0.01)}
                                            className="rtx-modify-stepper-btn"
                                            aria-label={tr("Decrease volume")}
                                        >
                                            <ChevronDown size={11} strokeWidth={2.5} />
                                        </button>
                                    </div>
                                </div>
                                <span className="rtx-modify-volume-desc text-[12px] font-normal">{volumeDescription}</span>
                            </div>
                        </div>

                        {/* Stop Loss with Points */}
                        <div className="rtx-modify-field-row">
                            <label htmlFor={slFieldId} className="rtx-modify-label rtx-modify-label--sl text-[14px] font-normal">
                                <span className="rtx-modify-label-dot--sl" aria-hidden="true" />
                                {tr("Stop Loss:")}
                            </label>
                            <div className="rtx-modify-points-group">
                                <input
                                    id={slFieldId}
                                    type="number"
                                    step={priceStepAttr}
                                    value={sl}
                                    onChange={(e) => setSl(e.target.value)}
                                    disabled={!hasProtectionReference}
                                    title={slViolation ?? (!hasProtectionReference ? tr("No live price is available to place this level") : undefined)}
                                    aria-invalid={slViolation ? true : undefined}
                                    className={`rtx-modify-input rtx-modify-input--mono rtx-modify-input--price${slViolation ? ' rtx-modify-input--invalid' : ''}`}
                                />
                                <input
                                    id={slPointsFieldId}
                                    aria-label={tr("Stop Loss points")}
                                    type="number"
                                    value={slPoints}
                                    onChange={(e) => handleSlPointsChange(parseInt(e.target.value) || 0)}
                                    disabled={!hasProtectionReference || !pointsDigitsKnown}
                                    title={!pointsDigitsKnown ? tr("Points need known symbol precision") : undefined}
                                    className="rtx-modify-input rtx-modify-input--mono rtx-modify-input--points"
                                />
                                <span className="rtx-modify-points-label text-[12px] font-normal">{tr("points")}</span>
                            </div>
                        </div>
                        {!hasProtectionReference && (
                            <div className="rtx-modify-alert rtx-modify-alert--error">
                                {tr("No live price is available to place Stop Loss or Take Profit levels")}
                            </div>
                        )}

                        {/* Take Profit with Points */}
                        <div className="rtx-modify-field-row">
                            <label htmlFor={tpFieldId} className="rtx-modify-label rtx-modify-label--tp text-[14px] font-normal">
                                <span className="rtx-modify-label-dot--tp" aria-hidden="true" />
                                {tr("Take Profit:")}
                            </label>
                            <div className="rtx-modify-points-group">
                                <input
                                    id={tpFieldId}
                                    type="number"
                                    step={priceStepAttr}
                                    value={tp}
                                    onChange={(e) => setTp(e.target.value)}
                                    disabled={!hasProtectionReference}
                                    title={tpViolation ?? (!hasProtectionReference ? tr("No live price is available to place this level") : undefined)}
                                    aria-invalid={tpViolation ? true : undefined}
                                    className={`rtx-modify-input rtx-modify-input--mono rtx-modify-input--price${tpViolation ? ' rtx-modify-input--invalid' : ''}`}
                                />
                                <input
                                    id={tpPointsFieldId}
                                    aria-label={tr("Take Profit points")}
                                    type="number"
                                    value={tpPoints}
                                    onChange={(e) => handleTpPointsChange(parseInt(e.target.value) || 0)}
                                    disabled={!hasProtectionReference || !pointsDigitsKnown}
                                    title={!pointsDigitsKnown ? tr("Points need known symbol precision") : undefined}
                                    className="rtx-modify-input rtx-modify-input--mono rtx-modify-input--points"
                                />
                                <span className="rtx-modify-points-label text-[12px] font-normal">{tr("points")}</span>
                            </div>
                        </div>

                        {kind === 'pending-order' && (
                            <>
                                {/* Entry Price (pending orders only) */}
                                <div className="rtx-modify-field-row">
                                    <label htmlFor={priceFieldId} className="rtx-modify-label text-[14px] font-normal">{tr("Price:")}</label>
                                    <input
                                        id={priceFieldId}
                                        type="number"
                                        step={priceStepAttr}
                                        value={priceStr}
                                        onChange={(e) => setPriceStr(e.target.value)}
                                        className="rtx-modify-input rtx-modify-input--mono rtx-modify-input--price"
                                    />
                                </div>

                                {/* Expiry, unix seconds, optional (pending orders only) */}
                                <div className="rtx-modify-field-row">
                                    <label htmlFor={expiryFieldId} className="rtx-modify-label text-[14px] font-normal">{tr("Expiry:")}</label>
                                    <input
                                        id={expiryFieldId}
                                        type="number"
                                        step="1"
                                        value={expiryStr}
                                        placeholder="Unix time, empty to keep"
                                        onChange={(e) => setExpiryStr(e.target.value)}
                                        className="rtx-modify-input rtx-modify-input--mono rtx-modify-input--price"
                                    />
                                </div>
                            </>
                        )}

                        {/* Comment */}
                        <div className="rtx-modify-field-row">
                            <label htmlFor={commentFieldId} className="rtx-modify-label text-[14px] font-normal">{tr("Comment:")}</label>
                            <input
                                id={commentFieldId}
                                type="text"
                                maxLength={64}
                                value={comment}
                                placeholder="Optional comment"
                                onChange={(e) => setComment(e.target.value)}
                                className="rtx-modify-input"
                            />
                        </div>

                        {/* Live Quote Strip */}
                        <div className="rtx-modify-quote-strip">
                            <div className="rtx-modify-quote-side">
                                <span className="rtx-modify-quote-tag rtx-modify-quote-tag--bid">SELL / BID</span>
                                <div className="rtx-modify-quote-price rtx-modify-quote-price--bid">
                                    {formatBigPrice(bid)}
                                </div>
                            </div>
                            <div className="rtx-modify-quote-spread">
                                {tr("Spread ")}{spreadPointsLabel} pts
                            </div>
                            <div className="rtx-modify-quote-side rtx-modify-quote-side--ask">
                                <span className="rtx-modify-quote-tag rtx-modify-quote-tag--ask">BUY / ASK</span>
                                <div className="rtx-modify-quote-price rtx-modify-quote-price--ask">
                                    {formatBigPrice(ask)}
                                </div>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="rtx-modify-actions-stack">
                            {/* Modify Button */}
                            <button
                                type="button"
                                onClick={handleSubmit}
                                disabled={isSubmitting}
                                className="rtx-modify-btn--submit"
                            >
                                {isSubmitting ? tr("Processing...") : tr("Modify #{{value0}} {{value1}} {{value2}} {{value3}} {{value4}}", { value0: position.id, value1: position.side.toLowerCase(), value2: position.volume.toFixed(2), value3: position.symbol, value4: fmtPrice(position.openPrice) })}
                            </button>

                            {kind === 'position' && (
                                <>
                                    <div className="rtx-modify-market-grid">
                                        <button
                                            type="button"
                                            onClick={() => handleMarketOrder('SELL')}
                                            disabled={isSubmitting || bid <= 0}
                                            className="rtx-modify-btn--market rtx-modify-btn--sell"
                                        >
                                            {tr("Sell by Market")}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleMarketOrder('BUY')}
                                            disabled={isSubmitting || ask <= 0}
                                            className="rtx-modify-btn--market rtx-modify-btn--buy"
                                        >
                                            {tr("Buy by Market")}
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleCloseByMarket}
                                        disabled={isSubmitting || closeVolumeInvalid}
                                        title={closeVolumeInvalid ? tr("Enter a valid close volume first") : undefined}
                                        className="rtx-modify-btn--close"
                                    >
                                        {tr("Close #")}{position.id} {position.side.toLowerCase()} {(actionVolume > 0 ? actionVolume : position.volume).toFixed(2)} {position.symbol} {fmtPrice(position.openPrice)} {tr(" by Market")}
                                    </button>
                                </>
                            )}
                        </div>

                        {/* Error / Success */}
                        {error && (
                            <div className="rtx-modify-alert rtx-modify-alert--error">
                                {error}
                            </div>
                        )}
                        {successMessage && (
                            <div className="rtx-modify-alert rtx-modify-alert--success">
                                {successMessage}
                            </div>
                        )}

                        {/* Information Note */}
                        <div className="rtx-modify-notice">
                            <Info size={14} className="rtx-modify-notice-icon" aria-hidden="true" />
                            <div className="rtx-modify-notice-text">
                                <div className="rtx-modify-notice-helper text-[#737882] text-[12px] font-normal">{tr("Stops processing is performed on the broker side.")}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
import { isShortcutOwnedBy, shouldIgnoreShortcutEvent } from '../services/keyboardShortcutManager';

import { useUiTranslation } from '../hooks/useUiTranslation';
/**
 * MT5-Style One-Click Trading Panel
 * Premium compact overlay — exact MT5 replica with Red SELL / Blue BUY
 * Toggled by Alt+T, sits on top-left of chart
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useAppStore, type Position } from '../store/useAppStore';
import { useLastSymbolStore } from '../store/useLastSymbolStore';
import api from '../services/api';
import { getTradeEntryPriceFromQuote } from '../services/chartPriceGuards';
import { captureTradeOrderIntent } from '../services/orderLatencyTelemetry';
import { resolvePositionOpenTime } from '../services/tradePositionTime';
import {
    createUnavailableMarketStatus,
    getMarketStatusTradeBlockMessage,
    shouldBlockSymbolTrading,
    type NormalizedMarketStatus,
} from '../utils/marketStatus';
import { resolveSpecDigits } from '../utils/symbolUtils';
import { resolveMarketWatchPriceDigits } from './market-watch/marketWatchPanelModel';
import { formatOrderError, isStaleOrderError } from '../utils/orderError';
import { refreshHistoryAfterFill } from '../app/trading/tradeHistoryFreshness';
import { TradeUnavailableDialog } from './TradeUnavailableDialog';
import {
    formatTradeVolume,
    isTradeVolumeDraftSyntax,
    isTradeVolumeValid,
    normalizeTradeVolume,
    parseTradeVolumeDraft,
    resolveTradeVolumeConstraints,
} from '../utils/tradeVolume';
import { formatPriceParts } from './ui/PriceDisplay';
import { resolveExactBrokerSymbolValue } from '../utils/exactBrokerSymbol';
import { getCommittedBrokerAccountSessionScope, getCommittedBrokerAccountSessionScopeKey } from '../services/brokerSession';
import { resolveDefaultTradeVolume, useSettingsStore } from '../store/useSettingsStore';
import './OneClickTrading.css';
import { hasAuthenticatedTradingSession, requireTradingAuth } from '../services/tradingAuthGate';

interface OneClickTradingProps {
    symbol: string;
    visible: boolean;
    timeframe: string;
    tradeAllowed?: boolean;
    marketStatus?: NormalizedMarketStatus;
    priceDigits?: number;
    minVolume?: number;
    maxVolume?: number;
    volumeStep?: number;
}

type LooseRecord = Record<string, unknown>;

const toNumber = (value: unknown, fallback = 0): number => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
};

const pickPositiveOpenPrice = (...values: unknown[]): number => {
    for (const value of values) {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 0) return numeric;
    }
    return 0;
};

const normalizeImmediatePosition = (
    raw: unknown,
    fallback: {
        symbol: string;
        side: 'BUY' | 'SELL';
        volume: number;
        chartEntryPrice?: number;
        chartEntryTime: string;
    },
): Position | null => {
    const record = raw && typeof raw === 'object' ? raw as LooseRecord : {};
    const id = Number.parseInt(String(record.ticket ?? record.id ?? ''), 10);
    if (!Number.isFinite(id) || id <= 0) return null;

    const openPrice = pickPositiveOpenPrice(
        record.price_open,
        record.open_price,
        record.openPrice,
        record.fill_price,
        record.price,
        fallback.chartEntryPrice,
    );
    const currentPrice = toNumber(record.price_current ?? record.current_price ?? record.currentPrice, openPrice);
    const rawSide = String(record.side ?? fallback.side).toLowerCase();

    return {
        id,
        symbol: String(record.symbol ?? fallback.symbol),
        side: rawSide === 'sell' || rawSide === 'short' ? 'SELL' : 'BUY',
        volume: toNumber(record.volume ?? record.quantity, fallback.volume),
        openPrice,
        currentPrice,
        openTime: resolvePositionOpenTime(record, fallback.chartEntryTime),
        sl: toNumber(record.price_sl ?? record.sl, 0),
        tp: toNumber(record.price_tp ?? record.tp, 0),
        swap: toNumber(record.swap, 0),
        commission: toNumber(record.commission, 0),
        unrealizedPnL: toNumber(record.profit ?? record.unrealized_pl ?? record.unrealizedPnL, 0),
        chartEntryPrice: fallback.chartEntryPrice,
        chartEntryTime: fallback.chartEntryTime,
    };
};

const upsertImmediatePosition = (position: Position) => {
    const store = useAppStore.getState();
    const existingIndex = store.positions.findIndex((existing) => existing.id === position.id);
    const nextPositions = existingIndex >= 0
        ? store.positions.map((existing, index) => index === existingIndex ? { ...existing, ...position } : existing)
        : [position, ...store.positions];

    store.setPositions(nextPositions, { touchedTickets: [position.id] });
};

export const OneClickTrading: React.FC<OneClickTradingProps> = ({
    symbol,
    visible,
    tradeAllowed = false,
    marketStatus,
    priceDigits,
    minVolume,
    maxVolume,
    volumeStep,
}) => {
    const tr = useUiTranslation();
    const volumeConstraints = useMemo(() => resolveTradeVolumeConstraints({
        minVolume,
        maxVolume,
        volumeStep,
    }), [maxVolume, minVolume, volumeStep]);
    // FIX: Keep the user's editable text separate from the executable number.
    // A numeric-only controlled state rejected the temporary empty value needed
    // to replace 0.01, so the leading zero was restored before typing 1 or more.
    // SUI-T8: seed the lot input from the Options trade defaults (`default`
    // mode uses the configured default volume, `last-used` prefers the ticket's
    // last lot size), clamped to this symbol's broker lot grid.
    const settingsDefaultVolume = useSettingsStore((state) => state.trade.defaultVolume);
    const settingsDefaultVolumeMode = useSettingsStore((state) => state.trade.defaultVolumeMode);
    const [volumeDraft, setVolumeDraft] = useState(() => {
        let lastUsedVolume: unknown;
        try {
            lastUsedVolume = localStorage.getItem('lastLotSize');
        } catch {
            lastUsedVolume = undefined;
        }
        return formatTradeVolume(
            normalizeTradeVolume(
                resolveDefaultTradeVolume(useSettingsStore.getState().trade, {
                    lastUsedVolume,
                    emptyVolumeSeed: volumeConstraints.min,
                }),
                volumeConstraints,
            ),
            volumeConstraints,
        );
    });
    useEffect(() => {
        if (settingsDefaultVolumeMode !== 'default') return;
        setVolumeDraft(formatTradeVolume(
            normalizeTradeVolume(
                resolveDefaultTradeVolume(useSettingsStore.getState().trade),
                volumeConstraints,
            ),
            volumeConstraints,
        ));
    }, [settingsDefaultVolumeMode, settingsDefaultVolume, volumeConstraints]);
    const [flashSide, setFlashSide] = useState<'buy' | 'sell' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
    useEffect(() => { setBlockedMessage(null); setError(null); }, [symbol]);
    const prevBidRef = useRef<number>(0);
    const prevAskRef = useRef<number>(0);
    const panelRef = useRef<HTMLDivElement>(null);
    const [compact, setCompact] = useState(false);
    useEffect(() => {
        const parent = panelRef.current?.parentElement;
        if (!parent || !visible) return;
        const update = (width: number) => {
            if (width > 0) setCompact(width < 390);
        };
        update(parent.getBoundingClientRect().width);
        if (typeof ResizeObserver === 'undefined') {
            const onResize = () => update(parent.getBoundingClientRect().width);
            window.addEventListener('resize', onResize);
            return () => window.removeEventListener('resize', onResize);
        }
        const observer = new ResizeObserver(entries => {
            const entry = entries.find(item => item.target === parent);
            if (entry) update(entry.contentRect.width);
        });
        observer.observe(parent);
        return () => observer.disconnect();
    }, [visible, symbol]);
    const authIdentity = useAppStore((state) => `${state.isAuthenticated}:${state.accountId}:${state.authToken}`);
    const hasTradingSession = Boolean(authIdentity) && hasAuthenticatedTradingSession();

    // FIX: Broker symbols are opaque execution identities. Exact lookup avoids
    // trading EURUSD.r/XAUUSD.raw with a similarly named instrument's quote.
    const tick = useAppStore((s) => {
        return resolveExactBrokerSymbolValue(s.ticks, symbol) ?? null;
    });
    const bid = tick?.bid || 0;
    const ask = tick?.ask || 0;
    const accountId = useAppStore((s) => s.accountId);
    const isAuthenticated = useAppStore((s) => s.isAuthenticated);

    // Track price direction for color flash
    const [bidFlash, setBidFlash] = useState<'up' | 'down' | ''>('');
    const [askFlash, setAskFlash] = useState<'up' | 'down' | ''>('');
    // MT5 colors each side by its own last tick direction (blue = up, red =
    // down) and the color persists until the next tick — unlike the transient
    // *Flash states above, which clear after 350ms.
    const [bidDir, setBidDir] = useState<'up' | 'down'>('up');
    const [askDir, setAskDir] = useState<'up' | 'down'>('up');

    useEffect(() => {
        if (prevBidRef.current && bid !== prevBidRef.current) {
            const dir = bid > prevBidRef.current ? 'up' : 'down';
            setBidFlash(dir);
            setBidDir(dir);
            const t = setTimeout(() => setBidFlash(''), 350);
            prevBidRef.current = bid;
            return () => clearTimeout(t);
        }
        prevBidRef.current = bid;
    }, [bid]);

    useEffect(() => {
        if (prevAskRef.current && ask !== prevAskRef.current) {
            const dir = ask > prevAskRef.current ? 'up' : 'down';
            setAskFlash(dir);
            setAskDir(dir);
            const t = setTimeout(() => setAskFlash(''), 350);
            prevAskRef.current = ask;
            return () => clearTimeout(t);
        }
        prevAskRef.current = ask;
    }, [ask]);

    const [isAdvancedMode, setIsAdvancedMode] = useState(false);
    useEffect(() => {
        const root = document.documentElement;
        const check = () => setIsAdvancedMode(root.classList.contains('rtx-advanced-view'));
        check();
        const obs = new MutationObserver(check);
        obs.observe(root, { attributes: true, attributeFilter: ['class'] });
        return () => obs.disconnect();
    }, []);

    // Spec digits from chart/catalog/tick; unknown precision renders raw downstream.
    const digits = resolveMarketWatchPriceDigits(symbol, resolveSpecDigits(priceDigits), tick?.digits, bid, ask);

    const formatPrice = useCallback((price: number, d: number | null) => {
        const parts = formatPriceParts(price, symbol, d ?? undefined);
        return { ...parts, pip: '' };
    }, [symbol]);

    const getAccountLogin = useCallback((): number => {
        const storeLogin = Number.parseInt(String(accountId || ''), 10);
        if (Number.isFinite(storeLogin) && storeLogin > 0) return storeLogin;
        const saved = localStorage.getItem('rtx_saved_username') || localStorage.getItem('rtx_last_login');
        const savedLogin = Number.parseInt(String(saved || ''), 10);
        return Number.isFinite(savedLogin) && savedLogin > 0 ? savedLogin : 0;
    }, [accountId]);

    useEffect(() => {
        // FIX: A chart symbol change may bring a different broker lot grid.
        // Re-commit the visible draft to that exact min/max/step contract.
        setVolumeDraft((currentDraft) => formatTradeVolume(
            parseTradeVolumeDraft(currentDraft) ?? volumeConstraints.min,
            volumeConstraints,
        ));
    }, [volumeConstraints]);

    const parsedVolumeDraft = parseTradeVolumeDraft(volumeDraft);
    const isVolumeValid = parsedVolumeDraft !== null
        && isTradeVolumeValid(parsedVolumeDraft, volumeConstraints);
    const volume = isVolumeValid
        ? normalizeTradeVolume(parsedVolumeDraft, volumeConstraints)
        : Number.NaN;
    const commitVolumeDraft = () => {
        setVolumeDraft(formatTradeVolume(
            parsedVolumeDraft ?? volumeConstraints.min,
            volumeConstraints,
        ));
    };
    const adjustVolume = (direction: -1 | 1) => {
        const baseVolume = parsedVolumeDraft === null
            ? volumeConstraints.min
            : normalizeTradeVolume(parsedVolumeDraft, volumeConstraints);
        setVolumeDraft(formatTradeVolume(
            baseVolume + direction * volumeConstraints.step,
            volumeConstraints,
        ));
    };
    const hasExecutablePrice = bid > 0 && ask > 0;
    const effectiveMarketStatus = marketStatus ?? createUnavailableMarketStatus(symbol);
    const marketBlockedMessage = effectiveMarketStatus.label;
    const marketOpenForTrading = !shouldBlockSymbolTrading(effectiveMarketStatus, symbol);
    const staleQuoteMessage = tr('Cannot place this trade because the quote for {{symbol}} is stale. Please wait for a fresh quote and try again.', { symbol });
    const canSubmitOrder = tradeAllowed && marketOpenForTrading && isVolumeValid && hasExecutablePrice;
    const tradeControlDisabled = hasTradingSession && !canSubmitOrder;
    const orderBlockedReason = !tradeAllowed
        ? hasExecutablePrice ? staleQuoteMessage : tr('No live quote is available for {{symbol}}. Please wait for a fresh quote and try again.', { symbol })
        : !marketOpenForTrading
            ? marketBlockedMessage
            : !isVolumeValid
                ? 'Invalid volume'
                : !hasExecutablePrice
                    ? 'Waiting for a valid bid/ask price'
                    : undefined;

    const placeOrder = useCallback(async (side: 'buy' | 'sell') => {
        if (!requireTradingAuth({
            source: 'one-click-trading',
            side: side.toUpperCase() as 'BUY' | 'SELL',
            symbol,
            volume,
            bid,
            ask,
        })) return;
        const intentAtMs = captureTradeOrderIntent();
        if (!isAuthenticated) {
            window.dispatchEvent(new Event('rtx:requestTradeLogin'));
            return;
        }
        if (!tradeAllowed) {
            setBlockedMessage(orderBlockedReason || staleQuoteMessage);
            return;
        }
        // The rendered status is already refreshed in the background. Never
        // put an HTTP market-status request in front of a one-click order;
        // the backend still performs the authoritative execution validation.
        if (!marketOpenForTrading) {
            setBlockedMessage(getMarketStatusTradeBlockMessage(effectiveMarketStatus, symbol));
            return;
        }
        if (!symbol.trim()) {
            setBlockedMessage(tr('Please select a symbol before placing a trade.'));
            return;
        }
        if (!isVolumeValid) {
            setBlockedMessage(tr('The volume is invalid. Check the lot size and try again.'));
            return;
        }
        if (!hasExecutablePrice) {
            setBlockedMessage(tr('No live quote is available for {{symbol}}. Please wait for a fresh quote and try again.', { symbol }));
            return;
        }
        if (!isAuthenticated) {
            setBlockedMessage(tr('Please sign in to place an order.'));
            return;
        }
        const login = getAccountLogin();
        if (!login) {
            setBlockedMessage(tr('No trading account is selected. Please sign in again.'));
            return;
        }
        const orderSessionScope = getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope());
        const ownsOrderSession = () => {
            const current = useAppStore.getState();
            return current.isAuthenticated && String(current.accountId) === String(login)
                && getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope()) === orderSessionScope;
        };
        try {
            const orderPromise = api.orders.placeMarketOrder({
                side,
                symbol,
                volume,
                login,
            }, { intentAtMs });
            // placeMarketOrder reaches the warm WebSocket's synchronous send()
            // before returning this Promise. Queue cosmetic React feedback only
            // afterwards so it cannot add work ahead of the order frame.
            // Do not lock BUY/SELL until this Promise reaches a terminal fill:
            // every deliberate click has its own UUID and pending-map entry, so
            // burst orders remain independently idempotent and correlated.
            setError(null);
            setFlashSide(side);
            const chartEntryPrice = getTradeEntryPriceFromQuote(tick, side.toUpperCase() as 'BUY' | 'SELL');
            const chartEntryTime = new Date().toISOString();
            const result = await orderPromise;
            if (!ownsOrderSession()) return;
            refreshHistoryAfterFill(login);
            // Concurrent clicks settle independently. If an earlier order was
            // rejected while this newer one was still executing, the newer
            // success must clear that stale banner immediately; it must never
            // leave BUY/SELL looking blocked after a confirmed fill.
            setError(null);
            const immediatePosition = normalizeImmediatePosition(result, {
                symbol,
                side: side.toUpperCase() as 'BUY' | 'SELL',
                volume,
                chartEntryPrice: chartEntryPrice ?? undefined,
                chartEntryTime,
            });
            if (immediatePosition) {
                upsertImmediatePosition(immediatePosition);
            }
            useLastSymbolStore.getState().setLastSymbol(symbol, side.toUpperCase() as 'BUY' | 'SELL');
            window.dispatchEvent(new Event('rtx:force-refresh-positions'));
        } catch (err: unknown) {
            if (!ownsOrderSession()) return;
            console.error('[OneClick] Trade failed:', err);
            setError(formatOrderError(err));
            if (isStaleOrderError(err)) setBlockedMessage(staleQuoteMessage);
            setTimeout(() => setError(null), 6000);
        } finally {
            setTimeout(() => setFlashSide(null), 500);
        }
    }, [isAuthenticated, tradeAllowed, marketOpenForTrading, effectiveMarketStatus, isVolumeValid, hasExecutablePrice, volume, symbol, getAccountLogin, tick, bid, ask, tr, orderBlockedReason, staleQuoteMessage]);

    if (!visible || !symbol) return null;

    const bidPrice = formatPrice(bid, digits);
    const askPrice = formatPrice(ask, digits);

    const btnWidth = isAdvancedMode ? 110 : 104;
    const btnHeight = 34;
    const centerWidth = isAdvancedMode ? 114 : 110;

    // Shared button style for BUY and SELL — identical structure
    const sharedButtonStyle: React.CSSProperties = {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '5px 10px',
        width: 'auto',
        minWidth: btnWidth,
        flexShrink: 0,
        height: btnHeight,
        minHeight: btnHeight,
        maxHeight: btnHeight,
        border: '1px solid rgba(255,255,255,0.1)',
        cursor: tradeControlDisabled ? 'not-allowed' : 'pointer',
        position: 'relative',
        opacity: 1,
        filter: tradeControlDisabled ? 'brightness(0.78) saturate(0.75)' : 'none',
        transition: 'background 150ms ease, filter 150ms ease',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
        boxSizing: 'border-box',
    };

    const renderTradeButton = (side: 'buy' | 'sell') => {
        const isBuy = side === 'buy';
        const price = isBuy ? askPrice : bidPrice;
        const priceText = `${price.small}${price.big}${price.pip}`;
        const priceFlash = isBuy ? askFlash : bidFlash;
        const priceFlashColor = priceFlash === 'down'
            ? '#ff6b6b'
            : isBuy ? '#6b9fff' : '#6bff6b';
        const restingBackground = isBuy
            ? '#0078D4'
            : 'linear-gradient(180deg, #dc2626 0%, #b91c1c 50%, #991b1b 100%)';
        const activeBackground = isBuy
            ? '#005A9E'
            : 'linear-gradient(180deg, #991b1b 0%, #7f1d1d 100%)';
        const hoverBackground = isBuy
            ? '#026EC1'
            : 'linear-gradient(180deg, #ef4444 0%, #dc2626 50%, #b91c1c 100%)';
        const label = isBuy ? 'BUY' : 'SELL';

        return (
            <button
                type="button"
                className="rtx-oct-trade-button"
                data-side={side}
                data-dir={isBuy ? askDir : bidDir}
                data-active={flashSide === side}
                onClick={() => placeOrder(side)}
                disabled={tradeControlDisabled}
                title={hasTradingSession ? tr(orderBlockedReason) : tr('Login required to trade')}
                aria-label={tr("{{value0}} {{value1}} at {{value2}}", { value0: tr(label), value1: symbol, value2: priceText })}
                style={{
                    ...sharedButtonStyle,
                    background: flashSide === side ? activeBackground : restingBackground,
                    borderRadius: 0,
                }}
                onMouseEnter={(event) => {
                    if (!flashSide) event.currentTarget.style.background = hoverBackground;
                }}
                onMouseLeave={(event) => {
                    if (!flashSide) event.currentTarget.style.background = restingBackground;
                }}
            >
                {isBuy && <span className="rtx-oct-side-label">{tr(label)}</span>}
                <span
                    className="rtx-oct-price"
                    style={{
                        textShadow: priceFlash
                            ? `0 0 8px ${priceFlashColor}`
                            : '0 1px 2px rgba(0,0,0,0.45)',
                    }}
                >
                    {priceText}
                </span>
                {!isBuy && <span className="rtx-oct-side-label">{tr(label)}</span>}
            </button>
        );
    };

    return (
        <div
            ref={panelRef}
            className="rtx-oct absolute top-[28px] left-[10px] z-30 select-none drop-shadow-2xl"
            data-compact={compact}
            style={{ pointerEvents: 'auto', fontFamily: 'var(--font-sans)', display: 'inline-block', width: compact ? 'calc(100% - 20px)' : 'fit-content', maxWidth: 'calc(100% - 20px)' }}
        >
            <div
                data-testid="one-click-trading-row"
                style={{
                    display: 'flex',
                    background: '#111827',
                    backdropFilter: 'none',
                    WebkitBackdropFilter: 'none',
                    border: '1px solid rgba(255,255,255,0.18)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 6px 20px rgba(0,0,0,0.42)',
                }}
            >
                {renderTradeButton('sell')}

                {/* ── Volume Control (Center) ── */}
                <div
                    className="rtx-oct-volume-control"
                    data-testid="one-click-volume-control"
                    style={{
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 3,
                        padding: 3,
                        width: centerWidth,
                        minWidth: centerWidth,
                        maxWidth: centerWidth,
                        height: btnHeight,
                        minHeight: btnHeight,
                        maxHeight: btnHeight,
                        background: 'linear-gradient(180deg, #1f2937 0%, #111827 100%)',
                        borderLeft: '1px solid rgba(255,255,255,0.22)',
                        borderRight: '1px solid rgba(255,255,255,0.22)',
                        boxSizing: 'border-box',
                    }}
                >
                    <button
                        type="button"
                        aria-label={tr("Decrease lot size")}
                        title={tr("Decrease lot size")}
                        data-at-min={!isVolumeValid || volume <= volumeConstraints.min}
                        onClick={() => adjustVolume(-1)}
                        style={{
                            background: 'none', border: 'none', color: '#b8c1d1', cursor: 'pointer',
                            width: 24, height: 28, minWidth: 24,
                            display: 'grid', placeItems: 'center', padding: 0,
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.color = '#ffffff'}
                        onMouseLeave={(e) => e.currentTarget.style.color = '#b8c1d1'}
                    >
                        <ChevronDown size={14} strokeWidth={2.5} aria-hidden="true" />
                    </button>
                    <input
                        className="rtx-oct-lot-input"
                        aria-label={tr("Lot size")}
                        type="text"
                        role="spinbutton"
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck={false}
                        aria-valuemin={volumeConstraints.min}
                        aria-valuemax={volumeConstraints.max}
                        aria-valuenow={isVolumeValid ? volume : undefined}
                        aria-invalid={!isVolumeValid}
                        value={volumeDraft}
                        onFocus={(event) => event.currentTarget.select()}
                        onChange={(e) => {
                            // FIX: Preserve empty and partial decimal drafts while
                            // the trader edits; validation happens on commit.
                            const nextDraft = e.currentTarget.value.replace(',', '.');
                            if (isTradeVolumeDraftSyntax(nextDraft)) {
                                setVolumeDraft(nextDraft);
                            }
                        }}
                        onBlur={commitVolumeDraft}
                        onKeyDown={(event) => {
                            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                                event.preventDefault();
                                adjustVolume(event.key === 'ArrowUp' ? 1 : -1);
                            } else if (event.key === 'Enter') {
                                event.preventDefault();
                                event.currentTarget.blur();
                            }
                        }}
                        style={{
                            width: 48, height: 24,
                            background: 'transparent',
                            border: 'none',
                            borderRadius: '0px',
                            appearance: 'none',
                            WebkitAppearance: 'none',
                            MozAppearance: 'textfield',
                            color: '#fff',
                            fontSize: 12,
                            fontFamily: 'monospace',
                            fontWeight: 700,
                            textAlign: 'center',
                            outline: 'none',
                            padding: 0,
                        }}
                    />
                    <button
                        type="button"
                        aria-label={tr("Increase lot size")}
                        title={tr("Increase lot size")}
                        onClick={() => adjustVolume(1)}
                        style={{
                            background: 'none', border: 'none', color: '#b8c1d1', cursor: 'pointer',
                            width: 24, height: 28, minWidth: 24,
                            display: 'grid', placeItems: 'center', padding: 0,
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.color = '#ffffff'}
                        onMouseLeave={(e) => e.currentTarget.style.color = '#b8c1d1'}
                    >
                        <ChevronUp size={14} strokeWidth={2.5} aria-hidden="true" />
                    </button>
                </div>

                {renderTradeButton('buy')}
            </div>

            {/* Invalid volume warning */}
            {!isVolumeValid && (
                <div style={{
                    fontSize: 10,
                    color: '#f87171',
                    textAlign: 'center',
                    padding: '3px 8px',
                    background: '#7f1d1d',
                    borderRadius: 0,
                    border: '1px solid #7f1d1d',
                    borderTop: 'none',
                }}>
                    {tr("⚠ Invalid volume (min ")}{formatTradeVolume(volumeConstraints.min, volumeConstraints)})
                </div>
            )}
            {tradeAllowed && marketOpenForTrading && !hasExecutablePrice && !error && (
                <div style={{
                    fontSize: 10,
                    color: '#fbbf24',
                    textAlign: 'center',
                    padding: '3px 8px',
                    background: '#78350f',
                    borderRadius: 0,
                    border: '1px solid rgba(245, 158, 11, 0.45)',
                    borderTop: 'none',
                }}>
                    {tr("Waiting for a valid bid/ask price")}</div>
            )}
            {tradeAllowed && !marketOpenForTrading && !error && (
                <div style={{
                    fontSize: 10,
                    color: '#fbbf24',
                    textAlign: 'center',
                    padding: '3px 8px',
                    background: '#78350f',
                    borderRadius: 0,
                    border: '1px solid rgba(245, 158, 11, 0.45)',
                    borderTop: 'none',
                }}>
                    {tr(marketBlockedMessage || effectiveMarketStatus.label)}
                </div>
            )}
            {blockedMessage && <TradeUnavailableDialog message={blockedMessage} onClose={() => setBlockedMessage(null)} />}
            {error && (
                <div style={{
                    fontSize: 10,
                    color: '#fecaca',
                    textAlign: 'center',
                    padding: '3px 8px',
                    background: '#7f1d1d',
                    borderRadius: 0,
                    border: '1px solid #7f1d1d',
                    borderTop: 'none',
                }}>
                    {tr(error)}
                </div>
            )}
        </div>
    );
};

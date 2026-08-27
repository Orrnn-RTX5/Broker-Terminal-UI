/**
 * MT5-Style One-Click Trading Panel
 * Premium compact overlay — exact MT5 replica with Red SELL / Blue BUY
 * Toggled by Alt+T, sits on top-left of chart
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useAppStore, type Position } from '../store/useAppStore';
import { useLastSymbolStore } from '../store/useLastSymbolStore';
import api from '../services/api';
import { getTradeEntryPriceFromQuote } from '../services/chartPriceGuards';
import { captureTradeOrderIntent } from '../services/orderLatencyTelemetry';
import { resolvePositionOpenTime } from '../services/tradePositionTime';
import {
    createUnavailableMarketStatus,
    shouldBlockSymbolTrading,
    type NormalizedMarketStatus,
} from '../utils/marketStatus';
import { getSymbolDigits } from '../utils/symbolUtils';
import { formatOrderError } from '../utils/orderError';
import { formatPriceParts } from './ui/PriceDisplay';

interface OneClickTradingProps {
    symbol: string;
    visible: boolean;
    timeframe: string;
    tradeAllowed?: boolean;
    marketStatus?: NormalizedMarketStatus;
}

type LooseRecord = Record<string, unknown>;

const toNumber = (value: unknown, fallback = 0): number => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
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

    const openPrice = toNumber(record.price_open ?? record.open_price ?? record.openPrice ?? record.price, fallback.chartEntryPrice ?? 0);
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

    store.setPositions(nextPositions);
};

export const OneClickTrading: React.FC<OneClickTradingProps> = ({ symbol, visible, timeframe, tradeAllowed = false, marketStatus }) => {
    const [volume, setVolume] = useState(0.01);
    const [flashSide, setFlashSide] = useState<'buy' | 'sell' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const prevBidRef = useRef<number>(0);
    const prevAskRef = useRef<number>(0);

    // Subscribe to live tick data for this symbol (with robust fallback matching)
    const tick = useAppStore((s) => {
        if (s.ticks[symbol]) return s.ticks[symbol];
        if (s.ticks[symbol.toUpperCase()]) return s.ticks[symbol.toUpperCase()];
        const normalized = symbol.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        const match = Object.keys(s.ticks).find(k =>
            k.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() === normalized
        );
        return match ? s.ticks[match] : null;
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

    const digits = tick?.digits || getSymbolDigits(symbol);

    const formatPrice = useCallback((price: number, d: number) => {
        const parts = formatPriceParts(price, symbol, d);
        return { ...parts, pip: '' };
    }, [symbol]);

    const getAccountLogin = useCallback((): number => {
        const storeLogin = Number.parseInt(String(accountId || ''), 10);
        if (Number.isFinite(storeLogin) && storeLogin > 0) return storeLogin;
        const saved = localStorage.getItem('rtx_saved_username') || localStorage.getItem('rtx_last_login');
        const savedLogin = Number.parseInt(String(saved || ''), 10);
        return Number.isFinite(savedLogin) && savedLogin > 0 ? savedLogin : 0;
    }, [accountId]);

    const isVolumeValid = Number.isFinite(volume) && volume > 0;
    const hasExecutablePrice = bid > 0 && ask > 0;
    const effectiveMarketStatus = marketStatus ?? createUnavailableMarketStatus(symbol);
    const marketBlockedMessage = 'Market Closed';
    const marketOpenForTrading = !shouldBlockSymbolTrading(effectiveMarketStatus, symbol);
    const canSubmitOrder = tradeAllowed && marketOpenForTrading && isVolumeValid && hasExecutablePrice;
    const orderBlockedReason = !tradeAllowed
        ? 'Live tradable quote unavailable - order not sent'
        : !marketOpenForTrading
            ? marketBlockedMessage
            : !isVolumeValid
                ? 'Invalid volume'
                : !hasExecutablePrice
                    ? 'Waiting for a valid bid/ask price'
                    : undefined;

    const placeOrder = useCallback(async (side: 'buy' | 'sell') => {
        const intentAtMs = captureTradeOrderIntent();
        if (!tradeAllowed) {
            setError('Trading is not enabled for this symbol');
            return;
        }
        // The rendered status is already refreshed in the background. Never
        // put an HTTP market-status request in front of a one-click order;
        // the backend still performs the authoritative execution validation.
        if (!marketOpenForTrading) {
            setError('Market Closed');
            return;
        }
        if (!symbol.trim()) {
            setError('Missing symbol');
            return;
        }
        if (!isVolumeValid) {
            setError('Volume must be greater than zero');
            return;
        }
        if (!hasExecutablePrice) {
            setError('Waiting for a valid bid/ask price');
            return;
        }
        if (!isAuthenticated) {
            setError('Please sign in to place an order.');
            return;
        }
        const login = getAccountLogin();
        if (!login) {
            setError('No trading account is selected. Please sign in again.');
            return;
        }
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
            console.error('[OneClick] Trade failed:', err);
            setError(formatOrderError(err));
            setTimeout(() => setError(null), 6000);
        } finally {
            setTimeout(() => setFlashSide(null), 500);
        }
    }, [isAuthenticated, tradeAllowed, marketOpenForTrading, isVolumeValid, hasExecutablePrice, volume, symbol, getAccountLogin, tick]);

    if (!visible || !symbol) return null;

    const bidPrice = formatPrice(bid, digits);
    const askPrice = formatPrice(ask, digits);

    // Symbol description for header
    const descriptions: Record<string, string> = {
        'BTCUSD': 'Bitcoin vs US Dollar',
        'ETHUSD': 'Ethereum vs US Dollar',
        'XAUUSD': 'Gold vs US Dollar',
        'EURUSD': 'Euro vs US Dollar',
        'GBPUSD': 'Pound vs US Dollar',
        'USDJPY': 'Dollar vs Japanese Yen',
        'AUDUSD': 'Australian Dollar vs USD',
        'NZDUSD': 'New Zealand Dollar vs USD',
        'USDCAD': 'US Dollar vs Canadian Dollar',
        'USDCHF': 'US Dollar vs Swiss Franc',
        'XAGUSD': 'Silver vs US Dollar',
        'SOLUSD': 'Solana vs US Dollar',
        'LTCUSD': 'Litecoin vs US Dollar',
        'XRPUSD': 'Ripple vs US Dollar',
    };
    const desc = descriptions[symbol] || symbol;

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
        cursor: !canSubmitOrder ? 'not-allowed' : 'pointer',
        position: 'relative',
        opacity: 1,
        filter: canSubmitOrder ? 'none' : 'brightness(0.78) saturate(0.75)',
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
            ? 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 50%, #1e40af 100%)'
            : 'linear-gradient(180deg, #dc2626 0%, #b91c1c 50%, #991b1b 100%)';
        const activeBackground = isBuy
            ? 'linear-gradient(180deg, #1e3a8a 0%, #172554 100%)'
            : 'linear-gradient(180deg, #991b1b 0%, #7f1d1d 100%)';
        const hoverBackground = isBuy
            ? 'linear-gradient(180deg, #3b82f6 0%, #2563eb 50%, #1d4ed8 100%)'
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
                disabled={!canSubmitOrder}
                title={orderBlockedReason}
                aria-label={`${label} ${symbol} at ${priceText}`}
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
                {isBuy && <span className="rtx-oct-side-label">{label}</span>}
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
                {!isBuy && <span className="rtx-oct-side-label">{label}</span>}
            </button>
        );
    };

    return (
        <div
            className="rtx-oct absolute top-[28px] left-[10px] z-30 select-none drop-shadow-2xl"
            style={{ pointerEvents: 'auto', fontFamily: 'var(--font-sans)', display: 'inline-block', width: 'fit-content' }}
        >
            <div
                data-testid="one-click-trading-row"
                style={{
                    display: 'flex',
                    background: '#111827',
                    backdropFilter: 'none',
                    WebkitBackdropFilter: 'none',
                    border: '1px solid rgba(255,255,255,0.18)',
                    borderRadius: '0px',
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
                        aria-label="Decrease lot size"
                        title="Decrease lot size"
                        data-at-min={volume <= 0.01}
                        onClick={() => setVolume(v => Math.max(0.01, Math.round((v - 0.01) * 100) / 100))}
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
                        aria-label="Lot size"
                        type="number"
                        inputMode="decimal"
                        step={0.01}
                        min={0.01}
                        value={volume}
                        onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val) && val >= 0) setVolume(Math.round(val * 100) / 100);
                        }}
                        style={{
                            width: 48, height: 24,
                            background: '#0f172a',
                            border: '1px solid #526174',
                            borderRadius: 0,
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
                        aria-label="Increase lot size"
                        title="Increase lot size"
                        onClick={() => setVolume(v => Math.round((v + 0.01) * 100) / 100)}
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
                    ⚠ Invalid volume (min 0.01)
                </div>
            )}
            {!tradeAllowed && !error && (
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
                    Live tradable quote unavailable - order not sent
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
                    Waiting for a valid bid/ask price
                </div>
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
                    {marketBlockedMessage || effectiveMarketStatus.label}
                </div>
            )}
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
                    {error}
                </div>
            )}
        </div>
    );
};

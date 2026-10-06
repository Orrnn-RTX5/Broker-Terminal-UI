import { useInvestorSession } from '../hooks/useInvestorSession';
import { INVESTOR_READ_ONLY_MESSAGE } from '../services/investorSession';
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
import { quoteDiagnosticsEnabled, recordQuoteDiagnostic } from '../services/quoteDiagnostics';
import { resolvePositionOpenTime } from '../services/tradePositionTime';
import {
    createUnavailableMarketStatus,
    getMarketStatusTradeBlockMessage,
    shouldBlockSymbolTrading,
    type NormalizedMarketStatus,
} from '../utils/marketStatus';
import { getSymbolDigits } from '../utils/symbolUtils';
import { formatOrderError, isStaleOrderError } from '../utils/orderError';
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
import { getAccessToken, getCommittedBrokerAccountSessionScope, getCommittedBrokerAccountSessionScopeKey } from '../services/brokerSession';
import './OneClickTrading.css';
import { hasAuthenticatedTradingSession, requireTradingAuth } from '../services/tradingAuthGate';
import { requestMarketSymbolsRefresh } from '../hooks/useLiveMarketData';
import { useTerminalQuoteFreshness } from '../hooks/useTerminalQuoteFreshness';
import { assertTerminalQuoteFresh, canSubmitTerminalMarketOrder, getTerminalQuoteFreshness, getTerminalQuoteSession, terminalMarketQuoteAdvisory, terminalQuoteBlockMessage, terminalQuoteFreshnessEnabled } from '../services/terminalQuoteFreshness';
import { prepareTerminalMarketQuote, TERMINAL_MARKET_QUOTE_RECOVERY_MAX_AGE_MS, TERMINAL_MARKET_QUOTE_WAIT_MS } from '../services/terminalMarketQuotePreflight';

interface OneClickTradingProps {
    symbol: string;
    visible: boolean;
    timeframe: string;
    tradeAllowed?: boolean;
    marketStatus?: NormalizedMarketStatus;
    minVolume?: number;
    maxVolume?: number;
    volumeStep?: number;
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

export const OneClickTrading: React.FC<OneClickTradingProps> = ({
    symbol,
    visible,
    tradeAllowed = false,
    marketStatus,
    minVolume,
    maxVolume,
    volumeStep,
}) => {
    const tr = useUiTranslation();
    const investorReadOnly = useInvestorSession();
    const volumeConstraints = useMemo(() => resolveTradeVolumeConstraints({
        minVolume,
        maxVolume,
        volumeStep,
    }), [maxVolume, minVolume, volumeStep]);
    // FIX: Keep the user's editable text separate from the executable number.
    // A numeric-only controlled state rejected the temporary empty value needed
    // to replace 0.01, so the leading zero was restored before typing 1 or more.
    const [volumeDraft, setVolumeDraft] = useState(() => (
        formatTradeVolume(volumeConstraints.min, volumeConstraints)
    ));
    const [flashSide, setFlashSide] = useState<'buy' | 'sell' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
    const [staleBlock, setStaleBlock] = useState<{ symbol: string; tick: unknown; clockOnly?: boolean } | null>(null);
    const [waitingForQuote, setWaitingForQuote] = useState(false);
    const quoteWaitRef = useRef(false);
    const mountedRef = useRef(false);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);
    const strictFreshness = terminalQuoteFreshnessEnabled();
    const quoteFreshness = useTerminalQuoteFreshness(symbol);
    const quoteAdvisory = strictFreshness ? terminalMarketQuoteAdvisory(quoteFreshness) : null;
    const blockedFreshness = useTerminalQuoteFreshness(staleBlock?.symbol ?? symbol);
    const blockedTick = useAppStore((state) => resolveExactBrokerSymbolValue(state.ticks, staleBlock?.symbol ?? symbol));
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
    useEffect(() => { setBlockedMessage(null); setError(null); setStaleBlock(null); }, [symbol, authIdentity]);
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
    const quoteLive = !strictFreshness || canSubmitTerminalMarketOrder(quoteFreshness);
    const canSubmitOrder = tradeAllowed && marketOpenForTrading && isVolumeValid && hasExecutablePrice && quoteLive;
    const tradeControlDisabled = investorReadOnly || (hasTradingSession && (!canSubmitOrder || waitingForQuote));
    // A changed draft, symbol or permission cancels a waiting click permanently,
    // even if the user changes it back before the next provider update.
    const preflightIdentity = JSON.stringify([symbol, visible, volumeDraft, volumeConstraints,
        authIdentity, tradeAllowed, marketOpenForTrading, isVolumeValid, hasExecutablePrice]);
    const preflightContextRef = useRef({ identity: preflightIdentity, revision: 0 });
    if (preflightContextRef.current.identity !== preflightIdentity) {
        preflightContextRef.current = { identity: preflightIdentity, revision: preflightContextRef.current.revision + 1 };
    }
    // Disabled HTML buttons never run placeOrder, so capture decision transitions
    // independently of submitted-order telemetry. Do not include account identity.
    const diagnosticBlockReason = !hasTradingSession ? 'login-required' : waitingForQuote ? 'waiting-for-quote' : !tradeAllowed ? 'symbol-not-eligible'
        : !quoteLive ? quoteFreshness.reason : !marketOpenForTrading ? 'market-not-open'
            : !isVolumeValid ? 'invalid-volume' : !hasExecutablePrice ? 'no-executable-price' : 'ready';
    const captureQuoteDiagnostics = quoteDiagnosticsEnabled();
    useEffect(() => {
        if (!visible || !captureQuoteDiagnostics) return;
        recordQuoteDiagnostic({ kind: 'trade-control', phase: 'rendered-state', symbol,
            disabled: tradeControlDisabled, reason: diagnosticBlockReason, authenticated: hasTradingSession,
            tradeAllowed, marketOpen: marketOpenForTrading, validVolume: isVolumeValid,
            executablePrice: hasExecutablePrice, quotePermitsOrder: quoteLive,
            freshnessReason: quoteFreshness.reason, clockStatus: quoteFreshness.clockStatus });
    }, [captureQuoteDiagnostics, visible, symbol, tradeControlDisabled, diagnosticBlockReason, hasTradingSession, tradeAllowed,
        marketOpenForTrading, isVolumeValid, hasExecutablePrice, quoteLive, quoteFreshness.reason, quoteFreshness.clockStatus]);
    const orderBlockedReason = investorReadOnly ? tr(INVESTOR_READ_ONLY_MESSAGE) : !tradeAllowed
        ? strictFreshness ? tr('Trading is not available for {{symbol}}.', { symbol }) : hasExecutablePrice ? staleQuoteMessage : tr('No live quote is available for {{symbol}}. Please wait for a fresh quote and try again.', { symbol })
        : !quoteLive
            ? terminalQuoteBlockMessage(quoteFreshness.reason, symbol)
        : !marketOpenForTrading
            ? marketBlockedMessage
            : !isVolumeValid
                ? 'Invalid volume'
                : !hasExecutablePrice
                    ? 'Waiting for a valid bid/ask price'
                    : undefined;
    // A disabled button cannot open the click-time error dialog. Show the
    // actual guard instead of leaving a live-looking price with no explanation.
    const quoteGuardMessage = hasTradingSession && !waitingForQuote && (!tradeAllowed || !quoteLive)
        ? orderBlockedReason : undefined;

    // Refresh data only: a blocked click never retains an executable order intent.
    const beginStaleQuoteRefresh = useCallback(() => {
        setStaleBlock({ symbol, tick: resolveExactBrokerSymbolValue(useAppStore.getState().ticks, symbol) });
        setBlockedMessage(tr('Waiting for a fresh quote'));
        void requestMarketSymbolsRefresh().catch(() => {});
    }, [symbol, tr]);

    const placeOrder = useCallback(async (side: 'buy' | 'sell') => {
        if (quoteWaitRef.current) return;
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
            if (strictFreshness) {
                setBlockedMessage(tr('Trading is not available for {{symbol}}.', { symbol }));
                return;
            }
            beginStaleQuoteRefresh();
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
        const preflightRevision = preflightContextRef.current.revision;
        const preflightToken = getAccessToken();
        const preflightStoreToken = useAppStore.getState().authToken;
        const preflightQuoteSession = getTerminalQuoteSession();
        const ownsOrderSession = () => {
            const current = useAppStore.getState();
            return current.isAuthenticated && String(current.accountId) === String(login)
                && getCommittedBrokerAccountSessionScopeKey(getCommittedBrokerAccountSessionScope()) === orderSessionScope;
        };
        const ownsPreflight = () => mountedRef.current && ownsOrderSession()
            && document.visibilityState !== 'hidden' && navigator.onLine !== false
            && preflightContextRef.current.revision === preflightRevision
            && getAccessToken() === preflightToken && useAppStore.getState().authToken === preflightStoreToken
            && getTerminalQuoteSession() === preflightQuoteSession;
        let orderSubmitted = false;
        try {
            if (strictFreshness) {
                // Fresh quotes preserve the synchronous send path. A provider
                // gap may wait briefly before submission, never after rejection.
                const preflightStartedAt = performance.now();
                const pendingQuote = prepareTerminalMarketQuote(symbol, ownsPreflight);
                if (pendingQuote) {
                    quoteWaitRef.current = true;
                    setWaitingForQuote(true);
                    try { await pendingQuote; }
                    finally {
                        quoteWaitRef.current = false;
                        if (mountedRef.current) setWaitingForQuote(false);
                    }
                    if (!ownsPreflight()) return;
                    if (performance.now() - preflightStartedAt >= TERMINAL_MARKET_QUOTE_WAIT_MS) {
                        throw Object.assign(new Error('Quote check expired. Please place the trade again.'), { code: 'QUOTE_STALE', symbol });
                    }
                    assertTerminalQuoteFresh(symbol);
                    const recoveredAge = getTerminalQuoteFreshness(symbol).ageMaxMs;
                    if (recoveredAge === null || recoveredAge > TERMINAL_MARKET_QUOTE_RECOVERY_MAX_AGE_MS) {
                        throw Object.assign(new Error('Waiting for a fresh quote'), { code: 'QUOTE_STALE', symbol });
                    }
                }
            }
            orderSubmitted = true;
            const orderPromise = api.orders.placeMarketOrder({
                side,
                symbol,
                volume,
                login,
            }, { intentAtMs });
            setBlockedMessage(null);
            setStaleBlock(null);
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
            if (!mountedRef.current || !ownsOrderSession() || (!orderSubmitted && !ownsPreflight())) return;
            console.error('[OneClick] Trade failed:', err);
            setError(formatOrderError(err));
            const clockError = err && typeof err === 'object' && (err as LooseRecord).code === 'QUOTE_TIME_UNVERIFIED';
            if (clockError || isStaleOrderError(err)) {
                const formattedError = formatOrderError(err);
                const record = err && typeof err === 'object' ? err as LooseRecord : {};
                const data = record.data && typeof record.data === 'object' ? record.data as LooseRecord : {};
                const code = String(data.error_code ?? data.code ?? record.code ?? '');
                const detail = code && !formattedError.includes(code) ? `${code}: ${formattedError}` : formattedError;
                // Account risk checks may reject an instrument other than the chart.
                const affectedSymbol = String(data.symbol ?? record.symbol ?? detail.match(/(?:risk quote\s+|stale for\s+|quote for\s+)([A-Za-z0-9_.-]+)/i)?.[1] ?? symbol);
                setStaleBlock({ symbol: affectedSymbol, clockOnly: Boolean(clockError), tick: resolveExactBrokerSymbolValue(useAppStore.getState().ticks, affectedSymbol) });
                setBlockedMessage(clockError ? detail : detail + ' ' + tr('Waiting for a fresh quote'));
                if (clockError) window.dispatchEvent(new Event('rtx:quote-clock-refresh'));
                void requestMarketSymbolsRefresh().catch(() => {});
            }
            setTimeout(() => setError(null), 6000);
        } finally {
            setTimeout(() => setFlashSide(null), 500);
        }
    }, [isAuthenticated, tradeAllowed, effectiveMarketStatus, marketOpenForTrading, isVolumeValid, hasExecutablePrice, volume, symbol, getAccountLogin, tick, bid, ask, tr, beginStaleQuoteRefresh, strictFreshness]);

    // Recovery clears the block but never submits an order. Require newer
    // evidence than the rejected attempt, including for another risk symbol.
    useEffect(() => {
        if (!staleBlock || (!staleBlock.clockOnly && blockedTick === staleBlock.tick)) return;
        if (strictFreshness ? !blockedFreshness.live : !tradeAllowed) return;
        setStaleBlock(null);
        setBlockedMessage(null);
        setError(null);
    }, [staleBlock, blockedTick, blockedFreshness.live, strictFreshness, tradeAllowed]);

    // Disabled buttons cannot request recovery on click. Revalidate the feed
    // snapshot when a block appears or quote/eligibility evidence changes.
    // A fresh quote does not itself grant permission: the status response and
    // account catalogue still determine tradeAllowed.
    const staleBlockedWithSession = hasTradingSession && (!tradeAllowed || !quoteLive) && marketOpenForTrading && hasExecutablePrice && isVolumeValid;
    const lastProactiveRefreshRef = useRef(-Infinity);
    const proactiveRefreshInFlightRef = useRef<Promise<void> | null>(null);
    const recoveryEpisodeRef = useRef<{ symbol: string; authIdentity: string; live: boolean; immediateUsed: boolean } | null>(null);
    const verifiedQuoteLive = strictFreshness && quoteFreshness.live && quoteFreshness.clockStatus === 'verified';
    useEffect(() => {
        const previous = recoveryEpisodeRef.current;
        const sameContext = previous?.symbol === symbol && previous.authIdentity === authIdentity;
        // One prompt revalidation per excluded episode. Boundary jitter and
        // uncertain-clock advisories must not repeatedly bypass the rate limit.
        const immediateRecovery = sameContext && !tradeAllowed && !previous.live
            && verifiedQuoteLive && !previous.immediateUsed;
        recoveryEpisodeRef.current = { symbol, authIdentity, live: verifiedQuoteLive,
            immediateUsed: !tradeAllowed && sameContext && (previous.immediateUsed || immediateRecovery) };
        if (!staleBlockedWithSession) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const refresh = () => {
            if (cancelled) return;
            // Repeated transitions must not abort an outstanding status poll.
            const inFlight = proactiveRefreshInFlightRef.current;
            if (inFlight) {
                void inFlight.then(refresh);
                return;
            }
            // Scheduling uses a monotonic clock, independent of OS clock sync.
            const delay = immediateRecovery ? 0 : 5000 - (performance.now() - lastProactiveRefreshRef.current);
            if (delay > 0) {
                timer = setTimeout(refresh, delay);
                return;
            }
            lastProactiveRefreshRef.current = performance.now();
            const pending = requestMarketSymbolsRefresh().catch(() => {});
            proactiveRefreshInFlightRef.current = pending;
            void pending.then(() => {
                if (proactiveRefreshInFlightRef.current === pending) proactiveRefreshInFlightRef.current = null;
            });
        };
        refresh();
        return () => {
            cancelled = true;
            if (timer !== undefined) clearTimeout(timer);
        };
    }, [staleBlockedWithSession, quoteLive, verifiedQuoteLive, tradeAllowed, symbol, authIdentity]);

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
                title={investorReadOnly || hasTradingSession ? tr(orderBlockedReason) : tr('Login required to trade')}
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
            {waitingForQuote && <div role="status">{tr('Waiting for a fresh quote')}</div>}
            {quoteGuardMessage && !error && !blockedMessage && (
                <div role="status" aria-live="polite" style={{ fontSize: 10, color: '#fbbf24', textAlign: 'center', padding: '3px 8px' }}>
                    {tr(quoteGuardMessage)}
                    {quoteFreshness.reason === 'stale' && Number.isFinite(quoteFreshness.ageMinMs) && (
                        <span>{` · ${tr('Quote age')}: ≥ ${Math.max(0, quoteFreshness.ageMinMs! / 1000).toFixed(1)} s`}</span>
                    )}
                </div>
            )}
            {quoteAdvisory && !quoteGuardMessage && !waitingForQuote && !error && !blockedMessage && (
                <div role="status" style={{ fontSize: 10, color: '#fbbf24', textAlign: 'center', padding: '3px 8px' }}>
                    {tr(quoteAdvisory)}
                </div>
            )}
            {blockedMessage && (
                <TradeUnavailableDialog
                    message={blockedMessage}
                    onClose={() => { setBlockedMessage(null); setStaleBlock(null); }}
                />
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
                    {tr(error)}
                </div>
            )}
        </div>
    );
};

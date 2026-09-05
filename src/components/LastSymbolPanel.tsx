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
import { captureTradeOrderIntent } from '../services/orderLatencyTelemetry';
import { formatSpreadDisplayWithUnit } from '../utils/spread';
import { formatOrderError } from '../utils/orderError';
import { useSymbolMarketStatus } from '../hooks/useSymbolMarketStatus';
import {
    getMarketStatusTradeBlockMessage,
    shouldBlockSymbolTrading,
} from '../utils/marketStatus';
import {
    normalizeExactBrokerSymbol,
    resolveExactBrokerSymbolValue,
} from '../utils/exactBrokerSymbol';

const PANEL_WIDTH = 320;
const PANEL_EDGE_GAP = 16;
const ACCOUNT_VALUE_FORMATTER = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const clampPanelPosition = (position: { x: number; y: number }) => ({
    x: Math.max(
        PANEL_EDGE_GAP,
        Math.min(Math.max(PANEL_EDGE_GAP, window.innerWidth - PANEL_WIDTH - PANEL_EDGE_GAP), position.x),
    ),
    y: Math.max(
        PANEL_EDGE_GAP,
        Math.min(Math.max(PANEL_EDGE_GAP, window.innerHeight - 96), position.y),
    ),
});

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

    const [isClosing, setIsClosing] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [statusType, setStatusType] = useState<'success' | 'error' | 'info'>('info');
    const [showSettings, setShowSettings] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [position, setPosition] = useState(() => {
        const saved = localStorage.getItem('lst_panel_pos');
        if (saved) {
            try {
                const parsed = JSON.parse(saved) as Partial<{ x: number; y: number }>;
                if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
                    return clampPanelPosition({ x: parsed.x as number, y: parsed.y as number });
                }
            } catch { /* ignore */ }
        }
        return clampPanelPosition({ x: window.innerWidth - PANEL_WIDTH - PANEL_EDGE_GAP, y: 96 });
    });
    const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const marketStatus = useSymbolMarketStatus(lastSymbol, {
        enabled: Boolean(lastSymbol),
    });

    // FIX: Resolve only the exact broker contract. Stripping punctuation could
    // display or execute XAUUSD with a quote received for XAUUSD.raw.
    const exactLastSymbol = normalizeExactBrokerSymbol(lastSymbol);
    const tick = resolveExactBrokerSymbolValue(ticks, exactLastSymbol) ?? null;

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

    // FIX: Closing/summary ownership follows the same exact contract identity
    // as its quote; case/whitespace may differ but punctuation never aliases.
    const lastSymbolPositions = positions.filter(
        (position) => normalizeExactBrokerSymbol(position.symbol) === exactLastSymbol,
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
    const canPlaceTrade = Boolean(lastSymbol) && !shouldBlockSymbolTrading(marketStatus, lastSymbol);
    const hasLiveQuote = Boolean(lastSymbol && bid > 0 && ask > 0);
    const executionStatus = !lastSymbol
        ? { label: 'Idle', tone: 'idle' }
        : !canPlaceTrade
            ? { label: marketStatus.label || 'Unavailable', tone: 'blocked' }
            : hasLiveQuote
                ? { label: 'Live', tone: 'live' }
                : { label: 'Awaiting quote', tone: 'waiting' };

    // Flash status message
    const flash = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'info') => {
        setStatusMessage(msg);
        setStatusType(type);
        setTimeout(() => setStatusMessage(''), 4000);
    }, []);

    // Place order via MT5 Sync API
    const placeOrder = useCallback(
        async (side: 'BUY' | 'SELL') => {
            if (!lastSymbol) {
                if (!lastSymbol) flash('No last symbol — place a trade first', 'error');
                return;
            }
            const intentAtMs = captureTradeOrderIntent();
            const login = Number(accountId) || 0;
            if (!login) {
                flash('No trading account is selected. Please sign in again.', 'error');
                return;
            }
            // Status polling already keeps this rendered gate current. A forced
            // HTTP check here previously added a complete network RTT per click.
            if (!canPlaceTrade) {
                flash(tradeBlockedMessage, 'error');
                return;
            }

            try {
                const orderData: {
                    symbol: string;
                    side: 'buy' | 'sell';
                    volume: number;
                    login: number;
                    price_sl?: number;
                    price_tp?: number;
                } = {
                    // FIX: Send the canonical exact contract while retaining
                    // all broker punctuation and suffixes.
                    symbol: exactLastSymbol,
                    side: side === 'BUY' ? 'buy' : 'sell',
                    volume: effectiveLot,
                    login,
                };

                // Deliberately omit the old informational REST-only comment so
                // standard Last Symbol orders can use the fixed low-latency WS
                // contract. User-authored comments elsewhere are still kept on REST.

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

                const orderPromise = api.orders.placeMarketOrder(orderData, { intentAtMs });
                // Do not serialize deliberate one-click orders behind a prior
                // terminal fill; every call owns separate durable correlation IDs.
                await orderPromise;
                setLastSymbol(exactLastSymbol, side);
                window.dispatchEvent(new Event('rtx:force-refresh-positions'));
                flash(`${side} ${effectiveLot} ${lastSymbol} ✓`, 'success');
            } catch (err: unknown) {
                console.error('LastSymbolPanel order failed:', err);
                flash(formatOrderError(err), 'error');
            }
        },
        [lastSymbol, exactLastSymbol, effectiveLot, autoSLTP, slPips, tpPips, pipSize, bid, ask, accountId, canPlaceTrade, tradeBlockedMessage, setLastSymbol, flash]
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
                (position) => normalizeExactBrokerSymbol(position.symbol) !== exactLastSymbol,
            ));
            window.dispatchEvent(new Event('rtx:force-refresh-positions'));
            flash(`Closed ${closed} position(s) on ${lastSymbol} ✓`, 'success');
        } catch (err: unknown) {
            flash(err instanceof Error ? err.message : 'Close failed', 'error');
        } finally {
            setIsClosing(false);
        }
    }, [isClosing, lastSymbol, exactLastSymbol, lastSymbolPositions, flash]);

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
            const newPos = clampPanelPosition({
                x: dragRef.current.origX + dx,
                y: dragRef.current.origY + dy,
            });
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

    useEffect(() => {
        const keepPanelInViewport = () => setPosition((current) => clampPanelPosition(current));
        window.addEventListener('resize', keepPanelInViewport);
        return () => window.removeEventListener('resize', keepPanelInViewport);
    }, []);

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
            className={`rtx-last-symbol-panel${isDragging ? ' is-dragging' : ''}`}
            style={{ left: position.x, top: position.y }}
            role="region"
            aria-label="Last symbol trader"
        >
            <div className="last-symbol-card">
                <header className="last-symbol-header" onMouseDown={onMouseDown}>
                    <div className="last-symbol-brand">
                        <span className="last-symbol-brand__icon" aria-hidden="true">
                            <Icon name="zap" size="sm" />
                        </span>
                        <span>
                            <strong>Last Symbol Trader</strong>
                        </span>
                    </div>
                    <div className="last-symbol-header__actions">
                        <button
                            type="button"
                            onClick={() => setShowSettings(!showSettings)}
                            className={`last-symbol-icon-button${showSettings ? ' is-active' : ''}`}
                            title="Execution settings"
                            aria-label="Execution settings"
                            aria-expanded={showSettings}
                            aria-controls="last-symbol-settings"
                        >
                            <Icon name="settings" size="sm" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setPanelVisible(false)}
                            className="last-symbol-icon-button last-symbol-icon-button--close"
                            title="Close trader panel"
                            aria-label="Close trader panel"
                        >
                            <Icon name="x-close" size="sm" />
                        </button>
                    </div>
                </header>

                <section className="last-symbol-summary" aria-label="Last traded symbol">
                    <div className="last-symbol-section-heading">
                        <span>Last traded symbol</span>
                        <span className="last-symbol-status" data-tone={executionStatus.tone}>
                            <span className="last-symbol-status__dot" aria-hidden="true" />
                            {executionStatus.label}
                        </span>
                    </div>
                    <div className="last-symbol-summary__row">
                        <div>
                            <div className="last-symbol-value" data-empty={!lastSymbol}>
                                {lastSymbol || 'No symbol selected'}
                            </div>
                        </div>
                        {lastTradeSide ? (
                            <div className="last-symbol-history">
                                <span className="last-symbol-side" data-side={lastTradeSide.toLowerCase()}>
                                    {lastTradeSide}
                                </span>
                                <span>{timeSince}</span>
                            </div>
                        ) : null}
                    </div>
                </section>

                <section className="last-symbol-volume" aria-labelledby="last-symbol-volume-title">
                    <div className="last-symbol-section-heading">
                        <span id="last-symbol-volume-title">Volume</span>
                        <span className="last-symbol-unit">
                            {useRiskSizing ? `${riskPercent}% risk` : 'Lots'}
                        </span>
                    </div>
                    <div className="last-symbol-stepper">
                        <button
                            type="button"
                            onClick={() => setVolume(volume - 0.01)}
                            disabled={volume <= 0.01 || useRiskSizing}
                            aria-label="Decrease order volume"
                        >
                            <Icon name="minus" size="sm" />
                        </button>
                        <input
                            type="number"
                            step={0.01}
                            min={0.01}
                            value={(useRiskSizing ? effectiveLot : volume).toFixed(2)}
                            onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                if (!isNaN(val) && val >= 0.01) setVolume(val);
                            }}
                            disabled={useRiskSizing}
                            aria-label="Order volume in lots"
                        />
                        <button
                            type="button"
                            onClick={() => setVolume(volume + 0.01)}
                            disabled={useRiskSizing}
                            aria-label="Increase order volume"
                        >
                            <Icon name="plus" size="sm" />
                        </button>
                    </div>
                    <div className="last-symbol-presets" aria-label="Volume presets">
                        {[0.01, 0.05, 0.1, 0.5, 1.0].map((preset) => {
                            const isSelected = Math.abs(volume - preset) < 0.001;
                            return (
                                <button
                                    type="button"
                                    key={preset}
                                    onClick={() => setVolume(preset)}
                                    disabled={useRiskSizing}
                                    className={isSelected ? 'is-selected' : ''}
                                    aria-pressed={isSelected}
                                    aria-label={`Set order volume to ${preset} lots`}
                                >
                                    {preset.toFixed(2)}
                                </button>
                            );
                        })}
                    </div>
                </section>

                {autoSLTP && (
                    <div className="last-symbol-protection-summary">
                        <span><Icon name="shield" size="xs" /> Protection on</span>
                        <span className="last-symbol-protection-summary__sl">SL {slPips}</span>
                        <span className="last-symbol-protection-summary__tp">TP {tpPips}</span>
                    </div>
                )}
                {canPlaceTrade === false && lastSymbol && !statusMessage && (
                    <div className="last-symbol-notice" role="status">
                        {tradeBlockedMessage || marketStatus.label}
                    </div>
                )}

                <section className="last-symbol-execution" aria-labelledby="last-symbol-execution-title">
                    <div className="last-symbol-section-heading">
                        <span id="last-symbol-execution-title">Market order</span>
                        <span className="last-symbol-unit">
                            {lastSymbol ? `Spread ${spreadDisplay}` : ''}
                        </span>
                    </div>
                    <div className="last-symbol-actions">
                        <button
                            type="button"
                            onClick={() => placeOrder('SELL')}
                            disabled={!canPlaceTrade || bid === 0}
                            className="last-symbol-trade-button last-symbol-trade-button--sell"
                            aria-label={`Sell ${lastSymbol || 'last symbol'} at market`}
                            title="Sell at market (Shift+S)"
                        >
                            <span className="last-symbol-trade-button__top">
                                <strong>Sell</strong>
                            </span>
                            <span className="last-symbol-trade-button__price">
                                {bid > 0 ? bid.toFixed(digits) : '—'}
                            </span>
                        </button>

                        <button
                            type="button"
                            onClick={() => placeOrder('BUY')}
                            disabled={!canPlaceTrade || ask === 0}
                            className="last-symbol-trade-button last-symbol-trade-button--buy"
                            aria-label={`Buy ${lastSymbol || 'last symbol'} at market`}
                            title="Buy at market (Shift+B)"
                        >
                            <span className="last-symbol-trade-button__top">
                                <strong>Buy</strong>
                            </span>
                            <span className="last-symbol-trade-button__price">
                                {ask > 0 ? ask.toFixed(digits) : '—'}
                            </span>
                        </button>
                    </div>
                </section>

                {statusMessage && (
                    <div
                        className="last-symbol-alert"
                        data-tone={statusType}
                        role={statusType === 'error' ? 'alert' : 'status'}
                    >
                        {statusMessage}
                    </div>
                )}

                <div className="last-symbol-close-row">
                    <button
                        type="button"
                        onClick={closeLastPositions}
                        disabled={isClosing || lastSymbolPositions.length === 0}
                        className="last-symbol-close-button"
                        aria-label={`Close all ${lastSymbol || 'last symbol'} positions`}
                        title="Close positions (Shift+X)"
                    >
                        <span className="last-symbol-close-button__label">
                            <Icon name="x-close" size="xs" />
                            {isClosing ? 'Closing positions' : 'Close positions'}
                        </span>
                        <span className="last-symbol-close-button__value">
                            {lastSymbolPositions.length > 0 ? (
                                <>
                                    {lastSymbolPositions.length}
                                    <strong data-tone={totalPnL >= 0 ? 'profit' : 'loss'}>
                                        {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}
                                    </strong>
                                </>
                            ) : 'None open'}
                        </span>
                    </button>
                </div>

                {account && (
                    <dl className="last-symbol-account-summary">
                        <div>
                            <dt>Balance</dt>
                            <dd>{ACCOUNT_VALUE_FORMATTER.format(account.balance ?? 0)}</dd>
                        </div>
                        <div>
                            <dt>Equity</dt>
                            <dd>{ACCOUNT_VALUE_FORMATTER.format(account.equity ?? 0)} {account.currency || 'USD'}</dd>
                        </div>
                    </dl>
                )}

                {showSettings && (
                    <section id="last-symbol-settings" className="last-symbol-settings" aria-label="Execution settings panel">
                        <div className="last-symbol-settings__heading">
                            <span>Execution settings</span>
                            <small>Applied to the next order</small>
                        </div>

                        <label className="last-symbol-setting-row">
                            <span>
                                <strong>Risk-based sizing</strong>
                                <small>Calculate lots from account balance</small>
                            </span>
                            <span className="last-symbol-toggle">
                                <input
                                    type="checkbox"
                                    checked={useRiskSizing}
                                    onChange={(e) => setUseRiskSizing(e.target.checked)}
                                />
                                <span aria-hidden="true" />
                            </span>
                        </label>
                        {useRiskSizing && (
                            <label className="last-symbol-field">
                                <span>Account risk <small>%</small></span>
                                <input
                                    type="number"
                                    step={0.1}
                                    min={0.1}
                                    max={100}
                                    value={riskPercent}
                                    onChange={(e) => setRiskPercent(parseFloat(e.target.value) || 1)}
                                />
                            </label>
                        )}

                        <label className="last-symbol-setting-row">
                            <span>
                                <strong>Automatic protection</strong>
                                <small>Add stop loss and take profit</small>
                            </span>
                            <span className="last-symbol-toggle">
                                <input
                                    type="checkbox"
                                    checked={autoSLTP}
                                    onChange={(e) => setAutoSLTP(e.target.checked)}
                                />
                                <span aria-hidden="true" />
                            </span>
                        </label>
                        {autoSLTP && (
                            <div className="last-symbol-protection-fields">
                                <label className="last-symbol-field last-symbol-field--loss">
                                    <span>Stop loss <small>pips</small></span>
                                    <input
                                        type="number"
                                        min={1}
                                        value={slPips}
                                        onChange={(e) => setSLPips(parseInt(e.target.value) || 30)}
                                    />
                                </label>
                                <label className="last-symbol-field last-symbol-field--profit">
                                    <span>Take profit <small>pips</small></span>
                                    <input
                                        type="number"
                                        min={1}
                                        value={tpPips}
                                        onChange={(e) => setTPPips(parseInt(e.target.value) || 60)}
                                    />
                                </label>
                            </div>
                        )}
                    </section>
                )}

            </div>
        </div>
    );
}

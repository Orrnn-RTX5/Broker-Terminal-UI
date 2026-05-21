/**
 * MT5-Style One-Click Trading Panel
 * Premium compact overlay — exact MT5 replica with Red SELL / Blue BUY
 * Toggled by Alt+T, sits on top-left of chart
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useLastSymbolStore } from '../store/useLastSymbolStore';
import api from '../services/api';
import { getSymbolDigits } from '../utils/symbolUtils';
import { formatPriceParts } from './ui/PriceDisplay';

interface OneClickTradingProps {
    symbol: string;
    visible: boolean;
    timeframe: string;
}

export const OneClickTrading: React.FC<OneClickTradingProps> = ({ symbol, visible, timeframe }) => {
    const [volume, setVolume] = useState(0.01);
    const [isPlacing, setIsPlacing] = useState(false);
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

    // Track price direction for color flash
    const [bidFlash, setBidFlash] = useState<'up' | 'down' | ''>('');
    const [askFlash, setAskFlash] = useState<'up' | 'down' | ''>('');

    useEffect(() => {
        if (prevBidRef.current && bid !== prevBidRef.current) {
            setBidFlash(bid > prevBidRef.current ? 'up' : 'down');
            const t = setTimeout(() => setBidFlash(''), 350);
            prevBidRef.current = bid;
            return () => clearTimeout(t);
        }
        prevBidRef.current = bid;
    }, [bid]);

    useEffect(() => {
        if (prevAskRef.current && ask !== prevAskRef.current) {
            setAskFlash(ask > prevAskRef.current ? 'up' : 'down');
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
        const saved = localStorage.getItem('rtx_saved_username') || localStorage.getItem('rtx_last_login');
        return saved ? parseInt(saved, 10) || 0 : 0;
    }, []);

    const isVolumeValid = Number.isFinite(volume) && volume > 0;
    const hasExecutablePrice = bid > 0 && ask > 0;

    const placeOrder = useCallback(async (side: 'buy' | 'sell') => {
        if (isPlacing) return;
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
        setError(null);
        setIsPlacing(true);
        setFlashSide(side);

        try {
            const login = getAccountLogin();
            await api.orders.placeMarketOrder({
                side,
                symbol,
                volume,
                login,
            });
            useLastSymbolStore.getState().setLastSymbol(symbol, side.toUpperCase() as 'BUY' | 'SELL');
            window.dispatchEvent(new Event('rtx:force-refresh-positions'));
        } catch (err: any) {
            console.error('[OneClick] Trade failed:', err);
            setError(err?.message || 'Order failed');
            setTimeout(() => setError(null), 3000);
        } finally {
            setIsPlacing(false);
            setTimeout(() => setFlashSide(null), 500);
        }
    }, [isPlacing, isVolumeValid, hasExecutablePrice, volume, symbol, getAccountLogin]);

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

    const btnWidth = isAdvancedMode ? 95 : 90;
    const btnHeight = isAdvancedMode ? 55 : 52;
    const centerWidth = isAdvancedMode ? 48 : 48;

    // Shared button style for BUY and SELL — identical structure
    const sharedButtonStyle: React.CSSProperties = {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '6px 8px',
        width: btnWidth,
        minWidth: btnWidth,
        maxWidth: btnWidth,
        height: btnHeight,
        minHeight: btnHeight,
        maxHeight: btnHeight,
        border: '1px solid rgba(255,255,255,0.1)',
        cursor: isPlacing || !isVolumeValid || !hasExecutablePrice ? 'not-allowed' : 'pointer',
        position: 'relative',
        opacity: !isVolumeValid ? 0.5 : 1,
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        boxSizing: 'border-box',
    };

    return (
        <div
            className="rtx-oct absolute top-[28px] left-[10px] z-30 select-none drop-shadow-2xl"
            style={{ pointerEvents: 'auto', fontFamily: "'Inter', 'Segoe UI', Tahoma, sans-serif", display: 'inline-block', width: 'fit-content' }}
        >
            <div
                style={{
                    display: 'flex',
                    background: 'rgba(15, 23, 42, 0.4)',
                    backdropFilter: 'blur(16px)',
                    WebkitBackdropFilter: 'blur(16px)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '0px',
                    overflow: 'hidden',
                    boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.05), 0 10px 40px rgba(0,0,0,0.5)',
                }}
            >
                {/* ── BUY Button ── */}
                <button
                    onClick={() => placeOrder('buy')}
                    disabled={isPlacing || !isVolumeValid || !hasExecutablePrice}
                    style={{
                        ...sharedButtonStyle,
                        background: flashSide === 'buy'
                            ? 'linear-gradient(180deg, rgba(30,58,138,0.8) 0%, rgba(30,58,138,0.9) 100%)'
                            : 'linear-gradient(180deg, rgba(37,99,235,0.85) 0%, rgba(29,78,216,0.85) 50%, rgba(30,64,175,0.95) 100%)',
                        borderRight: 'none',
                        borderRadius: '0px'
                    }}
                    onMouseEnter={(e) => { if (!flashSide) e.currentTarget.style.background = 'linear-gradient(180deg, rgba(59,130,246,0.9) 0%, rgba(37,99,235,0.9) 50%, rgba(29,78,216,0.95) 100%)'; }}
                    onMouseLeave={(e) => { if (!flashSide) e.currentTarget.style.background = 'linear-gradient(180deg, rgba(37,99,235,0.85) 0%, rgba(29,78,216,0.85) 50%, rgba(30,64,175,0.95) 100%)'; }}
                >
                    <span style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.7)', letterSpacing: '1px', textTransform: 'uppercase' }}>
                        BUY
                    </span>
                    <div style={{ display: 'flex', alignItems: 'baseline', lineHeight: 1, marginTop: 2 }}>
                        <span className="rtx-oct-digit-small" style={{
                            color: '#fff',
                            textShadow: askFlash === 'up' ? '0 0 8px #6b9fff' : askFlash === 'down' ? '0 0 8px #ff6b6b' : 'none',
                        }}>
                            {askPrice.small}
                        </span>
                        <span className="rtx-oct-digit-big" style={{
                            color: '#fff',
                            textShadow: askFlash === 'up' ? '0 0 12px #6b9fff' : askFlash === 'down' ? '0 0 12px #ff6b6b' : '0 1px 3px rgba(0,0,0,0.5)',
                        }}>
                            {askPrice.big}
                        </span>
                        {askPrice.pip && (
                            <span className="rtx-oct-digit-pip" style={{
                                color: '#fff',
                                position: 'relative', top: -8,
                                textShadow: askFlash === 'up' ? '0 0 8px #6b9fff' : askFlash === 'down' ? '0 0 8px #ff6b6b' : 'none',
                            }}>
                                {askPrice.pip}
                            </span>
                        )}
                    </div>
                </button>

                {/* ── Volume Control (Center) ── */}
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '3px 4px',
                        minWidth: centerWidth,
                        height: btnHeight,
                        minHeight: btnHeight,
                        maxHeight: btnHeight,
                        background: 'linear-gradient(180deg, #1f2937 0%, #111827 100%)',
                        borderLeft: '1px solid rgba(255,255,255,0.15)',
                        borderRight: '1px solid rgba(255,255,255,0.15)',
                        boxSizing: 'border-box',
                    }}
                >
                    <button
                        onClick={() => setVolume(v => Math.round((v + 0.01) * 100) / 100)}
                        style={{
                            background: 'none', border: 'none', color: '#8a8a8f', cursor: 'pointer',
                            fontSize: 9, lineHeight: 1, padding: '1px 0',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.color = '#d1d5db'}
                        onMouseLeave={(e) => e.currentTarget.style.color = '#8a8a8f'}
                    >
                        ▲
                    </button>
                    <input
                        type="number"
                        step={0.01}
                        min={0.01}
                        value={volume}
                        onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val) && val >= 0) setVolume(Math.round(val * 100) / 100);
                        }}
                        style={{
                            width: 42, height: 20,
                            background: '#0f172a',
                            border: '1px solid #374151',
                            borderRadius: 0,
                            color: '#fff',
                            fontSize: 11,
                            fontFamily: 'monospace',
                            fontWeight: 700,
                            textAlign: 'center',
                            outline: 'none',
                            padding: 0,
                        }}
                    />
                    <button
                        onClick={() => setVolume(v => Math.max(0.01, Math.round((v - 0.01) * 100) / 100))}
                        style={{
                            background: 'none', border: 'none', color: '#8a8a8f', cursor: 'pointer',
                            fontSize: 9, lineHeight: 1, padding: '1px 0',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.color = '#d1d5db'}
                        onMouseLeave={(e) => e.currentTarget.style.color = '#8a8a8f'}
                    >
                        ▼
                    </button>
                </div>

                {/* ── SELL Button ── */}
                <button
                    onClick={() => placeOrder('sell')}
                    disabled={isPlacing || !isVolumeValid || !hasExecutablePrice}
                    style={{
                        ...sharedButtonStyle,
                        background: flashSide === 'sell'
                            ? 'linear-gradient(180deg, rgba(153,27,27,0.8) 0%, rgba(127,29,29,0.9) 100%)'
                            : 'linear-gradient(180deg, rgba(220,38,38,0.85) 0%, rgba(185,28,28,0.85) 50%, rgba(153,27,27,0.95) 100%)',
                        borderLeft: 'none',
                        borderRadius: '0px'
                    }}
                    onMouseEnter={(e) => { if (!flashSide) e.currentTarget.style.background = 'linear-gradient(180deg, rgba(239,68,68,0.9) 0%, rgba(220,38,38,0.9) 50%, rgba(185,28,28,0.95) 100%)'; }}
                    onMouseLeave={(e) => { if (!flashSide) e.currentTarget.style.background = 'linear-gradient(180deg, rgba(220,38,38,0.85) 0%, rgba(185,28,28,0.85) 50%, rgba(153,27,27,0.95) 100%)'; }}
                >
                    <span style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.7)', letterSpacing: '1px', textTransform: 'uppercase' }}>
                        SELL
                    </span>
                    <div style={{ display: 'flex', alignItems: 'baseline', lineHeight: 1, marginTop: 2 }}>
                        <span className="rtx-oct-digit-small" style={{
                            color: '#fff',
                            textShadow: bidFlash === 'down' ? '0 0 8px #ff6b6b' : bidFlash === 'up' ? '0 0 8px #6bff6b' : 'none',
                        }}>
                            {bidPrice.small}
                        </span>
                        <span className="rtx-oct-digit-big" style={{
                            color: '#fff',
                            textShadow: bidFlash === 'down' ? '0 0 12px #ff6b6b' : bidFlash === 'up' ? '0 0 12px #6bff6b' : '0 1px 3px rgba(0,0,0,0.5)',
                        }}>
                            {bidPrice.big}
                        </span>
                        {bidPrice.pip && (
                            <span className="rtx-oct-digit-pip" style={{
                                color: '#fff',
                                position: 'relative', top: -8,
                                textShadow: bidFlash === 'down' ? '0 0 8px #ff6b6b' : bidFlash === 'up' ? '0 0 8px #6bff6b' : 'none',
                            }}>
                                {bidPrice.pip}
                            </span>
                        )}
                    </div>
                </button>
            </div>

            {/* Invalid volume warning */}
            {!isVolumeValid && (
                <div style={{
                    fontSize: 10,
                    color: '#f87171',
                    textAlign: 'center',
                    padding: '3px 8px',
                    background: 'rgba(127, 29, 29, 0.6)',
                    borderRadius: 0,
                    border: '1px solid #7f1d1d',
                    borderTop: 'none',
                }}>
                    ⚠ Invalid volume (min 0.01)
                </div>
            )}
            {error && (
                <div style={{
                    fontSize: 10,
                    color: '#fecaca',
                    textAlign: 'center',
                    padding: '3px 8px',
                    background: 'rgba(127, 29, 29, 0.72)',
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

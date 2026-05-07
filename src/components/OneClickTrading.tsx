/**
 * MT5-Style One-Click Trading Panel
 * Premium compact overlay — exact MT5 replica with Red SELL / Blue BUY
 * Toggled by Alt+T, sits on top-left of chart
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useMT5Store } from '../store/useMT5Store';
import { useLastSymbolStore } from '../store/useLastSymbolStore';
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

    const digits = tick?.digits || getSymbolDigits(symbol);

    const formatPrice = useCallback((price: number, d: number) => {
        const parts = formatPriceParts(price, symbol, d);
        return { ...parts, pip: '' };
    }, [symbol]);

    const getAccountLogin = useCallback((): number => {
        const saved = localStorage.getItem('rtx_saved_username') || localStorage.getItem('rtx_last_login');
        return saved ? parseInt(saved, 10) || 0 : 0;
    }, []);

    const isVolumeValid = volume > 0;

    const placeOrder = useCallback(async (side: 'buy' | 'sell') => {
        if (isPlacing || !isVolumeValid || bid <= 0) return;
        setIsPlacing(true);
        setFlashSide(side);

        try {
            const login = getAccountLogin();
            await useMT5Store.getState().submitOrder({
                action: side.toUpperCase() as 'BUY' | 'SELL',
                symbol,
                volume,
                login,
            });
            useLastSymbolStore.getState().setLastSymbol(symbol, side.toUpperCase() as 'BUY' | 'SELL');
        } catch (err: any) {
            console.error('[OneClick] Trade failed:', err);
        } finally {
            setIsPlacing(false);
            setTimeout(() => setFlashSide(null), 500);
        }
    }, [isPlacing, isVolumeValid, volume, bid, symbol, getAccountLogin]);

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

    // Shared button style for BUY and SELL — identical structure
    const sharedButtonStyle: React.CSSProperties = {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '6px 8px',
        width: 90,
        minWidth: 90,
        maxWidth: 90,
        height: 52,
        minHeight: 52,
        maxHeight: 52,
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 0,
        cursor: isPlacing || !isVolumeValid ? 'not-allowed' : 'pointer',
        position: 'relative',
        opacity: !isVolumeValid ? 0.5 : 1,
        transition: 'background 0.2s, opacity 0.2s',
        boxSizing: 'border-box',
    };

    return (
        <div
            className="absolute top-[6px] left-[6px] z-30 select-none"
            style={{ pointerEvents: 'auto', fontFamily: "'Segoe UI', Tahoma, sans-serif", display: 'inline-block', width: 'fit-content' }}
        >
            {/* ─── Header: Symbol + Timeframe ─── */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '3px 10px',
                    background: 'rgba(20, 24, 33, 0.92)',
                    backdropFilter: 'blur(8px)',
                    borderRadius: 0,
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderBottom: 'none',
                }}
            >
                <span style={{ fontSize: 11, fontWeight: 700, color: '#e2e2e8', letterSpacing: '0.4px' }}>
                    {symbol}, {timeframe}:
                </span>
                <span style={{ fontSize: 10, color: '#8a8a8f', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {desc}
                </span>
            </div>

            {/* ─── Main Body: BUY | Volume | SELL ─── */}
            <div
                style={{
                    display: 'flex',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 0,
                    overflow: 'hidden',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                }}
            >
                {/* ── BUY Button ── */}
                <button
                    onClick={() => placeOrder('buy')}
                    disabled={isPlacing || !isVolumeValid}
                    style={{
                        ...sharedButtonStyle,
                        background: flashSide === 'buy'
                            ? 'linear-gradient(180deg, #1e3a5f 0%, #1e3a8a 100%)'
                            : 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 50%, #1e40af 100%)',
                        borderRight: 'none',
                    }}
                    onMouseEnter={(e) => { if (!flashSide) e.currentTarget.style.background = 'linear-gradient(180deg, #2a6fd4 0%, #1e54a8 50%, #1a448a 100%)'; }}
                    onMouseLeave={(e) => { if (!flashSide) e.currentTarget.style.background = 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 50%, #1e40af 100%)'; }}
                >
                    <span style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.7)', letterSpacing: '1px', textTransform: 'uppercase' }}>
                        BUY
                    </span>
                    <div style={{ display: 'flex', alignItems: 'baseline', lineHeight: 1, marginTop: 2 }}>
                        <span style={{
                            fontSize: 12, fontFamily: 'monospace', fontWeight: 500, color: '#fff',
                            textShadow: askFlash === 'up' ? '0 0 8px #6b9fff' : askFlash === 'down' ? '0 0 8px #ff6b6b' : 'none',
                        }}>
                            {askPrice.small}
                        </span>
                        <span style={{
                            fontSize: 28, fontFamily: 'monospace', fontWeight: 900, color: '#fff', lineHeight: 0.85,
                            textShadow: askFlash === 'up' ? '0 0 12px #6b9fff' : askFlash === 'down' ? '0 0 12px #ff6b6b' : '0 1px 3px rgba(0,0,0,0.5)',
                        }}>
                            {askPrice.big}
                        </span>
                        {askPrice.pip && (
                            <span style={{
                                fontSize: 14, fontFamily: 'monospace', fontWeight: 700, color: '#fff',
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
                        minWidth: 48,
                        height: 52,
                        minHeight: 52,
                        maxHeight: 52,
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
                    disabled={isPlacing || !isVolumeValid}
                    style={{
                        ...sharedButtonStyle,
                        background: flashSide === 'sell'
                            ? 'linear-gradient(180deg, #991b1b 0%, #7f1d1d 100%)'
                            : 'linear-gradient(180deg, #dc2626 0%, #b91c1c 50%, #991b1b 100%)',
                        borderLeft: 'none',
                    }}
                    onMouseEnter={(e) => { if (!flashSide) e.currentTarget.style.background = 'linear-gradient(180deg, #ef4444 0%, #dc2626 50%, #b91c1c 100%)'; }}
                    onMouseLeave={(e) => { if (!flashSide) e.currentTarget.style.background = 'linear-gradient(180deg, #dc2626 0%, #b91c1c 50%, #991b1b 100%)'; }}
                >
                    <span style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.7)', letterSpacing: '1px', textTransform: 'uppercase' }}>
                        SELL
                    </span>
                    <div style={{ display: 'flex', alignItems: 'baseline', lineHeight: 1, marginTop: 2 }}>
                        <span style={{
                            fontSize: 12, fontFamily: 'monospace', fontWeight: 500, color: '#fff',
                            textShadow: bidFlash === 'down' ? '0 0 8px #ff6b6b' : bidFlash === 'up' ? '0 0 8px #6bff6b' : 'none',
                        }}>
                            {bidPrice.small}
                        </span>
                        <span style={{
                            fontSize: 28, fontFamily: 'monospace', fontWeight: 900, color: '#fff', lineHeight: 0.85,
                            textShadow: bidFlash === 'down' ? '0 0 12px #ff6b6b' : bidFlash === 'up' ? '0 0 12px #6bff6b' : '0 1px 3px rgba(0,0,0,0.5)',
                        }}>
                            {bidPrice.big}
                        </span>
                        {bidPrice.pip && (
                            <span style={{
                                fontSize: 14, fontFamily: 'monospace', fontWeight: 700, color: '#fff',
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
        </div>
    );
};

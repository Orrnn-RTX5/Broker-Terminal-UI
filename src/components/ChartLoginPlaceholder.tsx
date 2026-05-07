/**
 * ChartLoginPlaceholder
 *
 * Shown in Chart panels when the user is not yet authenticated.
 * Displays the pair name, a lock icon, sample pairs, and a login prompt.
 * No live data is fetched — completely static.
 */

import React from 'react';

interface ChartLoginPlaceholderProps {
    symbol?: string;
}


// Generates a static "fake" candlestick bar SVG path to give a chart-like feel
function FakeCandlestickSVG() {
    const bars = [
        { x: 12, open: 78, close: 62, high: 82, low: 58 },
        { x: 28, open: 62, close: 70, high: 74, low: 55 },
        { x: 44, open: 70, close: 58, high: 73, low: 52 },
        { x: 60, open: 58, close: 72, high: 76, low: 54 },
        { x: 76, open: 72, close: 65, high: 78, low: 61 },
        { x: 92, open: 65, close: 76, high: 80, low: 62 },
        { x: 108, open: 76, close: 60, high: 79, low: 56 },
        { x: 124, open: 60, close: 68, high: 72, low: 55 },
        { x: 140, open: 68, close: 82, high: 85, low: 65 },
        { x: 156, open: 82, close: 74, high: 86, low: 70 },
        { x: 172, open: 74, close: 80, high: 83, low: 70 },
        { x: 188, open: 80, close: 72, high: 84, low: 68 },
        { x: 204, open: 72, close: 78, high: 81, low: 68 },
        { x: 220, open: 78, close: 64, high: 81, low: 60 },
        { x: 236, open: 64, close: 70, high: 73, low: 60 },
        { x: 252, open: 70, close: 76, high: 79, low: 66 },
    ];

    return (
        <svg
            viewBox="0 0 270 100"
            width="100%"
            height="100%"
            style={{ opacity: 0.18 }}
            preserveAspectRatio="none"
        >
            {bars.map((bar, i) => {
                const isBull = bar.close >= bar.open;
                const color = isBull ? '#22c55e' : '#ef4444';
                const top = Math.min(bar.open, bar.close);
                const bottom = Math.max(bar.open, bar.close);
                const bodyH = Math.max(1, bottom - top);
                return (
                    <g key={i}>
                        {/* Wick */}
                        <line
                            x1={bar.x} y1={bar.high}
                            x2={bar.x} y2={bar.low}
                            stroke={color} strokeWidth={1}
                        />
                        {/* Body */}
                        <rect
                            x={bar.x - 5}
                            y={top}
                            width={10}
                            height={bodyH}
                            fill={color}
                        />
                    </g>
                );
            })}
        </svg>
    );
}

export function ChartLoginPlaceholder({ symbol = 'CHART' }: ChartLoginPlaceholderProps) {
    return (
        <div
            style={{
                width: '100%',
                height: '100%',
                background: '#0d0d11',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                overflow: 'hidden',
                fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
        >
            {/* Background fake chart */}
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                <FakeCandlestickSVG />
            </div>

            {/* Dark gradient overlay on top of the fake chart */}
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'radial-gradient(ellipse at center, rgba(19,23,34,0.78) 30%, rgba(19,23,34,0.95) 100%)',
                    pointerEvents: 'none',
                }}
            />

            {/* Content */}
            <div
                style={{
                    position: 'relative',
                    zIndex: 2,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 20,
                    maxWidth: 480,
                    padding: '0 24px',
                    textAlign: 'center',
                }}
            >
                {/* Lock icon */}
                <div
                    style={{
                        width: 56,
                        height: 56,
                        borderRadius: 14,
                        background: 'rgba(16,185,129,0.1)',
                        border: '1px solid rgba(16,185,129,0.25)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 0 28px rgba(16,185,129,0.15)',
                    }}
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                </div>

                {/* Symbol name */}
                <div>
                    <div
                        style={{
                            fontSize: 22,
                            fontWeight: 700,
                            color: '#f4f4f5',
                            letterSpacing: '0.08em',
                        }}
                    >
                        {symbol}
                    </div>
                    <div style={{ fontSize: 12, color: '#52525b', marginTop: 4, letterSpacing: '0.04em' }}>
                        CANDLESTICK CHART
                    </div>
                </div>

                {/* Message */}
                <div>
                    <p style={{ fontSize: 14, color: '#a1a1aa', margin: 0, lineHeight: 1.6 }}>
                        Login to your trade account to view live charts
                    </p>
                    <p style={{ fontSize: 12, color: '#52525b', margin: '6px 0 0', lineHeight: 1.5 }}>
                        Connect via the terminal panel on the left to access<br />
                        real-time price data and candlestick charts.
                    </p>
                </div>


                {/* Subtle footer note */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        marginTop: 4,
                    }}
                >
                    <span
                        style={{
                            display: 'inline-block',
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: '#22c55e',
                            boxShadow: '0 0 4px #22c55e',
                        }}
                    />
                    <span style={{ fontSize: 11, color: '#3f3f46' }}>
                        Market feed connected — awaiting authentication
                    </span>
                </div>
            </div>
        </div>
    );
}

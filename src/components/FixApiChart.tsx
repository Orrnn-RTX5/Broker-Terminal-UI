import { useRef, useEffect, memo } from 'react';
import { CandlestickChart, CandlestickChartRef } from './charts/CandlestickChart';
import { useFixMarketData, CandleData } from '../hooks/useFixMarketData';

interface FixApiChartProps {
    symbol: string;
    timeframe?: string;
}

function FixApiChartComponent({ symbol, timeframe = 'M1' }: FixApiChartProps) {
    const chartRef = useRef<CandlestickChartRef>(null);

    const handleCandleUpdate = (candle: CandleData) => {
        chartRef.current?.updateCandle(candle);
    };

    const {
        status,
        isConnected,
        tickCount,
        lastPrice,
        historicalData,
        availableSymbols,
    } = useFixMarketData({
        symbol,
        timeframe,
        onCandleUpdate: handleCandleUpdate
    });

    // Track symbol/timeframe to know when a full reset is needed
    const prevSymbolRef = useRef(symbol);
    const prevTimeframeRef = useRef(timeframe);
    const isInitialLoadRef = useRef(true);

    // Only call setData (full chart reset) on first load or when symbol/timeframe changes.
    // Incremental updates (tick updates & new-minute candles) flow through onCandleUpdate
    // → updateCandle, which appends/updates a single bar without resetting the view.
    useEffect(() => {
        if (historicalData.length === 0) return;

        const symbolChanged = prevSymbolRef.current !== symbol;
        const timeframeChanged = prevTimeframeRef.current !== timeframe;

        if (isInitialLoadRef.current || symbolChanged || timeframeChanged) {
            chartRef.current?.setData(historicalData);
            isInitialLoadRef.current = false;
            prevSymbolRef.current = symbol;
            prevTimeframeRef.current = timeframe;
        }
    }, [historicalData, symbol, timeframe]);

    return (
        <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, background: '#0d0d11', position: 'relative' }}>
                <CandlestickChart
                    ref={chartRef}
                    symbol={symbol}
                    timeframe={timeframe}
                    data={historicalData}
                />
            </div>

            {/* Bottom Panel Overlay */}
            <div
                style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: '50px',
                    background: 'rgba(24, 24, 27, 0.9)',
                    borderTop: '1px solid #222226',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 12px',
                    zIndex: 10,
                    pointerEvents: 'none' // Let clicks pass through if needed
                }}
            >
                <div
                    style={{
                        background: 'rgba(16, 185, 129, 0.1)',
                        border: '1px solid rgba(16, 185, 129, 0.3)',
                        padding: '6px 12px',
                        borderRadius: '6px',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span
                            style={{
                                width: '6px',
                                height: '6px',
                                background: isConnected ? '#34d399' : '#ef4444',
                                borderRadius: '50%',
                                animation: isConnected ? 'pulse 1s infinite' : 'none',
                                boxShadow: isConnected ? '0 0 8px #10b981' : 'none',
                            }}
                        />
                        <span style={{ color: isConnected ? '#34d399' : '#ef4444', fontSize: '11px', fontWeight: 'bold' }}>
                            {isConnected ? 'FIX API 4.4' : 'FIX DISCONNECTED'}
                        </span>
                    </div>
                    <div style={{ color: '#10b981', fontSize: '9px' }}>
                        {status} | Symbols: {availableSymbols.length} | Ticks: {tickCount}
                    </div>
                </div>

                {lastPrice !== null && (
                    <div style={{ textAlign: 'right' }}>
                        <div
                            style={{
                                color: '#34d399',
                                fontSize: '18px',
                                fontFamily: 'monospace',
                                fontWeight: 'bold',
                            }}
                        >
                            {lastPrice.toFixed(5)}
                        </div>
                        <div style={{ color: '#71717a', fontSize: '9px' }}>{symbol}</div>
                    </div>
                )}
            </div>

            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
            `}</style>
        </div>
    );
}

export const FixApiChart = memo(FixApiChartComponent);

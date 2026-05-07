import React, { useEffect, useState, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import './LiveForexChart.css';
import { API_BASE_URL as API_BASE, WS_ENDPOINTS } from '../config/api';
import { useWebSocket } from '../hooks/useWebSocket';

interface OHLCCandle {
    time: number; // UNIX timestamp
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

const AVAILABLE_SYMBOLS = [
    'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF',
    'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'BTCUSD', 'ETHUSD',
    'XAUUSD', 'XAGUSD'
];

const TIMEFRAMES = [
    { label: '1m', value: '1m' },
    { label: '5m', value: '5m' },
    { label: '15m', value: '15m' },
    { label: '1h', value: '1h' },
    { label: '4h', value: '4h' },
    { label: '1D', value: '1d' }
];

// API_BASE imported from config

interface LiveForexChartProps {
    initialSymbol?: string;
    availableSymbols?: string[];
}

export const LiveForexChart: React.FC<LiveForexChartProps> = ({
    initialSymbol = 'EURUSD',
    availableSymbols
}) => {
    const symbols = availableSymbols || AVAILABLE_SYMBOLS;
    const [selectedSymbol, setSelectedSymbol] = useState(initialSymbol);
    const [selectedTimeframe, setSelectedTimeframe] = useState('5m');
    const [currentPrice, setCurrentPrice] = useState({ bid: 0, ask: 0, spread: 0 });
    const [ohlc, setOhlc] = useState({ open: 0, high: 0, low: 0, close: 0 });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const wsRef = useRef<WebSocket | null>(null);

    // Initialize chart
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            width: chartContainerRef.current.clientWidth,
            height: 500,
            layout: {
                background: { type: ColorType.Solid, color: '#1a1a1a' },
                textColor: '#d1d4dc',
            },
            grid: {
                vertLines: { color: '#2a2e39' },
                horzLines: { color: '#2a2e39' },
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
            },
        });

        const candleSeries = (chart as any).addCandlestickSeries({
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderVisible: false,
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350',
        });

        chartRef.current = chart;
        candleSeriesRef.current = candleSeries;

        // Handle resize
        const handleResize = () => {
            if (chartContainerRef.current && chartRef.current) {
                chartRef.current.applyOptions({
                    width: chartContainerRef.current.clientWidth,
                });
            }
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, []);

    // Fetch OHLC data when symbol or timeframe changes
    useEffect(() => {
        fetchOHLCData();
    }, [selectedSymbol, selectedTimeframe]);

    // WebSocket connection handled by useWebSocket hook and subscribe useEffect above

    const fetchOHLCData = async () => {
        try {
            setLoading(true);
            setError(null);

            const response = await fetch(
                `${API_BASE}/api/history/ohlc?symbol=${selectedSymbol}&timeframe=${selectedTimeframe}&limit=200`
            );

            if (!response.ok) {
                throw new Error(`Failed to fetch OHLC data: ${response.statusText}`);
            }

            const candles: OHLCCandle[] = await response.json();

            if (candles.length === 0) {
                setError(`No historical data available for ${selectedSymbol}`);
                return;
            }

            // Convert to Lightweight Charts format
            const chartData = candles.map(candle => ({
                time: candle.time as Time,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
            }));

            // Update chart
            if (candleSeriesRef.current) {
                candleSeriesRef.current.setData(chartData);
            }

            // Update current OHLC display
            const lastCandle = candles[candles.length - 1];
            setOhlc({
                open: lastCandle.open,
                high: lastCandle.high,
                low: lastCandle.low,
                close: lastCandle.close,
            });

            setLoading(false);
        } catch (err) {
            console.error('Error fetching OHLC data:', err);
            setError(err instanceof Error ? err.message : 'Failed to fetch data');
            setLoading(false);
        }
    };

    // Use centralized WebSocket with auto-reconnection
    const { subscribe } = useWebSocket({
        url: WS_ENDPOINTS.general,
        autoConnect: true,
    });

    // Subscribe to tick messages for selected symbol
    useEffect(() => {
        const unsubscribe = subscribe('*', (message: any) => {
            try {
                const data = message;

                if (data.type === 'tick' && data.symbol === selectedSymbol) {
                    setCurrentPrice({
                        bid: data.bid,
                        ask: data.ask,
                        spread: data.spread || (data.ask - data.bid),
                    });

                    // Update latest candle close price
                    setOhlc(prev => ({
                        ...prev,
                        close: (data.bid + data.ask) / 2,
                        high: Math.max(prev.high, (data.bid + data.ask) / 2),
                        low: Math.min(prev.low, (data.bid + data.ask) / 2),
                    }));
                }
            } catch (err) {
                console.error('Error parsing WebSocket message:', err);
            }
        });

        return () => {
            unsubscribe();
        };
    }, [selectedSymbol, subscribe]);

    const handleSymbolChange = (symbol: string) => {
        setSelectedSymbol(symbol);
    };

    const handleTimeframeChange = (tf: string) => {
        setSelectedTimeframe(tf);
    };

    return (
        <div className="live-forex-chart">
            <div className="chart-header">
                <div className="symbol-selector">
                    <label>Symbol:</label>
                    <select value={selectedSymbol} onChange={(e) => handleSymbolChange(e.target.value)}>
                        {symbols.map(symbol => (
                            <option key={symbol} value={symbol}>{symbol}</option>
                        ))}
                    </select>
                </div>

                <div className="price-display">
                    <div className="price-item">
                        <span className="label">Bid:</span>
                        <span className="value bid">{currentPrice.bid.toFixed(5)}</span>
                    </div>
                    <div className="price-item">
                        <span className="label">Ask:</span>
                        <span className="value ask">{currentPrice.ask.toFixed(5)}</span>
                    </div>
                    <div className="price-item">
                        <span className="label">Spread:</span>
                        <span className="value spread">{(currentPrice.spread * 10000).toFixed(1)} pips</span>
                    </div>
                </div>

                <div className="timeframe-selector">
                    {TIMEFRAMES.map(tf => (
                        <button
                            key={tf.value}
                            className={`tf-btn ${selectedTimeframe === tf.value ? 'active' : ''}`}
                            onClick={() => handleTimeframeChange(tf.value)}
                        >
                            {tf.label}
                        </button>
                    ))}
                </div>
            </div>

            {loading && (
                <div className="loading-overlay">
                    <div className="spinner"></div>
                    <p>Loading chart data...</p>
                </div>
            )}

            {error && (
                <div className="error-message">
                    <p>⚠️ {error}</p>
                    <button onClick={fetchOHLCData}>Retry</button>
                </div>
            )}

            <div className="chart-container" ref={chartContainerRef}></div>

            <div className="ohlc-display">
                <div className="ohlc-item">
                    <span className="label">O:</span>
                    <span className="value">{ohlc.open.toFixed(5)}</span>
                </div>
                <div className="ohlc-item">
                    <span className="label">H:</span>
                    <span className="value">{ohlc.high.toFixed(5)}</span>
                </div>
                <div className="ohlc-item">
                    <span className="label">L:</span>
                    <span className="value">{ohlc.low.toFixed(5)}</span>
                </div>
                <div className="ohlc-item">
                    <span className="label">C:</span>
                    <span className="value">{ohlc.close.toFixed(5)}</span>
                </div>
            </div>
        </div>
    );
};

export default LiveForexChart;

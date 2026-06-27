import React, { useEffect, useState, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import './LiveForexChart.css';
import { chartDataService, type CandleStreamSubscription } from '../services/chartDataService';
import { formatSpreadDisplayWithUnit } from '../utils/spread';

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
    { label: '1m', value: 'M1' },
    { label: '5m', value: 'M5' },
    { label: '15m', value: 'M15' },
    { label: '1h', value: 'H1' },
    { label: '4h', value: 'H4' },
    { label: '1D', value: 'D1' }
];

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
    const [selectedTimeframe, setSelectedTimeframe] = useState('M5');
    const [currentPrice, setCurrentPrice] = useState({ bid: 0, ask: 0, spread: 0 });
    const [ohlc, setOhlc] = useState({ open: 0, high: 0, low: 0, close: 0 });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const candlesRef = useRef<OHLCCandle[]>([]);
    const streamRef = useRef<CandleStreamSubscription | null>(null);

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

    useEffect(() => {
        const controller = new AbortController();
        let disposed = false;

        streamRef.current?.close();
        streamRef.current = null;
        candlesRef.current = [];
        candleSeriesRef.current?.setData([]);
        fetchOHLCData(controller.signal, () => disposed);

        streamRef.current = chartDataService.subscribeCandles({
            symbol: selectedSymbol,
            timeframe: selectedTimeframe,
            onSnapshot: (snapshot) => {
                if (disposed) return;
                candlesRef.current = snapshot;
                updateChart(snapshot);
            },
            onCandle: (candle) => {
                if (disposed) return;
                const repaint = chartDataService.shouldRepaintForCandle(candlesRef.current, candle);
                candlesRef.current = chartDataService.mergeCandle(candlesRef.current, candle);
                if (repaint) {
                    updateChart(candlesRef.current);
                } else {
                    candleSeriesRef.current?.update({
                        time: candle.time as Time,
                        open: candle.open,
                        high: candle.high,
                        low: candle.low,
                        close: candle.close,
                    });
                }
                setOhlc({
                    open: candle.open,
                    high: candle.high,
                    low: candle.low,
                    close: candle.close,
                });
                setCurrentPrice(prev => ({
                    bid: candle.close,
                    ask: prev.ask || candle.close,
                    spread: prev.spread,
                }));
            },
            onError: (err) => {
                if (!disposed) setError(err.message);
            },
        });

        return () => {
            disposed = true;
            controller.abort();
            streamRef.current?.close();
            streamRef.current = null;
        };
    }, [selectedSymbol, selectedTimeframe]);

    const updateChart = (candles: OHLCCandle[]) => {
        const chartData = candles.map(candle => ({
            time: candle.time as Time,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
        }));

        candleSeriesRef.current?.setData(chartData);

        const lastCandle = candles[candles.length - 1];
        if (!lastCandle) return;

        setOhlc({
            open: lastCandle.open,
            high: lastCandle.high,
            low: lastCandle.low,
            close: lastCandle.close,
        });
        setCurrentPrice(prev => ({
            bid: lastCandle.close,
            ask: prev.ask || lastCandle.close,
            spread: prev.spread,
        }));
    };

    const fetchOHLCData = async (signal?: AbortSignal, isDisposed: () => boolean = () => false) => {
        try {
            setLoading(true);
            setError(null);

            const candles = await chartDataService.fetchCandles({
                symbol: selectedSymbol,
                timeframe: selectedTimeframe,
                signal,
            });
            if (isDisposed()) return;

            if (candles.length === 0) {
                setError(`No historical data available for ${selectedSymbol}`);
                return;
            }

            candlesRef.current = candles;
            updateChart(candles);
            setLoading(false);
        } catch (err) {
            if ((err as Error).name === 'AbortError') return;
            console.error('Error fetching OHLC data:', err);
            setError(err instanceof Error ? err.message : 'Failed to fetch data');
            setLoading(false);
        }
    };

    const handleSymbolChange = (symbol: string) => {
        setSelectedSymbol(symbol);
    };

    const handleTimeframeChange = (tf: string) => {
        setSelectedTimeframe(tf);
    };

    const spreadDisplay = formatSpreadDisplayWithUnit(
        selectedSymbol,
        currentPrice.spread,
        currentPrice.bid,
        currentPrice.ask
    );

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
                        <span className="value spread">{spreadDisplay}</span>
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
                    <button onClick={() => fetchOHLCData()}>Retry</button>
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

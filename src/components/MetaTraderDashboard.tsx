import React, { useState, useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, LineSeries, BarSeries, HistogramSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import './MetaTraderDashboard.css';
import { buildApiV2WsUrl } from '../config/api';
import { getAuthToken } from '../api/client';
import { tradeGatewayApi } from '../api/tradeGateway';
import { useTradeFacingData } from '../hooks/useTradeFacingData';

// Exact MetaTrader-style SVGs for all requested icons
const ToolIcons = {
    // Standard Tools
    Cursor: () => (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
            <path d="M4 2l10 7-4 1 2 4-2 1-2-4-4 3V2z" />
        </svg>
    ),
    Crosshair: () => (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.2">
            <circle cx="9" cy="9" r="3" />
            <path d="M9 1v16M1 9h16" />
        </svg>
    ),
    VerticalLine: () => (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 2v14" />
            <circle cx="9" cy="4" r="1" fill="currentColor" />
            <circle cx="9" cy="14" r="1" fill="currentColor" />
        </svg>
    ),
    HorizontalLine: () => (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 9h14" />
            <circle cx="4" cy="9" r="1" fill="currentColor" />
            <circle cx="14" cy="9" r="1" fill="currentColor" />
        </svg>
    ),
    TrendLine: () => (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 15L15 3" />
            <circle cx="3" cy="15" r="1" fill="currentColor" />
            <circle cx="15" cy="3" r="1" fill="currentColor" />
        </svg>
    ),
    Channel: () => (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M3 12L12 3M6 15L15 6" />
            <circle cx="3" cy="12" r="1" fill="currentColor" />
            <circle cx="12" cy="3" r="1" fill="currentColor" />
        </svg>
    ),
    Fibonacci: () => (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M2 16L16 2M2 13h14M2 10h14M2 7h14M2 4h14" />
        </svg>
    ),
    Text: () => (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
            <path d="M4 4h10v2h-4v8h-2v-8h-4z" />
        </svg>
    ),
    Shapes: () => (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
            <path d="M3 3h6v6h-6zM10 3l5 3-5 3zM12.5 10a2.5 2.5 0 100 5 2.5 2.5 0 000-5z" />
            <path d="M16 16l-2-2" stroke="currentColor" />
        </svg>
    ),

    // Chart Types & Controls
    Bars: () => (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 6v6M3 9h1M8 4v10M7 7h1M12 8v6M11 11h1" />
        </svg>
    ),
    Candlesticks: () => (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
            <rect x="3" y="6" width="3" height="6" />
            <path d="M4.5 2v4M4.5 12v14" />
            <rect x="7.5" y="4" width="3" height="8" />
            <path d="M9 2v2M9 12v4" />
            <rect x="12" y="7" width="3" height="5" />
            <path d="M13.5 2v5M13.5 12v4" />
        </svg>
    ),
    LineChart: () => (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 14l4-6 3 3 4-8 3 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    ),
    ZoomIn: () => (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="5" />
            <path d="M12 12l4 4M8 5v6M5 8h6" />
        </svg>
    ),
    ZoomOut: () => (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="5" />
            <path d="M12 12l4 4M5 8h6" />
        </svg>
    ),
    TileWindows: () => (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="3" y="3" width="5" height="5" />
            <rect x="10" y="3" width="5" height="5" />
            <rect x="3" y="10" width="5" height="5" />
            <rect x="10" y="10" width="5" height="5" />
        </svg>
    ),
    AutoScroll: () => (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor">
            <rect x="3" y="5" width="12" height="8" strokeWidth="1" />
            <path d="M15 9l-3-2v4z" fill="#26A69A" stroke="none" />
        </svg>
    ),
    ChartShift: () => (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor">
            <rect x="3" y="5" width="8" height="8" strokeWidth="1" />
            <path d="M11 9l-3-2v4z" fill="#26A69A" stroke="none" />
        </svg>
    ),

    // Action Tools
    AlgoTrading: () => (
        <svg width="80" height="18" viewBox="0 0 80 18" style={{ background: '#F0F0F0', borderRadius: '2px' }}>
            <rect x="2" y="2" width="14" height="14" fill="#EF5350" rx="1" />
            <text x="22" y="13" fontSize="9" fontWeight="bold" fill="#333">Algo Trading</text>
        </svg>
    ),
    NewOrder: () => (
        <svg width="70" height="18" viewBox="0 0 70 18" style={{ background: '#F0F0F0', borderRadius: '2px' }}>
            <rect x="2" y="2" width="14" height="14" fill="#8a8a8f" rx="1" />
            <path d="M6 9h6M9 6v6" stroke="white" strokeWidth="2" />
            <text x="22" y="13" fontSize="9" fontWeight="bold" fill="#333">New Order</text>
        </svg>
    ),

    // Navigation Tools
    MarketWatch: () => (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
            <rect x="3" y="3" width="12" height="12" fill="none" stroke="currentColor" />
            <path d="M5 6h8M5 9h8M5 12h8" strokeWidth="1.5" />
            <circle cx="13" cy="6" r="1.5" fill="#EF5350" />
            <circle cx="13" cy="12" r="1.5" fill="#26A69A" />
        </svg>
    ),
    Navigator: () => (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="#FACC15">
            <path d="M9 2l2 5h5l-4 3 2 6-5-4-5 4 2-6-4-3h5z" />
        </svg>
    ),
    ThumbsUp: () => (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
        </svg>
    ),
    ThumbsDown: () => (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" />
        </svg>
    ),
    ArrowUpObj: () => (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
    ),
    ArrowDownObj: () => (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
    ),
    StopSign: () => (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
    ),
    CheckSign: () => (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    ),
    ChevronDown: () => (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M1 3l4 4 4-4" />
        </svg>
    ),
    Arrow: () => (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
    ),
};

interface OHLC {
    time: Time | number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}
// Removed unused ChartTool interface
type ChartType = 'candlestick' | 'bar' | 'line';
type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1' | 'MN';

const MetaTraderDashboard: React.FC = () => {
    useTradeFacingData(undefined, 15000);
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<any> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

    const [selectedTool, setSelectedTool] = useState<any>('cursor');
    const [selectedChartType, setSelectedChartType] = useState<ChartType>('candlestick');
    const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>('M1');
    const [selectedSymbol] = useState('EURUSD');
    const [autoScroll, setAutoScroll] = useState(true);
    const [chartShift, setChartShift] = useState(true);
    const [showShapesMenu, setShowShapesMenu] = useState(false);

    const [currentPrice, setCurrentPrice] = useState<number>(0);
    const [priceChange, setPriceChange] = useState<number>(0);

    const timeframes: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN'];
    const timeframeMap: Record<Timeframe, string> = {
        'M1': 'M1', 'M5': 'M5', 'M15': 'M15', 'M30': 'M30',
        'H1': 'H1', 'H4': 'H4', 'D1': 'D1', 'W1': 'W1', 'MN': 'MN'
    };

    // Initialize chart
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
            layout: {
                background: { color: '#000000' },
                textColor: '#D1D4DC',
                fontSize: 12,
                fontFamily: 'Inter, sans-serif',
            },
            grid: {
                vertLines: { color: 'transparent' },
                horzLines: { color: 'transparent' },
            },
            crosshair: {
                mode: 1,
                vertLine: { color: '#FFFFFF', width: 1, style: 2, labelBackgroundColor: '#555555' },
                horzLine: { color: '#FFFFFF', width: 1, style: 2, labelBackgroundColor: '#555555' },
            },
            rightPriceScale: {
                borderColor: 'rgba(255, 255, 255, 0.2)',
                borderVisible: true,
                scaleMargins: {
                    top: 0.1,
                    bottom: 0.2, // Leave room for volume
                }
            },
            timeScale: {
                borderColor: 'rgba(255, 255, 255, 0.2)',
                borderVisible: true,
                timeVisible: true,
                rightOffset: 5,
            },
        });

        chartRef.current = chart;

        // Custom "Green on Black" Candle Style
        const mainSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#000000',         // Hollow (black match bg)
            downColor: '#FFFFFF',       // Filled White
            borderVisible: true,
            wickVisible: true,
            borderUpColor: '#00FF00',   // Lime Green
            borderDownColor: '#00FF00', // Lime Green (Standard MT4 GreenOnBlack)
            wickUpColor: '#00FF00',     // Lime Green
            wickDownColor: '#00FF00',   // Lime Green
        });
        seriesRef.current = mainSeries;

        const volumeSeries = chart.addSeries(HistogramSeries, {
            color: '#26a69a',
            priceFormat: { type: 'volume' },
            priceScaleId: '', // Overlay
        });
        volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        volumeSeriesRef.current = volumeSeries;

        updateChartType(selectedChartType);

        let cleanupPointerUp: (() => void) | null = null;
        let cleanupCrosshair: (() => void) | null = null;

        // Drawing Manager Integration
        import('../services/drawingManager').then(({ drawingManager }) => {
            drawingManager.setChart(chart, seriesRef.current);

            // Flag for tracking continuous freehand drawing
            let isDrawingFreehand = false;

            const clickHandler = (param: any) => {
                if (!param.time || !param.point || !seriesRef.current) return;
                const activeDrawing = drawingManager.getActiveDrawing();
                if (activeDrawing && activeDrawing.type !== 'freehand') {
                    const price = seriesRef.current.coordinateToPrice(param.point.y);
                    const seriesData = param.seriesData.get(seriesRef.current);
                    if (price !== null) {
                        drawingManager.addPoint(param.time as number, price, seriesData);
                    }
                }
            };
            chart.subscribeClick(clickHandler);

            if (chartContainerRef.current) {
                chartContainerRef.current.addEventListener('pointerdown', (e) => {
                    const activeDrawing = drawingManager.getActiveDrawing();
                    if (activeDrawing && activeDrawing.type === 'freehand') {
                        isDrawingFreehand = true;
                    }
                });
            }

            const handlePointerUp = () => {
                if (isDrawingFreehand) {
                    isDrawingFreehand = false;
                    const activeDrawing = drawingManager.getActiveDrawing();
                    if (activeDrawing && activeDrawing.points.length > 1) {
                        drawingManager.finishDrawing();
                    } else if (activeDrawing) {
                        drawingManager.cancelDrawing();
                    }
                }
            };
            window.addEventListener('pointerup', handlePointerUp);
            cleanupPointerUp = () => window.removeEventListener('pointerup', handlePointerUp);

            const crosshairHandler = (param: any) => {
                if (isDrawingFreehand && param.time && param.point && seriesRef.current) {
                    const price = seriesRef.current.coordinateToPrice(param.point.y);
                    const seriesData = param.seriesData.get(seriesRef.current);
                    if (price !== null) {
                        drawingManager.addPoint(param.time as number, price, seriesData);
                        drawingManager.renderAllDrawings(); // Force update during drag
                    }
                }
            };
            chart.subscribeCrosshairMove(crosshairHandler);
            cleanupCrosshair = () => chart.unsubscribeCrosshairMove(crosshairHandler);
        });

        const handleResize = () => {
            if (chartContainerRef.current && chartRef.current) {
                chartRef.current.applyOptions({
                    width: chartContainerRef.current.clientWidth,
                    height: chartContainerRef.current.clientHeight,
                });
            }
        };
        window.addEventListener('resize', handleResize);
        fetchHistoricalData();

        return () => {
            window.removeEventListener('resize', handleResize);
            if (cleanupPointerUp) cleanupPointerUp();
            if (cleanupCrosshair) cleanupCrosshair();
            if (chartRef.current) chartRef.current.remove();
        };
    }, []);

    // WebSocket for Live Data
    useEffect(() => {
        const token = getAuthToken() || undefined;
        const apiTimeframe = timeframeMap[selectedTimeframe];
        const ws = new WebSocket(buildApiV2WsUrl(token));

        ws.onopen = () => {
            console.log('[Dashboard] WebSocket Connected');
            if (token) ws.send(JSON.stringify({ action: 'auth', token }));
            ws.send(JSON.stringify({ action: 'subscribe', channel: `ticks.${selectedSymbol}` }));
            ws.send(JSON.stringify({ action: 'subscribe', channel: `candles.${selectedSymbol}.${apiTimeframe}` }));
        };

        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            const channel = String(message.channel ?? '');
            const data = message.data ?? message.payload ?? message;
            // console.log('[Dashboard] WS Message:', data.type); // Uncomment for verbose debug
            if ((channel === `ticks.${selectedSymbol}` || (data.symbol === selectedSymbol && data.bid != null)) && seriesRef.current) {
                const tickPrice = data.bid; // Or ask, or mid
                const rawTickTime = Number(data.time ?? data.timestamp);
                const tickTime = (
                    Number.isFinite(rawTickTime)
                        ? Math.floor(rawTickTime > 1_000_000_000_000 ? rawTickTime / 1000 : rawTickTime)
                        : Math.floor(Date.now() / 1000)
                ) as Time;

                // Get current candle data
                // Note: Lightweight-charts doesn't strictly expose "getLastCandle", we have to manage state or rely on series update logic
                // For simplicity, we assume we are updating the latest bar or creating a new one if time boundary crosses

                // Logic:
                // 1. Get last candle time.
                // 2. If tickTime is within same candle interval, update close/high/low.
                // 3. If tickTime is new candle, create new candle.

                // Since this is complex to sync perfectly without maintaining local state of the last candle,
                // we will rely on the "update" method which usually handles "current bar" updates for the same time.
                // HOWEVER, we need to quantize time to the timeframe.

                // Simple quantization for common timeframes (M1, M5, etc)
                // We need to parse selectedTimeframe to seconds
                let tfSecs = 60;
                if (selectedTimeframe === 'M5') tfSecs = 300;
                if (selectedTimeframe === 'M15') tfSecs = 900;
                if (selectedTimeframe === 'H1') tfSecs = 3600;
                if (selectedTimeframe === 'D1') tfSecs = 86400;

                const candleTime = (Math.floor(tickTime as number / tfSecs) * tfSecs) as number;

                // We need to know previous candle values to update high/low properly if we don't have them in state.
                // A reliable way is to keep 'lastCandle' ref.

                // But for now, let's try just updating with the "update" method which automatically handles "last bar" update if time matches.
                // If time is new, it adds a new bar.

                // To do this correctly solely from tick, we need to know the OPEN of the new bar if it's new.
                // If we rely on the chart to handle "update", we might miss "High" if we simply send Close.
                // Lightweight charts `update` takes a BarData.

                // Fetch cached last bar from chart data? (Not easily accessible efficiently).
                // Let's rely on backend providing history, and then here we just push updates.
                // The most robust way for a "simple" frontend without full engine logic:
                // 1. Update current price display.
                // 2. Refresh history periodically? NO, too heavy.
                // 3. Maintain a `lastCandle` ref.

                setCurrentPrice(tickPrice);
                // Calculate change based on daily open? Or previous candle close?
                // For now, simple diff from previous tick not stored.

                // Construct bar update
                const lastBar = lastCandleRef.current;

                if (lastBar && lastBar.time === candleTime) {
                    // Update existing
                    const newBar = {
                        ...lastBar,
                        close: tickPrice,
                        high: Math.max(lastBar.high, tickPrice),
                        low: Math.min(lastBar.low, tickPrice),
                        volume: (lastBar.volume || 0) + 1
                    };
                    seriesRef.current.update(newBar);
                    lastCandleRef.current = newBar;
                } else {
                    // New bar (or first bar)
                    const newBar = {
                        time: candleTime,
                        open: tickPrice,
                        high: tickPrice,
                        low: tickPrice,
                        close: tickPrice,
                        volume: 1
                    };
                    seriesRef.current.update(newBar);
                    lastCandleRef.current = newBar;
                }
            }

            if (channel === `candles.${selectedSymbol}.${apiTimeframe}` && seriesRef.current) {
                const candle = Array.isArray(data) ? data[data.length - 1] : data;
                if (!candle || candle.open == null || candle.close == null) return;
                const nextBar = {
                    time: candle.time as Time,
                    open: candle.open,
                    high: candle.high,
                    low: candle.low,
                    close: candle.close,
                    volume: candle.volume || candle.tick_count || 0,
                };
                seriesRef.current.update(nextBar);
                lastCandleRef.current = nextBar;
            }
        };

        return () => ws.close();
    }, [selectedSymbol, selectedTimeframe]);

    useEffect(() => {
        if (chartRef.current) {
            updateChartType(selectedChartType);
            fetchHistoricalData();
        }
    }, [selectedChartType]);

    useEffect(() => { fetchHistoricalData(); }, [selectedTimeframe, selectedSymbol]);

    // Ref to track last candle for updates
    const lastCandleRef = useRef<OHLC | null>(null);

    const updateChartType = (type: ChartType) => {
        if (!chartRef.current) return;

        // Remove old series if exists
        if (seriesRef.current) {
            chartRef.current.removeSeries(seriesRef.current);
        }

        let newSeries;
        if (type === 'candlestick') {
            newSeries = chartRef.current.addSeries(CandlestickSeries, {
                upColor: '#000000',
                downColor: '#FFFFFF',
                borderVisible: true,
                wickVisible: true,
                borderUpColor: '#00FF00',
                borderDownColor: '#00FF00',
                wickUpColor: '#00FF00',
                wickDownColor: '#00FF00',
            });
        } else if (type === 'bar') {
            newSeries = chartRef.current.addSeries(BarSeries, {
                upColor: '#00FF00',
                downColor: '#FFFFFF',
            });
        } else {
            newSeries = chartRef.current.addSeries(LineSeries, {
                color: '#00FF00', // Lime line
                lineWidth: 2,
            });
        }
        seriesRef.current = newSeries;

        // Re-sync drawing manager with new series
        import('../services/drawingManager').then(({ drawingManager }) => {
            drawingManager.setChart(chartRef.current, seriesRef.current);
        });

        // Removed hardcoded demo price lines
    };

    const fetchHistoricalData = async () => {
        try {
            const apiTimeframe = timeframeMap[selectedTimeframe];
            const response = await fetch(tradeGatewayApi.getHistoryUrl(selectedSymbol, apiTimeframe, 500));
            const data = await response.json();
            console.log('[Dashboard] History Fetch:', data);
            const candlesArray = Array.isArray(data) ? data : data?.candles || [];

            if (candlesArray.length > 0 && seriesRef.current && volumeSeriesRef.current) {
                console.log(`[Dashboard] Loaded ${candlesArray.length} candles for ${selectedSymbol}`);
                const candles = candlesArray.map((c: OHLC) => ({
                    time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close,
                }));
                const volumes = candlesArray.map((c: OHLC & { tick_count?: number }) => ({
                    time: c.time as Time, value: c.volume || c.tick_count || 0,
                    color: c.close >= c.open ? '#26a69a80' : '#ef535080',
                }));

                if (selectedChartType === 'candlestick' || selectedChartType === 'bar') {
                    seriesRef.current.setData(candles);
                } else {
                    seriesRef.current.setData(candles.map((c: any) => ({ time: c.time, value: c.close })));
                }
                volumeSeriesRef.current.setData(volumes);

                // Force visibility
                if (chartRef.current) {
                    chartRef.current.timeScale().fitContent();
                }

                if (candles.length > 0) {
                    const latest = candles[candles.length - 1];
                    setCurrentPrice(latest.close);
                    setPriceChange(latest.close - candles[0].open);
                    lastCandleRef.current = latest; // Sync ref
                }
            }
        } catch (error) { console.error('Error fetching historical data:', error); }
    };

    return (
        <div className="metatrader-dashboard">
            {/* MT5 Style Menubar */}
            <div className="mt-menubar">
                <span>File</span><span>View</span><span>Insert</span><span>Charts</span><span>Tools</span><span>Window</span><span>Help</span>
            </div>

            {/* MT5 Dense Toolbar */}
            <div className="mt-toolbar">
                {/* Group 1: General Navigation */}
                <div className="mt-toolbar-group">
                    <button className="mt-tool-btn"><ToolIcons.MarketWatch /></button>
                    <button className="mt-tool-btn"><ToolIcons.Navigator /></button>
                    <div className="mt-v-divider"></div>
                    <button className="mt-tool-btn"><ToolIcons.AlgoTrading /></button>
                    <button className="mt-tool-btn"><ToolIcons.NewOrder /></button>
                </div>

                <div className="mt-v-divider"></div>

                {/* Group 2: Chart Control Icons (requested) */}
                <div className="mt-toolbar-group">
                    <button className={`mt-tool-btn ${selectedChartType === 'bar' ? 'active' : ''}`} onClick={() => setSelectedChartType('bar')}><ToolIcons.Bars /></button>
                    <button className={`mt-tool-btn ${selectedChartType === 'candlestick' ? 'active' : ''}`} onClick={() => setSelectedChartType('candlestick')}><ToolIcons.Candlesticks /></button>
                    <button className={`mt-tool-btn ${selectedChartType === 'line' ? 'active' : ''}`} onClick={() => setSelectedChartType('line')}><ToolIcons.LineChart /></button>
                    <div className="mt-v-divider"></div>
                    <button className="mt-tool-btn" onClick={() => chartRef.current?.timeScale().scrollToPosition(2, false)}><ToolIcons.ZoomIn /></button>
                    <button className="mt-tool-btn" onClick={() => chartRef.current?.timeScale().scrollToPosition(-2, false)}><ToolIcons.ZoomOut /></button>
                    <button className="mt-tool-btn"><ToolIcons.TileWindows /></button>
                    <div className="mt-v-divider"></div>
                    <button className={`mt-tool-btn ${autoScroll ? 'active' : ''}`} onClick={() => setAutoScroll(!autoScroll)}><ToolIcons.AutoScroll /></button>
                    <button className={`mt-tool-btn ${chartShift ? 'active' : ''}`} onClick={() => setChartShift(!chartShift)}><ToolIcons.ChartShift /></button>
                </div>

                <div className="mt-v-divider"></div>

                {/* Group 3: Drawing Tools (Extended Beside Horizontal Line) */}
                <div className="mt-toolbar-group">
                    <button className={`mt-tool-btn ${selectedTool === 'cursor' ? 'active' : ''}`} onClick={() => setSelectedTool('cursor')}><ToolIcons.Cursor /></button>
                    <button className={`mt-tool-btn ${selectedTool === 'crosshair' ? 'active' : ''}`} onClick={() => setSelectedTool('crosshair')}><ToolIcons.Crosshair /></button>
                    <div className="mt-v-divider"></div>
                    <button className={`mt-tool-btn ${selectedTool === 'vertical' ? 'active' : ''}`} onClick={() => setSelectedTool('vertical')}><ToolIcons.VerticalLine /></button>
                    <button className={`mt-tool-btn ${selectedTool === 'horizontal' ? 'active' : ''}`} onClick={() => setSelectedTool('horizontal')}><ToolIcons.HorizontalLine /></button>
                    <button className={`mt-tool-btn ${selectedTool === 'trendline' ? 'active' : ''}`} onClick={() => setSelectedTool('trendline')}><ToolIcons.TrendLine /></button>
                    <button className={`mt-tool-btn ${selectedTool === 'channel' ? 'active' : ''}`} onClick={() => setSelectedTool('channel')}><ToolIcons.Channel /></button>
                    <button className={`mt-tool-btn ${selectedTool === 'fibonacci' ? 'active' : ''}`} onClick={() => {
                        setSelectedTool('fibonacci');
                        import('../services/drawingManager').then(({ drawingManager }) => drawingManager.startDrawing('fibonacci'));
                    }}><ToolIcons.Fibonacci /></button>
                    <button className={`mt-tool-btn ${selectedTool === 'text' ? 'active' : ''}`} onClick={() => {
                        setSelectedTool('text');
                        import('../services/drawingManager').then(({ drawingManager }) => drawingManager.startDrawing('text'));
                    }}><ToolIcons.Text /></button>

                    <div style={{ position: 'relative' }}>
                        <button
                            className={`mt-tool-btn ${showShapesMenu ? 'active' : ''}`}
                            onClick={() => setShowShapesMenu(!showShapesMenu)}
                        >
                            <ToolIcons.Shapes />
                            <ToolIcons.ChevronDown />
                        </button>
                        {showShapesMenu && (
                            <div className="mt-dropdown-menu">
                                <div className="mt-menu-item" onClick={() => { setSelectedTool('thumbs_up'); setShowShapesMenu(false); import('../services/drawingManager').then(({ drawingManager }) => drawingManager.startDrawing('shapes', '#22c55e')); }}>
                                    <ToolIcons.ThumbsUp /> <span>Thumbs Up</span>
                                </div>
                                <div className="mt-menu-item" onClick={() => { setSelectedTool('thumbs_down'); setShowShapesMenu(false); import('../services/drawingManager').then(({ drawingManager }) => drawingManager.startDrawing('shapes', '#ef4444')); }}>
                                    <ToolIcons.ThumbsDown /> <span>Thumbs Down</span>
                                </div>
                                <div className="mt-menu-item" onClick={() => { setSelectedTool('arrow_up'); setShowShapesMenu(false); import('../services/drawingManager').then(({ drawingManager }) => drawingManager.startDrawing('shapes', '#22c55e')); }}>
                                    <ToolIcons.ArrowUpObj /> <span>Arrow Up</span>
                                </div>
                                <div className="mt-menu-item" onClick={() => { setSelectedTool('arrow_down'); setShowShapesMenu(false); import('../services/drawingManager').then(({ drawingManager }) => drawingManager.startDrawing('shapes', '#ef4444')); }}>
                                    <ToolIcons.ArrowDownObj /> <span>Arrow Down</span>
                                </div>
                                <div className="mt-menu-item" onClick={() => { setSelectedTool('stop'); setShowShapesMenu(false); import('../services/drawingManager').then(({ drawingManager }) => drawingManager.startDrawing('shapes', '#ef4444')); }}>
                                    <ToolIcons.StopSign /> <span>Stop Sign</span>
                                </div>
                                <div className="mt-menu-item" onClick={() => { setSelectedTool('check'); setShowShapesMenu(false); import('../services/drawingManager').then(({ drawingManager }) => drawingManager.startDrawing('shapes', '#22c55e')); }}>
                                    <ToolIcons.CheckSign /> <span>Check Sign</span>
                                </div>
                                <div className="mt-menu-item" onClick={() => { setSelectedTool('buy'); setShowShapesMenu(false); import('../services/drawingManager').then(({ drawingManager }) => drawingManager.startDrawing('shapes', '#22c55e')); }}>
                                    <ToolIcons.ArrowUpObj /> <span>Buy</span>
                                </div>
                                <div className="mt-menu-item" onClick={() => { setSelectedTool('sell'); setShowShapesMenu(false); import('../services/drawingManager').then(({ drawingManager }) => drawingManager.startDrawing('shapes', '#ef4444')); }}>
                                    <ToolIcons.ArrowDownObj /> <span>Sell</span>
                                </div>
                                <div className="mt-menu-item" onClick={() => { setSelectedTool('arrow'); setShowShapesMenu(false); import('../services/drawingManager').then(({ drawingManager }) => drawingManager.startDrawing('shapes', '#2196F3')); }}>
                                    <ToolIcons.Arrow /> <span>Arrow</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-v-divider"></div>

                {/* Group 4: Timeframes */}
                <div className="mt-toolbar-group mt-timeframes-group">
                    {timeframes.map(tf => (
                        <button key={tf} className={`mt-tf-btn ${tf === selectedTimeframe ? 'active' : ''}`} onClick={() => setSelectedTimeframe(tf)}>{tf}</button>
                    ))}
                </div>
            </div>

            {/* Chart Area */}
            <div className="mt-chart-wrapper">
                <div className="mt-chart-container" ref={chartContainerRef}></div>
                <div className="mt-symbol-overlay">{selectedSymbol}, {selectedTimeframe}: Euro vs US Dollar</div>
                <div className="mt-price-overlay">
                    {currentPrice.toFixed(5)}
                    <span style={{ fontSize: '10px', marginLeft: '10px', color: priceChange >= 0 ? '#26A69A' : '#EF5350' }}>
                        {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(5)} ({((priceChange / currentPrice) * 100).toFixed(2)}%)
                    </span>
                </div>
                <div className="chart-drawing-overlay"></div>
            </div>
        </div>
    );
};

export default MetaTraderDashboard;

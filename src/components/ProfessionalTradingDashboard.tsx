
import React, { useState, useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts';

import { MarketWatch } from './MarketWatch';
import './ProfessionalTradingDashboard.css';
import { buildApiV2WsUrl } from '../config/api';
import { marketApi } from '../services/api';
import { useTradeFacingData } from '../hooks/useTradeFacingData';
import { getAuthToken } from '../api/client';
import { tradeApi } from '../api/trade';
import { getStoredAccountLogin, tradeGatewayApi } from '../api/tradeGateway';

// Icons as React components for better performance
const Icons = {
    Platform: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 4h6l3 3 7-5" />
            <path d="M2 10h6l3 3 7-5" opacity="0.65" />
            <path d="M2 16h6l3-3 7 5" opacity="0.45" />
        </svg>
    ),
    ChartWindow: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="2.5" width="16" height="15" rx="2" />
            <path d="M4 12l3-3 2 2 5-5" />
            <path d="M2 6.5h16" opacity="0.6" />
        </svg>
    ),
    Coin: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2.5" y="2.5" width="15" height="15" rx="2.5" />
            <path d="M10 5v10M7.5 7.5h4.5a2 2 0 010 4h-4a2 2 0 000 4h4.5" />
        </svg>
    ),
    IDE: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M7.5 6L4 10l3.5 4M12.5 6L16 10l-3.5 4" />
            <path d="M10.8 4L9.2 16" />
        </svg>
    ),
    Toolbox: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2.5" y="6" width="15" height="10.5" rx="2" />
            <path d="M7 6V4.5a1.5 1.5 0 011.5-1.5h3A1.5 1.5 0 0113 4.5V6" />
            <path d="M2.5 10.5h15" />
        </svg>
    ),
    Network: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="10" cy="4" r="2" />
            <circle cx="4.5" cy="14" r="2" />
            <circle cx="15.5" cy="14" r="2" />
            <path d="M10 6v4M8.5 11l-2.5 1.5M11.5 11l2.5 1.5" />
        </svg>
    ),
    CloudSync: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M5.5 15.5h8a3.5 3.5 0 000-7 4.5 4.5 0 00-8.6-1.4A3.4 3.4 0 005.5 15.5z" />
            <path d="M8 10.5h4M10 8.5l2 2-2 2" />
        </svg>
    ),
    Radar: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="10" cy="10" r="7" />
            <circle cx="10" cy="10" r="4" opacity="0.55" />
            <path d="M10 10l5-3" />
            <circle cx="15" cy="7" r="1" fill="currentColor" stroke="none" />
        </svg>
    ),
    StopSquare: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="4" y="4" width="12" height="12" rx="2" />
        </svg>
    ),
    NewOrder: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="14" height="14" rx="2" />
            <path d="M10 6v8M6 10h8" />
        </svg>
    ),
    SplitVertical: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2.5" y="3" width="15" height="14" rx="1.5" />
            <path d="M10 3v14" />
        </svg>
    ),
    Wave: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2.5 12c1.8 0 1.8-4 3.6-4s1.8 4 3.6 4 1.8-4 3.6-4 1.8 4 3.6 4" />
        </svg>
    ),
    CandleBars: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M5 3v14M4 7h2M4 13h2" />
            <path d="M10 5v10M9 9h2M9 12h2" />
            <path d="M15 2v16M14 6h2M14 11h2" />
        </svg>
    ),
    Grid: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="14" height="14" rx="1.5" />
            <path d="M3 8h14M3 12h14M8 3v14M12 3v14" />
        </svg>
    ),
    Speaker: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 11V9h3l4-3v8l-4-3H3z" />
            <path d="M13 8c1.5 1.4 1.5 2.6 0 4M15 6c3 2.6 3 5.4 0 8" />
        </svg>
    ),
    Camera: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2.5" y="5" width="15" height="11.5" rx="2" />
            <path d="M6 5l1.5-2h5L14 5" />
            <circle cx="10" cy="10.5" r="3" />
        </svg>
    ),
    CursorArrow: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 3v12l3-3h4L4 3z" fill="currentColor" stroke="none" />
        </svg>
    ),
    CloseX: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M6 6l8 8M14 6l-8 8" />
        </svg>
    ),
    Cross: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M10 3v14M3 10h14" />
        </svg>
    ),
    Segment: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 15L16 5" />
            <circle cx="4" cy="15" r="1.6" />
            <circle cx="16" cy="5" r="1.6" />
        </svg>
    ),
    Polyline: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 14l4-5 4 3 6-8" />
            <circle cx="3" cy="14" r="1.2" />
            <circle cx="7" cy="9" r="1.2" />
            <circle cx="11" cy="12" r="1.2" />
            <circle cx="17" cy="4" r="1.2" />
        </svg>
    ),
    Sliders: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 5h12M4 10h12M4 15h12" />
            <circle cx="8" cy="5" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="12" cy="10" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="6" cy="15" r="1.5" fill="currentColor" stroke="none" />
        </svg>
    ),
    Triangles: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 14l3-5 3 5H3zM11 14l3-5 3 5h-6zM7 7l3-5 3 5H7z" />
        </svg>
    ),
    Search: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="4.5" />
            <path d="M12 12l5 5" />
        </svg>
    ),
    BellDot: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M10 3a4 4 0 014 4c0 2.6.8 3.5 1.7 4.5H4.3C5.2 10.5 6 9.6 6 7a4 4 0 014-4z" />
            <path d="M8.5 14a1.5 1.5 0 003 0" />
            <circle cx="15.5" cy="4.5" r="2" fill="#ef4444" stroke="none" />
        </svg>
    ),
    Battery: () => (
        <svg width="28" height="16" viewBox="0 0 28 16" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="1" y="2" width="23" height="12" rx="1.8" />
            <path d="M24 6h3v4h-3" />
            <rect x="3" y="4" width="5" height="8" fill="#22c55e" stroke="none" />
        </svg>
    ),
    Crosshair: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 1v4M10 15v4M1 10h4M15 10h4M10 8a2 2 0 100 4 2 2 0 000-4z" stroke="currentColor" fill="none" strokeWidth="1.5" />
        </svg>
    ),
    TrendLine: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 17L17 3" />
        </svg>
    ),
    HorizontalLine: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 10h14" />
        </svg>
    ),
    VerticalLine: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M10 3v14" />
        </svg>
    ),
    Fibonacci: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 17L17 3M3 14h14M3 11h14M3 8h14M3 5h14" />
        </svg>
    ),
    Brush: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 2l4 4-10 10-4 2 2-4z" />
        </svg>
    ),
    Text: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6 4h8v2h-3v10h-2V6H6V4z" />
        </svg>
    ),
    Measure: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 3l14 14M17 3v14H3" />
        </svg>
    ),
    ZoomIn: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="5" />
            <path d="M12 12l5 5M8 5v6M5 8h6" />
        </svg>
    ),
    ZoomOut: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="5" />
            <path d="M12 12l5 5M5 8h6" />
        </svg>
    ),
    Settings: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="10" cy="10" r="3" />
            <path d="M10 1v2m0 14v2M19 10h-2M3 10H1m15.5-6.5l-1.4 1.4M5.9 14.1l-1.4 1.4m11-11l-1.4 1.4M5.9 5.9L4.5 4.5" />
        </svg>
    ),
    Indicator: () => (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 10h3l2-6 4 12 2-6h5" />
        </svg>
    ),
    ChevronDown: () => (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 6l4 4 4-4" />
        </svg>
    ),
};

interface OHLC {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}

type ChartTool = 'crosshair' | 'trendline' | 'horizontal' | 'vertical' | 'fibonacci' | 'brush' | 'text' | 'measure' | 'zoom_in' | 'zoom_out';
type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1D' | '1W' | '1M';
type Indicator = 'MA' | 'EMA' | 'RSI' | 'MACD' | 'BB' | 'Volume';
const toContractTimeframe = (timeframe: Timeframe): string => ({
    '1m': 'M1',
    '5m': 'M5',
    '15m': 'M15',
    '30m': 'M30',
    '1h': 'H1',
    '4h': 'H4',
    '1D': 'D1',
    '1W': 'W1',
    '1M': 'MN',
}[timeframe]);

const ProfessionalTradingDashboard: React.FC = () => {
    useTradeFacingData(undefined, 15000);
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const indicatorSeriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
    const wsRef = useRef<WebSocket | null>(null);

    // Chart Tab State
    const [openCharts, setOpenCharts] = useState<{ symbol: string; timeframe: Timeframe }[]>([
        { symbol: 'BTCUSD', timeframe: '1m' }
    ]);
    const [activeChartIndex, setActiveChartIndex] = useState(0);

    // Derived state for current view
    const selectedSymbol = openCharts[activeChartIndex]?.symbol || 'BTCUSD';
    const selectedTimeframe = openCharts[activeChartIndex]?.timeframe || '1m';

    // Helper to update current chart
    const setSelectedTimeframe = (tf: Timeframe) => {
        setOpenCharts(prev => prev.map((c, i) => i === activeChartIndex ? { ...c, timeframe: tf } : c));
    };

    const setSelectedSymbol = (symbol: string) => {
        const existingIndex = openCharts.findIndex(c => c.symbol === symbol);
        if (existingIndex >= 0) {
            setActiveChartIndex(existingIndex);
        } else {
            setOpenCharts(prev => [...prev, { symbol, timeframe: '1m' }]);
            setActiveChartIndex(openCharts.length);
        }
    };

    const handleCloseChart = (index: number) => {
        const newCharts = openCharts.filter((_, i) => i !== index);
        setOpenCharts(newCharts);

        if (index === activeChartIndex) {
            setActiveChartIndex(Math.max(0, index - 1));
        } else if (index < activeChartIndex) {
            setActiveChartIndex(activeChartIndex - 1);
        }
    };

    const [selectedTool, setSelectedTool] = useState<ChartTool>('crosshair');
    // Removed old useState definitions for selectedTimeframe and selectedSymbol as they are now derived
    const [activeIndicators, setActiveIndicators] = useState<Indicator[]>(['Volume']);
    const [marketWatchPosition, setMarketWatchPosition] = useState<'left' | 'right'>('left');

    const handlePanelDragStart = (e: React.DragEvent) => {
        e.dataTransfer.setData('text/plain', 'market-watch-panel');
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e: React.DragEvent, position: 'left' | 'right') => {
        e.preventDefault();
        setMarketWatchPosition(position);
    };

    const [currentPrice, setCurrentPrice] = useState<number>(0);
    const [bidPrice, setBidPrice] = useState<number>(0);
    const [askPrice, setAskPrice] = useState<number>(0);
    const [tradingVolume, setTradingVolume] = useState<number>(0.01);

    const [priceChange, setPriceChange] = useState<number>(0);
    const [priceChangePercent, setPriceChangePercent] = useState<number>(0);
    const [high24h, setHigh24h] = useState<number>(0);
    const [low24h, setLow24h] = useState<number>(0);
    const [volume24h, setVolume24h] = useState<number>(0);

    const [showIndicatorMenu, setShowIndicatorMenu] = useState(false);
    const [showSymbolMenu, setShowSymbolMenu] = useState(false);
    const [showSettingsMenu, setShowSettingsMenu] = useState(false);
    const [isAlgoTradingEnabled, setIsAlgoTradingEnabled] = useState(true);
    const [isGridVisible, setIsGridVisible] = useState(true);
    const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(false);
    const [isChartShiftEnabled, setIsChartShiftEnabled] = useState(true);
    const [activeChartVisual, setActiveChartVisual] = useState<'line' | 'candles'>('candles');
    const [activeRightTool, setActiveRightTool] = useState<string>('cursor');

    const timeframeButtons: Array<{ label: string; value: Timeframe }> = [
        { label: 'M1', value: '1m' },
        { label: 'M5', value: '5m' },
        { label: 'M15', value: '15m' },
        { label: 'M30', value: '30m' },
        { label: 'H1', value: '1h' },
        { label: 'H4', value: '4h' },
        { label: 'D1', value: '1D' },
        { label: 'W1', value: '1W' },
        { label: 'MN', value: '1M' },
    ];
    const indicators: Indicator[] = ['MA', 'EMA', 'RSI', 'MACD', 'BB', 'Volume'];
    // Full watchlist loaded dynamically from API
    const [symbols, setSymbols] = useState<string[]>([]);

    useEffect(() => {
        const fetchSymbols = async () => {
            try {
                const fetchedSymbols = await marketApi.getSymbols();
                if (fetchedSymbols && fetchedSymbols.length > 0) {
                    setSymbols(fetchedSymbols.map(s => s.id || s.name));
                }
            } catch (err) {
                console.error("Failed to fetch symbols for Professional Dashboard:", err);
            }
        };
        fetchSymbols();
    }, []);

    // Initialize chart
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
            layout: {
                background: { color: '#0F1419' },
                textColor: '#9BA3B5',
            },
            grid: {
                vertLines: { color: '#191a1e', style: 1 },
                horzLines: { color: '#191a1e', style: 1 },
            },
            crosshair: {
                mode: 1,
                vertLine: {
                    color: '#8a8a8f',
                    width: 1,
                    style: 3,
                    labelBackgroundColor: '#2563EB',
                },
                horzLine: {
                    color: '#8a8a8f',
                    width: 1,
                    style: 3,
                    labelBackgroundColor: '#2563EB',
                },
            },
            rightPriceScale: {
                borderColor: '#222226',
                borderVisible: true,
                scaleMargins: {
                    top: 0.1,
                    bottom: 0.2,
                },
            },
            timeScale: {
                borderColor: '#222226',
                borderVisible: true,
                timeVisible: true,
                secondsVisible: false,
            },
        });

        // Add candlestick series
        const candleSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#10B981',
            downColor: '#EF4444',
            borderUpColor: '#10B981',
            borderDownColor: '#EF4444',
            wickUpColor: '#10B981',
            wickDownColor: '#EF4444',
            lastValueVisible: false, // Fix: Eradicate ghost labels
            priceLineVisible: false,
        });

        // Add volume series
        const volumeSeries = chart.addSeries(HistogramSeries, {
            color: '#8a8a8f',
            priceFormat: {
                type: 'volume',
            },
            priceScaleId: '',
            lastValueVisible: false, // Fix: Eradicate ghost labels
            priceLineVisible: false,
        });

        chartRef.current = chart;
        candleSeriesRef.current = candleSeries;
        volumeSeriesRef.current = volumeSeries;

        // Handle resize
        const handleResize = () => {
            if (chartContainerRef.current && chartRef.current) {
                chartRef.current.applyOptions({
                    width: chartContainerRef.current.clientWidth,
                    height: chartContainerRef.current.clientHeight,
                });
            }
        };

        window.addEventListener('resize', handleResize);

        // Load initial data
        fetchHistoricalData();

        return () => {
            window.removeEventListener('resize', handleResize);
            if (chartRef.current) {
                chartRef.current.remove();
            }
        };
    }, []);

    // Handle Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {

            // Ctrl+F4 - Close active chart
            if (e.ctrlKey && e.key === 'F4') {
                e.preventDefault();
                if (openCharts.length > 1) {
                    handleCloseChart(activeChartIndex);
                }
            }
        };

        // Listen for close-active-chart event from menu
        const handleCloseEvent = () => {
            if (openCharts.length > 1) {
                handleCloseChart(activeChartIndex);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('close-active-chart', handleCloseEvent);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('close-active-chart', handleCloseEvent);
        };
    }, [openCharts.length, activeChartIndex]);



    // Update indicators
    useEffect(() => {
        if (!chartRef.current || !candleSeriesRef.current) return;

        const currentIndicators = indicatorSeriesRef.current;

        // Remove inactive indicators
        currentIndicators.forEach((series: ISeriesApi<'Line'>, name: string) => {
            if (!activeIndicators.includes(name as Indicator)) {
                chartRef.current?.removeSeries(series);
                currentIndicators.delete(name);
            }
        });

        // Add active indicators
        activeIndicators.forEach((indicator: Indicator) => {
            if (indicator === 'Volume') return; // Handled separately
            if (!currentIndicators.has(indicator)) {
                const color = indicator === 'MA' ? '#8a8a8f' : '#F59E0B';
                const series = chartRef.current!.addSeries(LineSeries, {
                    color,
                    lineWidth: 2,
                    title: indicator,
                    priceScaleId: 'right',
                    lastValueVisible: false, // Fix: Eradicate ghost labels
                    priceLineVisible: false,
                });
                currentIndicators.set(indicator, series);
            }
        });
    }, [activeIndicators]);

    // Fetch historical data
    const fetchHistoricalData = async () => {
        try {
            const apiTimeframe = toContractTimeframe(selectedTimeframe);
            const response = await fetch(
                tradeGatewayApi.getHistoryUrl(selectedSymbol, apiTimeframe, 500)
            );
            const rawData = await response.json();
            const candlesArray = Array.isArray(rawData) ? rawData : (rawData.candles || []);

            if (candlesArray.length > 0 && candleSeriesRef.current && volumeSeriesRef.current) {
                const formattedCandles: CandlestickData<Time>[] = candlesArray.map((c: any) => ({
                    time: (c.time || c.timestamp) as Time,
                    open: c.open,
                    high: c.high,
                    low: c.low,
                    close: c.close,
                }));

                const formattedVolumes = candlesArray.map((c: any) => ({
                    time: (c.time || c.timestamp) as Time,
                    value: c.volume || c.tick_count || 0,
                    color: c.close >= c.open ? '#10B98133' : '#EF444433',
                }));

                candleSeriesRef.current.setData(formattedCandles);
                volumeSeriesRef.current.setData(formattedVolumes);

                // Update price info
                const latest = candlesArray[candlesArray.length - 1];
                const first = candlesArray[0];
                const lastClose = latest.close;
                const firstOpen = first.open;

                setCurrentPrice(lastClose);
                setPriceChange(lastClose - firstOpen);
                setPriceChangePercent(((lastClose - firstOpen) / firstOpen) * 100);

                const highs = candlesArray.map((c: any) => c.high);
                const lows = candlesArray.map((c: any) => c.low);
                setHigh24h(Math.max(...highs));
                setLow24h(Math.min(...lows));

                const totalVolume = candlesArray.reduce((sum: number, c: any) => sum + (c.volume || 0), 0);
                setVolume24h(totalVolume);

                // Set the current forming candle
                formingCandleRef.current = {
                    time: (latest.time || latest.timestamp),
                    open: latest.open,
                    high: latest.high,
                    low: latest.low,
                    close: latest.close,
                    volume: latest.volume || latest.tick_count || 0
                };
            }
        } catch (error) {
            console.error('Error fetching historical data:', error);
        }
    };

    const formingCandleRef = useRef<OHLC | null>(null);

    // WebSocket connection for live updates
    useEffect(() => {
        const token = getAuthToken() || undefined;
        const socket = new WebSocket(buildApiV2WsUrl(token));
        const apiTimeframe = toContractTimeframe(selectedTimeframe);
        const handleMessage = (event: MessageEvent) => {
            try {
                const message = JSON.parse(event.data);
                const channel = String(message.channel ?? '');
                const data = message.data ?? message.payload ?? message;

                // Handle 'tick' for current price display (Bid/Ask/Spread)
                if (channel === `ticks.${selectedSymbol}` || (data.symbol === selectedSymbol && data.bid != null)) {
                    const price = data.bid;
                    const ask = data.ask || price;

                    setCurrentPrice(price);
                    setBidPrice(price);
                    setAskPrice(ask);

                    // Note: Chart updates are now handled via 'candle_update' from server
                    // to ensure consistency and performance.
                }

                // Handle 'candle_update' for Chart
                if (channel === `candles.${selectedSymbol}.${apiTimeframe}` || (data.symbol === selectedSymbol && data.open != null && data.close != null)) {
                    const candle = Array.isArray(data) ? data[data.length - 1] : data;
                    const candleVal = {
                        time: candle.time as Time,
                        open: candle.open,
                        high: candle.high,
                        low: candle.low,
                        close: candle.close,
                    };

                    const volumeVal = {
                        time: candle.time as Time,
                        value: candle.volume || candle.tick_count || 0,
                        color: candle.close >= candle.open ? '#10B98133' : '#EF444433'
                    };

                    if (candleSeriesRef.current) {
                        candleSeriesRef.current.update(candleVal);
                    }
                    if (volumeSeriesRef.current) {
                        volumeSeriesRef.current.update(volumeVal);
                    }

                    // Update forming candle ref for other logic if needed
                    formingCandleRef.current = {
                        time: candle.time,
                        open: candle.open,
                        high: candle.high,
                        low: candle.low,
                        close: candle.close,
                        volume: candle.volume || candle.tick_count || 0
                    };
                }
            } catch (error) {
                console.error('WebSocket message error:', error);
            }
        };

        socket.onopen = () => {
            if (token) socket.send(JSON.stringify({ action: 'auth', token }));
            socket.send(JSON.stringify({ action: 'subscribe', channel: `ticks.${selectedSymbol}` }));
            socket.send(JSON.stringify({ action: 'subscribe', channel: `candles.${selectedSymbol}.${apiTimeframe}` }));
        };
        socket.addEventListener('message', handleMessage);

        return () => {
            socket.removeEventListener('message', handleMessage);
            socket.close(1000, 'dashboard chart changed');
        };
    }, [selectedSymbol, selectedTimeframe]);

    // Refetch chart history when selected symbol changes
    useEffect(() => {
        fetchHistoricalData();
    }, [selectedSymbol, selectedTimeframe]);

    const toggleIndicator = (indicator: Indicator) => {
        setActiveIndicators(prev =>
            prev.includes(indicator)
                ? prev.filter(i => i !== indicator)
                : [...prev, indicator]
        );
    };

    const formatPrice = (price: number) => {
        return price.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 5,
        });
    };

    const formatVolume = (volume: number) => {
        if (volume >= 1_000_000_000) return `${(volume / 1_000_000_000).toFixed(2)}B`;
        if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(2)}M`;
        if (volume >= 1_000) return `${(volume / 1_000).toFixed(2)}K`;
        return volume.toFixed(2);
    };

    const placeOrder = async (side: 'BUY' | 'SELL') => {
        try {
            const login = getStoredAccountLogin();
            if (!login) {
                console.error('Order placement blocked: missing account login');
                return;
            }

            const data = await tradeApi.trading.placeOrder({
                login,
                symbol: selectedSymbol,
                side: side.toLowerCase() as 'buy' | 'sell',
                volume: tradingVolume,
            });

            console.log('Order placed successfully:', data);
            window.dispatchEvent(new Event('rtx:force-refresh-positions'));
        } catch (error) {
            console.error('Error placing order:', error);
        }
    };

    return (
        <div className="trading-dashboard bg-[#0d0d11] text-[#d1d4dc] h-screen flex font-sans overflow-hidden pt-[42px]">
            {marketWatchPosition === 'left' ? (
                <div
                    className="h-full border-r border-[#222226]"
                    draggable
                    onDragStart={handlePanelDragStart}
                    style={{ cursor: 'grab' }}
                >
                    <MarketWatch
                        selectedSymbol={selectedSymbol}
                        onSelectSymbol={setSelectedSymbol}
                        watchlist={symbols}
                    />
                </div>
            ) : (
                <div
                    className="w-6 hover:bg-[#222226]/30 transition-colors flex items-center justify-center cursor-pointer border-r border-[#222226]"
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, 'left')}
                    title="Drop to dock Left"
                >
                    <div className="w-0.5 h-8 bg-[#4A5568] rounded-full" />
                </div>
            )}

            <div className="flex-1 flex flex-col min-w-0">
                {/* MT5-style Toolbar */}
                <div className="mt5-toolbar">
                    <div className="mt5-toolbar-section">
                        <div className="symbol-selector">
                            <button
                                className="mt5-symbol-button"
                                onClick={() => setShowSymbolMenu(!showSymbolMenu)}
                                title="Select Symbol"
                            >
                                <span className="symbol-name">{selectedSymbol}</span>
                                <Icons.ChevronDown />
                            </button>
                            {showSymbolMenu && (
                                <div className="dropdown-menu symbol-menu">
                                    {symbols.map(symbol => (
                                        <div
                                            key={symbol}
                                            className={`menu-item ${symbol === selectedSymbol ? 'active' : ''}`}
                                            onClick={() => {
                                                setSelectedSymbol(symbol);
                                                setShowSymbolMenu(false);
                                            }}
                                        >
                                            {symbol}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <button className="mt5-icon-btn" title="Navigator">
                            <Icons.Platform />
                        </button>
                        <button className="mt5-icon-btn" title="Chart Window">
                            <Icons.ChartWindow />
                        </button>
                        <button className="mt5-icon-btn money" title="Trading Balance">
                            <Icons.Coin />
                        </button>
                        <button className="mt5-icon-btn" title="IDE">
                            <Icons.IDE />
                        </button>
                        <button className="mt5-icon-btn" title="Toolbox">
                            <Icons.Toolbox />
                        </button>
                        <button className="mt5-icon-btn" title="Signals">
                            <Icons.Network />
                        </button>
                        <button className="mt5-icon-btn" title="Cloud Sync">
                            <Icons.CloudSync />
                        </button>
                        <button className="mt5-icon-btn" title="Radar">
                            <Icons.Radar />
                        </button>
                        <button className="mt5-icon-btn danger" title="Stop">
                            <Icons.StopSquare />
                        </button>
                        <div className="mt5-separator"></div>

                        <button
                            className={`mt5-action-button ${isAlgoTradingEnabled ? 'active' : ''}`}
                            onClick={() => setIsAlgoTradingEnabled(prev => !prev)}
                            title="Toggle Algo Trading"
                        >
                            <span>Algo Trading</span>
                        </button>

                        <button
                            className="mt5-action-button"
                            onClick={() => window.dispatchEvent(new CustomEvent('toggle-one-click-trading'))}
                            title="New Order"
                        >
                            <Icons.NewOrder />
                            <span>New Order</span>
                        </button>
                        <div className="mt5-separator"></div>
                        <button
                            className="mt5-icon-btn"
                            title="Open New Chart"
                            onClick={() => setSelectedSymbol(symbols.find(symbol => symbol !== selectedSymbol) || selectedSymbol)}
                        >
                            <Icons.NewOrder />
                        </button>
                        <button
                            className={`mt5-icon-btn ${activeChartVisual === 'candles' ? 'active' : ''}`}
                            title="Candlestick View"
                            onClick={() => setActiveChartVisual('candles')}
                        >
                            <Icons.CandleBars />
                        </button>
                        <button
                            className={`mt5-icon-btn ${activeChartVisual === 'line' ? 'active' : ''}`}
                            title="Line View"
                            onClick={() => setActiveChartVisual('line')}
                        >
                            <Icons.Wave />
                        </button>
                        <div className="mt5-separator"></div>
                        <button
                            className="mt5-icon-btn"
                            title="Dock Left Panel"
                            onClick={() => setMarketWatchPosition('left')}
                        >
                            <Icons.SplitVertical />
                        </button>
                        <button
                            className="mt5-icon-btn"
                            title="Dock Right Panel"
                            onClick={() => setMarketWatchPosition('right')}
                        >
                            <Icons.Wave />
                        </button>

                        <div className="indicators-container">
                            <button
                                className="mt5-icon-btn"
                                onClick={() => setShowIndicatorMenu(!showIndicatorMenu)}
                                title="Indicators"
                            >
                                <Icons.Indicator />
                            </button>
                            {showIndicatorMenu && (
                                <div className="dropdown-menu indicator-menu">
                                    {indicators.map(indicator => (
                                        <div
                                            key={indicator}
                                            className={`menu-item ${activeIndicators.includes(indicator) ? 'active' : ''}`}
                                            onClick={() => toggleIndicator(indicator)}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={activeIndicators.includes(indicator)}
                                                readOnly
                                            />
                                            <span>{indicator}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <button
                            className={`mt5-icon-btn ${isGridVisible ? 'active' : ''}`}
                            title="Toggle Grid"
                            onClick={() => {
                                const nextVisible = !isGridVisible;
                                setIsGridVisible(nextVisible);
                                chartRef.current?.applyOptions({
                                    grid: {
                                        vertLines: { color: nextVisible ? '#191a1e' : 'transparent', style: 1 },
                                        horzLines: { color: nextVisible ? '#191a1e' : 'transparent', style: 1 },
                                    },
                                });
                            }}
                        >
                            <Icons.Grid />
                        </button>

                        <button
                            className={`mt5-icon-btn ${isAutoScrollEnabled ? 'active' : ''}`}
                            title="Auto Scroll"
                            onClick={() => {
                                const nextValue = !isAutoScrollEnabled;
                                setIsAutoScrollEnabled(nextValue);
                                chartRef.current?.timeScale().scrollToRealTime();
                            }}
                        >
                            <Icons.Speaker />
                        </button>

                        <button
                            className={`mt5-icon-btn ${isChartShiftEnabled ? 'active' : ''}`}
                            title="Chart Shift"
                            onClick={() => {
                                const nextValue = !isChartShiftEnabled;
                                setIsChartShiftEnabled(nextValue);
                                chartRef.current?.applyOptions({
                                    timeScale: {
                                        rightOffset: nextValue ? 8 : 0,
                                    },
                                });
                            }}
                        >
                            <Icons.SplitVertical />
                        </button>
                        <button className="mt5-icon-btn" title="Screenshot">
                            <Icons.Camera />
                        </button>
                    </div>

                    <div className="mt5-toolbar-section mt5-timeframes">
                        {timeframeButtons.map(tf => (
                            <button
                                key={tf.label}
                                className={`mt5-timeframe-button ${tf.value === selectedTimeframe ? 'active' : ''}`}
                                onClick={() => setSelectedTimeframe(tf.value)}
                            >
                                {tf.label}
                            </button>
                        ))}
                    </div>

                    <div className="mt5-toolbar-section">
                        <button
                            className={`mt5-icon-btn ${activeRightTool === 'cursor' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveRightTool('cursor');
                                setSelectedTool('crosshair');
                            }}
                            title="Cursor"
                        >
                            <Icons.CursorArrow />
                        </button>
                        <button
                            className={`mt5-icon-btn ${activeRightTool === 'cross' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveRightTool('cross');
                                setSelectedTool('measure');
                            }}
                            title="Cross"
                        >
                            <Icons.Cross />
                        </button>
                        <button
                            className={`mt5-icon-btn ${activeRightTool === 'vertical' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveRightTool('vertical');
                                setSelectedTool('vertical');
                            }}
                            title="Vertical Line"
                        >
                            <Icons.VerticalLine />
                        </button>
                        <button
                            className={`mt5-icon-btn ${activeRightTool === 'horizontal' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveRightTool('horizontal');
                                setSelectedTool('horizontal');
                            }}
                            title="Horizontal Line"
                        >
                            <Icons.HorizontalLine />
                        </button>
                        <button
                            className={`mt5-icon-btn ${activeRightTool === 'segment' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveRightTool('segment');
                                setSelectedTool('trendline');
                            }}
                            title="Segment"
                        >
                            <Icons.Segment />
                        </button>
                        <button
                            className={`mt5-icon-btn ${activeRightTool === 'trend' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveRightTool('trend');
                                setSelectedTool('trendline');
                            }}
                            title="Trend Line"
                        >
                            <Icons.TrendLine />
                        </button>
                        <button
                            className={`mt5-icon-btn ${activeRightTool === 'polyline' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveRightTool('polyline');
                                setSelectedTool('fibonacci');
                            }}
                            title="Polyline"
                        >
                            <Icons.Polyline />
                        </button>
                        <button className="mt5-icon-btn" title="Objects List">
                            <Icons.Sliders />
                        </button>
                        <button className="mt5-icon-btn" title="Search">
                            <Icons.Search />
                        </button>
                        <button className="mt5-icon-btn" title="Notifications">
                            <Icons.BellDot />
                        </button>
                        <span className="mt5-chip">LVL</span>
                        <span className="mt5-battery"><Icons.Battery /></span>
                        <div className="indicators-container">
                            <button
                                className="mt5-icon-btn"
                                onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                                title="Settings"
                            >
                                <Icons.Settings />
                            </button>
                            {showSettingsMenu && (
                                <div className="dropdown-menu settings-menu">
                                    <div className="menu-item">Chart Settings</div>
                                    <div className="menu-item">Color Theme</div>
                                    <div className="menu-item">Export Data</div>
                                    <div className="menu-item">Screenshot</div>
                                    <div className="menu-divider"></div>
                                    <div
                                        className="menu-item text-red-500 hover:bg-red-500/10"
                                        onClick={async () => {
                                            if (window.confirm('Reset all local data cache? This will refresh the page.')) {
                                                try {
                                                    const { ticksDB } = await import('../db/ticksDB');
                                                    await ticksDB.clearAll();
                                                    window.location.reload();
                                                } catch (e) {
                                                    console.error('Failed to reset cache:', e);
                                                    alert('Failed to reset cache');
                                                }
                                            }
                                        }}
                                    >
                                        Reset Cache
                                    </div>
                                </div>
                            )}
                        </div>
                        <button
                            className="mt5-icon-btn hover:bg-red-500/20 hover:text-red-400 transition-colors ml-1"
                            title="Close Active Chart"
                            onClick={() => {
                                if (openCharts.length > 0) {
                                    handleCloseChart(activeChartIndex);
                                }
                            }}
                            disabled={openCharts.length === 0}
                        >
                            <Icons.CloseX />
                        </button>
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="main-content">
                    {/* Chart Area Wrapper */}
                    <div className="relative flex-1 overflow-hidden">
                        <div className="absolute inset-0" ref={chartContainerRef} style={{ zIndex: 0 }} />
                    </div>
                </div>

                {/* Active Indicators Display */}
                {activeIndicators.length > 0 && (
                    <div className="active-indicators">
                        {activeIndicators.map(indicator => (
                            <span key={indicator} className="indicator-tag">
                                {indicator}
                                <button
                                    className="remove-indicator"
                                    onClick={() => toggleIndicator(indicator)}
                                >
                                    ×
                                </button>
                            </span>
                        ))}
                    </div>
                )}

                {/* Chart Tabs Bar */}
                <div className="h-8 bg-[#0d0d11] border-t border-[#222226] flex items-center px-1 select-none">
                    {openCharts.map((chart, index) => (
                        <div
                            key={`${chart.symbol}-${index}`}
                            className={`
                                group flex items-center gap-2 px-3 h-full cursor-pointer border-r border-[#222226] text-xs font-medium transition-colors
                                ${index === activeChartIndex
                                    ? 'bg-[#222226] text-[#8a8a8f] border-b-2 border-b-[#8a8a8f]'
                                    : 'text-[#808088] hover:bg-[#191a1e] hover:text-[#808088]'}
                            `}
                            onClick={() => setActiveChartIndex(index)}
                        >
                            <span>{chart.symbol}, {chart.timeframe}</span>
                            <span
                                className="opacity-0 group-hover:opacity-100 hover:text-red-400 p-0.5 rounded"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleCloseChart(index);
                                }}
                            >
                                ×
                            </span>
                        </div>
                    ))}
                    <div
                        className="px-3 h-full flex items-center justify-center text-[#808088] hover:text-white cursor-pointer hover:bg-[#191a1e]"
                        onClick={() => setSelectedSymbol('EURUSD')}
                        title="Open New Chart"
                    >
                        +
                    </div>
                </div>
            </div>
            {marketWatchPosition === 'right' ? (
                <div
                    className="h-full border-l border-[#222226]"
                    draggable
                    onDragStart={handlePanelDragStart}
                    style={{ cursor: 'grab' }}
                >
                    <MarketWatch
                        selectedSymbol={selectedSymbol}
                        onSelectSymbol={setSelectedSymbol}
                        watchlist={symbols}
                    />
                </div>
            ) : (
                <div
                    className="w-6 hover:bg-[#222226]/30 transition-colors flex items-center justify-center cursor-pointer border-l border-[#222226]"
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, 'right')}
                    title="Drop to dock Right"
                >
                    <div className="w-0.5 h-8 bg-[#4A5568] rounded-full" />
                </div>
            )}
        </div>
    );
};

export default ProfessionalTradingDashboard;

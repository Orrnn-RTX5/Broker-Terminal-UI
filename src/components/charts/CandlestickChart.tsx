import React, { useEffect, useRef, useImperativeHandle, forwardRef, memo } from 'react';
import {
    createChart,
    ColorType,
    CrosshairMode,
    IChartApi,
    ISeriesApi,
    Time,
    CandlestickSeries,
    HistogramSeries,
} from 'lightweight-charts';

export interface CandleData {
    time: number | string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}

interface CandlestickChartProps {
    symbol: string;
    timeframe: string;
    data: CandleData[];
    colors?: {
        backgroundColor?: string;
        lineColor?: string;
        textColor?: string;
        upColor?: string;
        downColor?: string;
    };
}

export interface CandlestickChartRef {
    updateCandle: (candle: CandleData) => void;
    setData: (data: CandleData[]) => void;
}

const CandlestickChartComponent = forwardRef<CandlestickChartRef, CandlestickChartProps>(
    ({ symbol, timeframe, data, colors = {} }, ref) => {
        const {
            backgroundColor = '#0d0d11',
            textColor = '#d4d4d8',
            upColor = '#26a69a',
            downColor = '#ef5350',
        } = colors;

        const chartContainerRef = useRef<HTMLDivElement>(null);
        const chartRef = useRef<IChartApi | null>(null);
        const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
        const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

        // Helper: build volume bars from candle data
        const buildVolumeData = (candles: CandleData[]) =>
            candles.map(c => ({
                time: c.time as Time,
                value: c.volume ?? 0,
                color: c.close >= c.open
                    ? 'rgba(38, 166, 154, 0.5)'  // green with alpha
                    : 'rgba(239, 83, 80, 0.5)',   // red with alpha
            }));

        useImperativeHandle(ref, () => ({
            updateCandle: (candle: CandleData) => {
                if (candleSeriesRef.current) {
                    try {
                        candleSeriesRef.current.update({
                            time: candle.time as Time,
                            open: candle.open,
                            high: candle.high,
                            low: candle.low,
                            close: candle.close,
                        });
                    } catch (e) {
                        // ignore if disposed
                    }
                }
                if (volumeSeriesRef.current && candle.volume !== undefined) {
                    try {
                        volumeSeriesRef.current.update({
                            time: candle.time as Time,
                            value: candle.volume,
                            color: candle.close >= candle.open
                                ? 'rgba(38, 166, 154, 0.5)'
                                : 'rgba(239, 83, 80, 0.5)',
                        });
                    } catch (e) {
                        // ignore if disposed
                    }
                }
            },
            setData: (newData: CandleData[]) => {
                if (candleSeriesRef.current && chartRef.current) {
                    try {
                        const formatted = newData.map(c => ({
                            time: c.time as Time,
                            open: c.open,
                            high: c.high,
                            low: c.low,
                            close: c.close,
                        }));
                        candleSeriesRef.current.setData(formatted);

                        if (volumeSeriesRef.current) {
                            volumeSeriesRef.current.setData(buildVolumeData(newData));
                        }

                        chartRef.current.timeScale().fitContent();
                    } catch (e) { }
                }
            }
        }));

        useEffect(() => {
            if (!chartContainerRef.current) return;

            const chart = createChart(chartContainerRef.current, {
                layout: {
                    background: { type: ColorType.Solid, color: backgroundColor },
                    textColor: textColor,
                },
                grid: {
                    vertLines: { color: '#131316' },
                    horzLines: { color: '#131316' },
                },
                crosshair: {
                    mode: CrosshairMode.Normal,
                },
                rightPriceScale: {
                    borderColor: '#222226',
                },
                timeScale: {
                    borderColor: '#222226',
                    timeVisible: true,
                    secondsVisible: false,
                },
                handleScale: true,
                handleScroll: true,
            });

            chartRef.current = chart;

            // ── Candlestick series ──────────────────────────────────────────────
            const candleSeries = chart.addSeries(CandlestickSeries, {
                upColor: upColor,
                downColor: downColor,
                borderVisible: true,
                wickVisible: true,
                borderColor: upColor,
                borderUpColor: upColor,
                borderDownColor: downColor,
                wickUpColor: upColor,
                wickDownColor: downColor,
                // Push candles to the top 80% of the pane
                priceScaleId: 'right',
            });

            // ── Volume histogram series ─────────────────────────────────────────
            const volumeSeries = chart.addSeries(HistogramSeries, {
                color: 'rgba(38, 166, 154, 0.5)',
                priceFormat: { type: 'volume' },
                // Overlay on the same pane but use a separate invisible scale
                // so volume occupies the bottom ~20% without affecting candle scale
                priceScaleId: 'volume',
            });

            // Size the volume scale to occupy the bottom 20% of the pane
            chart.priceScale('volume').applyOptions({
                scaleMargins: {
                    top: 0.82,   // volume starts 82% from top
                    bottom: 0,
                },
            });

            // Keep candle scale occupying the top area
            chart.priceScale('right').applyOptions({
                scaleMargins: {
                    top: 0.05,
                    bottom: 0.20,  // leave 20% at bottom for volume
                },
            });

            candleSeriesRef.current = candleSeries;
            volumeSeriesRef.current = volumeSeries;

            if (data.length > 0) {
                const formatted = data.map(c => ({
                    time: c.time as Time,
                    open: c.open,
                    high: c.high,
                    low: c.low,
                    close: c.close,
                }));
                candleSeries.setData(formatted);
                volumeSeries.setData(buildVolumeData(data));
                chart.timeScale().fitContent();
            }

            let resizeRafId: number | null = null;
            let lastWidth = -1;
            let lastHeight = -1;

            const handleResize = () => {
                if (!chartContainerRef.current || !chartRef.current) return;

                if (resizeRafId !== null) {
                    cancelAnimationFrame(resizeRafId);
                }

                resizeRafId = requestAnimationFrame(() => {
                    resizeRafId = null;
                    if (!chartContainerRef.current || !chartRef.current) return;

                    const nextWidth = chartContainerRef.current.clientWidth;
                    const nextHeight = chartContainerRef.current.clientHeight;
                    if (nextWidth === lastWidth && nextHeight === lastHeight) return;

                    lastWidth = nextWidth;
                    lastHeight = nextHeight;

                    try {
                        chartRef.current.resize(nextWidth, nextHeight);
                    } catch (e) {
                        // Chart disposed, ignore
                    }
                });
            };

            const resizeObserver = new ResizeObserver(handleResize);
            resizeObserver.observe(chartContainerRef.current);
            handleResize();

            return () => {
                resizeObserver.disconnect();
                if (resizeRafId !== null) {
                    cancelAnimationFrame(resizeRafId);
                }
                candleSeriesRef.current = null;
                volumeSeriesRef.current = null;
                chartRef.current = null;
                try {
                    chart.remove();
                } catch (e) {
                    // Chart already disposed
                }
            };
        }, []); // Empty dependency array, chart is initialized once. Updates flow through refs.

        return (
            <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
            </div>
        );
    }
);

CandlestickChartComponent.displayName = 'CandlestickChart';

export const CandlestickChart = memo(CandlestickChartComponent);

/**
 * useChartExport Hook
 *
 * Manages chart export state and provides utilities for exporting charts
 */

import { useState, useCallback, useRef, useEffect } from 'react';

export interface ChartExportState {
  isDialogOpen: boolean;
  chartCanvas: HTMLCanvasElement | null;
  chartContainer: HTMLElement | null;
  symbol: string;
  timeframe: string;
}

export const useChartExport = () => {
  const [state, setState] = useState<ChartExportState>({
    isDialogOpen: false,
    chartCanvas: null,
    chartContainer: null,
    symbol: '',
    timeframe: ''
  });

  const chartCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartContainerRef = useRef<HTMLElement | null>(null);

  // Auto-detect chart canvas and container
  useEffect(() => {
    const detectChart = () => {
      // Find the main chart canvas
      const canvases = Array.from(document.querySelectorAll('canvas'));
      const mainCanvas = canvases.reduce((largest, current) => {
        const currentArea = current.width * current.height;
        const largestArea = largest ? largest.width * largest.height : 0;
        return currentArea > largestArea ? current : largest;
      }, null as HTMLCanvasElement | null);

      if (mainCanvas) {
        chartCanvasRef.current = mainCanvas;
      }

      // Find chart container
      const container = document.querySelector('.chart-container, .trading-chart, [class*="chart"]') as HTMLElement;
      if (container) {
        chartContainerRef.current = container;
      }
    };

    // Detect on mount and when dialog opens
    if (state.isDialogOpen) {
      detectChart();
    }
  }, [state.isDialogOpen]);

  const openDialog = useCallback((symbol: string, timeframe: string) => {
    setState({
      isDialogOpen: true,
      chartCanvas: chartCanvasRef.current,
      chartContainer: chartContainerRef.current,
      symbol,
      timeframe
    });
  }, []);

  const closeDialog = useCallback(() => {
    setState(prev => ({
      ...prev,
      isDialogOpen: false
    }));
  }, []);

  const setChartCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    chartCanvasRef.current = canvas;
  }, []);

  const setChartContainer = useCallback((container: HTMLElement | null) => {
    chartContainerRef.current = container;
  }, []);

  return {
    state,
    openDialog,
    closeDialog,
    setChartCanvas,
    setChartContainer
  };
};

export default useChartExport;

/**
 * Chart Print Hook
 * Provides chart printing functionality with setup and preview dialogs
 */

import { useState, useCallback } from 'react';
import { chartPrinter, type PrintPreferences, type ChartPrintData } from '../services/chartPrinter';
import type { IChartApi } from 'lightweight-charts';

export interface UseChartPrintOptions {
  accountId?: string;
  symbol: string;
  timeframe: string;
  chartApi?: IChartApi | null;
  getIndicators?: () => Array<{ name: string; parameters: Record<string, any> }>;
  getDrawings?: () => Array<{ type: string; label?: string }>;
}

export function useChartPrint(options: UseChartPrintOptions) {
  const [showSetupDialog, setShowSetupDialog] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [printPreferences, setPrintPreferences] = useState<PrintPreferences | null>(null);
  const [chartData, setChartData] = useState<ChartPrintData | null>(null);

  /**
   * Open print setup dialog
   */
  const openPrintSetup = useCallback(() => {
    setShowSetupDialog(true);
  }, []);

  /**
   * Handle setup dialog completion
   */
  const handleSetupComplete = useCallback(
    (preferences: PrintPreferences) => {
      // Capture chart data
      const data: ChartPrintData = {
        symbol: options.symbol,
        timeframe: options.timeframe,
        dateRange: {
          from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Default: 30 days ago
          to: new Date(),
        },
        indicators: options.getIndicators ? options.getIndicators() : [],
        drawings: options.getDrawings ? options.getDrawings() : [],
      };

      // Capture chart canvas if API is available
      if (options.chartApi) {
        const canvas = chartPrinter.captureChartCanvas(options.chartApi);
        if (canvas) {
          data.chartCanvas = canvas;
        }
      }

      setChartData(data);
      setPrintPreferences(preferences);
      setShowSetupDialog(false);
      setShowPreviewDialog(true);
    },
    [options]
  );

  /**
   * Handle direct print (skip preview)
   */
  const handleDirectPrint = useCallback(async () => {
    if (!chartData || !printPreferences) return;

    try {
      await chartPrinter.printChart(chartData, printPreferences);
      setShowPreviewDialog(false);
      setChartData(null);
      setPrintPreferences(null);
    } catch (error) {
      console.error('Print failed:', error);
    }
  }, [chartData, printPreferences]);

  /**
   * Close all dialogs
   */
  const closeDialogs = useCallback(() => {
    setShowSetupDialog(false);
    setShowPreviewDialog(false);
    setChartData(null);
    setPrintPreferences(null);
  }, []);

  return {
    // State
    showSetupDialog,
    showPreviewDialog,
    printPreferences,
    chartData,

    // Actions
    openPrintSetup,
    handleSetupComplete,
    handleDirectPrint,
    closeDialogs,
  };
}

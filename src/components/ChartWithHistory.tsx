/**
 * Enhanced Trading Chart with Historical Data Support
 * Integrates historical data caching with live chart display
 */

import { Icon } from './ui/Icon';
import React, { useEffect, useState } from 'react';
import { TradingChart } from './TradingChart';
import { useHistoricalData } from '../hooks/useHistoricalData';
import type { ChartType, Timeframe } from './TradingChart';
import type { DateRange } from '../types/history';

interface ChartWithHistoryProps {
  symbol: string;
  chartType?: ChartType;
  timeframe?: Timeframe;
  enableHistoricalData?: boolean;
  historicalDateRange?: DateRange;
}

export const ChartWithHistory: React.FC<ChartWithHistoryProps> = ({
  symbol,
  chartType = 'candlestick',
  timeframe = 'M1',
  enableHistoricalData = true,
  historicalDateRange
}) => {
  const [showHistoricalPrompt, setShowHistoricalPrompt] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  // Calculate default date range (last 7 days)
  const [defaultDateRange] = useState<DateRange>(() => ({
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0]
  }));

  const dateRange = historicalDateRange || defaultDateRange;

  // Use historical data hook
  const {
    isLoading,
    error,
    symbolInfo,
    downloadIfMissing
  } = useHistoricalData({
    symbol,
    dateRange,
    autoLoad: enableHistoricalData,
    onProgress: setDownloadProgress
  });

  // Check if historical data is missing
  useEffect(() => {
    if (enableHistoricalData && symbolInfo) {
      const hasAllData = symbolInfo.downloadedDates.length === (symbolInfo.availableDates?.length || 0);
      if (!hasAllData && !isLoading) {
        setShowHistoricalPrompt(true);
      }
    }
  }, [symbolInfo, enableHistoricalData, isLoading]);

  const handleDownloadHistoricalData = async () => {
    setShowHistoricalPrompt(false);
    await downloadIfMissing();
  };



  return (
    <div className="relative w-full h-full">
      {/* Historical Data Prompt */}
      {showHistoricalPrompt && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 bg-blue-900/90 backdrop-blur-sm border border-zinc-600 rounded-lg p-4 max-w-md">
          <div className="flex items-start gap-3">
            <Icon name="download" size="sm" className="w-5 h-5 text-blue-400 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold mb-1">Historical Data Available</h3>
              <p className="text-sm text-gray-300 mb-3">
                Download historical tick data for {symbol} to view past price action and enable backtesting.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleDownloadHistoricalData}
                  className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded text-sm font-medium transition-colors"
                >
                  Download Now
                </button>
                <button
                  onClick={() => setShowHistoricalPrompt(false)}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium transition-colors"
                >
                  Later
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Download Progress */}
      {isLoading && downloadProgress > 0 && downloadProgress < 100 && (
        <div className="absolute top-4 right-4 z-10 bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg p-4 w-64">
          <div className="flex items-center gap-2 mb-2">
            <Icon name="refresh" size="sm" className="w-4 h-4 animate-spin text-blue-400" />
            <span className="text-sm font-medium">Downloading Historical Data</span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>{symbol}</span>
              <span>{Math.round(downloadProgress)}%</span>
            </div>
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-zinc-8000 transition-all duration-300"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 bg-red-900/90 backdrop-blur-sm border border-red-500 rounded-lg p-4 max-w-md">
          <div className="flex items-start gap-3">
            <Icon name="error" size="sm" className="w-5 h-5 text-red-400 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold mb-1">Failed to Load Historical Data</h3>
              <p className="text-sm text-gray-300">{error.message}</p>
            </div>
          </div>
        </div>
      )}

      {/* Data Info Banner */}
      {symbolInfo && enableHistoricalData && (
        <div className="absolute bottom-4 left-4 z-10 bg-gray-900/70 backdrop-blur-sm border border-gray-700 rounded px-3 py-1.5 text-xs">
          <div className="flex items-center gap-4">
            <span className="text-gray-400">
              Historical Data: {symbolInfo.downloadedDates.length} / {symbolInfo.availableDates?.length || 0} days
            </span>
            {symbolInfo.downloadedDates.length > 0 && symbolInfo.downloadedDates.length === (symbolInfo.availableDates?.length || 0) && (
              <span className="text-gray-400">
                {symbolInfo.firstDate} - {symbolInfo.lastDate}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Chart Component */}
      <TradingChart
        symbol={symbol}
        chartType={chartType}
        timeframe={timeframe}
      />
    </div>
  );
};

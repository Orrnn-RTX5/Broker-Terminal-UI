/**
 * Historical Data Integration Example
 * Demonstrates how to integrate historical data features into your trading app
 */

import { Icon } from '../components/ui/Icon';
import React, { useState } from 'react';
import { ChartWithHistory, HistoryDownloader } from '../components';
import { useHistoricalData } from '../hooks';
import { historyDataManager, chartDataService } from '../services';
/**
 * Example 1: Simple Chart with Historical Data
 */
export const SimpleChartExample: React.FC = () => {
  return (
    <div className="w-full h-96">
      <ChartWithHistory
        symbol="EURUSD"
        enableHistoricalData={true}
        chartType="candlestick"
        timeframe="H1"
      />
    </div>
  );
};

/**
 * Example 2: Chart with Custom Date Range
 */
export const CustomDateRangeExample: React.FC = () => {
  const [dateRange, setDateRange] = useState({
    from: '2026-01-15',
    to: '2026-01-20'
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <input
          type="date"
          value={dateRange.from}
          onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded"
        />
        <input
          type="date"
          value={dateRange.to}
          onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded"
        />
      </div>

      <div className="w-full h-96">
        <ChartWithHistory
          symbol="GBPUSD"
          enableHistoricalData={true}
          historicalDateRange={dateRange}
          chartType="line"
          timeframe="M15"
        />
      </div>
    </div>
  );
};

/**
 * Example 3: Using the useHistoricalData Hook
 */
export const HistoricalDataHookExample: React.FC = () => {
  const [symbol, setSymbol] = useState('EURUSD');

  const {
    data,
    isLoading,
    error,
    progress,
    symbolInfo,
    downloadIfMissing,
    refetch
  } = useHistoricalData({
    symbol,
    dateRange: {
      from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      to: new Date().toISOString().split('T')[0]
    },
    autoLoad: true,
    onProgress: (p) => console.log(`Download progress: ${p}%`)
  });

  return (
    <div className="p-6 bg-gray-900 rounded-lg">
      <h2 className="text-xl font-bold mb-4">Historical Data Hook Example</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm mb-2">Symbol</label>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded"
          >
            <option>EURUSD</option>
            <option>GBPUSD</option>
            <option>USDJPY</option>
          </select>
        </div>

        {isLoading && (
          <div className="text-blue-400">
            Loading... {progress}%
          </div>
        )}

        {error && (
          <div className="text-red-400">
            Error: {error.message}
          </div>
        )}

        {symbolInfo && (
          <div className="p-4 bg-gray-800 rounded">
            <h3 className="font-semibold mb-2">Symbol Info</h3>
            <div className="text-sm space-y-1">
              <div>Total Ticks: {symbolInfo.totalTicks.toLocaleString()}</div>
              <div>Downloaded: {symbolInfo.downloadedDates.length} days</div>
              <div>Available: {symbolInfo.availableDates.length} days</div>
              <div>Progress: {Math.round(symbolInfo.downloadProgress || 0)}%</div>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={downloadIfMissing}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded flex items-center gap-2"
          >
            <Icon name="download" size="sm" className="w-4 h-4" />
            Download Missing Data
          </button>
          <button
            onClick={refetch}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
          >
            Refresh
          </button>
        </div>

        {data.length > 0 && (
          <div className="p-4 bg-gray-800 rounded">
            <h3 className="font-semibold mb-2">Loaded Data</h3>
            <div className="text-sm">
              {data.length.toLocaleString()} ticks loaded
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Example 4: Programmatic Download
 */
export const ProgrammaticDownloadExample: React.FC = () => {
  const [downloadStatus, setDownloadStatus] = useState<string>('');
  const [progress, setProgress] = useState(0);

  const handleDownload = async () => {
    setDownloadStatus('Starting download...');

    try {
      const taskId = await historyDataManager.downloadData(
        'EURUSD',
        {
          from: '2026-01-15',
          to: '2026-01-20'
        },
        (task) => {
          setProgress(task.progress);
          setDownloadStatus(`Downloading: ${Math.round(task.progress)}%`);

          if (task.status === 'completed') {
            setDownloadStatus('Download completed!');
          } else if (task.status === 'failed') {
            setDownloadStatus(`Download failed: ${task.error}`);
          }
        }
      );

      console.log('Download task ID:', taskId);
    } catch (error) {
      setDownloadStatus(`Error: ${error}`);
    }
  };

  return (
    <div className="p-6 bg-gray-900 rounded-lg">
      <h2 className="text-xl font-bold mb-4">Programmatic Download</h2>

      <div className="space-y-4">
        <button
          onClick={handleDownload}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded flex items-center gap-2"
        >
          <Icon name="download" size="sm" className="w-4 h-4" />
          Download EURUSD Historical Data
        </button>

        {downloadStatus && (
          <div className="p-4 bg-gray-800 rounded">
            <div className="mb-2">{downloadStatus}</div>
            {progress > 0 && progress < 100 && (
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Example 5: OHLC Aggregation
 */
export const OHLCAggregationExample: React.FC = () => {
  const [ohlcData, setOhlcData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const handleAggregate = async () => {
    setLoading(true);
    try {
      // Get tick data
      const ticks = await historyDataManager.getTicks(
        'EURUSD',
        {
          from: '2026-01-20',
          to: '2026-01-20'
        },
        10000 // Limit to 10k ticks
      );

      // Aggregate to 1-hour candles
      const ohlc = chartDataService.aggregateToOHLC(ticks, '1h');
      setOhlcData(ohlc);
    } catch (error) {
      console.error('Failed to aggregate:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 bg-gray-900 rounded-lg">
      <h2 className="text-xl font-bold mb-4">OHLC Aggregation Example</h2>

      <div className="space-y-4">
        <button
          onClick={handleAggregate}
          disabled={loading}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 rounded flex items-center gap-2"
        >
          <Icon name="trending-up" size="sm" className="w-4 h-4" />
          {loading ? 'Aggregating...' : 'Aggregate to OHLC'}
        </button>

        {ohlcData.length > 0 && (
          <div className="p-4 bg-gray-800 rounded">
            <h3 className="font-semibold mb-2">OHLC Candles</h3>
            <div className="text-sm mb-2">
              Generated {ohlcData.length} 1-hour candles
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1 text-xs">
              {ohlcData.slice(0, 5).map((candle, i) => (
                <div key={i} className="p-2 bg-gray-900 rounded">
                  <div>Time: {new Date(candle.time).toLocaleString()}</div>
                  <div>O: {candle.open.toFixed(5)} H: {candle.high.toFixed(5)}</div>
                  <div>L: {candle.low.toFixed(5)} C: {candle.close.toFixed(5)}</div>
                </div>
              ))}
              {ohlcData.length > 5 && (
                <div className="text-gray-400">
                  ... and {ohlcData.length - 5} more
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Example 6: Full Download Manager UI
 */
export const DownloadManagerExample: React.FC = () => {
  return (
    <div className="w-full h-screen">
      <HistoryDownloader />
    </div>
  );
};

/**
 * Complete Example Dashboard
 */
export const HistoricalDataDashboard: React.FC = () => {
  const [activeExample, setActiveExample] = useState<number>(1);

  const examples = [
    { id: 1, name: 'Simple Chart', component: SimpleChartExample },
    { id: 2, name: 'Custom Date Range', component: CustomDateRangeExample },
    { id: 3, name: 'React Hook', component: HistoricalDataHookExample },
    { id: 4, name: 'Programmatic Download', component: ProgrammaticDownloadExample },
    { id: 5, name: 'OHLC Aggregation', component: OHLCAggregationExample },
    { id: 6, name: 'Download Manager', component: DownloadManagerExample }
  ];

  const ActiveComponent = examples.find(e => e.id === activeExample)?.component || SimpleChartExample;

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* Sidebar */}
      <div className="w-64 bg-gray-900 border-r border-gray-800 p-4">
        <div className="flex items-center gap-2 mb-6">
          <Icon name="database" size="sm" className="w-6 h-6 text-blue-400" />
          <h1 className="text-lg font-bold">Historical Data Examples</h1>
        </div>

        <div className="space-y-2">
          {examples.map((example) => (
            <button
              key={example.id}
              onClick={() => setActiveExample(example.id)}
              className={`w-full px-3 py-2 rounded text-left transition-colors ${activeExample === example.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 hover:bg-gray-700'
                }`}
            >
              {example.name}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-6">
          <ActiveComponent />
        </div>
      </div>
    </div>
  );
};

/**
 * History Downloader Component
 * UI for downloading and managing historical tick data
 */

import { Icon } from './ui/Icon';
import React, { useState, useEffect } from 'react';
import { historyDataManager } from '../services/historyDataManager';
import type { SymbolDataInfo, DownloadTask, StorageStats } from '../types/history';

export const HistoryDownloader: React.FC = () => {
  const [symbols, setSymbols] = useState<SymbolDataInfo[]>([]);
  const [downloadTasks, setDownloadTasks] = useState<DownloadTask[]>([]);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [dateRange, setDateRange] = useState({
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0]
  });
  const [isLoading, setIsLoading] = useState(false);
  const [backgroundDownload, setBackgroundDownload] = useState(false);

  useEffect(() => {
    loadSymbols();
    loadStorageStats();

    // Poll for task updates
    const interval = setInterval(() => {
      setDownloadTasks(historyDataManager.getDownloadTasks());
    }, 500);

    return () => clearInterval(interval);
  }, []);

  const loadSymbols = async () => {
    setIsLoading(true);
    try {
      const data = await historyDataManager.getAvailableSymbols();
      setSymbols(data);
      if (data.length > 0 && !selectedSymbol) {
        setSelectedSymbol(data[0].symbol);
      }
    } catch (error) {
      console.error('Failed to load symbols:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadStorageStats = async () => {
    try {
      const stats = await historyDataManager.getStorageStats();
      setStorageStats(stats);
    } catch (error) {
      console.error('Failed to load storage stats:', error);
    }
  };

  const handleDownload = async () => {
    if (!selectedSymbol) return;

    try {
      await historyDataManager.downloadData(
        selectedSymbol,
        dateRange,
        (task) => {
          setDownloadTasks(historyDataManager.getDownloadTasks());
          if (task.status === 'completed') {
            loadStorageStats();
            loadSymbols();
          }
        }
      );
    } catch (error) {
      console.error('Download failed:', error);
    }
  };

  const handlePauseResume = (taskId: string, status: string) => {
    if (status === 'downloading' || status === 'pending') {
      historyDataManager.pauseDownload(taskId);
    } else if (status === 'paused') {
      historyDataManager.resumeDownload(taskId);
    }
  };

  const handleCancel = (taskId: string) => {
    historyDataManager.cancelDownload(taskId);
    setDownloadTasks(historyDataManager.getDownloadTasks());
  };

  const handleClearSymbol = async (symbol: string) => {
    if (confirm(`Clear all cached data for ${symbol}?`)) {
      await historyDataManager.clearSymbol(symbol);
      loadSymbols();
      loadStorageStats();
    }
  };

  const handleClearAll = async () => {
    if (confirm('Clear all cached historical data? This cannot be undone.')) {
      await historyDataManager.clearAll();
      loadSymbols();
      loadStorageStats();
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDuration = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const selectedSymbolInfo = symbols.find(s => s.symbol === selectedSymbol);

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Icon name="database" size="sm" className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-semibold">Historical Data Manager</h2>
        </div>

        {storageStats && (
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Icon name="hard-drive" size="sm" className="w-4 h-4 text-gray-400" />
              <span>{formatBytes(storageStats.totalSize)}</span>
            </div>
            <div className="text-gray-400">
              {storageStats.tickCount.toLocaleString()} ticks
            </div>
            <div className="text-gray-400">
              {storageStats.symbolCount} symbols
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Symbol Selection */}
        <div className="w-80 border-r border-gray-700 flex flex-col">
          <div className="p-4 border-b border-gray-700">
            <h3 className="text-sm font-semibold mb-2">Available Symbols</h3>
            <input
              type="text"
              placeholder="Search symbols..."
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-zinc-600"
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-gray-400">Loading...</div>
            ) : (
              <div className="divide-y divide-gray-700">
                {symbols.map((symbolInfo) => (
                  <div
                    key={symbolInfo.symbol}
                    className={`p-3 cursor-pointer hover:bg-gray-800 transition-colors ${
                      selectedSymbol === symbolInfo.symbol ? 'bg-gray-800' : ''
                    }`}
                    onClick={() => setSelectedSymbol(symbolInfo.symbol)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium">{symbolInfo.symbol}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClearSymbol(symbolInfo.symbol);
                        }}
                        className="p-1 hover:bg-gray-700 rounded"
                        title="Clear cached data"
                      >
                        <Icon name="trash" size="sm" className="w-3 h-3 text-gray-400" />
                      </button>
                    </div>

                    <div className="text-xs text-gray-400 space-y-1">
                      <div>
                        {symbolInfo.downloadedDates.length} / {symbolInfo.availableDates.length} days
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-zinc-8000"
                            style={{ width: `${symbolInfo.downloadProgress || 0}%` }}
                          />
                        </div>
                        <span>{Math.round(symbolInfo.downloadProgress || 0)}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Center Panel - Download Controls */}
        <div className="flex-1 flex flex-col">
          <div className="p-4 border-b border-gray-700 space-y-4">
            <div>
              <h3 className="text-sm font-semibold mb-2">Download Settings</h3>
              {selectedSymbolInfo && (
                <div className="text-sm text-gray-400 mb-3">
                  Available: {selectedSymbolInfo.firstDate} to {selectedSymbolInfo.lastDate}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-1">From Date</label>
                <input
                  type="date"
                  value={dateRange.from}
                  onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-zinc-600"
                />
              </div>

              <div>
                <label className="block text-sm mb-1">To Date</label>
                <input
                  type="date"
                  value={dateRange.to}
                  onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-zinc-600"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={backgroundDownload}
                  onChange={(e) => setBackgroundDownload(e.target.checked)}
                  className="rounded"
                />
                Background download
              </label>
            </div>

            <button
              onClick={handleDownload}
              disabled={!selectedSymbol || isLoading}
              className="w-full px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:bg-gray-700 disabled:cursor-not-allowed rounded font-medium flex items-center justify-center gap-2 transition-colors"
            >
              <Icon name="download" size="sm" className="w-4 h-4" />
              Download Historical Data
            </button>
          </div>

          {/* Download Tasks */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-4">
              <h3 className="text-sm font-semibold mb-3">Download Tasks</h3>

              {downloadTasks.length === 0 ? (
                <div className="text-center text-gray-400 py-8">
                  No download tasks
                </div>
              ) : (
                <div className="space-y-3">
                  {downloadTasks.map((task) => (
                    <div
                      key={task.id}
                      className="p-3 bg-gray-800 rounded border border-gray-700"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <div className="font-medium">{task.symbol}</div>
                          <div className="text-xs text-gray-400">
                            {task.dateRange.from} to {task.dateRange.to}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handlePauseResume(task.id, task.status)}
                            className="p-1.5 hover:bg-gray-700 rounded"
                            disabled={task.status === 'completed' || task.status === 'failed'}
                          >
                            {task.status === 'paused' ? (
                              <Icon name="play" size="sm" className="w-4 h-4" />
                            ) : (
                              <Icon name="stop" size="sm" className="w-4 h-4" />
                            )}
                          </button>

                          <button
                            onClick={() => handleCancel(task.id)}
                            className="p-1.5 hover:bg-gray-700 rounded"
                          >
                            <Icon name="x-close" size="sm" className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-400">
                            {task.status.toUpperCase()}
                          </span>
                          <span>
                            {Math.round(task.progress)}% ({task.downloadedTicks.toLocaleString()} ticks)
                          </span>
                        </div>

                        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${
                              task.status === 'failed'
                                ? 'bg-red-500'
                                : task.status === 'completed'
                                ? 'bg-green-500'
                                : 'bg-zinc-600'
                            }`}
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>

                        {task.endTime && (
                          <div className="text-xs text-gray-400">
                            Duration: {formatDuration(task.endTime - task.startTime)}
                          </div>
                        )}

                        {task.error && (
                          <div className="text-xs text-red-400">
                            Error: {task.error}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-700 flex justify-between items-center">
        <button
          onClick={handleClearAll}
          className="px-4 py-2 text-sm text-red-400 hover:bg-red-900/20 rounded transition-colors"
        >
          Clear All Cached Data
        </button>

        <button
          onClick={loadStorageStats}
          className="px-4 py-2 text-sm text-gray-400 hover:bg-gray-800 rounded transition-colors"
        >
          Refresh Stats
        </button>
      </div>
    </div>
  );
};

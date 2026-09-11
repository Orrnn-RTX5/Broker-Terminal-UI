import { useUiTranslation } from '../hooks/useUiTranslation';
/**
 * Historical Data Manager
 * Downloads, monitors, and clears locally cached tick history.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { historyDataManager } from '../services/historyDataManager';
import { useConfirmStore } from '../store/useConfirmStore';
import type { DownloadTask, StorageStats, SymbolDataInfo } from '../types/history';
import { Icon } from './ui/Icon';

const toLocalDateInputValue = (date: Date) => {
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().split('T')[0];
};

const createDefaultDateRange = () => {
  const today = new Date();
  return {
    from: toLocalDateInputValue(new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)),
    to: toLocalDateInputValue(today),
  };
};

const STATUS_LABELS: Record<DownloadTask['status'], string> = {
  pending: 'Queued',
  downloading: 'Downloading',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
};

const DATE_PRESETS = [
  { id: '7d', label: '7 Days', days: 7 },
  { id: '14d', label: '14 Days', days: 14 },
  { id: '30d', label: '30 Days', days: 30 },
  { id: '90d', label: '3 Months', days: 90 },
  { id: '1y', label: '1 Year', days: 365 },
  { id: 'ytd', label: 'YTD', isYtd: true },
  { id: 'all', label: 'All', isAll: true },
] as const;

const clampProgress = (progress: number) => Math.max(0, Math.min(100, progress || 0));
const isActiveTask = (task: DownloadTask) => (
  task.status === 'pending' || task.status === 'downloading' || task.status === 'paused'
);

export const HistoryDownloader: React.FC = () => {
    const tr = useUiTranslation();
  const [symbols, setSymbols] = useState<SymbolDataInfo[]>([]);
  const [downloadTasks, setDownloadTasks] = useState<DownloadTask[]>([]);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [dateRange, setDateRange] = useState(createDefaultDateRange);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [clearingSymbol, setClearingSymbol] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);

  const loadSymbols = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await historyDataManager.getAvailableSymbols();
      setSymbols(data);
      setSelectedSymbol((current) => (
        current && data.some((item) => item.symbol === current)
          ? current
          : data[0]?.symbol ?? ''
      ));
    } catch (error) {
      console.error('Failed to load symbols:', error);
      setOperationError('Historical instruments could not be loaded. Try refreshing the manager.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadStorageStats = useCallback(async () => {
    try {
      setStorageStats(await historyDataManager.getStorageStats());
    } catch (error) {
      console.error('Failed to load storage stats:', error);
      setOperationError('Local cache statistics are temporarily unavailable.');
    }
  }, []);

  useEffect(() => {
    void loadSymbols();
    void loadStorageStats();
    setDownloadTasks(historyDataManager.getDownloadTasks());

    const interval = window.setInterval(() => {
      setDownloadTasks(historyDataManager.getDownloadTasks());
    }, 500);

    return () => window.clearInterval(interval);
  }, [loadStorageStats, loadSymbols]);

  const selectedSymbolInfo = useMemo(
    () => symbols.find((item) => item.symbol === selectedSymbol),
    [selectedSymbol, symbols],
  );

  const dateRangeError = useMemo(() => {
    if (!dateRange.from || !dateRange.to) return 'Choose both a start date and an end date.';
    if (dateRange.from > dateRange.to) return 'The start date must be before the end date.';
    return null;
  }, [dateRange]);

  const [activePreset, setActivePreset] = useState<string | null>('7d');

  const selectedDayCount = useMemo(() => {
    if (!dateRange.from || !dateRange.to) return 0;
    const fromMs = new Date(dateRange.from).getTime();
    const toMs = new Date(dateRange.to).getTime();
    if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs) return 0;
    return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000)) + 1;
  }, [dateRange]);

  const handleApplyPreset = (preset: (typeof DATE_PRESETS)[number]) => {
    const today = new Date();
    setActivePreset(preset.id);
    if ('days' in preset && preset.days) {
      setDateRange({
        from: toLocalDateInputValue(new Date(today.getTime() - preset.days * 24 * 60 * 60 * 1000)),
        to: toLocalDateInputValue(today),
      });
    } else if ('isYtd' in preset && preset.isYtd) {
      setDateRange({
        from: `${today.getFullYear()}-01-01`,
        to: toLocalDateInputValue(today),
      });
    } else if ('isAll' in preset && preset.isAll) {
      if (selectedSymbolInfo?.firstDate && selectedSymbolInfo?.lastDate) {
        setDateRange({
          from: selectedSymbolInfo.firstDate,
          to: selectedSymbolInfo.lastDate,
        });
      } else {
        setDateRange({
          from: toLocalDateInputValue(new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000)),
          to: toLocalDateInputValue(today),
        });
      }
    }
  };

  const activeTaskCount = downloadTasks.filter(isActiveTask).length;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setOperationError(null);
    try {
      await Promise.all([loadSymbols(), loadStorageStats()]);
      setDownloadTasks(historyDataManager.getDownloadTasks());
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDownload = async () => {
    if (!selectedSymbol || dateRangeError) return;

    setOperationError(null);
    try {
      await historyDataManager.downloadData(selectedSymbol, dateRange, (task) => {
        setDownloadTasks(historyDataManager.getDownloadTasks());
        if (task.status === 'completed') {
          void loadStorageStats();
          void loadSymbols();
        }
      });
      setDownloadTasks(historyDataManager.getDownloadTasks());
    } catch (error) {
      console.error('Download failed:', error);
      setOperationError(error instanceof Error ? error.message : 'The history download could not be started.');
    }
  };

  const handlePauseResume = (task: DownloadTask) => {
    if (task.status === 'downloading') {
      historyDataManager.pauseDownload(task.id);
    } else if (task.status === 'paused') {
      historyDataManager.resumeDownload(task.id);
    }
    setDownloadTasks(historyDataManager.getDownloadTasks());
  };

  const handleCancel = (taskId: string) => {
    historyDataManager.cancelDownload(taskId);
    setDownloadTasks(historyDataManager.getDownloadTasks());
  };

  const handleClearSymbol = async (symbol: string) => {
    const confirmed = await useConfirmStore.getState().showConfirm(
      tr('Clear symbol history'),
      tr('Remove all locally cached historical data for {{value0}}?', { value0: symbol }),
    );
    if (!confirmed) return;

    setClearingSymbol(symbol);
    setOperationError(null);
    try {
      await historyDataManager.clearSymbol(symbol);
      await Promise.all([loadSymbols(), loadStorageStats()]);
    } catch (error) {
      console.error('Failed to clear symbol history:', error);
      setOperationError(`Cached data for ${symbol} could not be cleared.`);
    } finally {
      setClearingSymbol(null);
    }
  };

  const handleClearAll = async () => {
    const confirmed = await useConfirmStore.getState().showConfirm(
      tr('Clear historical cache'),
      tr('Remove all locally cached historical data? Download tasks are not affected.'),
    );
    if (!confirmed) return;

    setClearingSymbol('*');
    setOperationError(null);
    try {
      await historyDataManager.clearAll();
      await Promise.all([loadSymbols(), loadStorageStats()]);
    } catch (error) {
      console.error('Failed to clear historical cache:', error);
      setOperationError('The historical data cache could not be cleared.');
    } finally {
      setClearingSymbol(null);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** unitIndex;
    return `${value >= 100 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
  };

  const formatNumber = (value: number) => new Intl.NumberFormat(undefined, {
    notation: value >= 1_000_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);

  const formatDuration = (ms: number): string => {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const formatLastUpdate = (timestamp?: number) => {
    if (!timestamp) return tr('Not yet updated');
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(timestamp);
  };

  return (
    <section className="rtx-history-downloader text-[14px] font-normal" aria-label={tr("Historical Data Manager")}>
      <header className="rtx-history-downloader__header">
        <div className="rtx-history-downloader__identity">
          <span className="rtx-history-downloader__identity-icon" aria-hidden="true">
            <Icon name="database" size="md" />
          </span>
          <div>
            <h2>{tr("Historical Data Manager")}</h2>
            <p>{tr("Download and maintain local tick history")}</p>
          </div>
        </div>

        <dl className="rtx-history-downloader__metrics" aria-label={tr("Historical cache statistics")}>
          <div>
            <dt>{tr("Local storage")}</dt>
            <dd>{storageStats ? formatBytes(storageStats.totalSize) : '—'}</dd>
          </div>
          <div>
            <dt>{tr("Cached ticks")}</dt>
            <dd>{storageStats ? formatNumber(storageStats.tickCount) : '—'}</dd>
          </div>
          <div>
            <dt>{tr("Symbols")}</dt>
            <dd>{storageStats ? storageStats.symbolCount.toLocaleString() : '—'}</dd>
          </div>
          <div className="rtx-history-downloader__metric-wide">
            <dt>{tr("Last update")}</dt>
            <dd>{formatLastUpdate(storageStats?.lastUpdate)}</dd>
          </div>
        </dl>

        <button
          type="button"
          className="rtx-history-icon-button"
          onClick={() => void handleRefresh()}
          disabled={isRefreshing}
          data-loading={isRefreshing || undefined}
          aria-busy={isRefreshing}
          aria-label={tr("Refresh historical data statistics")}
          title={tr("Refresh data and statistics")}
        >
          <Icon name="refresh" size="sm" />
        </button>
      </header>

      {operationError && (
        <div className="rtx-history-downloader__error" role="alert">
          <Icon name="warning" size="sm" />
          <span>{tr(operationError)}</span>
          <button type="button" onClick={() => setOperationError(null)} aria-label={tr("Dismiss error")}>
            <Icon name="x-close" size="xs" />
          </button>
        </div>
      )}

      <div className="rtx-history-downloader__workspace">
        <main className="rtx-history-main">
          <div className="rtx-history-download-panel">
            {/* Row 1: Symbol Dropdown, Status & Clear Action */}
            <div className="rtx-history-panel-row1">
              <div className="rtx-history-symbol-picker-group">
                <label htmlFor="history-symbol-select" className="rtx-history-symbol-label">
                  {tr("Symbol:")}</label>
                <div className="rtx-history-symbol-dropdown-wrapper">
                  <select
                    id="history-symbol-select"
                    className="rtx-history-symbol-select"
                    value={selectedSymbol}
                    onChange={(event) => setSelectedSymbol(event.target.value)}
                    aria-label={tr("Select instrument")}
                  >
                    {symbols.map((item) => (
                      <option key={item.symbol} value={item.symbol}>
                        {item.symbol}
                      </option>
                    ))}
                  </select>
                  <Icon name="chevron-down" size="xs" className="rtx-history-dropdown-chevron" />
                </div>
              </div>

              <div className="rtx-history-panel-row1-actions">
                <button
                  type="button"
                  className="rtx-history-clear-btn"
                  onClick={() => selectedSymbol && void handleClearSymbol(selectedSymbol)}
                  disabled={clearingSymbol !== null || !selectedSymbolInfo?.downloadedDates?.length || downloadTasks.some((t) => t.symbol === selectedSymbol && isActiveTask(t))}
                  aria-label={tr("Clear cached data for {{value0}}", { value0: selectedSymbol })}
                  title={tr("Clear cached data for {{value0}}", { value0: selectedSymbol })}
                >
                  <Icon name="trash" size="sm" />
                  <span>{tr("Clear Symbol Cache")}</span>
                </button>
              </div>
            </div>

            {/* Row 2: Presets + Dual Date Field + Download Button */}
            <div className="rtx-history-controls-row">
              <div className="rtx-history-segmented-presets" role="group" aria-label={tr("Quick date range selection")}>
                {DATE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`rtx-history-seg-btn ${activePreset === preset.id ? 'is-active' : ''}`}
                    onClick={() => handleApplyPreset(preset)}
                  >
                    {tr(preset.label)}
                  </button>
                ))}
              </div>

              <div className="rtx-history-date-inputs">
                <label className="rtx-history-field">
                  <span className="rtx-history-field-label">{tr("From")}</span>
                  <input
                    type="date"
                    className="rtx-history-date-input"
                    aria-label={tr("From date")}
                    value={dateRange.from}
                    max={dateRange.to || undefined}
                    onChange={(event) => {
                      setActivePreset(null);
                      setDateRange((current) => ({ ...current, from: event.target.value }));
                    }}
                  />
                </label>

                <span className="rtx-history-arrow">→</span>

                <label className="rtx-history-field">
                  <span className="rtx-history-field-label">{tr("To")}</span>
                  <input
                    type="date"
                    className="rtx-history-date-input"
                    aria-label={tr("To date")}
                    value={dateRange.to}
                    min={dateRange.from || undefined}
                    onChange={(event) => {
                      setActivePreset(null);
                      setDateRange((current) => ({ ...current, to: event.target.value }));
                    }}
                  />
                </label>

                {selectedDayCount > 0 && (
                  <span className="rtx-history-duration-badge">
                    {selectedDayCount} {selectedDayCount === 1 ? tr("Day") : tr("Days")}
                  </span>
                )}
              </div>

              <button
                type="button"
                className="rtx-history-primary-button"
                aria-label={tr("Download history")}
                onClick={() => void handleDownload()}
                disabled={!selectedSymbol || isLoading || Boolean(dateRangeError)}
              >
                <Icon name="download" size="sm" />
                <span>{tr("Download History")}</span>
              </button>
            </div>

            {/* Row 3: Coverage Status Banner (Without server range) */}
            <div className="rtx-history-coverage-banner" data-error={Boolean(dateRangeError) || undefined}>
              <div className="rtx-history-coverage-left">
                {dateRangeError ? (
                  <>
                    <Icon name="warning" size="xs" />
                    <span style={{ color: 'var(--color-loss)' }}>{tr(dateRangeError)}</span>
                  </>
                ) : selectedSymbolInfo?.firstDate && selectedSymbolInfo.lastDate ? (
                  <>
                    <Icon name="check" size="xs" />
                    <div className="rtx-history-coverage-details">
                      <span className="rtx-history-coverage-title">{tr("Cached Coverage:")}</span>
                      <strong className="rtx-history-coverage-date">{selectedSymbolInfo.firstDate}</strong>
                      <span className="rtx-history-coverage-sep">{tr("to")}</span>
                      <strong className="rtx-history-coverage-date">{selectedSymbolInfo.lastDate}</strong>
                      <span className="rtx-history-coverage-recorded">
                        ({selectedSymbolInfo.downloadedDates?.length || 0} {selectedSymbolInfo.downloadedDates?.length === 1 ? tr("day") : tr("days")} {tr(" recorded)")}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <Icon name="info" size="xs" />
                    <span>{tr("Select an instrument and date range to download tick history to local cache.")}</span>
                  </>
                )}
              </div>

              {selectedSymbolInfo && (selectedSymbolInfo.downloadProgress ?? 0) > 0 && !dateRangeError && (
                <div className="rtx-history-coverage-bar">
                  <span>{tr("Local sync: ")}{selectedSymbolInfo.downloadProgress}%</span>
                  <div className="rtx-history-bar-track">
                    <div className="rtx-history-bar-fill" style={{ width: `${selectedSymbolInfo.downloadProgress}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>

          <section className="rtx-history-tasks" aria-labelledby="history-download-queue-heading">
            <div className="rtx-history-tasks__header">
              <div>
                <h3 id="history-download-queue-heading">{tr("Download queue")}</h3>
                <span>{activeTaskCount ? tr("{{value0}} active", { value0: activeTaskCount }) : tr("No active downloads")}</span>
              </div>
              <span className="rtx-history-task-count">{downloadTasks.length} {tr(" total")}</span>
            </div>

            <div className="rtx-history-tasks__list">
              {downloadTasks.length === 0 ? (
                <div className="rtx-history-empty">
                  <span className="rtx-history-empty__icon" aria-hidden="true">
                    <Icon name="history" size="lg" />
                  </span>
                  <strong>{tr("Your download queue is clear")}</strong>
                  <span>{tr("Choose an instrument and date range to cache historical ticks.")}</span>
                </div>
              ) : (
                downloadTasks.map((task) => {
                  const progress = clampProgress(task.progress);
                  const canPauseOrResume = task.status === 'downloading' || task.status === 'paused';
                  const isFinished = task.status === 'completed' || task.status === 'failed';

                  return (
                    <article className="rtx-history-task" data-status={task.status} key={task.id}>
                      <div className="rtx-history-task__identity">
                        <span className="rtx-history-task__status-dot" aria-hidden="true" />
                        <div>
                          <strong>{task.symbol}</strong>
                          <span>{task.dateRange.from} — {task.dateRange.to}</span>
                        </div>
                      </div>

                      <div className="rtx-history-task__progress-area">
                        <div className="rtx-history-task__progress-label">
                          <span>{tr(STATUS_LABELS[task.status])}</span>
                          <span>{Math.round(progress)}% · {task.downloadedTicks.toLocaleString()} {tr(" ticks")}</span>
                        </div>
                        <div
                          className="rtx-history-progress rtx-history-progress--task"
                          role="progressbar"
                          aria-label={`${task.symbol} ${tr(STATUS_LABELS[task.status])}`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(progress)}
                        >
                          <span style={{ width: `${progress}%` }} />
                        </div>
                        {(task.endTime || task.error) && (
                          <div className="rtx-history-task__detail" data-error={Boolean(task.error) || undefined}>
                            {task.error || `Completed in ${formatDuration(task.endTime! - task.startTime)}`}
                          </div>
                        )}
                      </div>

                      <div className="rtx-history-task__actions">
                        <button
                          type="button"
                          className="rtx-history-icon-button"
                          onClick={() => handlePauseResume(task)}
                          disabled={!canPauseOrResume}
                          aria-label={task.status === 'paused' ? tr("Resume {{value0}} download", { value0: task.symbol }) : tr("Pause {{value0}} download", { value0: task.symbol })}
                          title={task.status === 'paused' ? tr("Resume download") : canPauseOrResume ? tr("Pause download") : STATUS_LABELS[task.status]}
                        >
                          <Icon name={task.status === 'paused' ? 'play' : isFinished ? 'check' : 'stop'} size="sm" />
                        </button>
                        <button
                          type="button"
                          className="rtx-history-icon-button"
                          onClick={() => handleCancel(task.id)}
                          aria-label={tr("{{value0}} {{value1}} download", { value0: isFinished ? 'Dismiss' : 'Cancel', value1: task.symbol })}
                          title={isFinished ? tr("Dismiss task") : tr("Cancel download")}
                        >
                          <Icon name="x-close" size="sm" />
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </main>
      </div>
    </section>
  );
};

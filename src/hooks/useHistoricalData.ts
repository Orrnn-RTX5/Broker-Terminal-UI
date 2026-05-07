/**
 * Historical Data Hook
 * React hook for accessing historical tick data
 */

import { useState, useEffect, useCallback } from 'react';
import { historyDataManager } from '../services/historyDataManager';
import type { TickData, DateRange, SymbolDataInfo } from '../types/history';

export type UseHistoricalDataOptions = {
  symbol: string;
  dateRange: DateRange;
  autoLoad?: boolean;
  onProgress?: (progress: number) => void;
};

export type UseHistoricalDataResult = {
  data: TickData[];
  isLoading: boolean;
  error: Error | null;
  progress: number;
  symbolInfo: SymbolDataInfo | null;
  refetch: () => Promise<void>;
  downloadIfMissing: () => Promise<void>;
};

export const useHistoricalData = (
  options: UseHistoricalDataOptions
): UseHistoricalDataResult => {
  const { symbol, dateRange, autoLoad = true, onProgress } = options;

  const [data, setData] = useState<TickData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState(0);
  const [symbolInfo, setSymbolInfo] = useState<SymbolDataInfo | null>(null);

  const loadData = useCallback(async () => {
    if (!symbol) return;

    setIsLoading(true);
    setError(null);

    try {
      // Load symbol info
      const info = await historyDataManager.getSymbolInfo(symbol);
      setSymbolInfo(info);

      // Load data from cache
      const ticks = await historyDataManager.getTicks(symbol, dateRange);
      setData(ticks);
      setProgress(100);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load data'));
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, [symbol, dateRange]);

  const downloadIfMissing = useCallback(async () => {
    if (!symbol) return;

    setIsLoading(true);
    setError(null);

    try {
      await historyDataManager.downloadData(
        symbol,
        dateRange,
        (task) => {
          const newProgress = task.progress;
          setProgress(newProgress);
          onProgress?.(newProgress);

          if (task.status === 'completed') {
            loadData();
          } else if (task.status === 'failed') {
            setError(new Error(task.error || 'Download failed'));
          }
        }
      );
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to download data'));
    } finally {
      setIsLoading(false);
    }
  }, [symbol, dateRange, onProgress, loadData]);

  const refetch = useCallback(async () => {
    await loadData();
  }, [loadData]);

  useEffect(() => {
    if (autoLoad) {
      loadData();
    }
  }, [autoLoad, loadData]);

  return {
    data,
    isLoading,
    error,
    progress,
    symbolInfo,
    refetch,
    downloadIfMissing
  };
};

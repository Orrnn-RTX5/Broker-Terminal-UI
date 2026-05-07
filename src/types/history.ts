/**
 * Historical Data Types
 * Type definitions for historical data management
 */

export type TickData = {
  symbol: string;
  bid: number;
  ask: number;
  timestamp: number;
  volume?: number;
};

export type DateRange = {
  from: string; // ISO date string
  to: string;   // ISO date string
};

export type SymbolDataInfo = {
  symbol: string;
  availableDates: string[]; // Array of ISO date strings
  totalTicks: number;
  firstDate: string;
  lastDate: string;
  downloadedDates: string[]; // Locally cached dates
  downloadProgress?: number; // 0-100
};

export type DownloadTask = {
  id: string;
  symbol: string;
  dateRange: DateRange;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'paused';
  progress: number; // 0-100
  totalTicks: number;
  downloadedTicks: number;
  startTime: number;
  endTime?: number;
  error?: string;
};

export type DownloadChunk = {
  symbol: string;
  date: string;
  ticks: TickData[];
  chunkIndex: number;
  totalChunks: number;
};

export type StorageStats = {
  totalSize: number; // bytes
  tickCount: number;
  symbolCount: number;
  dateRanges: Record<string, DateRange>;
  lastUpdate: number;
};

export type CacheOptions = {
  maxAge?: number; // milliseconds
  maxSize?: number; // bytes
  evictionPolicy?: 'LRU' | 'LFU' | 'FIFO';
};

export type DataIntegrityCheck = {
  symbol: string;
  date: string;
  expectedCount: number;
  actualCount: number;
  isValid: boolean;
  checksum?: string;
};

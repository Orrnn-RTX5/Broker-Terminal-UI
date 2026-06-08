import Papa from 'papaparse';

import { tradeGatewayApi } from '../api/tradeGateway';
import { api } from '../services/api';
import type { Trade } from '../store/useAppStore';
import { sanitizeCsvRow } from '../utils/csvSafety';

export type ExportFormat = 'csv' | 'pdf' | 'json';
export type ExportDataType = 'trades' | 'positions' | 'performance';
export type ExportableDataType = Exclude<ExportDataType, 'performance'>;
export type CsvDelimiter = ',' | ';' | '\t';
export type ExportColumnDefinition = {
  key: string;
  label: string;
};

const TAB_DELIMITER = '\t';
const LITERAL_TAB_DELIMITER = '\\t';
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const EXPORT_COLUMNS_BY_DATA_TYPE: Record<ExportableDataType, ExportColumnDefinition[]> = {
  trades: [
    { key: 'id', label: 'Trade ID' },
    { key: 'symbol', label: 'Symbol' },
    { key: 'side', label: 'Side' },
    { key: 'volume', label: 'Volume' },
    { key: 'openPrice', label: 'Open Price' },
    { key: 'closePrice', label: 'Close Price' },
    { key: 'profit', label: 'Profit' },
    { key: 'commission', label: 'Commission' },
    { key: 'swap', label: 'Swap' },
    { key: 'openTime', label: 'Open Time' },
    { key: 'closeTime', label: 'Close Time' },
  ],
  positions: [
    { key: 'id', label: 'Position ID' },
    { key: 'symbol', label: 'Symbol' },
    { key: 'side', label: 'Side' },
    { key: 'volume', label: 'Volume' },
    { key: 'openPrice', label: 'Open Price' },
    { key: 'currentPrice', label: 'Current Price' },
    { key: 'unrealizedPnL', label: 'Unrealized P&L' },
    { key: 'sl', label: 'Stop Loss' },
    { key: 'tp', label: 'Take Profit' },
  ],
};

export const DEFAULT_EXPORT_COLUMNS_BY_DATA_TYPE: Record<ExportableDataType, string[]> = {
  trades: ['symbol', 'side', 'volume', 'profit', 'openTime', 'closeTime'],
  positions: ['symbol', 'side', 'volume', 'openPrice', 'currentPrice', 'unrealizedPnL'],
};

export const getExportColumnsForDataType = (dataType: ExportableDataType): ExportColumnDefinition[] =>
  EXPORT_COLUMNS_BY_DATA_TYPE[dataType];

export const getDefaultSelectedExportColumns = (dataType: ExportableDataType): Set<string> =>
  new Set(DEFAULT_EXPORT_COLUMNS_BY_DATA_TYPE[dataType]);

export const filterSelectedExportColumns = (
  dataType: ExportableDataType,
  columns: Iterable<string>
): string[] => {
  const allowedColumns = new Set(EXPORT_COLUMNS_BY_DATA_TYPE[dataType].map((column) => column.key));
  return Array.from(columns).filter((column) => allowedColumns.has(column));
};

export const normalizeCsvDelimiter = (delimiter: string): CsvDelimiter => {
  if (delimiter === TAB_DELIMITER || delimiter === LITERAL_TAB_DELIMITER) {
    return TAB_DELIMITER;
  }
  if (delimiter === ';') {
    return ';';
  }
  return ',';
};

const parseDateOnlyUtc = (value: string, endOfDay: boolean): number => {
  const [year, month, day] = value.split('-').map((part) => Number(part));
  return Date.UTC(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0
  );
};

const parseExportDateBound = (value: string, endOfDay: boolean): number => {
  if (DATE_ONLY_PATTERN.test(value)) {
    return parseDateOnlyUtc(value, endOfDay);
  }
  return new Date(value).getTime();
};

export const getExportDateRangeMs = (startDate: string, endDate: string) => ({
  start: parseExportDateBound(startDate, false),
  end: parseExportDateBound(endDate, true),
});

export const filterTradesByExportDateRange = <T extends { closeTime?: string | null }>(
  trades: T[],
  startDate: string,
  endDate: string
): T[] => {
  const { start, end } = getExportDateRangeMs(startDate, endDate);

  return trades.filter((item) => {
    const closeTime = item.closeTime ? new Date(item.closeTime).getTime() : 0;
    return Number.isFinite(closeTime) && closeTime >= start && closeTime <= end;
  });
};

export const buildExportCsv = (
  data: Array<Record<string, unknown>>,
  columns: Iterable<string>,
  delimiter: string
): string => {
  const selected = Array.from(columns);
  const filteredData = data.map((item) => {
    const filtered: Record<string, unknown> = {};
    selected.forEach((col) => {
      filtered[col] = item[col];
    });
    return filtered;
  });

  const safeData = filteredData.map((row) => sanitizeCsvRow(row));

  return Papa.unparse(safeData, {
    delimiter: normalizeCsvDelimiter(delimiter),
    header: true,
  });
};

export const getExportUnavailableReason = (format: ExportFormat, dataType: ExportDataType): string | null => {
  if (format === 'pdf') {
    return 'PDF export is unavailable because this broker backend does not expose a PDF export endpoint.';
  }
  if (dataType === 'performance') {
    return 'Performance export is unavailable because this broker backend does not expose a performance export endpoint.';
  }
  return null;
};

export const parseExportAccountLogin = (accountId: string): number => {
  const login = Number(accountId);
  if (!Number.isFinite(login) || login <= 0) {
    throw new Error('A valid account login is required to export data');
  }
  return login;
};

export const fetchExportRows = async (
  accountId: string,
  dataType: Exclude<ExportDataType, 'performance'>,
  startDate: string,
  endDate: string
): Promise<Array<Record<string, unknown>>> => {
  const login = parseExportAccountLogin(accountId);

  if (dataType === 'positions') {
    const positions = await api.positions.getPositions(login);
    return positions as unknown as Array<Record<string, unknown>>;
  }

  const trades = await tradeGatewayApi.getDeals(login);
  return filterTradesByExportDateRange(trades as Trade[], startDate, endDate) as unknown as Array<Record<string, unknown>>;
};

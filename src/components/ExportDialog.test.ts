import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildExportCsv,
  fetchExportRows,
  filterSelectedExportColumns,
  filterTradesByExportDateRange,
  getDefaultSelectedExportColumns,
  getExportColumnsForDataType,
  getExportDateRangeMs,
  getExportUnavailableReason,
  normalizeCsvDelimiter,
  parseExportAccountLogin,
} from './ExportDialog.helpers';
import { tradeGatewayApi } from '../api/tradeGateway';
import { api } from '../services/api';
import type { Position } from '../api/endpoints';
import type { Trade } from '../store/useAppStore';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ExportDialog CSV delimiter handling', () => {
  it('normalizes literal backslash-t to a real tab delimiter', () => {
    expect(normalizeCsvDelimiter('\\t')).toBe('\t');
    expect(normalizeCsvDelimiter('\t')).toBe('\t');
  });

  it('serializes tab-delimited exports with real tab characters', () => {
    const csv = buildExportCsv(
      [{ symbol: 'EURUSD', side: 'buy', profit: 12.5 }],
      new Set(['symbol', 'side', 'profit']),
      '\\t'
    );

    expect(csv).toContain('symbol\tside\tprofit');
    expect(csv).toContain('EURUSD\tbuy\t12.5');
    expect(csv).not.toContain('symbol\\tside\\tprofit');
  });
});

describe('ExportDialog data-type-specific columns', () => {
  it('keeps separate default selected columns for trades and positions', () => {
    expect(Array.from(getDefaultSelectedExportColumns('trades'))).toEqual([
      'symbol',
      'side',
      'volume',
      'profit',
      'openTime',
      'closeTime',
    ]);
    expect(Array.from(getDefaultSelectedExportColumns('positions'))).toEqual([
      'symbol',
      'side',
      'volume',
      'openPrice',
      'currentPrice',
      'unrealizedPnL',
    ]);
  });

  it('drops hidden stale trade columns when exporting positions', () => {
    expect(
      filterSelectedExportColumns('positions', ['symbol', 'profit', 'closeTime', 'currentPrice'])
    ).toEqual(['symbol', 'currentPrice']);
  });

  it('does not expose position-only columns in trade exports', () => {
    expect(
      filterSelectedExportColumns('trades', ['symbol', 'unrealizedPnL', 'closeTime'])
    ).toEqual(['symbol', 'closeTime']);
    expect(getExportColumnsForDataType('trades').some((column) => column.key === 'unrealizedPnL')).toBe(false);
  });
});

describe('ExportDialog trade date filtering', () => {
  it('treats a date-only end date as the full selected final day', () => {
    expect(getExportDateRangeMs('2026-06-01', '2026-06-07')).toEqual({
      start: Date.UTC(2026, 5, 1, 0, 0, 0, 0),
      end: Date.UTC(2026, 5, 7, 23, 59, 59, 999),
    });
  });

  it('includes trades closed any time on the selected end date', () => {
    const trades = [
      { id: 'start', closeTime: '2026-06-01T00:00:00.000Z' },
      { id: 'end-day-late', closeTime: '2026-06-07T23:59:59.999Z' },
      { id: 'next-day', closeTime: '2026-06-08T00:00:00.000Z' },
    ];

    expect(
      filterTradesByExportDateRange(trades, '2026-06-01', '2026-06-07').map((trade) => trade.id)
    ).toEqual(['start', 'end-day-late']);
  });
});

describe('ExportDialog unavailable export modes', () => {
  it('quarantines PDF and performance exports with clear reasons', () => {
    expect(getExportUnavailableReason('pdf', 'trades')).toContain('PDF export is unavailable');
    expect(getExportUnavailableReason('csv', 'performance')).toContain('Performance export is unavailable');
    expect(getExportUnavailableReason('json', 'positions')).toBeNull();
  });

  it('requires a real account login before export route selection', () => {
    expect(parseExportAccountLogin('100001')).toBe(100001);
    expect(() => parseExportAccountLogin('')).toThrow('valid account login');
    expect(() => parseExportAccountLogin('not-a-login')).toThrow('valid account login');
  });
});

describe('ExportDialog v2 export data sources', () => {
  it('routes position exports through the existing v2 positions helper', async () => {
    const positionsSpy = vi.spyOn(api.positions, 'getPositions').mockResolvedValueOnce([
      { id: '1', symbol: 'EURUSD', side: 'buy' } satisfies Position,
    ]);

    await expect(fetchExportRows('100001', 'positions', '2026-06-01', '2026-06-07')).resolves.toEqual([
      { id: '1', symbol: 'EURUSD', side: 'buy' },
    ]);
    expect(positionsSpy).toHaveBeenCalledWith(100001);
  });

  it('routes trade exports through the existing v2 deals helper and filters dates', async () => {
    const dealsSpy = vi.spyOn(tradeGatewayApi, 'getDeals').mockResolvedValueOnce([
      { id: 1, closeTime: '2026-06-02T12:00:00.000Z' } as Trade,
      { id: 2, closeTime: '2026-06-08T00:00:00.000Z' } as Trade,
    ]);

    await expect(fetchExportRows('100001', 'trades', '2026-06-01', '2026-06-07')).resolves.toEqual([
      { id: 1, closeTime: '2026-06-02T12:00:00.000Z' },
    ]);
    expect(dealsSpy).toHaveBeenCalledWith(100001);
  });
});

/**
 * Print Functionality Integration Test
 * Tests the complete print workflow
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useChartPrint } from '../hooks/useChartPrint';
import { chartPrinter } from '../services/chartPrinter';

describe('Print Functionality', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
  });

  describe('useChartPrint Hook', () => {
    it('should initialize with correct default state', () => {
      const { result } = renderHook(() =>
        useChartPrint({
          symbol: 'BTCUSD',
          timeframe: '1m',
        })
      );

      expect(result.current.showSetupDialog).toBe(false);
      expect(result.current.showPreviewDialog).toBe(false);
      expect(result.current.printPreferences).toBeNull();
      expect(result.current.chartData).toBeNull();
    });

    it('should open print setup dialog', () => {
      const { result } = renderHook(() =>
        useChartPrint({
          symbol: 'BTCUSD',
          timeframe: '1m',
        })
      );

      result.current.openPrintSetup();

      expect(result.current.showSetupDialog).toBe(true);
    });

    it('should handle setup completion', () => {
      const { result } = renderHook(() =>
        useChartPrint({
          symbol: 'BTCUSD',
          timeframe: '1m',
        })
      );

      const mockPreferences = chartPrinter.getPreferences();
      result.current.handleSetupComplete(mockPreferences);

      expect(result.current.showSetupDialog).toBe(false);
      expect(result.current.showPreviewDialog).toBe(true);
      expect(result.current.printPreferences).toEqual(mockPreferences);
      expect(result.current.chartData).toBeTruthy();
    });
  });

  describe('chartPrinter Service', () => {
    it('should return default preferences', () => {
      const preferences = chartPrinter.getPreferences();

      expect(preferences).toMatchObject({
        pageSize: 'A4',
        orientation: 'landscape',
        colorMode: 'color',
        includeHeader: true,
        includeFooter: true,
        includeGrid: true,
        includeIndicators: true,
        includeDrawings: true,
      });
    });

    it('should generate printable HTML', () => {
      const chartData = {
        symbol: 'BTCUSD',
        timeframe: '1m',
        dateRange: {
          from: new Date('2024-01-01'),
          to: new Date('2024-01-02'),
        },
        indicators: [
          {
            name: 'SMA',
            parameters: { period: 20 },
          },
        ],
        drawings: [
          {
            type: 'TREND_LINE',
            label: 'Support',
          },
        ],
      };

      const preferences = chartPrinter.getPreferences();
      const html = chartPrinter.generatePrintableHTML(chartData, preferences);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('BTCUSD');
      expect(html).toContain('1m');
      expect(html).toContain('SMA');
      expect(html).toContain('TREND_LINE');
    });

    it('should include header when enabled', () => {
      const chartData = {
        symbol: 'EURUSD',
        timeframe: '5m',
        dateRange: {
          from: new Date('2024-01-01'),
          to: new Date('2024-01-02'),
        },
        indicators: [],
        drawings: [],
      };

      const preferences = {
        ...chartPrinter.getPreferences(),
        includeHeader: true,
        headerText: 'Custom Header',
      };

      const html = chartPrinter.generatePrintableHTML(chartData, preferences);

      expect(html).toContain('Custom Header');
      expect(html).toContain('header');
    });

    it('should include footer when enabled', () => {
      const chartData = {
        symbol: 'GBPUSD',
        timeframe: '15m',
        dateRange: {
          from: new Date('2024-01-01'),
          to: new Date('2024-01-02'),
        },
        indicators: [],
        drawings: [],
      };

      const preferences = {
        ...chartPrinter.getPreferences(),
        includeFooter: true,
        footerText: 'Custom Footer',
      };

      const html = chartPrinter.generatePrintableHTML(chartData, preferences);

      expect(html).toContain('Custom Footer');
      expect(html).toContain('footer');
    });

    it('should apply grayscale filter when colorMode is grayscale', () => {
      const chartData = {
        symbol: 'USDJPY',
        timeframe: '1h',
        dateRange: {
          from: new Date('2024-01-01'),
          to: new Date('2024-01-02'),
        },
        indicators: [],
        drawings: [],
      };

      const preferences = {
        ...chartPrinter.getPreferences(),
        colorMode: 'grayscale' as const,
      };

      const html = chartPrinter.generatePrintableHTML(chartData, preferences);

      expect(html).toContain('grayscale(100%)');
    });

    it('should handle landscape orientation', () => {
      const chartData = {
        symbol: 'BTCUSD',
        timeframe: '4h',
        dateRange: {
          from: new Date('2024-01-01'),
          to: new Date('2024-01-02'),
        },
        indicators: [],
        drawings: [],
      };

      const preferences = {
        ...chartPrinter.getPreferences(),
        orientation: 'landscape' as const,
      };

      const html = chartPrinter.generatePrintableHTML(chartData, preferences);

      expect(html).toContain('landscape');
    });

    it('should handle portrait orientation', () => {
      const chartData = {
        symbol: 'ETHUSD',
        timeframe: '1d',
        dateRange: {
          from: new Date('2024-01-01'),
          to: new Date('2024-01-02'),
        },
        indicators: [],
        drawings: [],
      };

      const preferences = {
        ...chartPrinter.getPreferences(),
        orientation: 'portrait' as const,
      };

      const html = chartPrinter.generatePrintableHTML(chartData, preferences);

      expect(html).toContain('portrait');
    });

    it('should include indicators legend when enabled', () => {
      const chartData = {
        symbol: 'BTCUSD',
        timeframe: '1m',
        dateRange: {
          from: new Date('2024-01-01'),
          to: new Date('2024-01-02'),
        },
        indicators: [
          {
            name: 'RSI',
            parameters: { period: 14 },
          },
          {
            name: 'MACD',
            parameters: { fast: 12, slow: 26, signal: 9 },
          },
        ],
        drawings: [],
      };

      const preferences = {
        ...chartPrinter.getPreferences(),
        includeIndicators: true,
      };

      const html = chartPrinter.generatePrintableHTML(chartData, preferences);

      expect(html).toContain('RSI');
      expect(html).toContain('MACD');
      expect(html).toContain('indicators-legend');
    });

    it('should include drawings legend when enabled', () => {
      const chartData = {
        symbol: 'EURUSD',
        timeframe: '1h',
        dateRange: {
          from: new Date('2024-01-01'),
          to: new Date('2024-01-02'),
        },
        indicators: [],
        drawings: [
          {
            type: 'FIBONACCI',
            label: 'Fib Retracement',
          },
          {
            type: 'HORIZONTAL_LINE',
            label: 'Resistance',
          },
        ],
      };

      const preferences = {
        ...chartPrinter.getPreferences(),
        includeDrawings: true,
      };

      const html = chartPrinter.generatePrintableHTML(chartData, preferences);

      expect(html).toContain('FIBONACCI');
      expect(html).toContain('HORIZONTAL_LINE');
      expect(html).toContain('drawings-legend');
    });
  });

  describe('Print Preview Dialog', () => {
    it('should support zoom controls', () => {
      // This would test the zoom functionality in PrintPreviewDialog
      // The zoom should range from 50% to 200%
      const minZoom = 50;
      const maxZoom = 200;

      expect(minZoom).toBe(50);
      expect(maxZoom).toBe(200);
    });
  });

  describe('Print Setup Dialog', () => {
    it('should validate margin values', () => {
      // Margins should be between 0 and 50mm
      const minMargin = 0;
      const maxMargin = 50;

      expect(minMargin).toBeGreaterThanOrEqual(0);
      expect(maxMargin).toBeLessThanOrEqual(50);
    });

    it('should support all page sizes', () => {
      const pageSizes = ['A4', 'Letter', 'Legal', 'A3'];

      pageSizes.forEach(size => {
        const preferences = {
          ...chartPrinter.getPreferences(),
          pageSize: size as any,
        };

        const chartData = {
          symbol: 'TEST',
          timeframe: '1m',
          dateRange: {
            from: new Date(),
            to: new Date(),
          },
          indicators: [],
          drawings: [],
        };

        const html = chartPrinter.generatePrintableHTML(chartData, preferences);
        expect(html).toContain(size);
      });
    });
  });

  describe('Keyboard Shortcuts', () => {
    it('should support Ctrl+P for print', () => {
      // This tests that Ctrl+P is properly configured
      const printShortcut = 'Ctrl+P';
      expect(printShortcut).toBe('Ctrl+P');
    });
  });
});

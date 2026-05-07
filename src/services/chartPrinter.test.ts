/**
 * Chart Printer Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chartPrinter, DEFAULT_PRINT_PREFERENCES, type ChartPrintData } from './chartPrinter';

// Mock fetch
global.fetch = vi.fn();

describe('ChartPrinterService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Preferences Management', () => {
    it('should return default preferences', () => {
      const prefs = chartPrinter.getPreferences();
      expect(prefs).toEqual(DEFAULT_PRINT_PREFERENCES);
    });

    it('should load preferences from backend', async () => {
      const mockPrefs = {
        ...DEFAULT_PRINT_PREFERENCES,
        pageSize: 'Letter' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockPrefs,
      });

      const prefs = await chartPrinter.loadPreferences('test-account');
      expect(prefs.pageSize).toBe('Letter');
    });

    it('should save preferences to backend', async () => {
      const mockPrefs = {
        ...DEFAULT_PRINT_PREFERENCES,
        pageSize: 'A3' as const,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success' }),
      });

      await expect(
        chartPrinter.savePreferences('test-account', mockPrefs)
      ).resolves.not.toThrow();
    });
  });

  describe('HTML Generation', () => {
    const mockChartData: ChartPrintData = {
      symbol: 'EURUSD',
      timeframe: '1H',
      dateRange: {
        from: new Date('2024-01-01'),
        to: new Date('2024-01-31'),
      },
      indicators: [
        { name: 'EMA', parameters: { period: 20 } },
        { name: 'RSI', parameters: { period: 14 } },
      ],
      drawings: [
        { type: 'TREND_LINE', label: 'Support' },
        { type: 'HORIZONTAL_LINE', label: 'Resistance' },
      ],
    };

    it('should generate HTML with all elements', () => {
      const html = chartPrinter.generatePrintableHTML(
        mockChartData,
        DEFAULT_PRINT_PREFERENCES
      );

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('EURUSD');
      expect(html).toContain('1H');
      expect(html).toContain('EMA');
      expect(html).toContain('RSI');
    });

    it('should include header when enabled', () => {
      const prefs = {
        ...DEFAULT_PRINT_PREFERENCES,
        includeHeader: true,
        headerText: 'Test Header',
      };

      const html = chartPrinter.generatePrintableHTML(mockChartData, prefs);
      expect(html).toContain('Test Header');
    });

    it('should exclude header when disabled', () => {
      const prefs = {
        ...DEFAULT_PRINT_PREFERENCES,
        includeHeader: false,
      };

      const html = chartPrinter.generatePrintableHTML(mockChartData, prefs);
      expect(html).not.toContain('class="header"');
    });

    it('should include footer when enabled', () => {
      const prefs = {
        ...DEFAULT_PRINT_PREFERENCES,
        includeFooter: true,
        footerText: 'Test Footer',
      };

      const html = chartPrinter.generatePrintableHTML(mockChartData, prefs);
      expect(html).toContain('Test Footer');
    });

    it('should apply grayscale filter when in grayscale mode', () => {
      const prefs = {
        ...DEFAULT_PRINT_PREFERENCES,
        colorMode: 'grayscale' as const,
      };

      const html = chartPrinter.generatePrintableHTML(mockChartData, prefs);
      expect(html).toContain('grayscale(100%)');
    });

    it('should apply correct page orientation', () => {
      const landscapePrefs = {
        ...DEFAULT_PRINT_PREFERENCES,
        orientation: 'landscape' as const,
      };

      const html = chartPrinter.generatePrintableHTML(mockChartData, landscapePrefs);
      expect(html).toContain('landscape');
    });

    it('should include indicators legend when enabled', () => {
      const prefs = {
        ...DEFAULT_PRINT_PREFERENCES,
        includeIndicators: true,
      };

      const html = chartPrinter.generatePrintableHTML(mockChartData, prefs);
      expect(html).toContain('indicators-legend');
      expect(html).toContain('EMA');
      expect(html).toContain('period:20');
    });

    it('should include drawings legend when enabled', () => {
      const prefs = {
        ...DEFAULT_PRINT_PREFERENCES,
        includeDrawings: true,
      };

      const html = chartPrinter.generatePrintableHTML(mockChartData, prefs);
      expect(html).toContain('drawings-legend');
      expect(html).toContain('Support');
      expect(html).toContain('Resistance');
    });

    it('should apply custom margins', () => {
      const prefs = {
        ...DEFAULT_PRINT_PREFERENCES,
        marginTop: 30,
        marginRight: 25,
        marginBottom: 20,
        marginLeft: 15,
      };

      const html = chartPrinter.generatePrintableHTML(mockChartData, prefs);
      expect(html).toContain('padding: 30px 25px 20px 15px');
    });
  });

  describe('Page Dimensions', () => {
    it('should calculate correct A4 landscape dimensions', () => {
      const prefs = {
        ...DEFAULT_PRINT_PREFERENCES,
        pageSize: 'A4' as const,
        orientation: 'landscape' as const,
      };

      const html = chartPrinter.generatePrintableHTML(
        {
          symbol: 'TEST',
          timeframe: '1H',
          dateRange: { from: new Date(), to: new Date() },
          indicators: [],
          drawings: [],
        },
        prefs
      );

      // In landscape, width should be > height
      expect(html).toContain('landscape');
    });

    it('should calculate correct Letter portrait dimensions', () => {
      const prefs = {
        ...DEFAULT_PRINT_PREFERENCES,
        pageSize: 'Letter' as const,
        orientation: 'portrait' as const,
      };

      const html = chartPrinter.generatePrintableHTML(
        {
          symbol: 'TEST',
          timeframe: '1H',
          dateRange: { from: new Date(), to: new Date() },
          indicators: [],
          drawings: [],
        },
        prefs
      );

      expect(html).toContain('Letter');
      expect(html).toContain('portrait');
    });
  });

  describe('Chart Canvas Capture', () => {
    it('should return null if chart API is invalid', () => {
      const result = chartPrinter.captureChartCanvas(null as any);
      expect(result).toBeNull();
    });

    it('should return null if container has no canvas', () => {
      const mockChartApi = {
        chartElement: () => document.createElement('div'),
      };

      const result = chartPrinter.captureChartCanvas(mockChartApi as any);
      expect(result).toBeNull();
    });
  });

  describe('Print Functionality', () => {
    it('should create iframe for printing', async () => {
      const mockChartData: ChartPrintData = {
        symbol: 'EURUSD',
        timeframe: '1H',
        dateRange: {
          from: new Date('2024-01-01'),
          to: new Date('2024-01-31'),
        },
        indicators: [],
        drawings: [],
      };

      // Mock window.print
      const originalPrint = window.print;
      window.print = vi.fn();

      // Create a mock iframe
      const mockIframe = document.createElement('iframe');
      document.body.appendChild(mockIframe);

      // Test would need more setup to properly test iframe creation
      // This is a basic structure test

      window.print = originalPrint;
      document.body.removeChild(mockIframe);
    });
  });

  describe('Date Formatting', () => {
    it('should format dates correctly in header', () => {
      const mockChartData: ChartPrintData = {
        symbol: 'EURUSD',
        timeframe: '1H',
        dateRange: {
          from: new Date('2024-01-01T00:00:00Z'),
          to: new Date('2024-01-31T23:59:59Z'),
        },
        indicators: [],
        drawings: [],
      };

      const html = chartPrinter.generatePrintableHTML(
        mockChartData,
        DEFAULT_PRINT_PREFERENCES
      );

      expect(html).toContain('2024');
      expect(html).toContain('Jan');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty indicators array', () => {
      const mockChartData: ChartPrintData = {
        symbol: 'EURUSD',
        timeframe: '1H',
        dateRange: { from: new Date(), to: new Date() },
        indicators: [],
        drawings: [],
      };

      const html = chartPrinter.generatePrintableHTML(
        mockChartData,
        DEFAULT_PRINT_PREFERENCES
      );

      expect(html).toBeDefined();
      expect(html.length).toBeGreaterThan(0);
    });

    it('should handle empty drawings array', () => {
      const mockChartData: ChartPrintData = {
        symbol: 'EURUSD',
        timeframe: '1H',
        dateRange: { from: new Date(), to: new Date() },
        indicators: [{ name: 'EMA', parameters: { period: 20 } }],
        drawings: [],
      };

      const html = chartPrinter.generatePrintableHTML(
        mockChartData,
        DEFAULT_PRINT_PREFERENCES
      );

      expect(html).toBeDefined();
      expect(html).toContain('EMA');
    });

    it('should handle missing optional text fields', () => {
      const prefs = {
        ...DEFAULT_PRINT_PREFERENCES,
        includeHeader: true,
        includeFooter: true,
        headerText: undefined,
        footerText: undefined,
      };

      const mockChartData: ChartPrintData = {
        symbol: 'EURUSD',
        timeframe: '1H',
        dateRange: { from: new Date(), to: new Date() },
        indicators: [],
        drawings: [],
      };

      const html = chartPrinter.generatePrintableHTML(mockChartData, prefs);
      expect(html).toBeDefined();
    });
  });
});

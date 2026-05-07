/**
 * Chart Exporter Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChartExporter } from './chartExporter';

describe('ChartExporter', () => {
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    // Create a mock canvas
    canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    ctx = canvas.getContext('2d')!;

    // Draw a simple test pattern
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, 800, 600);
    ctx.fillStyle = 'white';
    ctx.fillRect(100, 100, 100, 100);
  });

  describe('generateFilename', () => {
    it('should generate a valid filename', () => {
      const metadata = {
        symbol: 'EURUSD',
        timeframe: '5m',
        timestamp: new Date('2024-01-01T12:00:00Z')
      };

      const filename = ChartExporter.generateFilename(metadata, 'png');
      expect(filename).toMatch(/^EURUSD_5m_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.png$/);
    });

    it('should sanitize symbol names', () => {
      const metadata = {
        symbol: 'EUR/USD',
        timeframe: '1h',
        timestamp: new Date()
      };

      const filename = ChartExporter.generateFilename(metadata, 'jpg');
      expect(filename).toContain('EURUSD');
      expect(filename).not.toContain('/');
    });
  });

  describe('exportCanvas', () => {
    it('should export canvas as PNG blob', async () => {
      const metadata = {
        symbol: 'EURUSD',
        timeframe: '5m',
        timestamp: new Date()
      };

      const blob = await ChartExporter.exportCanvas(canvas, metadata, {
        format: 'png',
        includeTimestamp: false,
        includeSymbolInfo: false,
        includeWatermark: false
      });

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('image/png');
      expect(blob.size).toBeGreaterThan(0);
    });

    it('should export canvas as JPG blob', async () => {
      const metadata = {
        symbol: 'EURUSD',
        timeframe: '5m',
        timestamp: new Date()
      };

      const blob = await ChartExporter.exportCanvas(canvas, metadata, {
        format: 'jpg',
        quality: 0.8,
        includeTimestamp: false,
        includeSymbolInfo: false,
        includeWatermark: false
      });

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('image/jpeg');
      expect(blob.size).toBeGreaterThan(0);
    });

    it('should apply scale factor', async () => {
      const metadata = {
        symbol: 'EURUSD',
        timeframe: '5m',
        timestamp: new Date()
      };

      const blob1x = await ChartExporter.exportCanvas(canvas, metadata, {
        format: 'png',
        scale: 1,
        includeTimestamp: false,
        includeSymbolInfo: false,
        includeWatermark: false
      });

      const blob2x = await ChartExporter.exportCanvas(canvas, metadata, {
        format: 'png',
        scale: 2,
        includeTimestamp: false,
        includeSymbolInfo: false,
        includeWatermark: false
      });

      // 2x scaled image should be larger
      expect(blob2x.size).toBeGreaterThan(blob1x.size);
    });

    it('should include symbol info overlay', async () => {
      const metadata = {
        symbol: 'EURUSD',
        timeframe: '5m',
        timestamp: new Date()
      };

      const blobWithInfo = await ChartExporter.exportCanvas(canvas, metadata, {
        format: 'png',
        includeSymbolInfo: true,
        includeTimestamp: false,
        includeWatermark: false
      });

      const blobWithoutInfo = await ChartExporter.exportCanvas(canvas, metadata, {
        format: 'png',
        includeSymbolInfo: false,
        includeTimestamp: false,
        includeWatermark: false
      });

      // With overlay should be slightly larger
      expect(blobWithInfo.size).toBeGreaterThanOrEqual(blobWithoutInfo.size);
    });
  });

  describe('getPreview', () => {
    it('should generate a preview data URL', () => {
      const preview = ChartExporter.getPreview(canvas, 300, 200);

      expect(preview).toContain('data:image/png;base64');
      expect(preview.length).toBeGreaterThan(100);
    });

    it('should scale down large images', () => {
      const largeCanvas = document.createElement('canvas');
      largeCanvas.width = 1920;
      largeCanvas.height = 1080;

      const preview = ChartExporter.getPreview(largeCanvas, 300, 200);

      expect(preview).toBeTruthy();
      expect(preview).toContain('data:image/png;base64');
    });
  });

  describe('downloadBlob', () => {
    it('should trigger download', () => {
      const blob = new Blob(['test'], { type: 'image/png' });
      const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      // Mock appendChild/removeChild
      const appendChildSpy = vi.spyOn(document.body, 'appendChild');
      const removeChildSpy = vi.spyOn(document.body, 'removeChild');

      ChartExporter.downloadBlob(blob, 'test.png');

      expect(createObjectURLSpy).toHaveBeenCalledWith(blob);
      expect(appendChildSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalled();

      // Cleanup
      createObjectURLSpy.mockRestore();
      revokeObjectURLSpy.mockRestore();
      appendChildSpy.mockRestore();
      removeChildSpy.mockRestore();
    });
  });

  describe('exportActiveChart', () => {
    it('should find and export the largest canvas', async () => {
      // Create multiple canvases
      const smallCanvas = document.createElement('canvas');
      smallCanvas.width = 400;
      smallCanvas.height = 300;
      document.body.appendChild(smallCanvas);

      const largeCanvas = document.createElement('canvas');
      largeCanvas.width = 1200;
      largeCanvas.height = 800;
      document.body.appendChild(largeCanvas);

      const metadata = {
        symbol: 'EURUSD',
        timeframe: '5m',
        timestamp: new Date()
      };

      const blob = await ChartExporter.exportActiveChart(metadata, {
        includeTimestamp: false,
        includeSymbolInfo: false,
        includeWatermark: false
      });

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.size).toBeGreaterThan(0);

      // Cleanup
      document.body.removeChild(smallCanvas);
      document.body.removeChild(largeCanvas);
    });

    it('should throw error when no chart found', async () => {
      // Remove all canvases
      document.querySelectorAll('canvas').forEach(c => c.remove());

      const metadata = {
        symbol: 'EURUSD',
        timeframe: '5m',
        timestamp: new Date()
      };

      await expect(
        ChartExporter.exportActiveChart(metadata)
      ).rejects.toThrow('No chart found to export');
    });
  });
});

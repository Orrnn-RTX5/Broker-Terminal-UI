/**
 * Chart Exporter Service
 *
 * Handles exporting trading charts as images (PNG/JPG)
 * Supports canvas-based charts (lightweight-charts) and complex HTML elements
 */

export interface ChartExportOptions {
  format: 'png' | 'jpg';
  quality: number; // 0.1 to 1.0 (for JPG)
  scale: number; // 1x, 2x, 3x for retina displays
  exportArea: 'visible' | 'full';
  includeWatermark: boolean;
  watermarkText?: string;
  includeTimestamp: boolean;
  includeSymbolInfo: boolean;
  backgroundColor?: string;
}

export interface ChartMetadata {
  symbol: string;
  timeframe: string;
  timestamp: Date;
}

const DEFAULT_OPTIONS: ChartExportOptions = {
  format: 'png',
  quality: 0.92,
  scale: 1,
  exportArea: 'visible',
  includeWatermark: false,
  includeTimestamp: true,
  includeSymbolInfo: true,
  backgroundColor: '#000000'
};

export class ChartExporter {
  /**
   * Export a chart canvas to an image
   * @param canvas The canvas element to export
   * @param metadata Chart metadata (symbol, timeframe, etc.)
   * @param options Export options
   * @returns Blob containing the image data
   */
  static async exportCanvas(
    canvas: HTMLCanvasElement,
    metadata: ChartMetadata,
    options: Partial<ChartExportOptions> = {}
  ): Promise<Blob> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Create a temporary canvas for compositing
    const tempCanvas = document.createElement('canvas');
    const ctx = tempCanvas.getContext('2d');

    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }

    // Calculate dimensions with scaling
    const width = canvas.width * opts.scale;
    const height = canvas.height * opts.scale;

    tempCanvas.width = width;
    tempCanvas.height = height;

    // Fill background
    if (opts.backgroundColor) {
      ctx.fillStyle = opts.backgroundColor;
      ctx.fillRect(0, 0, width, height);
    }

    // Draw the original chart with scaling
    ctx.scale(opts.scale, opts.scale);
    ctx.drawImage(canvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform

    // Add symbol info at top
    if (opts.includeSymbolInfo) {
      this.drawSymbolInfo(ctx, metadata, width, opts.scale);
    }

    // Add timestamp at bottom
    if (opts.includeTimestamp) {
      this.drawTimestamp(ctx, metadata.timestamp, width, height, opts.scale);
    }

    // Add watermark
    if (opts.includeWatermark && opts.watermarkText) {
      this.drawWatermark(ctx, opts.watermarkText, width, height, opts.scale);
    }

    // Convert to blob
    return new Promise((resolve, reject) => {
      tempCanvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create blob'));
          }
        },
        opts.format === 'jpg' ? 'image/jpeg' : 'image/png',
        opts.quality
      );
    });
  }

  /**
   * Export a DOM element as an image using html2canvas
   * Useful for complex chart layouts with overlays
   * @param element The DOM element to capture
   * @param metadata Chart metadata
   * @param options Export options
   * @returns Blob containing the image data
   */
  static async exportElement(
    element: HTMLElement,
    metadata: ChartMetadata,
    options: Partial<ChartExportOptions> = {}
  ): Promise<Blob> {
    // Check if html2canvas is available
    if (typeof window === 'undefined' || !(window as any).html2canvas) {
      // Fallback to basic canvas export if available
      const canvas = element.querySelector('canvas');
      if (canvas) {
        return this.exportCanvas(canvas, metadata, options);
      }
      throw new Error('html2canvas library not available and no canvas found');
    }

    const opts = { ...DEFAULT_OPTIONS, ...options };
    const html2canvas = (window as any).html2canvas;

    // Capture the element
    const canvas = await html2canvas(element, {
      backgroundColor: opts.backgroundColor,
      scale: opts.scale,
      logging: false,
      useCORS: true,
      allowTaint: true
    });

    // Use the canvas export method for adding metadata
    return this.exportCanvas(canvas, metadata, options);
  }

  /**
   * Find and export the active chart
   * Attempts to locate the chart canvas or container in the DOM
   */
  static async exportActiveChart(
    metadata: ChartMetadata,
    options: Partial<ChartExportOptions> = {}
  ): Promise<Blob> {
    // Strategy 1: Check global window object for active chart (set by TradingChart component)
    const globalCanvas = (window as any).__activeChartCanvas as HTMLCanvasElement | null;
    const globalContainer = (window as any).__activeChartContainer as HTMLElement | null;

    if (globalCanvas) {
      console.log('[ChartExporter] Using global chart canvas');
      return this.exportCanvas(globalCanvas, metadata, options);
    }

    if (globalContainer) {
      console.log('[ChartExporter] Using global chart container');
      return this.exportElement(globalContainer, metadata, options);
    }

    // Strategy 2: Look for canvas with chart data
    const canvases = Array.from(document.querySelectorAll('canvas'));

    // Find the largest canvas (likely the main chart)
    const chartCanvas = canvases.reduce((largest, current) => {
      const currentArea = current.width * current.height;
      const largestArea = largest ? largest.width * largest.height : 0;
      return currentArea > largestArea ? current : largest;
    }, null as HTMLCanvasElement | null);

    if (chartCanvas) {
      console.log('[ChartExporter] Using largest canvas found');
      return this.exportCanvas(chartCanvas, metadata, options);
    }

    // Strategy 3: Look for common chart container class names
    const chartContainer = document.querySelector('.chart-container, .trading-chart, [class*="chart"]') as HTMLElement;

    if (chartContainer) {
      console.log('[ChartExporter] Using chart container element');
      return this.exportElement(chartContainer, metadata, options);
    }

    throw new Error('No chart found to export');
  }

  /**
   * Download a blob as a file
   * @param blob The blob to download
   * @param filename The filename
   */
  static downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up the object URL after a short delay
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  /**
   * Generate a filename for the chart export
   * @param metadata Chart metadata
   * @param format Image format
   * @returns Filename string
   */
  static generateFilename(metadata: ChartMetadata, format: 'png' | 'jpg'): string {
    const timestamp = metadata.timestamp.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const symbol = metadata.symbol.replace(/[^a-zA-Z0-9]/g, '');
    const timeframe = metadata.timeframe;

    return `${symbol}_${timeframe}_${timestamp}.${format}`;
  }

  /**
   * Draw symbol info overlay on canvas
   */
  private static drawSymbolInfo(
    ctx: CanvasRenderingContext2D,
    metadata: ChartMetadata,
    width: number,
    scale: number
  ): void {
    const fontSize = 14 * scale;
    const padding = 10 * scale;

    ctx.save();
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const text = `${metadata.symbol} - ${metadata.timeframe}`;
    const metrics = ctx.measureText(text);

    // Semi-transparent background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(
      padding,
      padding,
      metrics.width + padding * 2,
      fontSize + padding * 2
    );

    // Text
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillText(text, padding * 2, padding * 2);

    ctx.restore();
  }

  /**
   * Draw timestamp overlay on canvas
   */
  private static drawTimestamp(
    ctx: CanvasRenderingContext2D,
    timestamp: Date,
    width: number,
    height: number,
    scale: number
  ): void {
    const fontSize = 11 * scale;
    const padding = 10 * scale;

    ctx.save();
    ctx.font = `${fontSize}px Arial`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';

    const text = timestamp.toLocaleString();
    const metrics = ctx.measureText(text);

    // Semi-transparent background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(
      width - metrics.width - padding * 3,
      height - fontSize - padding * 3,
      metrics.width + padding * 2,
      fontSize + padding * 2
    );

    // Text
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText(text, width - padding * 2, height - padding * 2);

    ctx.restore();
  }

  /**
   * Draw watermark overlay on canvas
   */
  private static drawWatermark(
    ctx: CanvasRenderingContext2D,
    text: string,
    width: number,
    height: number,
    scale: number
  ): void {
    const fontSize = 24 * scale;

    ctx.save();
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Rotate for diagonal watermark
    ctx.translate(width / 2, height / 2);
    ctx.rotate(-Math.PI / 6); // -30 degrees
    ctx.fillText(text, 0, 0);

    ctx.restore();
  }

  /**
   * Get a preview/thumbnail of the chart
   * @param canvas The canvas to preview
   * @param maxWidth Maximum width of the preview
   * @param maxHeight Maximum height of the preview
   * @returns Data URL of the preview image
   */
  static getPreview(
    canvas: HTMLCanvasElement,
    maxWidth: number = 300,
    maxHeight: number = 200
  ): string {
    const tempCanvas = document.createElement('canvas');
    const ctx = tempCanvas.getContext('2d');

    if (!ctx) {
      return '';
    }

    // Calculate aspect ratio
    const aspectRatio = canvas.width / canvas.height;
    let width = maxWidth;
    let height = maxWidth / aspectRatio;

    if (height > maxHeight) {
      height = maxHeight;
      width = maxHeight * aspectRatio;
    }

    tempCanvas.width = width;
    tempCanvas.height = height;

    ctx.drawImage(canvas, 0, 0, width, height);

    return tempCanvas.toDataURL('image/png', 0.7);
  }
}

export default ChartExporter;

/**
 * Chart Printer Service
 * Handles chart printing and PDF generation with full chart elements
 */

import type { IChartApi, ISeriesApi } from 'lightweight-charts';

export type PageSize = 'A4' | 'Letter' | 'Legal' | 'A3';
export type PageOrientation = 'portrait' | 'landscape';
export type ColorMode = 'color' | 'grayscale';

export interface PrintPreferences {
  pageSize: PageSize;
  orientation: PageOrientation;
  colorMode: ColorMode;
  includeHeader: boolean;
  includeFooter: boolean;
  includeGrid: boolean;
  includeIndicators: boolean;
  includeDrawings: boolean;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  scaleToFit: boolean;
  headerText?: string;
  footerText?: string;
}

export interface ChartPrintData {
  symbol: string;
  timeframe: string;
  dateRange: {
    from: Date;
    to: Date;
  };
  chartCanvas?: HTMLCanvasElement;
  indicators: Array<{
    name: string;
    parameters: Record<string, any>;
  }>;
  drawings: Array<{
    type: string;
    label?: string;
  }>;
}

// Default print preferences
export const DEFAULT_PRINT_PREFERENCES: PrintPreferences = {
  pageSize: 'A4',
  orientation: 'landscape',
  colorMode: 'color',
  includeHeader: true,
  includeFooter: true,
  includeGrid: true,
  includeIndicators: true,
  includeDrawings: true,
  marginTop: 20,
  marginBottom: 20,
  marginLeft: 20,
  marginRight: 20,
  scaleToFit: true,
};

// Page dimensions in pixels (at 96 DPI)
const PAGE_DIMENSIONS = {
  A4: { width: 794, height: 1123 },
  Letter: { width: 816, height: 1056 },
  Legal: { width: 816, height: 1344 },
  A3: { width: 1123, height: 1587 },
};

class ChartPrinterService {
  private preferences: PrintPreferences = DEFAULT_PRINT_PREFERENCES;

  /**
   * Load print preferences from backend
   */
  async loadPreferences(accountId: string): Promise<PrintPreferences> {
    try {
      const response = await fetch(`/api/accounts/${accountId}/print-preferences`);
      if (response.ok) {
        const prefs = await response.json();
        this.preferences = { ...DEFAULT_PRINT_PREFERENCES, ...prefs };
        return this.preferences;
      }
    } catch (error) {
      console.error('Failed to load print preferences:', error);
    }
    return this.preferences;
  }

  /**
   * Save print preferences to backend
   */
  async savePreferences(accountId: string, preferences: PrintPreferences): Promise<void> {
    try {
      await fetch(`/api/accounts/${accountId}/print-preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      });
      this.preferences = preferences;
    } catch (error) {
      console.error('Failed to save print preferences:', error);
      throw error;
    }
  }

  /**
   * Get current preferences
   */
  getPreferences(): PrintPreferences {
    return { ...this.preferences };
  }

  /**
   * Generate printable HTML from chart data
   */
  generatePrintableHTML(data: ChartPrintData, preferences: PrintPreferences): string {
    const { width, height } = this.getPageDimensions(preferences);
    const margins = this.getMargins(preferences);

    const contentWidth = width - margins.left - margins.right;
    const contentHeight = height - margins.top - margins.bottom;

    let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Chart Print - ${data.symbol} ${data.timeframe}</title>
  <style>
    @page {
      size: ${preferences.pageSize} ${preferences.orientation};
      margin: 0;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      ${preferences.colorMode === 'grayscale' ? 'filter: grayscale(100%);' : ''}
      background: white;
      padding: ${margins.top}px ${margins.right}px ${margins.bottom}px ${margins.left}px;
    }

    .page {
      width: ${contentWidth}px;
      height: ${contentHeight}px;
      position: relative;
      page-break-after: always;
    }

    .header {
      padding: 10px 0;
      border-bottom: 2px solid #333;
      margin-bottom: 15px;
    }

    .header-title {
      font-size: 18px;
      font-weight: bold;
      color: #333;
    }

    .header-info {
      font-size: 12px;
      color: #666;
      margin-top: 5px;
    }

    .chart-container {
      width: 100%;
      height: calc(100% - ${preferences.includeHeader ? '80px' : '0px'} - ${preferences.includeFooter ? '40px' : '0px'});
      position: relative;
      border: 1px solid #ddd;
      background: #fff;
    }

    .chart-image {
      width: 100%;
      height: 100%;
      object-fit: ${preferences.scaleToFit ? 'contain' : 'cover'};
    }

    .indicators-legend {
      position: absolute;
      top: 10px;
      left: 10px;
      background: rgba(255, 255, 255, 0.9);
      padding: 10px;
      border-radius: 4px;
      font-size: 11px;
      border: 1px solid #ddd;
    }

    .indicator-item {
      margin: 3px 0;
      color: #333;
    }

    .drawings-legend {
      position: absolute;
      top: 10px;
      right: 10px;
      background: rgba(255, 255, 255, 0.9);
      padding: 10px;
      border-radius: 4px;
      font-size: 11px;
      border: 1px solid #ddd;
    }

    .drawing-item {
      margin: 3px 0;
      color: #333;
    }

    .footer {
      padding: 10px 0;
      border-top: 1px solid #ddd;
      margin-top: 15px;
      font-size: 10px;
      color: #666;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .footer-left {
      flex: 1;
    }

    .footer-right {
      text-align: right;
    }

    @media print {
      body {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }

      .page {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="page">
`;

    // Header
    if (preferences.includeHeader) {
      const dateRange = `${this.formatDate(data.dateRange.from)} - ${this.formatDate(data.dateRange.to)}`;
      html += `
    <div class="header">
      <div class="header-title">${preferences.headerText || `${data.symbol} - ${data.timeframe}`}</div>
      <div class="header-info">
        Date Range: ${dateRange} | Generated: ${this.formatDateTime(new Date())}
      </div>
    </div>
`;
    }

    // Chart container
    html += `
    <div class="chart-container">
`;

    // Chart image (if provided)
    if (data.chartCanvas) {
      const imageData = data.chartCanvas.toDataURL('image/png');
      html += `      <img src="${imageData}" alt="Chart" class="chart-image" />
`;
    }

    // Indicators legend
    if (preferences.includeIndicators && data.indicators.length > 0) {
      html += `
      <div class="indicators-legend">
        <strong>Indicators:</strong>
`;
      data.indicators.forEach(indicator => {
        const params = Object.entries(indicator.parameters)
          .map(([key, value]) => `${key}:${value}`)
          .join(', ');
        html += `        <div class="indicator-item">${indicator.name} (${params})</div>
`;
      });
      html += `      </div>
`;
    }

    // Drawings legend
    if (preferences.includeDrawings && data.drawings.length > 0) {
      html += `
      <div class="drawings-legend">
        <strong>Drawings:</strong>
`;
      data.drawings.forEach((drawing, index) => {
        const label = drawing.label || `${drawing.type} ${index + 1}`;
        html += `        <div class="drawing-item">${label}</div>
`;
      });
      html += `      </div>
`;
    }

    html += `    </div>
`;

    // Footer
    if (preferences.includeFooter) {
      html += `
    <div class="footer">
      <div class="footer-left">
        ${preferences.footerText || 'Trading Chart'}
      </div>
      <div class="footer-right">
        Page 1 of 1
      </div>
    </div>
`;
    }

    html += `
  </div>
</body>
</html>
`;

    return html;
  }

  /**
   * Open print preview
   */
  async printChart(data: ChartPrintData, preferences?: PrintPreferences): Promise<void> {
    const prefs = preferences || this.preferences;
    const html = this.generatePrintableHTML(data, prefs);

    // Create a hidden iframe for printing
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      throw new Error('Failed to create print iframe');
    }

    doc.open();
    doc.write(html);
    doc.close();

    // Wait for content to load
    await new Promise(resolve => setTimeout(resolve, 500));

    // Trigger print
    iframe.contentWindow?.print();

    // Clean up after a delay
    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 1000);
  }

  /**
   * Generate PDF from chart (requires html2pdf library)
   */
  async generatePDF(data: ChartPrintData, preferences?: PrintPreferences): Promise<Blob> {
    const prefs = preferences || this.preferences;
    const html = this.generatePrintableHTML(data, prefs);

    // Note: This requires html2pdf.js library to be installed
    // For now, we'll return a placeholder
    // In production, you would use: html2pdf().from(html).output('blob')

    throw new Error('PDF generation requires html2pdf library. Use printChart() for browser printing.');
  }

  /**
   * Capture chart canvas from lightweight-charts
   */
  captureChartCanvas(chartApi: IChartApi): HTMLCanvasElement | null {
    try {
      // Get the chart container
      const container = chartApi.chartElement?.() as HTMLElement;
      if (!container) return null;

      // Find the canvas element
      const canvas = container.querySelector('canvas');
      if (!canvas) return null;

      // Create a new canvas with the same dimensions
      const capturedCanvas = document.createElement('canvas');
      capturedCanvas.width = canvas.width;
      capturedCanvas.height = canvas.height;

      // Copy the content
      const ctx = capturedCanvas.getContext('2d');
      if (!ctx) return null;

      ctx.drawImage(canvas, 0, 0);

      return capturedCanvas;
    } catch (error) {
      console.error('Failed to capture chart canvas:', error);
      return null;
    }
  }

  /**
   * Get page dimensions based on preferences
   */
  private getPageDimensions(preferences: PrintPreferences): { width: number; height: number } {
    const dims = PAGE_DIMENSIONS[preferences.pageSize];
    if (preferences.orientation === 'landscape') {
      return { width: dims.height, height: dims.width };
    }
    return dims;
  }

  /**
   * Get margins based on preferences
   */
  private getMargins(preferences: PrintPreferences) {
    return {
      top: preferences.marginTop,
      right: preferences.marginRight,
      bottom: preferences.marginBottom,
      left: preferences.marginLeft,
    };
  }

  /**
   * Format date for display
   */
  private formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  /**
   * Format date and time for display
   */
  private formatDateTime(date: Date): string {
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

// Export singleton instance
export const chartPrinter = new ChartPrinterService();

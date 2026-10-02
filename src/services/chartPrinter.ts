/**
 * Chart Printer Service
 * Handles chart printing and PDF generation with full chart elements
 */

import type { IChartApi } from 'lightweight-charts';
import { getActiveChartSource } from './activeChartSource';
import i18n from '../i18n';
import { translateUi as tr } from '../hooks/useUiTranslation';
import { getAccessToken, getServerUrl } from './brokerSession';
import { isConfiguredBrokerEndpoint } from '../config/backendTarget.js';
import { toLocalDevProxyUrl } from '../config/localDevProxy';

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

export interface PrintPreferencesSaveResult {
  local: boolean;
  remote: boolean;
}

export interface ChartPrintData {
  symbol: string;
  timeframe: string;
  dateRange?: {
    from: Date;
    to: Date;
  };
  chartCanvas?: HTMLCanvasElement;
  capturedAt?: Date;
  indicators: Array<{
    name: string;
    parameters: Record<string, unknown>;
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
const PAGE_DIMENSIONS_MM = {
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
  A3: { width: 297, height: 420 },
};
const escapeHTML = (value: unknown): string => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);

const PRINT_PREFERENCES_STORAGE_PREFIX = 'rtx5:print-preferences:';

const PAGE_SIZES: PageSize[] = ['A4', 'Letter', 'Legal', 'A3'];
const PAGE_ORIENTATIONS: PageOrientation[] = ['portrait', 'landscape'];
const COLOR_MODES: ColorMode[] = ['color', 'grayscale'];

type ChartCaptureRenderer = typeof import('html2canvas-pro')['default'];

class ChartPrinterService {
  private preferences: PrintPreferences = { ...DEFAULT_PRINT_PREFERENCES };
  private readonly accountPreferences = new Map<string, PrintPreferences>();
  private captureRendererPromise: Promise<ChartCaptureRenderer> | null = null;

  /** The capture renderer loads on demand; a dev-server restart or a fresh
   * deploy can invalidate its module URL mid-session, so a failed load resets
   * the cache (the next attempt re-imports) and reports an actionable error. */
  private loadCaptureRenderer(): Promise<ChartCaptureRenderer> {
    if (!this.captureRendererPromise) {
      this.captureRendererPromise = import('html2canvas-pro')
        .then((module) => module.default)
        .catch((error) => {
          this.captureRendererPromise = null;
          console.warn('Failed to load the chart capture module:', error);
          throw new Error('The chart capture module could not be loaded. Reload the terminal and try again.');
        });
    }
    return this.captureRendererPromise;
  }

  private getAccountScope(accountId: string): string {
    const scope = accountId.trim();
    if (!scope) {
      throw new Error('An account ID is required for print preferences');
    }
    return scope;
  }

  private getStorageKey(accountId: string): string {
    return `${PRINT_PREFERENCES_STORAGE_PREFIX}${encodeURIComponent(accountId)}`;
  }

  private normalizePreferences(
    value: unknown,
    fallback: PrintPreferences = DEFAULT_PRINT_PREFERENCES,
  ): PrintPreferences {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ...fallback };
    }

    const candidate = value as Partial<PrintPreferences>;
    const margin = (input: unknown, defaultValue: number) => (
      typeof input === 'number' && Number.isFinite(input)
        ? Math.min(50, Math.max(0, input))
        : defaultValue
    );
    const optionalText = (input: unknown, defaultValue?: string) => (
      typeof input === 'string' ? input : defaultValue
    );

    return {
      pageSize: PAGE_SIZES.includes(candidate.pageSize as PageSize)
        ? candidate.pageSize as PageSize
        : fallback.pageSize,
      orientation: PAGE_ORIENTATIONS.includes(candidate.orientation as PageOrientation)
        ? candidate.orientation as PageOrientation
        : fallback.orientation,
      colorMode: COLOR_MODES.includes(candidate.colorMode as ColorMode)
        ? candidate.colorMode as ColorMode
        : fallback.colorMode,
      includeHeader: typeof candidate.includeHeader === 'boolean'
        ? candidate.includeHeader
        : fallback.includeHeader,
      includeFooter: typeof candidate.includeFooter === 'boolean'
        ? candidate.includeFooter
        : fallback.includeFooter,
      includeGrid: typeof candidate.includeGrid === 'boolean'
        ? candidate.includeGrid
        : fallback.includeGrid,
      includeIndicators: typeof candidate.includeIndicators === 'boolean'
        ? candidate.includeIndicators
        : fallback.includeIndicators,
      includeDrawings: typeof candidate.includeDrawings === 'boolean'
        ? candidate.includeDrawings
        : fallback.includeDrawings,
      marginTop: margin(candidate.marginTop, fallback.marginTop),
      marginBottom: margin(candidate.marginBottom, fallback.marginBottom),
      marginLeft: margin(candidate.marginLeft, fallback.marginLeft),
      marginRight: margin(candidate.marginRight, fallback.marginRight),
      scaleToFit: typeof candidate.scaleToFit === 'boolean'
        ? candidate.scaleToFit
        : fallback.scaleToFit,
      headerText: optionalText(candidate.headerText, fallback.headerText),
      footerText: optionalText(candidate.footerText, fallback.footerText),
    };
  }

  private readLocalPreferences(accountId: string): PrintPreferences | null {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return null;
      const stored = window.localStorage.getItem(this.getStorageKey(accountId));
      if (!stored) return null;
      return this.normalizePreferences(JSON.parse(stored));
    } catch (error) {
      console.warn('Failed to read local print preferences:', error);
      return null;
    }
  }

  private writeLocalPreferences(accountId: string, preferences: PrintPreferences): boolean {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return false;
      window.localStorage.setItem(this.getStorageKey(accountId), JSON.stringify(preferences));
      return true;
    } catch (error) {
      console.warn('Failed to save local print preferences:', error);
      return false;
    }
  }

  private rememberPreferences(accountId: string, preferences: PrintPreferences): void {
    const snapshot = { ...preferences };
    this.accountPreferences.set(accountId, snapshot);
    // Preserve the no-argument API for legacy direct-print callers while new
    // callers use getPreferences(accountId) for strict account isolation.
    this.preferences = snapshot;
  }

  /**
   * Load print preferences from backend
   */
  async loadPreferences(accountId: string): Promise<PrintPreferences> {
    const accountScope = this.getAccountScope(accountId);
    const localPreferences = this.readLocalPreferences(accountScope)
      ?? this.accountPreferences.get(accountScope)
      ?? DEFAULT_PRINT_PREFERENCES;
    const fallback = this.normalizePreferences(localPreferences);
    this.rememberPreferences(accountScope, fallback);

    try {
      const endpoint = `${getServerUrl()}/api/accounts/${encodeURIComponent(accountScope)}/print-preferences`;
      const token = getAccessToken();
      if (!token || !isConfiguredBrokerEndpoint(endpoint)) return { ...fallback };
      const response = await fetch(
        toLocalDevProxyUrl(endpoint),
        { redirect: 'error', headers: { Authorization: `Bearer ${token}` } },
      );
      if (response.ok) {
        const prefs = this.normalizePreferences(await response.json(), fallback);
        this.rememberPreferences(accountScope, prefs);
        this.writeLocalPreferences(accountScope, prefs);
        return { ...prefs };
      }

      console.warn(`Print preferences request failed with status ${response.status}`);
    } catch (error) {
      console.warn('Failed to load remote print preferences; using local preferences:', error);
    }

    return { ...fallback };
  }

  /**
   * Save print preferences to backend
   */
  async savePreferences(
    accountId: string,
    preferences: PrintPreferences,
  ): Promise<PrintPreferencesSaveResult> {
    const accountScope = this.getAccountScope(accountId);
    const normalizedPreferences = this.normalizePreferences(preferences);
    this.rememberPreferences(accountScope, normalizedPreferences);
    const local = this.writeLocalPreferences(accountScope, normalizedPreferences);

    try {
      const endpoint = `${getServerUrl()}/api/accounts/${encodeURIComponent(accountScope)}/print-preferences`;
      const token = getAccessToken();
      if (!token || !isConfiguredBrokerEndpoint(endpoint)) return { local, remote: false };
      const response = await fetch(
        toLocalDevProxyUrl(endpoint),
        {
          method: 'POST',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(normalizedPreferences),
        },
      );

      if (!response.ok) {
        console.warn(`Print preferences save failed with status ${response.status}; saved locally`);
        return { local, remote: false };
      }

      return { local, remote: true };
    } catch (error) {
      console.warn('Failed to save remote print preferences; saved locally:', error);
      return { local, remote: false };
    }
  }

  /**
   * Get current preferences
   */
  getPreferences(accountId?: string): PrintPreferences {
    if (!accountId?.trim()) {
      return { ...this.preferences };
    }

    const accountScope = this.getAccountScope(accountId);
    const preferences = this.accountPreferences.get(accountScope)
      ?? this.readLocalPreferences(accountScope)
      ?? DEFAULT_PRINT_PREFERENCES;
    this.rememberPreferences(accountScope, preferences);
    return { ...preferences };
  }

  /** Apply Print Setup to this session without changing the saved default. */
  setPreferences(preferences: PrintPreferences, accountId?: string): void {
    const normalized = this.normalizePreferences(preferences);
    if (accountId?.trim()) this.rememberPreferences(accountId.trim(), normalized);
    else this.preferences = normalized;
  }

  /** Capture the selected chart, including its axes, volume panes and SVG drawings. */
  async captureActiveChartData(): Promise<ChartPrintData> {
    const source = getActiveChartSource();
    if (!source?.container || !source.symbol || !source.timeframe) {
      throw new Error('Open a chart before printing.');
    }
    const { container, symbol, timeframe, dateRange } = source;
    const bounds = container.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1 || !container.querySelector('canvas')) {
      throw new Error('The chart is not ready. Wait for it to load, then try again.');
    }
    const render = await this.loadCaptureRenderer();
    if (!container.isConnected || getActiveChartSource()?.id !== source.id) {
      throw new Error('The active chart changed. Open Print Preview again.');
    }
    const canvas = await render(container, {
      backgroundColor: getComputedStyle(container).backgroundColor,
      scale: Math.min(window.devicePixelRatio || 1, 2),
      useCORS: true,
      logging: false,
      width: bounds.width,
      height: bounds.height,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      ignoreElements: element => element.matches('button, [role="menu"], [data-print-exclude]'),
    });
    if (!container.isConnected || getActiveChartSource()?.symbol !== symbol
      || getActiveChartSource()?.timeframe !== timeframe) {
      throw new Error('The active chart changed. Open Print Preview again.');
    }
    return { symbol, timeframe, dateRange, chartCanvas: canvas, capturedAt: new Date(), indicators: [], drawings: [] };
  }

  /** Physical paper dimensions shared by the print document and preview. */
  getPageDimensions(preferences: PrintPreferences): { width: number; height: number } {
    const prefs = this.normalizePreferences(preferences);
    const page = PAGE_DIMENSIONS_MM[prefs.pageSize];
    const width = prefs.orientation === 'landscape' ? page.height : page.width;
    const height = prefs.orientation === 'landscape' ? page.width : page.height;
    return { width: width * 96 / 25.4, height: height * 96 / 25.4 };
  }

  generatePrintableHTML(data: ChartPrintData, preferences: PrintPreferences): string {
    const prefs = this.normalizePreferences(preferences);
    const page = PAGE_DIMENSIONS_MM[prefs.pageSize];
    const width = prefs.orientation === 'landscape' ? page.height : page.width;
    const height = prefs.orientation === 'landscape' ? page.width : page.height;
    const title = escapeHTML(prefs.headerText || `${data.symbol} - ${data.timeframe}`);
    const range = data.dateRange
      ? `${escapeHTML(tr('Date range'))}: ${escapeHTML(this.formatDate(data.dateRange.from))} - ${escapeHTML(this.formatDate(data.dateRange.to))} | `
      : '';
    const capturedAt = escapeHTML(this.formatDateTime(data.capturedAt ?? new Date()));
    const indicators = prefs.includeIndicators && data.indicators.length
      ? `<div class="indicators-legend"><strong>${escapeHTML(tr('Indicators'))}:</strong> ${data.indicators.map(indicator =>
        `${escapeHTML(indicator.name)} (${Object.entries(indicator.parameters).map(([key, value]) =>
          `${escapeHTML(key)}:${escapeHTML(value)}`).join(', ')})`).join('; ')}</div>` : '';
    const drawings = prefs.includeDrawings && data.drawings.length
      ? `<div class="drawings-legend"><strong>${escapeHTML(tr('Drawing tools'))}:</strong> ${data.drawings.map(drawing =>
        `${escapeHTML(drawing.type)}${drawing.label ? ` - ${escapeHTML(drawing.label)}` : ''}`).join('; ')}</div>` : '';
    return `<!DOCTYPE html>
<html lang="${escapeHTML(i18n.resolvedLanguage || 'en')}" dir="${i18n.dir()}"><head><meta charset="UTF-8"><title>${escapeHTML(tr('Print'))} - ${escapeHTML(data.symbol)} ${escapeHTML(data.timeframe)}</title>
<style>
@page { size: ${prefs.pageSize} ${prefs.orientation}; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #182230; }
body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
.page { width: ${width}mm; height: ${height}mm; padding: ${prefs.marginTop}mm ${prefs.marginRight}mm ${prefs.marginBottom}mm ${prefs.marginLeft}mm; display: flex; flex-direction: column; gap: 4mm; overflow: hidden; break-inside: avoid; }
.header { flex: 0 0 auto; border-bottom: 1px solid #cbd2da; padding-bottom: 3mm; overflow-wrap: anywhere; }
.header-title { font-size: 16px; font-weight: 600; }
.header-info { margin-top: 5px; font-size: 11px; color: #526070; }
.chart-container { flex: 1 1 0; min-height: 0; min-width: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.chart-image { display: block; width: ${prefs.scaleToFit ? '100%' : 'auto'}; height: ${prefs.scaleToFit ? '100%' : 'auto'}; max-width: 100%; max-height: 100%; object-fit: contain; ${prefs.colorMode === 'grayscale' ? 'filter: grayscale(100%);' : ''} }
.legend { flex: 0 0 auto; max-height: 15%; overflow: hidden; font-size: 10px; color: #526070; overflow-wrap: anywhere; }
.footer { flex: 0 0 auto; display: flex; justify-content: space-between; gap: 4mm; border-top: 1px solid #cbd2da; padding-top: 3mm; font-size: 10px; color: #526070; overflow-wrap: anywhere; }
.footer-left { min-width: 0; } .footer-right { white-space: nowrap; }
@media print { html, body { width: ${width}mm; height: ${height}mm; } }
</style></head><body><main class="page">
${prefs.includeHeader ? `<header class="header"><div class="header-title">${title}</div><div class="header-info">${range}${escapeHTML(tr('Time'))}: ${capturedAt}</div></header>` : ''}
<div class="chart-container" dir="ltr">${data.chartCanvas ? `<img src="${data.chartCanvas.toDataURL('image/png')}" alt="${escapeHTML(data.symbol)} ${escapeHTML(data.timeframe)} ${escapeHTML(tr('Chart'))}" class="chart-image">` : `<p>${escapeHTML(tr('No chart image is available. Open a chart and try again.'))}</p>`}</div>
${indicators || drawings ? `<section class="legend">${indicators}${drawings}</section>` : ''}
${prefs.includeFooter ? `<footer class="footer"><span class="footer-left">${escapeHTML(prefs.footerText || `RTX5 | ${tr('Chart')}`)}</span><span class="footer-right">${escapeHTML(tr('Page 1 of 1 |').replace(/\s*\|\s*$/, ''))}</span></footer>` : ''}
</main></body></html>`;
  }

  private printInProgress = false;

  /** Keep the document alive until the native print dialog has closed. */
  async printChart(data: ChartPrintData, preferences?: PrintPreferences): Promise<void> {
    if (this.printInProgress) throw new Error('A print dialog is already open. Close it before printing again.');
    if (!data.chartCanvas?.width || !data.chartCanvas.height) throw new Error('No chart image is available to print. Open Print Preview again.');
    const prefs = preferences || this.preferences;
    const html = this.generatePrintableHTML(data, prefs);
    this.printInProgress = true;
    const iframe = document.createElement('iframe');
    iframe.title = 'Chart print document';
    iframe.setAttribute('aria-hidden', 'true');
    const dimensions = this.getPageDimensions(prefs);
    Object.assign(iframe.style, { position: 'fixed', left: '-10000px', top: '0',
      width: `${dimensions.width}px`, height: `${dimensions.height}px`, border: '0' });
    const cleanup = () => { iframe.remove(); this.printInProgress = false; };
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('The print document could not load. Please try again.')), 15000);
        iframe.onload = () => { window.clearTimeout(timeout); resolve(); };
        iframe.onerror = () => { window.clearTimeout(timeout); reject(new Error('The print document could not load.')); };
        iframe.srcdoc = html;
        document.body.appendChild(iframe);
      });
      const target = iframe.contentWindow;
      const doc = iframe.contentDocument;
      if (!target || !doc) throw new Error('The browser could not open the print document.');
      await doc.fonts?.ready;
      await Promise.all(Array.from(doc.images).map(image => {
        if (image.complete) {
          if (!image.naturalWidth) throw new Error('The chart image could not load for printing.');
          return Promise.resolve();
        }
        return image.decode();
      }));
      target.addEventListener('afterprint', cleanup, { once: true });
      target.focus();
      target.print();
      // Browser printing can be non-blocking. Cleanup belongs to afterprint,
      // not a timer or the return from print().
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  /**
   * Generate PDF from chart (requires html2pdf library)
   */
  async generatePDF(data: ChartPrintData, preferences?: PrintPreferences): Promise<Blob> {
    void data;
    void preferences;

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
      return chartApi.takeScreenshot(true, false);
    } catch (error) {
      console.error('Failed to capture chart canvas:', error);
      return null;
    }
  }

  /**
   * Format date for display
   */
  private formatDate(date: Date): string {
    return date.toLocaleDateString(i18n.resolvedLanguage || 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  /**
   * Format date and time for display
   */
  private formatDateTime(date: Date): string {
    return date.toLocaleString(i18n.resolvedLanguage || 'en-US', {
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

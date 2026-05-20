/**
 * Indicator Manager
 * Calculates and manages technical indicators using background Web Workers
 */

import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import { LineSeries } from 'lightweight-charts';
import { getWorkerManager } from './aggregationWorkerManager';

export interface IndicatorConfig {
  id: string;
  name: string;
  type: string;
  parameters: Record<string, any>;
  visible: boolean;
  color?: string;
}

export interface OHLCData {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export class IndicatorManager {
  private indicators: Map<string, IndicatorConfig> = new Map();
  private indicatorSeries: Map<string, ISeriesApi<any>> = new Map();
  private chart: IChartApi | null = null;
  private ohlcData: OHLCData[] = [];

  constructor() { }

  /**
   * Set chart reference
   */
  setChart(chart: IChartApi | null): void {
    this.chart = chart;
  }

  /**
   * Update OHLC data for calculations
   */
  setOHLCData(data: OHLCData[]): void {
    this.ohlcData = data;
    this.recalculateAll();
  }

  /**
   * Add an indicator
   */
  addIndicator(config: IndicatorConfig): void {
    if (!this.chart) return;

    this.indicators.set(config.id, config);

    if (config.type === 'bollinger' || config.type === 'bb') {
      // Create middle (main) series
      const middleSeries = this.createIndicatorSeries({
        ...config,
        name: `${config.name} (Middle)`
      });
      if (middleSeries) {
        this.indicatorSeries.set(config.id, middleSeries);
      }

      // Create upper series
      const upperSeries = this.createIndicatorSeries({
        ...config,
        id: `${config.id}_upper`,
        name: `${config.name} (Upper)`,
        color: config.parameters.upperColor || '#E91E63'
      });
      if (upperSeries) {
        this.indicatorSeries.set(`${config.id}_upper`, upperSeries);
      }

      // Create lower series
      const lowerSeries = this.createIndicatorSeries({
        ...config,
        id: `${config.id}_lower`,
        name: `${config.name} (Lower)`,
        color: config.parameters.lowerColor || '#E91E63'
      });
      if (lowerSeries) {
        this.indicatorSeries.set(`${config.id}_lower`, lowerSeries);
      }
    } else {
      // Standard single line indicator series
      const series = this.createIndicatorSeries(config);
      if (series) {
        this.indicatorSeries.set(config.id, series);
      }
    }

    // Calculate and display
    this.calculateIndicator(config.id);
  }

  /**
   * Remove an indicator
   */
  removeIndicator(id: string): void {
    if (!this.chart) return;

    const series = this.indicatorSeries.get(id);
    if (series) {
      this.chart.removeSeries(series);
      this.indicatorSeries.delete(id);
    }

    // Also check for and clean up Bollinger Bands companion series
    const upper = this.indicatorSeries.get(`${id}_upper`);
    if (upper) {
      this.chart.removeSeries(upper);
      this.indicatorSeries.delete(`${id}_upper`);
    }
    const lower = this.indicatorSeries.get(`${id}_lower`);
    if (lower) {
      this.chart.removeSeries(lower);
      this.indicatorSeries.delete(`${id}_lower`);
    }

    this.indicators.delete(id);
  }

  /**
   * Toggle indicator visibility
   */
  toggleIndicator(id: string): void {
    const config = this.indicators.get(id);
    if (!config) return;

    config.visible = !config.visible;

    const series = this.indicatorSeries.get(id);
    if (series) {
      series.applyOptions({
        visible: config.visible
      });
    }

    // Toggle companion series for Bollinger Bands
    if (config.type === 'bollinger' || config.type === 'bb') {
      const upper = this.indicatorSeries.get(`${id}_upper`);
      if (upper) {
        upper.applyOptions({ visible: config.visible });
      }
      const lower = this.indicatorSeries.get(`${id}_lower`);
      if (lower) {
        lower.applyOptions({ visible: config.visible });
      }
    }
  }

  /**
   * Update indicator parameters
   */
  updateIndicator(id: string, parameters: Record<string, any>): void {
    const config = this.indicators.get(id);
    if (!config) return;

    config.parameters = { ...config.parameters, ...parameters };
    this.calculateIndicator(id);
  }

  /**
   * Get all indicators
   */
  getIndicators(): IndicatorConfig[] {
    return Array.from(this.indicators.values());
  }

  /**
   * Create series for indicator
   */
  private createIndicatorSeries(config: IndicatorConfig): ISeriesApi<any> | null {
    if (!this.chart) return null;

    const isCompanion = config.id.endsWith('_upper') || config.id.endsWith('_lower');

    // Most indicators use line series
    const series = this.chart.addSeries(LineSeries, {
      color: config.color || this.getDefaultColor(config.type),
      lineWidth: isCompanion ? 1 : 2, // Thinner lines for Bollinger Band boundaries
      lastValueVisible: false, // Fix: Hide indicator price labels on Y-axis
      priceLineVisible: false, // Fix: Hide indicator horizontal lines
      title: config.name,
      priceScaleId: this.needsSeparateScale(config.type) ? config.id : 'right',
      visible: config.visible
    });

    return series;
  }

  /**
   * Calculate indicator values asynchronously via Web Workers
   */
  private calculateIndicator(id: string): void {
    const config = this.indicators.get(id);
    const series = this.indicatorSeries.get(id);

    if (!config || !series || this.ohlcData.length === 0) return;

    const currentOHLC = [...this.ohlcData];
    const prices = currentOHLC.map(c => c.close);
    const worker = getWorkerManager();

    switch (config.type.toLowerCase()) {
      case 'ma':
      case 'sma': {
        const period = config.parameters.period || 20;
        worker.calculateSMA(prices, period, (smaValues) => {
          if (!this.indicators.has(id)) return;
          const data = smaValues
            .map((value, index) => ({
              time: currentOHLC[index]?.time,
              value
            }))
            .filter(d => d.time !== undefined && !isNaN(d.value));
          series.setData(data);
        });
        break;
      }

      case 'ema': {
        const period = config.parameters.period || 12;
        worker.calculateEMA(prices, period, (emaValues) => {
          if (!this.indicators.has(id)) return;
          const data = emaValues
            .map((value, index) => ({
              time: currentOHLC[index]?.time,
              value
            }))
            .filter(d => d.time !== undefined && !isNaN(d.value));
          series.setData(data);
        });
        break;
      }

      case 'rsi': {
        const period = config.parameters.period || 14;
        worker.calculateRSI(prices, period, (rsiValues) => {
          if (!this.indicators.has(id)) return;
          const data = rsiValues
            .map((value, index) => ({
              time: currentOHLC[index]?.time,
              value
            }))
            .filter(d => d.time !== undefined && !isNaN(d.value));
          series.setData(data);
        });
        break;
      }

      case 'macd': {
        const fast = config.parameters.fast || 12;
        const slow = config.parameters.slow || 26;
        const signal = config.parameters.signal || 9;
        worker.calculateMACD(prices, fast, slow, signal, (res) => {
          if (!this.indicators.has(id)) return;
          const data = res.macd
            .map((value, index) => ({
              time: currentOHLC[index]?.time,
              value
            }))
            .filter(d => d.time !== undefined && !isNaN(d.value));
          series.setData(data);
        });
        break;
      }

      case 'bollinger':
      case 'bb': {
        const period = config.parameters.period || 20;
        const stdDev = config.parameters.stdDev || 2;
        worker.calculateBollinger(prices, period, stdDev, (res) => {
          if (!this.indicators.has(id)) return;

          const middleSeries = this.indicatorSeries.get(id);
          const upperSeries = this.indicatorSeries.get(`${id}_upper`);
          const lowerSeries = this.indicatorSeries.get(`${id}_lower`);

          if (middleSeries) {
            const middleData = res.middle
              .map((value, index) => ({
                time: currentOHLC[index]?.time,
                value
              }))
              .filter(d => d.time !== undefined && !isNaN(d.value));
            middleSeries.setData(middleData);
          }
          if (upperSeries) {
            const upperData = res.upper
              .map((value, index) => ({
                time: currentOHLC[index]?.time,
                value
              }))
              .filter(d => d.time !== undefined && !isNaN(d.value));
            upperSeries.setData(upperData);
          }
          if (lowerSeries) {
            const lowerData = res.lower
              .map((value, index) => ({
                time: currentOHLC[index]?.time,
                value
              }))
              .filter(d => d.time !== undefined && !isNaN(d.value));
            lowerSeries.setData(lowerData);
          }
        });
        break;
      }

      default:
        console.warn(`Indicator type ${config.type} not implemented yet`);
        return;
    }
  }

  /**
   * Recalculate all indicators
   */
  private recalculateAll(): void {
    this.indicators.forEach((_, id) => {
      this.calculateIndicator(id);
    });
  }

  /**
   * Check if indicator needs separate price scale
   */
  private needsSeparateScale(type: string): boolean {
    const separateScaleIndicators = ['rsi', 'macd', 'stochastic', 'cci', 'mfi', 'awesome'];
    return separateScaleIndicators.includes(type.toLowerCase());
  }

  /**
   * Get default color for indicator type
   */
  private getDefaultColor(type: string): string {
    const colors: Record<string, string> = {
      'ma': '#2196F3',
      'ema': '#9C27B0',
      'sma': '#2196F3',
      'rsi': '#FF9800',
      'macd': '#4CAF50',
      'bb': '#E91E63',
      'bollinger': '#E91E63',
      'stochastic': '#00BCD4',
      'cci': '#FFEB3B',
      'momentum': '#8BC34A'
    };

    return colors[type.toLowerCase()] || '#2196F3';
  }

  /**
   * Clear all indicators
   */
  clearAll(): void {
    this.indicators.forEach((_, id) => {
      this.removeIndicator(id);
    });
  }

  /**
   * Save indicators configuration
   */
  saveToStorage(symbol: string): void {
    try {
      const config = Array.from(this.indicators.values());
      const key = `chart-indicators-${symbol}`;
      localStorage.setItem(key, JSON.stringify(config));
    } catch (error) {
      console.error('Failed to save indicators:', error);
    }
  }

  /**
   * Load indicators configuration
   */
  loadFromStorage(symbol: string): void {
    try {
      const key = `chart-indicators-${symbol}`;
      const data = localStorage.getItem(key);

      if (data) {
        const configs: IndicatorConfig[] = JSON.parse(data);
        configs.forEach(config => {
          this.addIndicator(config);
        });
      }
    } catch (error) {
      console.error('Failed to load indicators:', error);
    }
  }
}

// Export singleton instance
export const indicatorManager = new IndicatorManager();

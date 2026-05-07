/**
 * Indicator Manager
 * Calculates and manages technical indicators
 */

import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import { LineSeries } from 'lightweight-charts';

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

    // Create series for the indicator
    const series = this.createIndicatorSeries(config);
    if (series) {
      this.indicatorSeries.set(config.id, series);
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

    // Most indicators use line series
    const series = this.chart.addSeries(LineSeries, {
      color: config.color || this.getDefaultColor(config.type),
      lineWidth: 2,
      lastValueVisible: false, // Fix: Hide indicator price labels on Y-axis
      priceLineVisible: false, // Fix: Hide indicator horizontal lines
      title: config.name,
      priceScaleId: this.needsSeparateScale(config.type) ? config.id : 'right',
      visible: config.visible
    });

    return series;
  }

  /**
   * Calculate indicator values
   */
  private calculateIndicator(id: string): void {
    const config = this.indicators.get(id);
    const series = this.indicatorSeries.get(id);

    if (!config || !series || this.ohlcData.length === 0) return;

    let data: any[] = [];

    switch (config.type) {
      case 'ma':
      case 'sma':
        data = this.calculateSMA(this.ohlcData, config.parameters.period || 20);
        break;

      case 'ema':
        data = this.calculateEMA(this.ohlcData, config.parameters.period || 12);
        break;

      case 'rsi':
        data = this.calculateRSI(this.ohlcData, config.parameters.period || 14);
        break;

      case 'macd':
        // MACD requires multiple series (line, signal, histogram)
        data = this.calculateMACD(
          this.ohlcData,
          config.parameters.fast || 12,
          config.parameters.slow || 26,
          config.parameters.signal || 9
        );
        break;

      default:
        console.warn(`Indicator type ${config.type} not implemented yet`);
        return;
    }

    series.setData(data);
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
   * Calculate Simple Moving Average
   */
  private calculateSMA(data: OHLCData[], period: number): Array<{ time: Time; value: number }> {
    const result: Array<{ time: Time; value: number }> = [];

    for (let i = period - 1; i < data.length; i++) {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += data[i - j].close;
      }
      result.push({
        time: data[i].time,
        value: sum / period
      });
    }

    return result;
  }

  /**
   * Calculate Exponential Moving Average
   */
  private calculateEMA(data: OHLCData[], period: number): Array<{ time: Time; value: number }> {
    const result: Array<{ time: Time; value: number }> = [];
    const multiplier = 2 / (period + 1);

    // Start with SMA for first value
    let ema = 0;
    for (let i = 0; i < period; i++) {
      ema += data[i].close;
    }
    ema /= period;

    result.push({
      time: data[period - 1].time,
      value: ema
    });

    // Calculate EMA for remaining values
    for (let i = period; i < data.length; i++) {
      ema = (data[i].close - ema) * multiplier + ema;
      result.push({
        time: data[i].time,
        value: ema
      });
    }

    return result;
  }

  /**
   * Calculate Relative Strength Index
   */
  private calculateRSI(data: OHLCData[], period: number): Array<{ time: Time; value: number }> {
    const result: Array<{ time: Time; value: number }> = [];

    if (data.length < period + 1) return result;

    let gains = 0;
    let losses = 0;

    // Calculate initial average gain and loss
    for (let i = 1; i <= period; i++) {
      const change = data[i].close - data[i - 1].close;
      if (change >= 0) {
        gains += change;
      } else {
        losses -= change;
      }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Calculate RSI
    for (let i = period; i < data.length; i++) {
      const change = data[i].close - data[i - 1].close;

      const currentGain = change >= 0 ? change : 0;
      const currentLoss = change < 0 ? -change : 0;

      avgGain = (avgGain * (period - 1) + currentGain) / period;
      avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      const rsi = 100 - (100 / (1 + rs));

      result.push({
        time: data[i].time,
        value: rsi
      });
    }

    return result;
  }

  /**
   * Calculate MACD
   */
  private calculateMACD(
    data: OHLCData[],
    fastPeriod: number,
    slowPeriod: number,
    _signalPeriod: number
  ): Array<{ time: Time; value: number }> {
    const fastEMA = this.calculateEMA(data, fastPeriod);
    const slowEMA = this.calculateEMA(data, slowPeriod);

    const macdLine: Array<{ time: Time; value: number }> = [];

    // Calculate MACD line (fast EMA - slow EMA)
    for (let i = 0; i < Math.min(fastEMA.length, slowEMA.length); i++) {
      if (fastEMA[i].time === slowEMA[i].time) {
        macdLine.push({
          time: fastEMA[i].time,
          value: fastEMA[i].value - slowEMA[i].value
        });
      }
    }

    // Calculate signal line (EMA of MACD)
    // For simplicity, return just the MACD line
    // In production, you'd create separate series for signal and histogram

    return macdLine;
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

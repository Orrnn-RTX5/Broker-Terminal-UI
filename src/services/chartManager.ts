/**
 * Chart Manager
 * Manages chart configuration and responds to toolbar commands
 */

import type { IChartApi } from 'lightweight-charts';
import { CrosshairMode } from 'lightweight-charts';

export interface ChartCommand {
  type: string;
  payload?: any;
}

export class ChartManager {
  private chart: IChartApi | null = null;
  private crosshairEnabled: boolean = true;
  private currentBarSpacing: number = 6;

  constructor() {}

  setChart(chart: IChartApi | null): void {
    this.chart = chart;

    // Initialize with current settings
    if (this.chart) {
      this.chart.applyOptions({
        timeScale: {
          barSpacing: this.currentBarSpacing
        },
        crosshair: {
          mode: this.crosshairEnabled ? CrosshairMode.Normal : CrosshairMode.Hidden
        }
      });
    }
  }

  /**
   * Toggle crosshair on/off
   */
  toggleCrosshair(): void {
    if (!this.chart) return;

    this.crosshairEnabled = !this.crosshairEnabled;

    this.chart.applyOptions({
      crosshair: {
        mode: this.crosshairEnabled ? CrosshairMode.Normal : CrosshairMode.Hidden,
        vertLine: {
          color: '#525252',
          width: 1,
          style: 2,
          labelBackgroundColor: '#18181b'
        },
        horzLine: {
          color: '#525252',
          width: 1,
          style: 2,
          labelBackgroundColor: '#18181b'
        }
      }
    });
  }

  /**
   * Zoom in - increase candle density by increasing bar spacing
   */
  zoomIn(): void {
    if (!this.chart) return;

    const timeScale = this.chart.timeScale();
    const currentSpacing = timeScale.options().barSpacing || 6;

    // Increase bar spacing (makes candles wider/less dense)
    this.currentBarSpacing = Math.min(currentSpacing + 1, 50);

    this.chart.applyOptions({
      timeScale: {
        barSpacing: this.currentBarSpacing
      }
    });
  }

  /**
   * Zoom out - decrease candle density by decreasing bar spacing
   */
  zoomOut(): void {
    if (!this.chart) return;

    const timeScale = this.chart.timeScale();
    const currentSpacing = timeScale.options().barSpacing || 6;

    // Decrease bar spacing (makes candles narrower/more dense)
    this.currentBarSpacing = Math.max(currentSpacing - 1, 1);

    this.chart.applyOptions({
      timeScale: {
        barSpacing: this.currentBarSpacing
      }
    });
  }

  /**
   * Set zoom level directly
   */
  setZoom(barSpacing: number): void {
    if (!this.chart) return;

    this.currentBarSpacing = Math.max(1, Math.min(barSpacing, 50));

    this.chart.applyOptions({
      timeScale: {
        barSpacing: this.currentBarSpacing
      }
    });
  }

  /**
   * Reset zoom to default
   */
  resetZoom(): void {
    if (!this.chart) return;

    this.currentBarSpacing = 6;

    this.chart.applyOptions({
      timeScale: {
        barSpacing: this.currentBarSpacing
      }
    });
  }

  /**
   * Get current crosshair state
   */
  isCrosshairEnabled(): boolean {
    return this.crosshairEnabled;
  }

  /**
   * Get current bar spacing
   */
  getBarSpacing(): number {
    return this.currentBarSpacing;
  }

  /**
   * Fit content to viewport
   */
  fitContent(): void {
    if (!this.chart) return;
    this.chart.timeScale().fitContent();
  }

  /**
   * Scroll to realtime
   */
  scrollToRealtime(): void {
    if (!this.chart) return;
    this.chart.timeScale().scrollToRealTime();
  }
}

// Export singleton instance
export const chartManager = new ChartManager();

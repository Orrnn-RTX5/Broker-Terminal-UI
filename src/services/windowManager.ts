export type LayoutMode = 'single' | 'horizontal' | 'vertical' | 'grid';

export interface ChartWindow {
  id: string;
  symbol: string;
  position?: { row: number; col: number };
}

export class WindowManager {
  private layoutMode: LayoutMode = 'single';
  private charts: ChartWindow[] = [];
  private listeners: Set<(mode: LayoutMode) => void> = new Set();

  constructor() {
    this.loadState();
  }

  private loadState(): void {
    const saved = localStorage.getItem('windowManagerState');
    if (saved) {
      try {
        const state = JSON.parse(saved);
        this.layoutMode = state.layoutMode || 'single';
        this.charts = state.charts || [];
      } catch (e) {
        console.error('Failed to load window manager state:', e);
      }
    }
  }

  private saveState(): void {
    localStorage.setItem('windowManagerState', JSON.stringify({
      layoutMode: this.layoutMode,
      charts: this.charts
    }));
  }

  setLayoutMode(mode: LayoutMode): void {
    if (this.layoutMode !== mode) {
      this.layoutMode = mode;
      this.rearrangeCharts();
      this.saveState();
      this.notifyListeners();
    }
  }

  getLayoutMode(): LayoutMode {
    return this.layoutMode;
  }

  private rearrangeCharts(): void {
    const count = this.charts.length;

    switch (this.layoutMode) {
      case 'single':
        // Only show first chart
        this.charts = this.charts.slice(0, 1);
        break;

      case 'horizontal':
        // Arrange in horizontal row
        this.charts.forEach((chart, i) => {
          chart.position = { row: 0, col: i };
        });
        break;

      case 'vertical':
        // Arrange in vertical column
        this.charts.forEach((chart, i) => {
          chart.position = { row: i, col: 0 };
        });
        break;

      case 'grid':
        // Arrange in grid (2x2, 3x3, etc.)
        const cols = Math.ceil(Math.sqrt(count));
        this.charts.forEach((chart, i) => {
          chart.position = {
            row: Math.floor(i / cols),
            col: i % cols
          };
        });
        break;
    }
  }

  addChart(symbol: string): string {
    const id = `chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.charts.push({ id, symbol });
    this.rearrangeCharts();
    this.saveState();
    return id;
  }

  removeChart(id: string): void {
    this.charts = this.charts.filter(c => c.id !== id);
    this.rearrangeCharts();
    this.saveState();
  }

  getCharts(): ChartWindow[] {
    return this.charts;
  }

  getChartCount(): number {
    return this.charts.length;
  }

  getGridDimensions(): { rows: number; cols: number } {
    const count = this.charts.length;
    switch (this.layoutMode) {
      case 'single':
        return { rows: 1, cols: 1 };
      case 'horizontal':
        return { rows: 1, cols: count };
      case 'vertical':
        return { rows: count, cols: 1 };
      case 'grid':
        const cols = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / cols);
        return { rows, cols };
      default:
        return { rows: 1, cols: 1 };
    }
  }

  getGridCSSClass(): string {
    const { rows, cols } = this.getGridDimensions();

    if (rows === 1 && cols === 1) return 'grid-cols-1 grid-rows-1';
    if (rows === 1) return `grid-cols-${cols}`;
    if (cols === 1) return `grid-rows-${rows}`;

    return `grid-cols-${cols} grid-rows-${rows}`;
  }

  subscribe(callback: (mode: LayoutMode) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(): void {
    this.listeners.forEach(callback => callback(this.layoutMode));
  }

  reset(): void {
    this.layoutMode = 'single';
    this.charts = [];
    localStorage.removeItem('windowManagerState');
    this.notifyListeners();
  }
}

// Singleton instance
export const windowManager = new WindowManager();

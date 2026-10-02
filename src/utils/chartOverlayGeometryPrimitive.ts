import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, Time } from 'lightweight-charts';

/** Reproject DOM overlays after the chart commits its price/time transform. */
export class ChartOverlayGeometryPrimitive implements ISeriesPrimitive<Time> {
  private attachedToChart = false;
  private dirty = true;
  private readonly paneRenderer: IPrimitivePaneRenderer = {
    draw: () => {
      if (!this.attachedToChart || !this.dirty) return;
      this.dirty = false;
      this.repaintGeometry();
    },
  };
  private readonly views: readonly IPrimitivePaneView[] = [{
    zOrder: () => 'top',
    renderer: () => this.paneRenderer,
  }];

  constructor(private readonly repaintGeometry: () => void) {}

  attached(): void {
    this.attachedToChart = true;
    this.dirty = true;
  }

  detached(): void {
    this.attachedToChart = false;
  }

  updateAllViews(): void {
    this.dirty = true;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }
}

import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import {
  buildDrawingContextKey,
  type DrawingContextIdentity,
} from '../contextKey';
import type { DrawingSeriesDataProvider } from '../model/drawing';

export interface ChartContext {
  chart: IChartApi;
  series: ISeriesApi<SeriesType>;
  contextId: string;
  symbol: string;
  timeframe: string;
  accountScope?: string;
  seriesDataProvider?: DrawingSeriesDataProvider;
  svgOverlay: SVGSVGElement | null;
}

export type DrawingContextEntry = [HTMLElement, ChartContext];

/** Registry for mounted chart adapters, independent from drawing documents. */
export class DrawingContextRegistry {
  private readonly contexts = new Map<HTMLElement, ChartContext>();

  get(container: HTMLElement): ChartContext | undefined {
    return this.contexts.get(container);
  }

  set(container: HTMLElement, context: ChartContext): void {
    this.contexts.set(container, context);
  }

  delete(container: HTMLElement): boolean {
    return this.contexts.delete(container);
  }

  values(): IterableIterator<ChartContext> {
    return this.contexts.values();
  }

  entries(): IterableIterator<DrawingContextEntry> {
    return this.contexts.entries();
  }

  /** Prefer the active context, otherwise the newest mounted matching panel. */
  resolve(
    contextId: string,
    activeContainer: HTMLElement | null,
    expectedIdentity?: DrawingContextIdentity,
  ): DrawingContextEntry | null {
    const matches = (context: ChartContext) => (
      context.contextId === contextId
      && (
        !expectedIdentity
        || buildDrawingContextKey(context) === buildDrawingContextKey(expectedIdentity)
      )
    );

    if (activeContainer) {
      const activeContext = this.contexts.get(activeContainer);
      if (activeContext && matches(activeContext)) return [activeContainer, activeContext];
    }

    let latestMatch: DrawingContextEntry | null = null;
    let latestConnectedMatch: DrawingContextEntry | null = null;
    for (const entry of this.contexts.entries()) {
      if (!matches(entry[1])) continue;
      latestMatch = entry;
      if (entry[0].isConnected) latestConnectedMatch = entry;
    }
    return latestConnectedMatch ?? latestMatch;
  }
}

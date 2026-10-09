import type { ChartType } from '../../../types/chart';

export interface ChartDataRenderRequest {
  chartType?: ChartType;
  prependedBars?: number;
  resetVisibleRange?: boolean;
  suppressGlobalVisibleRangeReset?: boolean;
  releaseLivePaintAfterRender?: boolean;
  finishLoadingAfterRender?: boolean;
  immediate?: boolean;
  /** Commit an owned cache baseline before paint, without a loading fade. */
  cachedBaseline?: boolean;
  reason?: string;
}

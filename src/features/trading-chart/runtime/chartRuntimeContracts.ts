import type { ChartType } from '../../../types/chart';

export interface ChartDataRenderRequest {
  chartType?: ChartType;
  prependedBars?: number;
  resetVisibleRange?: boolean;
  suppressGlobalVisibleRangeReset?: boolean;
  releaseLivePaintAfterRender?: boolean;
  finishLoadingAfterRender?: boolean;
  immediate?: boolean;
  reason?: string;
}

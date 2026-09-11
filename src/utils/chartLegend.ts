export interface ChartLegendValues {
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export type ChartLegendRefs = {
  [Key in keyof ChartLegendValues]: { current: HTMLSpanElement | null };
};

const legendKeys = ['open', 'high', 'low', 'close', 'volume'] as const;

// A matching cached value does not mean it is visible: React can replace these
// nodes when OHLC is enabled again, the ticker changes, or the theme changes.
export const isChartLegendPainted = (refs: ChartLegendRefs, values: ChartLegendValues): boolean => (
  legendKeys.every((key) => refs[key].current?.textContent === values[key])
);

export function paintChartLegend(refs: ChartLegendRefs, values: ChartLegendValues): boolean {
  if (legendKeys.some((key) => !refs[key].current)) return false;
  for (const key of legendKeys) refs[key].current!.textContent = values[key];
  return true;
}

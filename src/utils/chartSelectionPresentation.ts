import type {
  ChartSelectionPresentationGate,
  ChartSelectionPresentationKeyParts,
  FirstLiveSelectionBaselineInput,
} from '../types/chart';

export type {
  ChartSelectionPresentationGate,
  ChartSelectionPresentationKeyParts,
  FirstLiveSelectionBaselineInput,
} from '../types/chart';

const normalizeSelectionPart = (value: unknown): string => (
  String(value ?? '').trim().toUpperCase()
);

export const buildChartSelectionPresentationKey = ({
  sessionScope,
  symbol,
  timeframe,
}: ChartSelectionPresentationKeyParts): string => (
  [String(sessionScope ?? ''), normalizeSelectionPart(symbol), normalizeSelectionPart(timeframe)].join('\u001f')
);

export const createChartSelectionPresentationGate = (
  selectionKey: string,
): ChartSelectionPresentationGate => ({
  selectionKey,
  livePaintAllowed: false,
});

/**
 * A different account/symbol/timeframe starts behind the loading surface. Live
 * ticks may update the in-memory candle model, but they cannot paint yet.
 */
export const selectChartPresentation = (
  gate: ChartSelectionPresentationGate,
  selectionKey: string,
): ChartSelectionPresentationGate => (
  gate.selectionKey === selectionKey
    ? gate
    : createChartSelectionPresentationGate(selectionKey)
);

/**
 * Releases live painting only for the selection that actually committed its
 * historical baseline (REST, session cache, or a full stream snapshot). A late
 * response from an older selection cannot unlock the current chart.
 */
export const releaseChartSelectionLivePaint = (
  gate: ChartSelectionPresentationGate,
  selectionKey: string,
): ChartSelectionPresentationGate => {
  if (gate.selectionKey !== selectionKey || gate.livePaintAllowed) return gate;
  return { ...gate, livePaintAllowed: true };
};

export const isChartSelectionLivePaintAllowed = (
  gate: ChartSelectionPresentationGate,
  selectionKey: string,
): boolean => gate.selectionKey === selectionKey && gate.livePaintAllowed;

/**
 * The terminal keeps the stale-selection gate, but it may establish a new
 * selection from that selection's first validated live candle. The caller
 * still commits through the full setData path before the gate is released.
 */
export const shouldCommitFirstLiveSelectionBaseline = ({
  gate,
  selectionKey,
  active,
  disposed,
  rebuilding,
  hasSeries,
  hasCurrentCandle,
}: FirstLiveSelectionBaselineInput): boolean => Boolean(
  active
  && !disposed
  && !rebuilding
  && hasSeries
  && hasCurrentCandle
  && gate.selectionKey === selectionKey
  && !gate.livePaintAllowed
);

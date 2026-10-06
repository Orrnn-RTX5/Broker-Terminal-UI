/** Preserve immediate placement without adding a redundant successful pass. */
export function layoutRebuiltTradeOverlay(
  interactionActive: boolean,
  updateLabelPositions: () => boolean,
  queueTradeOverlayRelayout: () => void,
): void {
  if (interactionActive || updateLabelPositions()) queueTradeOverlayRelayout();
  // Never cancel an existing request: quote/range events may also own it.
  // The queued callback performs one pass, without scheduling itself again.
}

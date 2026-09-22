/**
 * A WebSocket array is only a transport snapshot. It must not erase a visible
 * position set merely because a delayed/reconnected socket supplies `[]`.
 * The REST positions endpoint is the durable source that confirms an account
 * really has no open positions.
 */
export const shouldDeferEmptyPositionSnapshot = (
  currentPositions: readonly unknown[] | null | undefined,
  incomingPositions: readonly unknown[] | null | undefined,
): boolean => (
  Array.isArray(currentPositions)
  && currentPositions.length > 0
  && Array.isArray(incomingPositions)
  && incomingPositions.length === 0
);

const REVALIDATION_DEBOUNCE_MS = 500;
let lastRevalidationAt = 0;

/**
 * BottomDock owns a REST-backed Trade data reader. Ask it to reconcile an
 * incomplete stream update; its successful `[]` response remains
 * able to clear rows after a real final close.
 */
export const requestPositionSnapshotRevalidation = (): boolean => {
  if (typeof window === 'undefined') return false;

  const now = Date.now();
  if (now - lastRevalidationAt < REVALIDATION_DEBOUNCE_MS) return false;
  lastRevalidationAt = now;
  window.dispatchEvent(new CustomEvent('rtx:toolbox-trade-refresh', {
    detail: { reason: 'incomplete_position_stream_update' },
  }));
  return true;
};

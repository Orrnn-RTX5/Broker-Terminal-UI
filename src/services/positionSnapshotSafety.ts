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

/** Periodic complete positions read (safety net for a lost close frame on a live socket). */
export const POSITIONS_SAFETY_READ_INTERVAL_MS = 30_000;
/** A stream positions frame this recent means the stream is live: the periodic read waits. */
export const POSITIONS_SAFETY_QUIET_MS = 5_000;

let positionsReadsInFlight = 0;
let lastPositionsStreamFrameAt = 0;

/** Every complete positions read (refresh controller, account poll) brackets itself with these. */
export const markPositionsReadStarted = (): void => {
  positionsReadsInFlight += 1;
};
export const markPositionsReadSettled = (): void => {
  positionsReadsInFlight = Math.max(0, positionsReadsInFlight - 1);
};
export const arePositionsReadsInFlight = (): boolean => positionsReadsInFlight > 0;

/**
 * Called once per stream positions frame. A pnl-only frame (every row carries update_kind
 * 'pnl', the classification tradePositionStream.decodePositionStreamMessage and
 * positionStream.reconcilePositionStreamBatch use) does not stamp: the stream is alive, but
 * nothing structural changed. Open, modify, close and rows without update_kind do stamp.
 * Cost: one pass over the frame's rows, once per frame; nothing per tick.
 */
export const markPositionsStreamFrameIfStructural = (
  rows: readonly { update_kind?: unknown }[],
  closedTickets: readonly unknown[],
  now: number = Date.now(),
): boolean => {
  const structural = closedTickets.length > 0 || rows.some((row) => row.update_kind !== 'pnl');
  if (!structural) return false;
  lastPositionsStreamFrameAt = now;
  return true;
};
export const getLastPositionsStreamFrameAt = (): number => lastPositionsStreamFrameAt;

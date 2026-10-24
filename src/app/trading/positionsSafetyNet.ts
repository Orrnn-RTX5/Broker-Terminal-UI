import {
  arePositionsReadsInFlight,
  getLastPositionsStreamFrameAt,
  POSITIONS_SAFETY_QUIET_MS,
  POSITIONS_SAFETY_READ_INTERVAL_MS,
} from '../../services/positionSnapshotSafety';

export interface PositionsSafetyNetOptions {
  /** One complete positions revalidation through the existing refresh path. */
  read: () => void;
  intervalMs?: number;
  quietMs?: number;
  now?: () => number;
  isVisible?: () => boolean;
  isReadInFlight?: () => boolean;
  lastFrameAt?: () => number;
}

const documentVisible = (): boolean => typeof document === 'undefined' || !document.hidden;

/**
 * Periodic complete positions read. It catches a close frame lost on a live socket: stream
 * snapshots only merge rows, so only a complete read can remove a missed close. One read per
 * interval; never while a positions read is in flight or a stream positions frame arrived in
 * the quiet window; the timer stops while the page is hidden and when the returned stop runs.
 */
export const startPositionsSafetyNet = (options: PositionsSafetyNetOptions): (() => void) => {
  const intervalMs = options.intervalMs ?? POSITIONS_SAFETY_READ_INTERVAL_MS;
  const quietMs = options.quietMs ?? POSITIONS_SAFETY_QUIET_MS;
  const now = options.now ?? (() => Date.now());
  const isVisible = options.isVisible ?? documentVisible;
  const isReadInFlight = options.isReadInFlight ?? arePositionsReadsInFlight;
  const lastFrameAt = options.lastFrameAt ?? getLastPositionsStreamFrameAt;

  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = (): void => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };
  const tick = (): void => {
    if (!isVisible() || isReadInFlight() || now() - lastFrameAt() < quietMs) return;
    options.read();
  };
  const start = (): void => {
    if (timer === null && isVisible()) timer = setInterval(tick, intervalMs);
  };
  const onVisibilityChange = (): void => {
    if (isVisible()) start();
    else stop();
  };

  start();
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    stop();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
  };
};

export type TradeOverlayRelayoutRequest = { retryOnce?: boolean };

/** Coalesce geometry only. Model ownership and close suppression stay synchronous. */
export function createTradeOverlayRelayoutQueue(options: {
  frameRef: { current: number | null };
  isCurrent: () => boolean;
  isInteracting: () => boolean;
  requestPostInteraction: () => void;
  project: () => boolean;
}) {
  let disposed = false, retryRequested = false;
  let ownedFrame: number | null = null;
  const current = () => !disposed && options.isCurrent();
  const projectOnce = () => {
    const mayRetry = retryRequested;
    retryRequested = false;
    const unresolved = options.project();
    if (unresolved && mayRetry && current()) queue();
  };
  const queue = (request: TradeOverlayRelayoutRequest = {}) => {
    if (!current()) return;
    retryRequested ||= request.retryOnce === true;
    if (options.isInteracting()) { options.requestPostInteraction(); return; }
    if (options.frameRef.current !== null) return;
    const frame = requestAnimationFrame(() => {
      // A late callback must never clear a replacement owner's request.
      if (disposed || options.frameRef.current !== frame || ownedFrame !== frame) return;
      options.frameRef.current = null; ownedFrame = null;
      if (!current()) return;
      if (options.isInteracting()) { options.requestPostInteraction(); return; }
      projectOnce();
    });
    ownedFrame = frame;
    options.frameRef.current = frame;
  };
  return {
    queue,
    flushPostInteraction() {
      if (!current()) return;
      if (options.isInteracting()) { options.requestPostInteraction(); return; }
      projectOnce();
    },
    dispose() {
      disposed = true; retryRequested = false;
      if (ownedFrame !== null && options.frameRef.current === ownedFrame) {
        cancelAnimationFrame(ownedFrame); options.frameRef.current = null;
      }
      ownedFrame = null;
    },
  };
}

export type TradeOverlayRelayoutRequest = { retryOnce?: boolean };
// RAF IDs may be reused after cancellation. Tokens distinguish both reentrant
// requests and replacement owners sharing the same React ref, without retention.
const sharedFrameOwners = new WeakMap<object, object>();

/** Coalesce geometry only. Model ownership and close suppression stay synchronous. */
export function createTradeOverlayRelayoutQueue(options: {
  frameRef: { current: number | null };
  isCurrent: () => boolean;
  isInteracting: () => boolean;
  requestPostInteraction: () => void;
  project: (refreshMetrics?: boolean) => boolean;
}) {
  let disposed = false, retryRequested = false;
  let ownedFrame: number | null = null;
  let ownedToken: object | null = null;
  const current = () => !disposed && options.isCurrent();
  const ownsFrame = () => ownedFrame !== null && ownedToken !== null
    && options.frameRef.current === ownedFrame && sharedFrameOwners.get(options.frameRef) === ownedToken;
  const clearOwnedFrame = () => {
    options.frameRef.current = null;
    sharedFrameOwners.delete(options.frameRef);
    ownedFrame = null; ownedToken = null;
  };
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
    const token = {};
    const frame = requestAnimationFrame(() => {
      // A late callback must never clear a replacement owner's request.
      if (disposed || ownedToken !== token || !ownsFrame()) return;
      clearOwnedFrame();
      if (!current()) return;
      if (options.isInteracting()) { options.requestPostInteraction(); return; }
      projectOnce();
    });
    ownedFrame = frame;
    ownedToken = token; sharedFrameOwners.set(options.frameRef, token);
    options.frameRef.current = frame;
  };
  return {
    queue,
    projectCommittedGeometry() {
      if (!current()) return;
      // A committed chart draw must always project its current transform. It
      // can also fulfil an already pending model request, but never deferred
      // gesture work or a replacement owner's frame. No frame-time cache.
      if (options.isInteracting() || !ownsFrame()) {
        options.project(false);
        return;
      }
      const frame = ownedFrame!;
      cancelAnimationFrame(frame);
      clearOwnedFrame();
      // Clear before projecting: callbacks which invalidate geometry or replace
      // the model during metrics refresh must retain their newly owned request.
      // Same exception semantics as the owned RAF: this request was attempted;
      // only an unresolved result or a real invalidation can schedule more work.
      projectOnce();
    },
    flushPostInteraction() {
      if (!current()) return;
      if (options.isInteracting()) { options.requestPostInteraction(); return; }
      projectOnce();
    },
    dispose() {
      disposed = true; retryRequested = false;
      if (ownsFrame()) {
        cancelAnimationFrame(ownedFrame!); clearOwnedFrame();
      }
      ownedFrame = null; ownedToken = null;
    },
  };
}

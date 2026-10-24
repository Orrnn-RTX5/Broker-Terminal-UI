/**
 * History tabs (orders, deals, closed positions) are served from projector
 * tables that trail a fill or close by roughly 40-50 ms, so a refetch that runs
 * on the same tick as the frame or ACK can read the pre-change state.
 *
 * Two refetch paths keep History fresh without polling:
 *  - stream frames go through a coalescer: a leading refetch shortly after the
 *    first close/order/deal frame of a burst, a trailing refetch that follows
 *    the last frame (capped so a steady stream still refetches each second), and
 *    one bounded fallback after the last close frame for stream-only closes
 *    such as SL/TP or stop-out, which have no ACK;
 *  - every order or close ACK calls refreshHistoryAfterFill: one immediate
 *    refetch plus one bounded fallback refetch, both guarded by isCurrent.
 * A stream close fallback is skipped while an ACK fallback for the same login
 * is pending, so one UI close gets exactly one fallback refetch.
 */

/** Leading refetch delay after the first frame of a burst; also the lag window. */
export const STREAM_HISTORY_LEAD_MS = 50;
/** Quiet window after the last frame before the trailing refetch runs. */
export const STREAM_HISTORY_WINDOW_MS = 250;
/** Longest wait for a trailing refetch after the first frame it must cover. */
export const STREAM_HISTORY_MAX_WAIT_MS = 1000;
/** Fallback refetch after the last close frame. */
export const STREAM_CLOSE_FALLBACK_MS = 1500;
/** Fallback refetch after a fill or close ACK. */
export const ACK_HISTORY_FALLBACK_MS = 1500;

export type HistoryRefresh = (login: number) => unknown;

export interface HistoryFreshnessOwner {
  refresh: HistoryRefresh;
  /** True while the account is still the live one and the owner is mounted. */
  isCurrent: (login: number) => boolean;
  /** Pending ACK fallback timers (timer id to login), cleared by disposeHistoryFreshnessOwner. */
  timers: Map<number, number>;
}

/** Login to the number of pending ACK fallback timers across all owners. */
const pendingAckFallbacks = new Map<number, number>();

const retainAckFallback = (login: number): void => {
  pendingAckFallbacks.set(login, (pendingAckFallbacks.get(login) ?? 0) + 1);
};

const releaseAckFallback = (login: number): void => {
  const remaining = (pendingAckFallbacks.get(login) ?? 0) - 1;
  if (remaining > 0) pendingAckFallbacks.set(login, remaining);
  else pendingAckFallbacks.delete(login);
};

const hasPendingAckFallback = (login: number): boolean => (pendingAckFallbacks.get(login) ?? 0) > 0;

const reportRefreshError = (error: unknown): void => {
  console.error('[History] Failed to refresh orders/history:', error);
};

const runRefresh = (refresh: HistoryRefresh, login: number): void => {
  try {
    void Promise.resolve(refresh(login)).catch(reportRefreshError);
  } catch (error) {
    reportRefreshError(error);
  }
};

export const createHistoryFreshnessOwner = (
  refresh: HistoryRefresh,
  isCurrent: (login: number) => boolean,
): HistoryFreshnessOwner => ({ refresh, isCurrent, timers: new Map<number, number>() });

export const disposeHistoryFreshnessOwner = (owner: HistoryFreshnessOwner): void => {
  owner.timers.forEach((login, timerId) => {
    window.clearTimeout(timerId);
    releaseAckFallback(login);
  });
  owner.timers.clear();
};

let defaultOwner: HistoryFreshnessOwner | null = null;

/**
 * Registers the owner used by order/close call sites outside hooks. Returns the
 * unbind, which also clears the owner's pending fallback timers.
 */
export const bindDefaultHistoryFreshnessOwner = (owner: HistoryFreshnessOwner): (() => void) => {
  defaultOwner = owner;
  return () => {
    if (defaultOwner === owner) defaultOwner = null;
    disposeHistoryFreshnessOwner(owner);
  };
};

/**
 * Call after a fill or close ACK. Refetches now, then once more after
 * ACK_HISTORY_FALLBACK_MS. Both refetches run only while owner.isCurrent holds
 * (same live account, owner still mounted).
 */
export const refreshHistoryAfterFill = (
  login: number,
  owner: HistoryFreshnessOwner | null = defaultOwner,
): void => {
  if (!owner || !Number.isSafeInteger(login) || login <= 0) return;
  if (owner.isCurrent(login)) runRefresh(owner.refresh, login);
  const timerId = window.setTimeout(() => {
    owner.timers.delete(timerId);
    releaseAckFallback(login);
    if (owner.isCurrent(login)) runRefresh(owner.refresh, login);
  }, ACK_HISTORY_FALLBACK_MS);
  owner.timers.set(timerId, login);
  retainAckFallback(login);
};

export interface StreamHistoryCoalescer {
  onFrame: (login: number, kind: 'close' | 'order') => void;
  dispose: () => void;
}

/**
 * Coalesces stream-driven history refetches for one subscription.
 *  - First frame of a burst (no refetch in the last window): leading refetch
 *    STREAM_HISTORY_LEAD_MS later. Later frames before it are covered by it.
 *  - A frame inside the lead's lag window re-arms ONE trailing refetch that
 *    follows the last frame by STREAM_HISTORY_WINDOW_MS. A frame during a quiet
 *    window (after a refetch) arms the same trailing refetch.
 *  - The trailing refetch is capped at STREAM_HISTORY_MAX_WAIT_MS after the
 *    first frame it must cover, so a steady stream still refetches each second.
 *    If a capped refetch lands before the last frame's quiet window has
 *    elapsed, one more trailing refetch is kept for that last frame.
 *  - Close frames also re-arm ONE fallback refetch STREAM_CLOSE_FALLBACK_MS
 *    after the last close frame, unless an ACK fallback for the same login is
 *    pending; the ACK fallback then covers the close.
 * At most three timers exist at once. No timer runs without a frame.
 * dispose() flushes one refetch when a lead or trailing refetch was pending and
 * the login is still current, so a pending refresh is never silently dropped.
 */
export const createStreamHistoryCoalescer = (owner: {
  refresh: HistoryRefresh;
  isCurrent: (login: number) => boolean;
}): StreamHistoryCoalescer => {
  let leadTimer: number | null = null;
  let trailTimer: number | null = null;
  let closeTimer: number | null = null;
  let pendingLogin: number | null = null;
  let closeLogin: number | null = null;
  let lastFrameAt = Number.NEGATIVE_INFINITY;
  let lastFireAt = Number.NEGATIVE_INFINITY;
  /** First frame not yet covered by a refetch; bounds the trailing wait. */
  let uncoveredSinceAt: number | null = null;
  let disposed = false;

  const refetch = (login: number | null): void => {
    if (login !== null && owner.isCurrent(login)) runRefresh(owner.refresh, login);
  };

  const onTrail = (): void => {
    trailTimer = null;
    const fireAt = Date.now();
    lastFireAt = fireAt;
    uncoveredSinceAt = null;
    refetch(pendingLogin);
    // A capped fire can land inside the last frame's quiet window: keep one refetch for it.
    if (lastFrameAt + STREAM_HISTORY_WINDOW_MS > fireAt) armTrailing();
  };

  // Due STREAM_HISTORY_WINDOW_MS after the last frame, capped at MAX_WAIT after the first uncovered one.
  const armTrailing = (): void => {
    if (trailTimer !== null) window.clearTimeout(trailTimer);
    const due = Math.min(
      lastFrameAt + STREAM_HISTORY_WINDOW_MS,
      (uncoveredSinceAt ?? lastFrameAt) + STREAM_HISTORY_MAX_WAIT_MS,
    );
    trailTimer = window.setTimeout(onTrail, Math.max(0, due - Date.now()));
  };

  const onLead = (): void => {
    leadTimer = null;
    const fireAt = Date.now();
    lastFireAt = fireAt;
    uncoveredSinceAt = null;
    refetch(pendingLogin);
    // A frame inside the lag window before this fire may not be readable yet.
    if (lastFrameAt > fireAt - STREAM_HISTORY_LEAD_MS) {
      uncoveredSinceAt = lastFrameAt;
      armTrailing();
    }
  };

  const onCloseFallback = (): void => {
    closeTimer = null;
    if (closeLogin !== null && !hasPendingAckFallback(closeLogin)) refetch(closeLogin);
  };

  const onFrame = (login: number, kind: 'close' | 'order'): void => {
    if (disposed) return;
    const at = Date.now();
    lastFrameAt = at;
    pendingLogin = login;
    if (kind === 'close') {
      closeLogin = login;
      if (closeTimer !== null) window.clearTimeout(closeTimer);
      closeTimer = hasPendingAckFallback(login)
        ? null
        : window.setTimeout(onCloseFallback, STREAM_CLOSE_FALLBACK_MS);
    }
    if (leadTimer !== null) return;
    if (trailTimer === null && at - lastFireAt >= STREAM_HISTORY_WINDOW_MS) {
      leadTimer = window.setTimeout(onLead, STREAM_HISTORY_LEAD_MS);
      return;
    }
    if (uncoveredSinceAt === null) uncoveredSinceAt = at;
    armTrailing();
  };

  const dispose = (): void => {
    const refreshPending = leadTimer !== null || trailTimer !== null;
    const closePending = closeTimer !== null;
    if (leadTimer !== null) window.clearTimeout(leadTimer);
    if (trailTimer !== null) window.clearTimeout(trailTimer);
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    leadTimer = null;
    trailTimer = null;
    closeTimer = null;
    uncoveredSinceAt = null;
    disposed = true;
    if (refreshPending) refetch(pendingLogin);
    else if (closePending && closeLogin !== null && !hasPendingAckFallback(closeLogin)) refetch(closeLogin);
  };

  return { onFrame, dispose };
};

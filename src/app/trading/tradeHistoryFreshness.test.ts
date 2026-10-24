import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  ACK_HISTORY_FALLBACK_MS,
  STREAM_CLOSE_FALLBACK_MS,
  STREAM_HISTORY_LEAD_MS,
  STREAM_HISTORY_MAX_WAIT_MS,
  STREAM_HISTORY_WINDOW_MS,
  bindDefaultHistoryFreshnessOwner,
  createHistoryFreshnessOwner,
  createStreamHistoryCoalescer,
  disposeHistoryFreshnessOwner,
  refreshHistoryAfterFill,
} from './tradeHistoryFreshness';

const LOGIN = 200036;

describe('refreshHistoryAfterFill', () => {
  let refresh: Mock<(login: number) => Promise<void>>;
  let current: boolean;
  let owner: ReturnType<typeof createHistoryFreshnessOwner>;

  beforeEach(() => {
    vi.useFakeTimers();
    refresh = vi.fn((_login: number) => Promise.resolve());
    current = true;
    owner = createHistoryFreshnessOwner(refresh, () => current);
  });

  afterEach(() => {
    disposeHistoryFreshnessOwner(owner);
    vi.useRealTimers();
  });

  it('refetches at once and runs exactly one fallback ACK_HISTORY_FALLBACK_MS later', () => {
    refreshHistoryAfterFill(LOGIN, owner);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenLastCalledWith(LOGIN);

    vi.advanceTimersByTime(ACK_HISTORY_FALLBACK_MS - 1);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(owner.timers.size).toBe(0);

    vi.advanceTimersByTime(ACK_HISTORY_FALLBACK_MS * 4);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('always runs the fallback, even after a stream refetch in the meantime', () => {
    const streamCoalescer = createStreamHistoryCoalescer({ refresh, isCurrent: () => current });
    refreshHistoryAfterFill(LOGIN, owner);

    vi.advanceTimersByTime(100);
    streamCoalescer.onFrame(LOGIN, 'close');
    vi.advanceTimersByTime(ACK_HISTORY_FALLBACK_MS - 100);

    // ACK refetch, the stream's leading refetch, then the ACK fallback.
    expect(refresh).toHaveBeenCalledTimes(3);
    streamCoalescer.dispose();
  });

  it('skips the fallback once the account is no longer current', () => {
    refreshHistoryAfterFill(LOGIN, owner);
    current = false;
    vi.advanceTimersByTime(ACK_HISTORY_FALLBACK_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refetch at the ACK itself when the account already changed, nor later', () => {
    current = false;
    refreshHistoryAfterFill(LOGIN, owner);
    expect(refresh).not.toHaveBeenCalled();

    current = true;
    vi.advanceTimersByTime(ACK_HISTORY_FALLBACK_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('clears a pending fallback when the owner is disposed (unmount)', () => {
    refreshHistoryAfterFill(LOGIN, owner);
    expect(owner.timers.size).toBe(1);
    disposeHistoryFreshnessOwner(owner);
    expect(owner.timers.size).toBe(0);
    vi.advanceTimersByTime(ACK_HISTORY_FALLBACK_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('gives each ACK its own bounded fallback', () => {
    refreshHistoryAfterFill(LOGIN, owner);
    vi.advanceTimersByTime(200);
    refreshHistoryAfterFill(LOGIN, owner);

    // First ACK fallback due at +1500, second at +1700.
    vi.advanceTimersByTime(ACK_HISTORY_FALLBACK_MS - 1);
    expect(refresh).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it('ignores an invalid login', () => {
    refreshHistoryAfterFill(0, owner);
    refreshHistoryAfterFill(Number.NaN, owner);
    vi.advanceTimersByTime(ACK_HISTORY_FALLBACK_MS);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('uses the bound default owner, and unbinding clears its fallbacks', () => {
    const unbind = bindDefaultHistoryFreshnessOwner(owner);
    refreshHistoryAfterFill(LOGIN);
    expect(refresh).toHaveBeenCalledTimes(1);

    unbind();
    vi.advanceTimersByTime(ACK_HISTORY_FALLBACK_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    refreshHistoryAfterFill(LOGIN);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a UI close gives exactly one fallback refetch when the stream close frame arrives after the ACK', () => {
    const streamCoalescer = createStreamHistoryCoalescer({ refresh, isCurrent: () => current });
    refreshHistoryAfterFill(LOGIN, owner);
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    streamCoalescer.onFrame(LOGIN, 'close');
    vi.advanceTimersByTime(STREAM_HISTORY_LEAD_MS);
    expect(refresh).toHaveBeenCalledTimes(2);

    // The ACK fallback is the only fallback: the close fallback was never armed.
    vi.advanceTimersByTime(ACK_HISTORY_FALLBACK_MS);
    expect(refresh).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(STREAM_CLOSE_FALLBACK_MS * 4);
    expect(refresh).toHaveBeenCalledTimes(3);
    streamCoalescer.dispose();
  });

  it('a UI close gives exactly one fallback refetch when the stream close frame arrives before the ACK', () => {
    const streamCoalescer = createStreamHistoryCoalescer({ refresh, isCurrent: () => current });
    streamCoalescer.onFrame(LOGIN, 'close');
    vi.advanceTimersByTime(100);
    refreshHistoryAfterFill(LOGIN, owner);
    expect(refresh).toHaveBeenCalledTimes(2);

    // The stream close fallback (due at +1500 from the frame) defers to the ACK fallback (+1600).
    vi.advanceTimersByTime(STREAM_CLOSE_FALLBACK_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(3);
    streamCoalescer.dispose();
  });
});

describe('createStreamHistoryCoalescer', () => {
  let refresh: Mock<(login: number) => Promise<void>>;
  let current: boolean;
  let coalescer: ReturnType<typeof createStreamHistoryCoalescer>;

  beforeEach(() => {
    vi.useFakeTimers();
    refresh = vi.fn((_login: number) => Promise.resolve());
    current = true;
    coalescer = createStreamHistoryCoalescer({ refresh, isCurrent: (login) => current && login === LOGIN });
  });

  afterEach(() => {
    coalescer.dispose();
    vi.useRealTimers();
  });

  it('refetches once, STREAM_HISTORY_LEAD_MS after the first frame of a burst', () => {
    coalescer.onFrame(LOGIN, 'order');
    vi.advanceTimersByTime(STREAM_HISTORY_LEAD_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenLastCalledWith(LOGIN);

    vi.advanceTimersByTime(STREAM_CLOSE_FALLBACK_MS * 3);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a single close frame gets the leading refetch and one close fallback, then nothing', () => {
    coalescer.onFrame(LOGIN, 'close');
    vi.advanceTimersByTime(STREAM_HISTORY_LEAD_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(STREAM_CLOSE_FALLBACK_MS - STREAM_HISTORY_LEAD_MS - 1);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(STREAM_CLOSE_FALLBACK_MS * 4);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('a burst before the lead fires coalesces into one leading refetch', () => {
    coalescer.onFrame(LOGIN, 'order');
    coalescer.onFrame(LOGIN, 'order');
    coalescer.onFrame(LOGIN, 'order');
    vi.advanceTimersByTime(STREAM_HISTORY_LEAD_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(STREAM_HISTORY_WINDOW_MS * 4);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a frame inside the lag window before the lead fires re-arms one trailing refetch after the last frame', () => {
    coalescer.onFrame(LOGIN, 'order');
    vi.advanceTimersByTime(30);
    coalescer.onFrame(LOGIN, 'order');
    vi.advanceTimersByTime(STREAM_HISTORY_LEAD_MS - 30);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Last frame at +30, so the trailing refetch is due at +280.
    vi.advanceTimersByTime(STREAM_HISTORY_WINDOW_MS - 21);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('a tail frame at +245 ms after a leading refetch gets a later refetch 250 ms after it', () => {
    coalescer.onFrame(LOGIN, 'order');
    vi.advanceTimersByTime(245);
    expect(refresh).toHaveBeenCalledTimes(1);

    coalescer.onFrame(LOGIN, 'order');
    vi.advanceTimersByTime(STREAM_HISTORY_WINDOW_MS - 1);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('frames every 100 ms are capped to a refetch each second, then one final refetch 250 ms after the last frame', () => {
    const refetchTimes: number[] = [];
    refresh.mockImplementation(() => {
      refetchTimes.push(Date.now());
      return Promise.resolve();
    });
    const start = Date.now();
    coalescer.onFrame(LOGIN, 'order');
    for (let at = 100; at <= 3000; at += 100) {
      vi.advanceTimersByTime(at - (Date.now() - start));
      coalescer.onFrame(LOGIN, 'order');
    }
    const lastFrame = start + 3000;

    // Steady frames never starve the trailing refetch: at least one refetch per ~1 s.
    vi.advanceTimersByTime(STREAM_HISTORY_WINDOW_MS * 2);
    expect(refetchTimes.length).toBeGreaterThanOrEqual(4);
    const gaps = refetchTimes.slice(1).map((time, index) => time - refetchTimes[index]);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(STREAM_HISTORY_MAX_WAIT_MS + 100);
    expect(refetchTimes.slice(-1)[0]).toBe(lastFrame + STREAM_HISTORY_WINDOW_MS);
  });

  it('frames every 100 ms: the trailing refetch waits at most STREAM_HISTORY_MAX_WAIT_MS after the first uncovered frame', () => {
    // Lead at +50 covers frame 0. Frames 60..960 then push the trailing wait; the cap sets it at 60 + 1000.
    coalescer.onFrame(LOGIN, 'order');
    vi.advanceTimersByTime(60);
    for (let at = 60; at <= 960; at += 100) {
      if (at > 60) vi.advanceTimersByTime(100);
      coalescer.onFrame(LOGIN, 'order');
    }
    vi.advanceTimersByTime(1060 - 961);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(2);

    // The capped refetch left the last frame (960) inside its quiet window: one final refetch at 960 + 250 = 1210.
    vi.advanceTimersByTime(960 + STREAM_HISTORY_WINDOW_MS - 1060 - 1);
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(STREAM_HISTORY_WINDOW_MS * 4);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('does not refetch for a login that is no longer current when the timer fires', () => {
    coalescer.onFrame(LOGIN, 'close');
    current = false;
    vi.advanceTimersByTime(STREAM_CLOSE_FALLBACK_MS * 2);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('flushes one pending refetch on dispose when the login is still current', () => {
    coalescer.onFrame(LOGIN, 'close');
    coalescer.dispose();
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(STREAM_CLOSE_FALLBACK_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not flush on dispose when the account changed or nothing was pending', () => {
    coalescer.onFrame(LOGIN, 'order');
    current = false;
    coalescer.dispose();
    expect(refresh).not.toHaveBeenCalled();

    const idle = createStreamHistoryCoalescer({ refresh, isCurrent: () => true });
    idle.dispose();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('ignores frames after dispose', () => {
    coalescer.dispose();
    coalescer.onFrame(LOGIN, 'close');
    vi.advanceTimersByTime(STREAM_CLOSE_FALLBACK_MS * 2);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a login switch mid-window refetches only the new login', () => {
    let live = LOGIN;
    const switching = createStreamHistoryCoalescer({ refresh, isCurrent: (login) => login === live });
    switching.onFrame(LOGIN, 'order');
    vi.advanceTimersByTime(10);
    live = LOGIN + 1;
    vi.advanceTimersByTime(STREAM_HISTORY_LEAD_MS - 10);
    expect(refresh).not.toHaveBeenCalled();

    switching.onFrame(LOGIN + 1, 'order');
    vi.advanceTimersByTime(STREAM_HISTORY_WINDOW_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenLastCalledWith(LOGIN + 1);
    switching.dispose();
  });
});

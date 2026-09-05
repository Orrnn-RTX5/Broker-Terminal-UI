import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSymbolMarketStatus } from './useSymbolMarketStatus';

const getSymbolStatus = vi.hoisted(() => vi.fn());

vi.mock('../api/trade', () => ({
  marketV2Api: {
    getSymbolStatus,
  },
}));

const setVisibility = (visibilityState: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: visibilityState,
  });
};

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('useSymbolMarketStatus polling lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getSymbolStatus.mockReset();
    getSymbolStatus.mockImplementation(async (symbol: string) => ({ symbol, status: 'open' }));
    setVisibility('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('clamps a positive visible poll interval to at least one second', async () => {
    const { unmount } = renderHook(() => useSymbolMarketStatus('POLL-FLOOR', { pollMs: 10 }));
    await flushPromises();

    expect(getSymbolStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(999);
      await Promise.resolve();
    });
    expect(getSymbolStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(getSymbolStatus).toHaveBeenCalledTimes(2);

    unmount();
  });

  it('pauses while hidden and refreshes once when the document returns to foreground', async () => {
    setVisibility('hidden');
    const { unmount } = renderHook(() => useSymbolMarketStatus('VISIBILITY-LIFECYCLE', { pollMs: 100 }));
    await flushPromises();

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(getSymbolStatus).not.toHaveBeenCalled();

    await act(async () => {
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getSymbolStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(999);
      await Promise.resolve();
    });
    expect(getSymbolStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(getSymbolStatus).toHaveBeenCalledTimes(2);

    unmount();
  });
});

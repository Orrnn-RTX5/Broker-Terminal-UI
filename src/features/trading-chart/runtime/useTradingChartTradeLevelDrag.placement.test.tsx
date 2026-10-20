// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTradingChartTradeLevelDrag } from './useTradingChartTradeLevelDrag';

const { modifyPosition } = vi.hoisted(() => ({ modifyPosition: vi.fn(() => new Promise(() => undefined)) }));
vi.mock('../../../services/api', () => ({ default: { positions: { modifyPosition } } }));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => ({ positions: [], accountId: 123 }) } }));
vi.mock('../../../utils/tradeHistoryLevelCache', () => ({ rememberTradeHistoryPositionLevels: vi.fn() }));

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function harness(role: 'SL' | 'TP' | 'ENTRY', offset: number, docked = false) {
  const wrapper = document.createElement('div');
  wrapper.className = 'rtx-chart-wrapper';
  const container = document.createElement('div');
  const overlay = document.createElement('div');
  const bar = document.createElement('div');
  bar.className = 'rtx-trade-controls rtx-trade-level-badge';
  bar.dataset.tradeKey = 'trade:987';
  bar.dataset.role = docked ? 'ENTRY' : role;
  bar.dataset.priceAnchorOffsetY = String(offset);
  bar.dataset.priceAnchorY = String(docked || role === 'ENTRY' ? 100 : role === 'SL' ? 150 : 50);
  const target = docked ? document.createElement('div') : bar;
  if (docked) {
    target.className = 'rtx-trade-level-badge rtx-trade-dock-chip';
    target.dataset.tradeKey = 'trade:987';
    target.dataset.role = role;
    bar.appendChild(target);
  }
  wrapper.append(container, overlay, bar);
  document.body.append(wrapper);
  const capturedPointers = new Set<number>();
  wrapper.setPointerCapture = vi.fn((id: number) => { capturedPointers.add(id); });
  wrapper.hasPointerCapture = vi.fn((id: number) => capturedPointers.has(id));
  wrapper.releasePointerCapture = vi.fn((id: number) => { capturedPointers.delete(id); });
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 500, left: 0, right: 800, width: 800, height: 400 } as DOMRect);
  const coordinateToPrice = vi.fn((y: number) => 1000 - y);
  const priceToCoordinate = vi.fn((price: number) => 1000 - price);
  const ref = <T,>(current: T) => ({ current });
  const trade = {
    key: 'trade:987', symbol: 'XAUUSD', side: 'BUY' as const, volume: 1,
    entryPrice: 900, currentPrice: 900, entryTime: 1000, entryExecutionTime: 1000, currentTime: 1100,
    sl: 850, tp: 950,
  };
  const options = {
    activeToolRef: ref(null), activeTradeSnapshotsRef: ref(new Map([[trade.key, trade]])),
    brokerAccountSessionScope: 'test-only', chartRef: ref({ applyOptions: vi.fn() }),
    chartSettingsRef: ref({ showTradeLevels: true }), containerRef: ref(container), isActive: true,
    isChartInteractionActiveRef: ref(false), isChartSurfaceLight: () => true, overlayRef: ref(overlay),
    pendingTradeLevelModifyRequestsRef: ref(new Map()), persistTradeLevelOverrides: vi.fn(),
    resolvedPriceDigitsRef: ref(2),
    seriesRef: ref({ coordinateToPrice, priceToCoordinate, priceScale: () => ({ width: () => 60 }) }),
    tr: <T,>(source: T) => source, tradeAllowed: true,
    tradeLevelLastKnownLevelsRef: ref(new Map()), tradeLevelModifyRequestSeqRef: ref(0),
    tradeLevelOptimisticGraceUntilRef: ref(new Map()), tradeLevelOverridesRef: ref(new Map()),
  } as unknown as Parameters<typeof useTradingChartTradeLevelDrag>[0];
  const hook = renderHook(() => useTradingChartTradeLevelDrag(options));
  const send = (type: string, y: number, eventTarget: HTMLElement | Window = window, pointerId = 1, clientX = 0) => {
    const event = new MouseEvent(type, { clientX, clientY: y + 100 + offset, button: 0, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    act(() => { eventTarget.dispatchEvent(event); });
    return event;
  };
  return { bar, target, send, coordinateToPrice, priceToCoordinate, wrapper, container, overlay, options, trade, ...hook };
}

describe('displaced trade control gestures', () => {
  it.each([
    ['ENTRY', 100, 740], ['ENTRY', 100, 780],
    ['SL', 150, 740], ['SL', 150, 780],
    ['TP', 50, 740], ['TP', 50, 780],
  ] as const)('leaves a price-axis drag aligned with %s at y=%s to the chart at x=%s', (role, startY, x) => {
    const h = harness(role, 0);
    const axisCanvas = document.createElement('canvas');
    h.container.appendChild(axisCanvas);
    const chartPointerDown = vi.fn();
    axisCanvas.addEventListener('pointerdown', chartPointerDown);

    const down = h.send('pointerdown', startY, axisCanvas, 1, x);
    h.send('pointermove', startY - 14, window, 1, x);
    h.send('pointerup', startY - 14, window, 1, x);

    expect(modifyPosition).not.toHaveBeenCalled();
    expect(down.defaultPrevented).toBe(false);
    expect(chartPointerDown).toHaveBeenCalledOnce();
    expect(h.wrapper.setPointerCapture).not.toHaveBeenCalled();
    expect(h.options.chartRef.current?.applyOptions).not.toHaveBeenCalled();
    expect(h.options.tradeLevelOverridesRef.current.size).toBe(0);
    expect(h.options.pendingTradeLevelModifyRequestsRef.current.size).toBe(0);
    expect(h.overlay.children).toHaveLength(0);
  });

  it.each([
    ['ENTRY', 100], ['SL', 150], ['TP', 50],
  ] as const)('keeps the normal cursor across the %s line and price axis', (role, levelY) => {
    const h = harness(role, 0);
    const canvas = document.createElement('canvas');
    h.container.appendChild(canvas);
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame');

    for (const x of [10, 300, 739, 740, 780]) {
      h.send('pointermove', levelY, canvas, 1, x);
      expect(h.container.style.cursor).not.toBe('grab');
      expect(h.wrapper.style.cursor).not.toBe('grab');
      expect(canvas.style.cursor).not.toBe('grab');
      expect(document.body.style.cursor).not.toBe('grab');
    }
    expect(requestFrame).not.toHaveBeenCalled();
    expect(modifyPosition).not.toHaveBeenCalled();
  });

  it('keeps an explicit ticket control draggable independently of the canvas price-axis boundary', () => {
    const h = harness('SL', 0);
    h.send('pointerdown', 150, h.target, 1, 780);
    h.send('pointermove', 157, window, 1, 780);
    h.send('pointerup', 157, window, 1, 780);
    expect(modifyPosition).toHaveBeenCalledExactlyOnceWith(987, { price_sl: 843 });
  });

  it.each([-42, 58])('keeps SL preview and committed price identical with offset %s', offset => {
    const h = harness('SL', offset);
    h.send('pointerdown', 150, h.target);
    h.bar.dataset.priceAnchorOffsetY = '999';
    h.send('pointermove', 157);
    expect(h.coordinateToPrice).toHaveBeenLastCalledWith(157);
    h.send('pointerup', 157);
    expect(modifyPosition).toHaveBeenCalledExactlyOnceWith(987, { price_sl: 843 });
  });

  it('keeps an upward entry gesture a TP when the bar was moved below the entry line', () => {
    const h = harness('ENTRY', 58);
    h.send('pointerdown', 100, h.target);
    h.send('pointermove', 93);
    h.send('pointerup', 93);
    expect(modifyPosition).toHaveBeenCalledExactlyOnceWith(987, { price_tp: 907 });
  });

  it('reads the parent entry-strip offset for its nested bracket shortcut', () => {
    const h = harness('TP', 58, true);
    h.send('pointerdown', 100, h.target);
    h.send('pointermove', 93);
    h.send('pointerup', 93);
    expect(modifyPosition).toHaveBeenCalledExactlyOnceWith(987, { price_tp: 907 });
  });

  it('does not turn a click on a displaced level into a modification', () => {
    const h = harness('SL', 58);
    h.send('pointerdown', 150, h.target);
    h.send('pointerup', 150);
    expect(modifyPosition).not.toHaveBeenCalled();
  });

  it('starts at the price anchor when grabbing the upper edge of a wrapped bar', () => {
    const h = harness('SL', 58);
    h.send('pointerdown', 138, h.target);
    h.send('pointermove', 145);
    h.send('pointerup', 145);
    expect(modifyPosition).toHaveBeenCalledExactlyOnceWith(987, { price_sl: 843 });
  });

  it('keeps a level visible until the existing drag threshold is crossed', () => {
    const h = harness('SL', 0);
    h.send('pointerdown', 150, h.target);
    expect(h.bar.style.visibility).not.toBe('hidden');
    h.send('pointermove', 153);
    expect(h.bar.style.visibility).not.toBe('hidden');
    h.send('pointermove', 154);
    expect(h.bar.style.visibility).toBe('hidden');
    h.send('pointercancel', 154);
    expect(h.bar.style.visibility).not.toBe('hidden');
    expect(modifyPosition).not.toHaveBeenCalled();
  });

  it.each(['pointercancel', 'lostpointercapture', 'blur', 'visibilitychange'])('restores the level and cancels without submitting on %s', interruption => {
    const h = harness('SL', 0);
    h.send('pointerdown', 150, h.target);
    h.send('pointermove', 157);
    expect(h.bar.style.visibility).toBe('hidden');
    expect(document.body.style.cursor).toBe('grabbing');

    if (interruption === 'visibilitychange') {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      act(() => document.dispatchEvent(new Event('visibilitychange')));
    } else if (interruption === 'blur') {
      act(() => window.dispatchEvent(new Event('blur')));
    } else {
      h.send(interruption, 157, h.wrapper);
    }

    expect(h.bar.style.visibility).not.toBe('hidden');
    expect(h.overlay.children).toHaveLength(0);
    expect(document.body.style.cursor).not.toBe('grabbing');
    expect(document.body.style.userSelect).not.toBe('none');
    expect(h.wrapper.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(h.options.chartRef.current?.applyOptions).toHaveBeenLastCalledWith(expect.objectContaining({
      handleScroll: expect.objectContaining({ pressedMouseMove: true }),
    }));
    h.send('pointerup', 157);
    expect(modifyPosition).not.toHaveBeenCalled();
  });

  it('captures on the stable chart wrapper so replacing a level does not remove the capture owner', () => {
    const h = harness('SL', 0);
    h.send('pointerdown', 150, h.target);
    expect(h.wrapper.setPointerCapture).toHaveBeenCalledWith(1);
    h.bar.remove();
    h.send('pointermove', 157);
    h.send('pointerup', 157);
    expect(modifyPosition).toHaveBeenCalledExactlyOnceWith(987, { price_sl: 843 });
    expect(h.wrapper.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it('cancels an abandoned gesture before a repeated down from the same pointer', () => {
    const h = harness('SL', 0);
    h.send('pointerdown', 150, h.target);
    h.send('pointermove', 157);
    h.send('pointerdown', 150, h.container);
    expect(h.bar.style.visibility).not.toBe('hidden');
    expect(h.overlay.children).toHaveLength(3);
    h.send('pointerup', 150);
    expect(h.overlay.children).toHaveLength(0);
    expect(modifyPosition).not.toHaveBeenCalled();
  });

  it.each([false, true])('ignores another pointer throughout a gesture when capture fails: %s', captureFails => {
    const h = harness('SL', 0);
    if (captureFails) h.wrapper.setPointerCapture = vi.fn(() => { throw new Error('Capture unavailable'); });
    h.send('pointerdown', 150, h.target);
    h.send('pointermove', 157);
    h.send('pointerdown', 150, h.target, 2);
    h.send('pointermove', 180, window, 2);
    h.send('pointerup', 180, window, 2);
    h.send('pointercancel', 180, window, 2);
    h.send('lostpointercapture', 180, h.wrapper, 2);
    expect(h.bar.style.visibility).toBe('hidden');
    expect(h.overlay.children).toHaveLength(3);
    expect(modifyPosition).not.toHaveBeenCalled();
    h.send('pointerup', 157);
    expect(modifyPosition).toHaveBeenCalledExactlyOnceWith(987, { price_sl: 843 });
  });

  it('uses the hit-area ticket instead of another position at the same price', () => {
    const h = harness('SL', 0);
    h.options.activeTradeSnapshotsRef.current = new Map([
      [h.trade.key, h.trade],
      ['trade:999', { ...h.trade, key: 'trade:999' }],
    ]);
    const hitArea = document.createElement('div');
    hitArea.className = 'rtx-trade-level-hit-area';
    hitArea.dataset.tradeKey = h.trade.key;
    hitArea.dataset.role = 'SL';
    h.wrapper.appendChild(hitArea);
    h.send('pointerdown', 150, hitArea);
    h.send('pointermove', 157);
    h.send('pointerup', 157);
    expect(modifyPosition).toHaveBeenCalledExactlyOnceWith(987, { price_sl: 843 });
  });

  it.each(['BUY', 'SELL'] as const)('does not choose a ticket from a shared entry line with another %s position', side => {
    const h = harness('ENTRY', 0);
    // A nearby SL must not become an accidental fallback for the shared line.
    h.options.activeTradeSnapshotsRef.current.set('trade:999', { ...h.trade, key: 'trade:999', side, sl: 899 });
    h.send('pointerdown', 100, h.container);
    h.send('pointermove', 93);
    h.send('pointerup', 93);
    expect(h.wrapper.setPointerCapture).not.toHaveBeenCalled();
    expect(h.overlay.children).toHaveLength(0);
    expect(h.bar.style.visibility).not.toBe('hidden');
    expect(modifyPosition).not.toHaveBeenCalled();
    expect(h.options.tradeLevelOverridesRef.current.size).toBe(0);
  });

  it.each([987, 999])('keeps an exact-ticket entry bar draggable at a shared price: %s', ticket => {
    const h = harness('ENTRY', 0);
    h.options.activeTradeSnapshotsRef.current.set('trade:999', { ...h.trade, key: 'trade:999' });
    h.bar.dataset.tradeKey = `trade:${ticket}`;
    h.send('pointerdown', 100, h.target);
    h.send('pointermove', 93);
    h.send('pointerup', 93);
    expect(modifyPosition).toHaveBeenCalledExactlyOnceWith(ticket, { price_tp: 907 });
  });

  it('drags only the targeted overlapping entry bar after the price scale expands', () => {
    // A 26px ENTRY bar has its center 17px above the true price (13px + 4px gap).
    const h = harness('ENTRY', -17);
    const otherTrade = { ...h.trade, key: 'trade:999', sl: 840, tp: 960 };
    const untouchedTrade = { ...h.trade };
    h.options.activeTradeSnapshotsRef.current.set(otherTrade.key, otherTrade);

    // Simulate the updated inverse transforms and anchors after a price-axis zoom.
    h.priceToCoordinate.mockImplementation(price => (1000 - price) * 2);
    h.coordinateToPrice.mockImplementation(y => 1000 - y / 2);
    const entryY = h.priceToCoordinate(otherTrade.entryPrice);
    h.bar.dataset.priceAnchorY = String(entryY);
    h.bar.style.cssText = `height:26px;top:${entryY - 17}px;transform:translateY(-50%);`;
    const otherBar = h.bar.cloneNode(false) as HTMLElement;
    otherBar.dataset.tradeKey = otherTrade.key;
    h.wrapper.appendChild(otherBar);

    h.send('pointerdown', entryY, otherBar);
    h.send('pointermove', entryY - 14);
    expect(h.coordinateToPrice).toHaveBeenLastCalledWith(186);
    const preview = h.overlay.querySelector<HTMLElement>('.rtx-trade-drag-price-badge');
    expect(preview?.textContent).toContain('TP 907.00');
    expect(preview?.style.transform).toBe('translateY(calc(-50% + 186px))');
    h.send('pointerup', entryY - 14);

    expect(modifyPosition).toHaveBeenCalledExactlyOnceWith(999, { price_tp: 907 });
    expect(h.options.tradeLevelOverridesRef.current.get(otherTrade.key)).toEqual({ sl: 840, tp: 907 });
    expect([...h.options.pendingTradeLevelModifyRequestsRef.current.keys()]).toEqual([otherTrade.key]);
    expect(h.options.activeTradeSnapshotsRef.current.get(h.trade.key)).toEqual(untouchedTrade);
    expect(h.options.tradeLevelOverridesRef.current.has(h.trade.key)).toBe(false);
    expect(h.options.tradeLevelLastKnownLevelsRef.current.has(h.trade.key)).toBe(false);
    expect(h.options.tradeLevelOptimisticGraceUntilRef.current.has(h.trade.key)).toBe(false);
    expect(h.bar.style.visibility).not.toBe('hidden');
  });

  it('keeps distinct exact entry prices eligible even when they format to the same label', () => {
    const h = harness('ENTRY', 0);
    h.options.activeTradeSnapshotsRef.current.set('trade:999', { ...h.trade, key: 'trade:999', entryPrice: 900.001 });
    h.send('pointerdown', 100, h.container);
    h.send('pointermove', 93);
    h.send('pointerup', 93);
    expect(modifyPosition).toHaveBeenCalledExactlyOnceWith(987, { price_tp: 907 });
  });

  it.each(['SL', 'TP'] as const)('keeps a unique %s fallback selectable when the trades share an entry price', role => {
    const h = harness(role, 0);
    h.options.activeTradeSnapshotsRef.current.set('trade:999', { ...h.trade, key: 'trade:999', sl: 800, tp: 980 });
    const start = role === 'SL' ? 150 : 50;
    const end = role === 'SL' ? 157 : 43;
    h.send('pointerdown', start, h.container);
    h.send('pointermove', end);
    h.send('pointerup', end);
    expect(modifyPosition).toHaveBeenCalledExactlyOnceWith(987, role === 'SL' ? { price_sl: 843 } : { price_tp: 957 });
  });

  it('does not drag another position when the hit-area ticket is no longer live', () => {
    const h = harness('SL', 0);
    h.options.activeTradeSnapshotsRef.current = new Map([
      ['trade:999', { ...h.trade, key: 'trade:999' }],
    ]);
    const hitArea = document.createElement('div');
    hitArea.className = 'rtx-trade-level-hit-area';
    hitArea.dataset.tradeKey = h.trade.key;
    hitArea.dataset.role = 'SL';
    h.wrapper.appendChild(hitArea);
    h.send('pointerdown', 150, hitArea);
    h.send('pointermove', 157);
    h.send('pointerup', 157);
    expect(h.wrapper.setPointerCapture).not.toHaveBeenCalled();
    expect(modifyPosition).not.toHaveBeenCalled();
  });

  it('preserves double-click modification without hiding the level or submitting a trade', () => {
    const h = harness('SL', 0);
    const onModify = vi.fn();
    window.addEventListener('rtx:chart-position-modify', onModify);
    try {
      for (let click = 0; click < 2; click += 1) {
        h.send('pointerdown', 150, h.target);
        expect(h.bar.style.visibility).not.toBe('hidden');
        h.send('pointerup', 150);
      }
      expect(onModify).toHaveBeenCalledOnce();
      expect(onModify.mock.calls[0][0].detail).toEqual({ ticket: 987, symbol: 'XAUUSD', sessionScope: 'test-only' });
      expect(modifyPosition).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('rtx:chart-position-modify', onModify);
    }
  });

  it.each(['coordinate conversion', 'synchronous submission'])('restores controls even when %s throws during release', failure => {
    const h = harness('SL', 0);
    h.send('pointerdown', 150, h.target);
    h.send('pointermove', 157);
    const error = new Error(`Failed ${failure}`);
    if (failure === 'coordinate conversion') h.coordinateToPrice.mockImplementationOnce(() => { throw error; });
    else modifyPosition.mockImplementationOnce(() => { throw error; });
    const onError = vi.fn((event: ErrorEvent) => { event.preventDefault(); });
    window.addEventListener('error', onError);
    try {
      h.send('pointerup', 157);
      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0][0].error).toBe(error);
      expect(h.bar.style.visibility).not.toBe('hidden');
      expect(h.overlay.children).toHaveLength(0);
      expect(document.body.style.cursor).not.toBe('grabbing');
      expect(h.wrapper.releasePointerCapture).toHaveBeenCalledWith(1);
      expect(modifyPosition).toHaveBeenCalledTimes(failure === 'coordinate conversion' ? 0 : 1);
    } finally {
      window.removeEventListener('error', onError);
    }
  });

  it('cancels an active gesture and removes interruption listeners on unmount', () => {
    const h = harness('SL', 0);
    h.send('pointerdown', 150, h.target);
    h.send('pointermove', 157);
    h.unmount();
    expect(h.bar.style.visibility).not.toBe('hidden');
    expect(h.overlay.children).toHaveLength(0);
    expect(document.body.style.cursor).not.toBe('grabbing');
    const applyCount = vi.mocked(h.options.chartRef.current!.applyOptions).mock.calls.length;
    act(() => window.dispatchEvent(new Event('blur')));
    h.send('pointerup', 157);
    expect(h.options.chartRef.current?.applyOptions).toHaveBeenCalledTimes(applyCount);
    expect(modifyPosition).not.toHaveBeenCalled();
  });

  it.each([
    ['SL', 'pending'], ['SL', 'grace'], ['TP', 'pending'], ['TP', 'grace'],
    ['SL', 'expired grace'], ['TP', 'expired grace'],
  ] as const)('resolves %s removal during %s when dragging the other level', (removedRole, windowKind) => {
    const h = harness(removedRole === 'SL' ? 'TP' : 'SL', 0);
    h.options.tradeLevelOverridesRef.current.set(h.trade.key, {
      sl: removedRole === 'SL' ? 0 : 850,
      tp: removedRole === 'TP' ? 0 : 950,
    });
    if (windowKind === 'pending') h.options.pendingTradeLevelModifyRequestsRef.current.set(h.trade.key, 10);
    else h.options.tradeLevelOptimisticGraceUntilRef.current.set(h.trade.key, Date.now() + (windowKind === 'grace' ? 10_000 : -1));
    const onModified = vi.fn();
    window.addEventListener('rtx:trade-modified', onModified);
    try {
      h.send('pointerdown', removedRole === 'SL' ? 50 : 150, h.target);
      h.send('pointermove', removedRole === 'SL' ? 43 : 157);
      h.send('pointerup', removedRole === 'SL' ? 43 : 157);
      if (windowKind === 'pending') {
        expect(modifyPosition).not.toHaveBeenCalled();
        expect(onModified).not.toHaveBeenCalled();
        expect(h.wrapper.setPointerCapture).not.toHaveBeenCalled();
        expect(h.bar.style.visibility).not.toBe('hidden');
        expect(h.options.tradeLevelOverridesRef.current.get(h.trade.key)).toEqual({
          sl: removedRole === 'SL' ? 0 : 850,
          tp: removedRole === 'TP' ? 0 : 950,
        });
        return;
      }
      const expectedLevels = removedRole === 'SL'
        ? { sl: windowKind === 'expired grace' ? 850 : 0, tp: 957 }
        : { sl: 843, tp: windowKind === 'expired grace' ? 950 : 0 };
      expect(h.options.tradeLevelOverridesRef.current.get(h.trade.key)).toEqual(expectedLevels);
      expect(onModified).toHaveBeenCalledOnce();
      expect(onModified.mock.calls[0][0].detail).toEqual({
        id: 987, symbol: 'XAUUSD', sessionScope: 'test-only', ...expectedLevels,
      });
      expect(modifyPosition).toHaveBeenCalledExactlyOnceWith(987, removedRole === 'SL' ? { price_tp: 957 } : { price_sl: 843 });
    } finally {
      window.removeEventListener('rtx:trade-modified', onModified);
    }
  });

  it.each(['SL', 'TP'] as const)('blocks the other role during a pending %s drag without blocking another ticket', async firstRole => {
    const h = harness(firstRole, 0);
    let rejectFirst!: (reason: Error) => void;
    modifyPosition.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onFeedback = vi.fn();
    window.addEventListener('rtx:order-feedback', onFeedback);
    try {
      const start = firstRole === 'SL' ? 150 : 50;
      const end = firstRole === 'SL' ? 157 : 43;
      h.send('pointerdown', start, h.target);
      h.send('pointermove', end);
      h.send('pointerup', end);
      const optimistic = firstRole === 'SL' ? { sl: 843, tp: 950 } : { sl: 850, tp: 957 };

      const otherStart = firstRole === 'SL' ? 50 : 150;
      h.bar.dataset.role = firstRole === 'SL' ? 'TP' : 'SL';
      h.bar.dataset.priceAnchorY = String(otherStart);
      h.send('pointerdown', otherStart, h.target);
      h.send('pointermove', otherStart + 7);
      expect(h.bar.style.visibility).not.toBe('hidden');
      expect(h.overlay.children).toHaveLength(0);
      h.send('pointerup', otherStart + 7);
      expect(modifyPosition).toHaveBeenCalledTimes(1);
      expect(h.wrapper.setPointerCapture).toHaveBeenCalledTimes(1);
      expect(h.options.tradeLevelOverridesRef.current.get(h.trade.key)).toEqual(optimistic);
      expect(onFeedback.mock.calls[0][0].detail).toEqual({ message: 'Modify Position: Processing...', type: 'error' });

      const otherTrade = { ...h.trade, key: 'trade:999' };
      h.options.activeTradeSnapshotsRef.current.set(otherTrade.key, otherTrade);
      const otherTarget = document.createElement('div');
      otherTarget.className = 'rtx-trade-level-badge';
      otherTarget.dataset.tradeKey = otherTrade.key;
      otherTarget.dataset.role = 'TP';
      h.wrapper.appendChild(otherTarget);
      h.send('pointerdown', 50, otherTarget);
      h.send('pointermove', 43);
      h.send('pointerup', 43);
      expect(modifyPosition).toHaveBeenNthCalledWith(2, 999, { price_tp: 957 });

      await act(async () => { rejectFirst(new Error('The first protection change was rejected')); });
      expect(h.options.tradeLevelOverridesRef.current.get(h.trade.key)).toEqual({ sl: 850, tp: 950 });
      expect(h.options.tradeLevelOverridesRef.current.get(otherTrade.key)).toEqual({ sl: 850, tp: 957 });
      expect(h.options.pendingTradeLevelModifyRequestsRef.current.has(h.trade.key)).toBe(false);
      expect(h.options.pendingTradeLevelModifyRequestsRef.current.has(otherTrade.key)).toBe(true);

      h.send('pointerdown', otherStart, h.target);
      h.send('pointermove', otherStart + 7);
      h.send('pointerup', otherStart + 7);
      expect(modifyPosition).toHaveBeenCalledTimes(3);
    } finally {
      window.removeEventListener('rtx:order-feedback', onFeedback);
    }
  });

  it('cancels a release cleanly when another chart control starts a request during the gesture', () => {
    const h = harness('SL', 0);
    h.send('pointerdown', 150, h.target);
    h.send('pointermove', 157);
    expect(h.bar.style.visibility).toBe('hidden');
    h.options.pendingTradeLevelModifyRequestsRef.current.set(h.trade.key, 10);
    h.options.tradeLevelOverridesRef.current.set(h.trade.key, { sl: 850, tp: 0 });
    h.send('pointerup', 157);
    expect(modifyPosition).not.toHaveBeenCalled();
    expect(h.options.tradeLevelOverridesRef.current.get(h.trade.key)).toEqual({ sl: 850, tp: 0 });
    expect(h.options.pendingTradeLevelModifyRequestsRef.current.get(h.trade.key)).toBe(10);
    expect(h.bar.style.visibility).not.toBe('hidden');
    expect(h.overlay.children).toHaveLength(0);
    expect(document.body.style.cursor).not.toBe('grabbing');
    expect(h.wrapper.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it.each([false, true])('publishes rejected-level rollback only while the request is current (superseded: %s)', async superseded => {
    const h = harness('SL', 0);
    let rejectRequest!: (reason: Error) => void;
    modifyPosition.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onModified = vi.fn();
    const onFeedback = vi.fn();
    window.addEventListener('rtx:trade-modified', onModified);
    window.addEventListener('rtx:order-feedback', onFeedback);
    try {
      h.send('pointerdown', 150, h.target);
      h.send('pointermove', 157);
      h.send('pointerup', 157);
      expect(h.options.tradeLevelOverridesRef.current.get(h.trade.key)).toEqual({ sl: 843, tp: 950 });
      if (superseded) {
        // An ownership replacement must still fence a delayed old callback.
        h.options.pendingTradeLevelModifyRequestsRef.current.set(h.trade.key, 2);
        h.options.tradeLevelOverridesRef.current.set(h.trade.key, { sl: 840, tp: 950 });
        h.options.tradeLevelLastKnownLevelsRef.current.set(h.trade.key, { sl: 840, tp: 950 });
      }
      await act(async () => { rejectRequest(new Error('Broker rejected stop level')); });

      const expectedLevels = superseded ? { sl: 840, tp: 950 } : { sl: 850, tp: 950 };
      expect(h.options.tradeLevelOverridesRef.current.get(h.trade.key)).toEqual(expectedLevels);
      expect(h.options.tradeLevelLastKnownLevelsRef.current.get(h.trade.key)).toEqual(expectedLevels);
      expect(onModified).toHaveBeenCalledTimes(superseded ? 1 : 2);
      expect(onFeedback).toHaveBeenCalledTimes(superseded ? 0 : 1);
      if (!superseded) {
        expect(onModified.mock.calls[1][0].detail).toEqual({
          id: 987, symbol: 'XAUUSD', sessionScope: 'test-only', ...expectedLevels,
        });
        // Non-geometry errors route through formatOrderError (informative,
        // never a bare generic); the feedback purpose is unchanged.
        expect(onFeedback.mock.calls[0][0].detail).toEqual({ message: 'Order failed: Broker rejected stop level', type: 'error' });
        expect(h.options.pendingTradeLevelModifyRequestsRef.current.has(h.trade.key)).toBe(false);
        expect(h.options.tradeLevelOptimisticGraceUntilRef.current.has(h.trade.key)).toBe(false);
      }
    } finally {
      window.removeEventListener('rtx:trade-modified', onModified);
      window.removeEventListener('rtx:order-feedback', onFeedback);
    }
  });
});

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChartCursorStore } from '../store/useChartCursorStore';
import {
  VALUES_TOOLTIP_HOLD_MS,
  VALUES_TOOLTIP_MOVE_THRESHOLD_PX,
  buildChartValuesTooltip,
  installChartValuesTooltip,
  nearestCandle,
} from './chartValuesTooltip';
import type { Candle } from '../types/chart';

const candle = (time: number, open: number, close: number, volume = 20): Candle => ({
  time, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume,
});

describe('long-press values tooltip', () => {
  afterEach(() => {
    document.body.replaceChildren();
    useChartCursorStore.setState({ mode: 'arrow', valuesTooltipOnLongPress: true });
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('snaps a coordinate time to the nearest bar and formats its values', () => {
    const candles = [candle(100, 10, 11, 1500), candle(200, 11, 9)];
    expect(nearestCandle(candles, 140)?.time).toBe(100);
    expect(nearestCandle(candles, 160)?.time).toBe(200);
    const model = buildChartValuesTooltip({
      symbol: 'XAUUSD',
      timeframe: 'M1',
      digits: 2,
      candles,
      clientX: 40,
      chartLeft: 10,
      coordinateToTime: () => 200,
      indicatorRows: () => [{ label: 'RSI', value: 55.5, color: '#336699' }, { label: 'Bad', value: 1, color: 'red' }],
    });
    expect(model?.title).toBe('XAUUSD');
    expect(model?.subtitle).toContain('00:03:20');
    expect(model?.lines.find((line) => line.label === 'Close')).toMatchObject({ value: '9.00', tone: 'down' });
    expect(model?.lines.at(-2)).toMatchObject({ label: 'RSI', value: '55.50', color: '#336699' });
    expect(model?.lines.at(-1)).toMatchObject({ label: 'Bad', color: undefined });
    expect(buildChartValuesTooltip({
      symbol: 'XAUUSD', timeframe: 'M1', digits: 2, candles, clientX: 10, chartLeft: 0, coordinateToTime: () => null,
    })).toBeNull();
  });

  it('opens after a hold and closes when the pointer is released', () => {
    vi.useFakeTimers();
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    const read = vi.fn(() => ({ title: 'XAUUSD', lines: [{ label: 'Open', value: '1.00' }] }));
    const release = installChartValuesTooltip(wrapper, read);

    wrapper.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 80, pointerId: 1 }));
    vi.advanceTimersByTime(VALUES_TOOLTIP_HOLD_MS - 1);
    expect(read).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(wrapper.querySelector('.rtx-values-tooltip')?.textContent).toContain('XAUUSD');
    expect(wrapper.querySelector('.rtx-values-tooltip')?.textContent).toContain('1.00');

    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 }));
    expect(wrapper.querySelector('.rtx-values-tooltip')).toBeNull();
    release();
  });

  it('stays hidden for a click and when the cursors setting is off', () => {
    vi.useFakeTimers();
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    const read = vi.fn(() => ({ title: 'XAUUSD', lines: [] }));
    const release = installChartValuesTooltip(wrapper, read);

    wrapper.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 12, clientY: 12, pointerId: 2 }));
    vi.advanceTimersByTime(VALUES_TOOLTIP_HOLD_MS - 1);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }));
    vi.advanceTimersByTime(VALUES_TOOLTIP_HOLD_MS);
    expect(read).not.toHaveBeenCalled();

    useChartCursorStore.setState({ valuesTooltipOnLongPress: false });
    wrapper.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 12, clientY: 12, pointerId: 3 }));
    vi.advanceTimersByTime(VALUES_TOOLTIP_HOLD_MS);
    expect(read).not.toHaveBeenCalled();
    release();
  });

  it('cancels a pending hold once pointer movement becomes a pan', () => {
    vi.useFakeTimers();
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    const read = vi.fn(() => ({ title: 'XAUUSD', lines: [] }));
    const release = installChartValuesTooltip(wrapper, read);

    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 20, clientY: 20, pointerId: 4,
    }));
    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      buttons: 1,
      clientX: 20 + VALUES_TOOLTIP_MOVE_THRESHOLD_PX + 1,
      clientY: 20,
      pointerId: 4,
    }));
    vi.advanceTimersByTime(VALUES_TOOLTIP_HOLD_MS * 2);

    expect(read).not.toHaveBeenCalled();
    expect(wrapper.querySelector('.rtx-values-tooltip')).toBeNull();
    release();
  });

  it.each(['demonstration', 'magic', 'eraser'] as const)(
    'does not start a tooltip during the %s cursor gesture',
    (mode) => {
      vi.useFakeTimers();
      useChartCursorStore.setState({ mode });
      const wrapper = document.createElement('div');
      document.body.appendChild(wrapper);
      const read = vi.fn(() => ({ title: 'XAUUSD', lines: [] }));
      const release = installChartValuesTooltip(wrapper, read);

      wrapper.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 20, pointerId: 6,
      }));
      vi.advanceTimersByTime(VALUES_TOOLTIP_HOLD_MS);

      expect(read).not.toHaveBeenCalled();
      expect(wrapper.querySelector('.rtx-values-tooltip')).toBeNull();
      release();
    },
  );

  it('does not start a tooltip from an already consumed chart press', () => {
    vi.useFakeTimers();
    const wrapper = document.createElement('div');
    wrapper.addEventListener('pointerdown', (event) => event.preventDefault(), { capture: true });
    document.body.appendChild(wrapper);
    const read = vi.fn(() => ({ title: 'XAUUSD', lines: [] }));
    const release = installChartValuesTooltip(wrapper, read);

    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 20, pointerId: 7,
    }));
    vi.advanceTimersByTime(VALUES_TOOLTIP_HOLD_MS);

    expect(read).not.toHaveBeenCalled();
    release();
  });

  it('reuses tooltip nodes and coalesces pointer updates into one animation frame', () => {
    vi.useFakeTimers();
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    });
    const cancelFrame = vi.fn((id: number) => frames.delete(id));
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);

    const wrapper = document.createElement('div');
    vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 500, bottom: 300, width: 500, height: 300,
      toJSON: () => ({}),
    });
    document.body.appendChild(wrapper);
    const read = vi.fn(({ clientX }: { clientX: number }) => ({
      title: 'XAUUSD',
      subtitle: '29 Sep 2026',
      lines: [{ label: 'Open', value: clientX.toFixed(2), tone: 'up' as const }],
    }));
    const release = installChartValuesTooltip(wrapper, read);

    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 100, clientY: 80, pointerId: 5,
    }));
    vi.advanceTimersByTime(VALUES_TOOLTIP_HOLD_MS);
    const tooltip = wrapper.querySelector<HTMLElement>('.rtx-values-tooltip');
    const title = tooltip?.querySelector('.rtx-values-tooltip__title');
    const row = tooltip?.querySelector('.rtx-values-tooltip__row');
    expect(read).toHaveBeenCalledTimes(1);

    for (const clientX of [104, 108, 112]) {
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, buttons: 1, clientX, clientY: 84, pointerId: 5,
      }));
    }
    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);

    const [[frameId, frame]] = frames.entries();
    frames.delete(frameId);
    frame(0);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenLastCalledWith({ clientX: 112, clientY: 84 });
    expect(wrapper.querySelector('.rtx-values-tooltip')).toBe(tooltip);
    expect(tooltip?.querySelector('.rtx-values-tooltip__title')).toBe(title);
    expect(tooltip?.querySelector('.rtx-values-tooltip__row')).toBe(row);
    expect(row?.textContent).toContain('112.00');

    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, buttons: 1, clientX: 116, clientY: 88, pointerId: 5,
    }));
    expect(frames.size).toBe(1);
    release();
    expect(cancelFrame).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(wrapper.querySelector('.rtx-values-tooltip')).toBeNull();

    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, buttons: 1, clientX: 120, clientY: 90, pointerId: 5,
    }));
    expect(requestFrame).toHaveBeenCalledTimes(2);
  });
});

// @vitest-environment jsdom

import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawingManager } from '../services/drawingManager';
import * as activeChartSource from '../services/activeChartSource';
import { useChartCursorStore } from '../store/useChartCursorStore';
import {
  DEMONSTRATION_FADE_DELAY_MS,
  DEMONSTRATION_FADE_MS,
  installChartCursorInteractions,
} from './chartCursorInteractions';

const originalElementsFromPoint = document.elementsFromPoint;

const mountChart = () => {
  const wrapper = document.createElement('div');
  wrapper.className = 'rtx-chart-wrapper';
  wrapper.dataset.chartContextId = 'chart-xauusd';
  const overlay = document.createElement('div');
  overlay.className = 'chart-drawing-overlay';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('data-id', 'trend-1');
  const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  group.appendChild(hit);
  svg.appendChild(group);
  overlay.appendChild(svg);
  wrapper.appendChild(overlay);
  document.body.appendChild(wrapper);
  const release = installChartCursorInteractions(wrapper);
  return { wrapper, hit, release };
};

describe('chart cursor interactions', () => {
  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    useChartCursorStore.setState({ mode: 'arrow', valuesTooltipOnLongPress: true });
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.elementsFromPoint = originalElementsFromPoint;
  });

  it('publishes the selected cursor on the chart wrapper', () => {
    const { wrapper, release } = mountChart();
    expect(wrapper.dataset.cursor).toBe('select');
    useChartCursorStore.getState().setMode('dot');
    expect(wrapper.dataset.cursor).toBe('dot');
    expect(wrapper.dataset.crosshair).toBe('on');
    useChartCursorStore.getState().setMode('eraser');
    expect(wrapper.dataset.cursor).toBe('eraser');
    expect(wrapper.dataset.crosshair).toBe('off');
    useChartCursorStore.getState().setMode('magic');
    expect(wrapper.dataset.cursor).toBe('magic');
    expect(wrapper.dataset.crosshair).toBe('off');
    release();
  });

  it('activates the clicked chart before Demonstration or Eraser consumes the press', () => {
    const activate = vi.spyOn(activeChartSource, 'activateActiveChartSource').mockReturnValue(null);
    const { wrapper, release } = mountChart();
    vi.spyOn(drawingManager, 'getDrawings').mockReturnValue([]);

    useChartCursorStore.getState().setMode('demonstration');
    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, altKey: true, pointerId: 20,
    }));
    expect(activate).toHaveBeenLastCalledWith('chart-xauusd');
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 20 }));

    useChartCursorStore.getState().setMode('eraser');
    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 21,
    }));
    expect(activate).toHaveBeenLastCalledWith('chart-xauusd');
    expect(activate).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 21 }));
    release();
  });

  it('deletes the unlocked drawing under an eraser press and drag', () => {
    const { wrapper, hit, release } = mountChart();
    const second = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    second.setAttribute('data-id', 'hline-2');
    const secondHit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    second.appendChild(secondHit);
    wrapper.querySelector('svg')?.appendChild(second);
    vi.spyOn(drawingManager, 'getDrawings').mockReturnValue([
      { id: 'trend-1', locked: false },
      { id: 'hline-2', locked: true },
    ] as ReturnType<typeof drawingManager.getDrawings>);
    const remove = vi.spyOn(drawingManager, 'deleteDrawing').mockReturnValue(true);
    useChartCursorStore.getState().setMode('eraser');

    hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 12, clientY: 18, pointerId: 4 }));
    expect(remove).toHaveBeenCalledWith('trend-1', 'chart-xauusd');

    document.elementsFromPoint = () => [secondHit];
    wrapper.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: 0, buttons: 1, clientX: 40, clientY: 40, pointerId: 4 }));
    expect(remove).toHaveBeenCalledTimes(1);
    release();
  });

  it('draws a temporary Alt highlight that fades without saving a drawing', () => {
    vi.useFakeTimers();
    const { wrapper, release } = mountChart();
    const remove = vi.spyOn(drawingManager, 'deleteDrawing');
    useChartCursorStore.getState().setMode('demonstration');

    wrapper.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 8, clientY: 8, pointerId: 2 }));
    expect(wrapper.querySelector('.rtx-demonstration-mark')).toBeNull();

    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, altKey: true, clientX: 30, clientY: 40, pointerId: 3,
    }));
    wrapper.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, buttons: 1, clientX: 80, clientY: 90, pointerId: 3,
    }));
    wrapper.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 80, clientY: 90, pointerId: 3 }));
    const mark = wrapper.querySelector('.rtx-demonstration-mark');
    expect(mark?.querySelector('path')?.getAttribute('stroke')).toBe('#f5c542');
    expect(remove).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DEMONSTRATION_FADE_DELAY_MS);
    expect(mark).toHaveStyle({ opacity: '0' });
    vi.advanceTimersByTime(DEMONSTRATION_FADE_MS + 40);
    expect(wrapper.querySelector('.rtx-demonstration-mark')).toBeNull();
    release();
  });

  it('does not consume an Alt press on an interactive chart control', () => {
    const { wrapper, release } = mountChart();
    const control = document.createElement('button');
    wrapper.appendChild(control);
    useChartCursorStore.getState().setMode('demonstration');

    const press = new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, altKey: true, pointerId: 9,
    });
    control.dispatchEvent(press);

    expect(press.defaultPrevented).toBe(false);
    expect(wrapper.querySelector('.rtx-demonstration-mark')).toBeNull();
    release();
  });

  it('coalesces demonstration moves into one frame and skips near-duplicate points', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    const { wrapper, release } = mountChart();
    useChartCursorStore.getState().setMode('demonstration');

    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, altKey: true, clientX: 10, clientY: 10, pointerId: 11,
    }));
    const path = wrapper.querySelector<SVGPathElement>('.rtx-demonstration-mark path');
    expect(path?.getAttribute('d')).toBe('M10 10 L10 10');

    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, buttons: 1, clientX: 10.5, clientY: 10.5, pointerId: 11,
    }));
    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, buttons: 1, clientX: 30, clientY: 30, pointerId: 11,
    }));

    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(path?.getAttribute('d')).toBe('M10 10 L10 10');
    const firstPaint = frames.get(1);
    frames.delete(1);
    firstPaint?.(16);
    expect(wrapper.querySelector('.rtx-demonstration-mark path')).toBe(path);
    expect(path?.getAttribute('d')).toBe('M10 10 L30 30');
    expect(path?.getAttribute('d')).not.toContain('10.5');
    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, buttons: 1, clientX: 50, clientY: 50, pointerId: 11,
    }));
    release();
    expect(cancelFrame).toHaveBeenCalledWith(2);
    expect(frames.size).toBe(0);
  });

  it('coalesces eraser drag hit-tests and stops the gesture on an outside pointerup', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    const { wrapper, hit, release } = mountChart();
    const second = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    second.setAttribute('data-id', 'hline-2');
    const secondHit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    second.appendChild(secondHit);
    wrapper.querySelector('svg')?.appendChild(second);
    vi.spyOn(drawingManager, 'getDrawings').mockReturnValue([
      { id: 'trend-1', locked: false },
      { id: 'hline-2', locked: false },
    ] as ReturnType<typeof drawingManager.getDrawings>);
    const remove = vi.spyOn(drawingManager, 'deleteDrawing').mockReturnValue(true);
    document.elementsFromPoint = vi.fn((x: number) => x === 20 ? [hit] : x === 40 ? [secondHit] : []);
    useChartCursorStore.getState().setMode('eraser');

    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 0, clientY: 0, pointerId: 12,
    }));
    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, buttons: 1, clientX: 20, clientY: 20, pointerId: 12,
    }));
    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, buttons: 1, clientX: 40, clientY: 40, pointerId: 12,
    }));

    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    const firstErase = frames.get(1);
    frames.delete(1);
    firstErase?.(16);
    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('hline-2', 'chart-xauusd');

    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, buttons: 1, clientX: 20, clientY: 20, pointerId: 12,
    }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 12 }));
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenLastCalledWith('trend-1', 'chart-xauusd');
    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, buttons: 1, clientX: 20, clientY: 20, pointerId: 12,
    }));
    expect(requestFrame).toHaveBeenCalledTimes(2);
    release();
  });

  it('bursts glitter for Magic without taking the press away from the chart', () => {
    const { wrapper, release } = mountChart();
    const remove = vi.spyOn(drawingManager, 'deleteDrawing');
    let reachedTheChart = false;
    wrapper.addEventListener('pointerdown', () => { reachedTheChart = true; });
    useChartCursorStore.getState().setMode('magic');

    wrapper.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 24, clientY: 30, pointerId: 8 }));
    expect(wrapper.querySelectorAll('.rtx-magic-spark').length).toBeGreaterThan(0);
    expect(reachedTheChart).toBe(true);
    expect(remove).not.toHaveBeenCalled();
    release();
    expect(wrapper.querySelector('.rtx-magic-layer')).toBeNull();
  });

  it('ends Magic on pointerup outside the wrapper and removes listeners on teardown', () => {
    vi.spyOn(performance, 'now').mockReturnValue(100);
    const { wrapper, release } = mountChart();
    useChartCursorStore.getState().setMode('magic');

    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 24, clientY: 30, pointerId: 13,
    }));
    const initialCount = wrapper.querySelectorAll('.rtx-magic-spark').length;
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 13 }));
    wrapper.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, buttons: 1, clientX: 50, clientY: 50, pointerId: 13,
    }));
    expect(wrapper.querySelectorAll('.rtx-magic-spark')).toHaveLength(initialCount);

    wrapper.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, clientX: 30, clientY: 30, pointerId: 14,
    }));
    release();
    wrapper.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, buttons: 1, clientX: 60, clientY: 60, pointerId: 14,
    }));
    expect(wrapper.querySelector('.rtx-magic-layer')).toBeNull();
  });
});

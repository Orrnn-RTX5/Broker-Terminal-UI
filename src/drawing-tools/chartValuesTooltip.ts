import { translateUi } from '../hooks/useUiTranslation';
import { createChartDataSnapshot } from '../services/chartDataSnapshot';
import { useChartCursorStore } from '../store/useChartCursorStore';
import type { Candle } from '../types/chart';
import { resolveSpecDigits } from '../utils/symbolUtils';

export const VALUES_TOOLTIP_HOLD_MS = 400;
export const VALUES_TOOLTIP_MOVE_THRESHOLD_PX = 8;

const PRESS_IGNORE = 'button, a, input, textarea, select, label, [role="button"], .rtx-trade-level-badge, .rtx-trade-level-hit-area, .rtx-chart-text-input-popover';

export interface ValuesTooltipLine {
  label: string;
  value: string;
  tone?: 'up' | 'down';
  color?: string;
}

export interface ValuesTooltipModel {
  title: string;
  subtitle?: string;
  lines: ValuesTooltipLine[];
}

export interface ChartValuesTooltipSource {
  symbol: string;
  timeframe: string;
  /** Broker price precision; null when unpublished (values render raw). */
  digits: number | null;
  offsetSeconds?: number;
  candles: readonly Candle[];
  clientX: number;
  chartLeft: number;
  coordinateToTime: (x: number) => number | null;
  indicatorRows?: (time: number) => Array<{ label: string; value: number; color?: string }>;
}

/** Bar whose open time is nearest to a chart coordinate time. */
export const nearestCandle = (candles: readonly Candle[], time: number): Candle | null => {
  if (candles.length === 0 || !Number.isFinite(time)) return null;
  let low = 0;
  let high = candles.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (candles[mid].time < time) low = mid + 1;
    else high = mid;
  }
  const next = candles[low];
  const previous = candles[low - 1];
  if (!previous) return next;
  return time - previous.time <= next.time - time ? previous : next;
};

const safeColor = (color?: string): string | undefined =>
  color && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color) ? color : undefined;

export const buildChartValuesTooltip = (source: ChartValuesTooltipSource): ValuesTooltipModel | null => {
  const time = source.coordinateToTime(source.clientX - source.chartLeft);
  if (time === null) return null;
  const candle = nearestCandle(source.candles, time);
  const snapshot = createChartDataSnapshot(
    candle,
    source.symbol,
    source.timeframe,
    source.digits,
    source.offsetSeconds ?? 0,
  );
  if (!snapshot || !candle) return null;
  // TERM-DIGITS-WL: broker digits only; unknown precision renders raw
  // (toFixed(null) would silently round to 0 decimals).
  const digits = resolveSpecDigits(source.digits);
  const price = (value: number) => (digits === null ? String(value) : value.toFixed(digits));
  const lines: ValuesTooltipLine[] = [
    { label: translateUi('Open'), value: price(snapshot.open) },
    { label: translateUi('High'), value: price(snapshot.high) },
    { label: translateUi('Low'), value: price(snapshot.low) },
    { label: translateUi('Close'), value: price(snapshot.close), tone: snapshot.close >= snapshot.open ? 'up' : 'down' },
    { label: translateUi('Volume'), value: Math.round(snapshot.volume).toLocaleString() },
  ];
  for (const row of source.indicatorRows?.(candle.time) ?? []) {
    lines.push({ label: row.label, value: price(row.value), color: safeColor(row.color) });
  }
  return { title: source.symbol, subtitle: `${snapshot.date} ${snapshot.time}`, lines };
};

const pointInside = (wrapper: HTMLElement, clientX: number, clientY: number): boolean => {
  const rect = wrapper.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return true;
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
};

interface ValuesTooltipRowDom {
  row: HTMLDivElement;
  label: HTMLSpanElement;
  value: HTMLSpanElement;
}

interface ValuesTooltipDom {
  root: HTMLDivElement;
  title: HTMLDivElement;
  subtitle: HTMLDivElement;
  rows: ValuesTooltipRowDom[];
}

/**
 * Shows the bar's OHLC, volume, and indicator values while the pointer is held.
 * A quick click never opens it. The cursors menu can turn it off.
 */
export const installChartValuesTooltip = (
  wrapper: HTMLElement,
  read: (point: { clientX: number; clientY: number }) => ValuesTooltipModel | null,
): (() => void) => {
  const abort = new AbortController();
  let tooltip: ValuesTooltipDom | null = null;
  let holdTimer = 0;
  let paintFrame = 0;
  let activePointer: number | null = null;
  let holdActivated = false;
  let pressOrigin = { clientX: 0, clientY: 0 };
  let point = { clientX: 0, clientY: 0 };
  let contentSignature = '';
  let measuredWidth = 0;
  let measuredHeight = 0;

  const cancelPaint = () => {
    if (paintFrame === 0) return;
    window.cancelAnimationFrame(paintFrame);
    paintFrame = 0;
  };

  const removeTooltip = () => {
    tooltip?.root.remove();
    tooltip = null;
    contentSignature = '';
    measuredWidth = 0;
    measuredHeight = 0;
  };

  const endHold = () => {
    window.clearTimeout(holdTimer);
    holdTimer = 0;
    cancelPaint();
    activePointer = null;
    holdActivated = false;
    removeTooltip();
  };

  const ensureTooltip = (): ValuesTooltipDom => {
    if (!tooltip) {
      const root = document.createElement('div');
      root.className = 'rtx-values-tooltip';
      const title = document.createElement('div');
      title.className = 'rtx-values-tooltip__title';
      const subtitle = document.createElement('div');
      subtitle.className = 'rtx-values-tooltip__subtitle';
      root.append(title, subtitle);
      wrapper.appendChild(root);
      tooltip = { root, title, subtitle, rows: [] };
    }
    return tooltip;
  };

  const updateContent = (dom: ValuesTooltipDom, model: ValuesTooltipModel): boolean => {
    const signature = [
      model.title,
      model.subtitle ?? '',
      ...model.lines.flatMap((line) => [line.label, line.value, line.tone ?? '', line.color ?? '']),
    ].join('\u0000');
    if (signature === contentSignature) return false;
    contentSignature = signature;

    dom.title.textContent = model.title;
    dom.subtitle.textContent = model.subtitle ?? '';
    dom.subtitle.hidden = !model.subtitle;

    while (dom.rows.length < model.lines.length) {
      const row = document.createElement('div');
      row.className = 'rtx-values-tooltip__row';
      const label = document.createElement('span');
      label.className = 'rtx-values-tooltip__label';
      const value = document.createElement('span');
      value.className = 'rtx-values-tooltip__value';
      row.append(label, value);
      dom.root.appendChild(row);
      dom.rows.push({ row, label, value });
    }
    while (dom.rows.length > model.lines.length) dom.rows.pop()?.row.remove();

    model.lines.forEach((line, index) => {
      const row = dom.rows[index];
      row.label.textContent = line.label;
      row.value.textContent = line.value;
      if (line.tone) row.value.dataset.tone = line.tone;
      else delete row.value.dataset.tone;
      row.value.style.color = line.color ?? '';
    });
    return true;
  };

  const hideVisual = () => {
    if (tooltip) tooltip.root.hidden = true;
  };

  const paint = () => {
    paintFrame = 0;
    if (!holdActivated || activePointer === null) return;
    if (!useChartCursorStore.getState().valuesTooltipOnLongPress) {
      endHold();
      return;
    }
    if (wrapper.dataset.trendDrawingActive === 'true' || !pointInside(wrapper, point.clientX, point.clientY)) {
      hideVisual();
      return;
    }
    const model = read(point);
    if (!model) {
      hideVisual();
      return;
    }

    const dom = ensureTooltip();
    const contentChanged = updateContent(dom, model);
    dom.root.hidden = false;
    if (contentChanged || measuredWidth === 0 || measuredHeight === 0) {
      measuredWidth = dom.root.offsetWidth;
      measuredHeight = dom.root.offsetHeight;
    }
    const rect = wrapper.getBoundingClientRect();
    let left = point.clientX - rect.left + 16;
    let top = point.clientY - rect.top + 18;
    if (rect.width > 0 && left + measuredWidth > rect.width - 8) {
      left = point.clientX - rect.left - measuredWidth - 12;
    }
    if (rect.height > 0 && top + measuredHeight > rect.height - 8) {
      top = point.clientY - rect.top - measuredHeight - 12;
    }
    dom.root.style.left = `${Math.max(8, left)}px`;
    dom.root.style.top = `${Math.max(8, top)}px`;
  };

  const schedulePaint = () => {
    if (!holdActivated || activePointer === null || paintFrame !== 0) return;
    paintFrame = window.requestAnimationFrame(paint);
  };

  const onPointerDown = (event: PointerEvent) => {
    const cursor = useChartCursorStore.getState();
    if (event.button !== 0 || event.defaultPrevented || !cursor.valuesTooltipOnLongPress) return;
    if (cursor.mode === 'demonstration' || cursor.mode === 'magic' || cursor.mode === 'eraser') return;
    if (wrapper.dataset.trendDrawingActive === 'true') return;
    if (event.target instanceof Element && event.target.closest(PRESS_IGNORE)) return;
    endHold();
    activePointer = event.pointerId;
    point = { clientX: event.clientX, clientY: event.clientY };
    pressOrigin = point;
    holdTimer = window.setTimeout(() => {
      holdTimer = 0;
      if (activePointer !== event.pointerId) return;
      holdActivated = true;
      paint();
    }, VALUES_TOOLTIP_HOLD_MS);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== activePointer) return;
    point = { clientX: event.clientX, clientY: event.clientY };
    if (!holdActivated) {
      const movement = Math.hypot(
        point.clientX - pressOrigin.clientX,
        point.clientY - pressOrigin.clientY,
      );
      if (movement > VALUES_TOOLTIP_MOVE_THRESHOLD_PX) endHold();
      return;
    }
    schedulePaint();
  };

  const onPointerUp = (event: PointerEvent) => {
    if (activePointer === null || event.pointerId !== activePointer) return;
    endHold();
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') endHold();
  };

  wrapper.addEventListener('pointerdown', onPointerDown, { capture: true, signal: abort.signal });
  window.addEventListener('pointermove', onPointerMove, { capture: true, signal: abort.signal });
  window.addEventListener('pointerup', onPointerUp, { capture: true, signal: abort.signal });
  window.addEventListener('pointercancel', onPointerUp, { capture: true, signal: abort.signal });
  window.addEventListener('blur', endHold, { signal: abort.signal });
  document.addEventListener('visibilitychange', onVisibilityChange, { signal: abort.signal });
  const unsubscribe = useChartCursorStore.subscribe(() => {
    if (!useChartCursorStore.getState().valuesTooltipOnLongPress) endHold();
  });

  return () => {
    endHold();
    abort.abort();
    unsubscribe();
  };
};

import { barVolume, type ForecastingBar } from './forecastingMeasurementRenderer';

export interface RulerPoint { logical: number; time: number; price: number }
export interface RulerMetrics { price: string; range: string; volume: string; color: string }
const RULER_NEGATIVE_COLOR = '#f7525f';
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export function rulerDuration(seconds: number): string {
  let remaining = Math.round(Math.abs(seconds));
  const parts: string[] = [];
  for (const [unit, size] of [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]] as const) {
    const count = Math.floor(remaining / size);
    if (count) parts.push(`${count}${unit}`);
    remaining %= size;
  }
  return `${seconds < 0 ? '-' : ''}${parts.join(' ') || '0m'}`;
}

export function rulerMetrics(start: RulerPoint, end: RulerPoint, bars: readonly ForecastingBar[], digits: number, tickSize: number): RulerMetrics {
  const precision = clamp(Math.trunc(digits), 0, 10);
  const delta = Number((end.price - start.price).toFixed(precision));
  const format = (value: number, places: number) => (Object.is(Number(value.toFixed(places)), -0) ? 0 : value)
    .toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places });
  const percentage = start.price === 0 ? '—' : `${format(delta / start.price * 100, 2)}%`;
  const ticks = finite(tickSize) && tickSize > 0 ? ` ${format(delta / tickSize, 1).replace(/\.0$/, '')}` : '';
  const low = Math.min(start.time, end.time), high = Math.max(start.time, end.time);
  const selected = bars.filter(bar => bar.time >= low && bar.time <= high);
  const known = selected.length > 0 && selected.every(bar => [bar.volume, bar.tickVolume, bar.realVolume].some(value => finite(value) && value >= 0));
  const volume = selected.reduce((sum, bar) => sum + barVolume(bar), 0);
  const compact = (value: number) => {
    const units: [number, string][] = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    const unit = units.find(([size]) => value >= size);
    return unit ? `${Number((value / unit[0]).toFixed(2))}${unit[1]}` : Number(value.toFixed(2)).toLocaleString('en-US');
  };
  return {
    price: `${format(delta, precision)} (${percentage})${ticks}`,
    range: `${end.logical - start.logical} bars, ${rulerDuration(end.time - start.time)}`,
    volume: `Vol ${known ? compact(volume) : '—'}`,
    color: delta < 0 ? RULER_NEGATIVE_COLOR : '#2962ff',
  };
}

export interface RulerGeometry {
  width: number; height: number; totalWidth: number; totalHeight: number;
  /** Opt in only for built-in light palettes; custom chart colors remain authoritative. */
  useLightPalette?: boolean;
  x: (logical: number) => number | null;
  y: (price: number) => number | null;
  formatPrice: (price: number) => string;
  formatTime: (time: number) => string;
}

export function renderChartRuler(svg: SVGSVGElement, start: RulerPoint, end: RulerPoint, metrics: RulerMetrics, geometry: RulerGeometry) {
  const { width, height, totalWidth, totalHeight } = geometry;
  const raw = [geometry.x(start.logical), geometry.y(start.price), geometry.x(end.logical), geometry.y(end.price)];
  if (!raw.every(finite) || width <= 0 || height <= 0) { svg.replaceChildren(); return; }
  const [x1, y1, x2, y2] = raw as number[];
  const content = document.createDocumentFragment();
  // Off-screen measurements are clipped, never remapped onto different candles.
  svg.setAttribute('viewBox', `0 0 ${totalWidth} ${totalHeight}`);
  const node = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
    if (text !== undefined) element.textContent = text;
    content.appendChild(element); return element;
  };
  const left = Math.max(0, Math.min(x1, x2)), right = Math.min(width, Math.max(x1, x2));
  const top = Math.max(0, Math.min(y1, y2)), bottom = Math.min(height, Math.max(y1, y2));
  if (right < left || bottom < top) { svg.replaceChildren(); return; }
  node('rect', { 'data-ruler-part': 'range', x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top), fill: metrics.color, 'fill-opacity': .18 });
  const middleX = clamp((x1 + x2) / 2, 0, width), middleY = clamp((y1 + y2) / 2, 0, height);
  const line = (ax: number, ay: number, bx: number, by: number, arrow: boolean) => {
    ax = clamp(ax, 0, width); bx = clamp(bx, 0, width); ay = clamp(ay, 0, height); by = clamp(by, 0, height);
    node('line', { x1: ax, y1: ay, x2: bx, y2: by, stroke: metrics.color, 'stroke-width': 1 });
    if (!arrow || (ax === bx && ay === by)) return;
    const angle = Math.atan2(by - ay, bx - ax), length = 6;
    node('path', { d: `M ${bx - length * Math.cos(angle - .7)} ${by - length * Math.sin(angle - .7)} L ${bx} ${by} L ${bx - length * Math.cos(angle + .7)} ${by - length * Math.sin(angle + .7)}`, fill: 'none', stroke: metrics.color, 'stroke-width': 1 });
  };
  line(x1, middleY, x2, middleY, true); line(middleX, y1, middleX, y2, true);
  const lines = [metrics.price, metrics.range, metrics.volume];
  const boxWidth = Math.max(1, Math.min(width - 8, Math.max(128, Math.max(...lines.map(text => text.length)) * 6.4 + 20)));
  const boxHeight = 70;
  const boxX = clamp(middleX - boxWidth / 2, 4, width - boxWidth - 4);
  const preferredY = end.price >= start.price ? top - boxHeight - 10 : bottom + 10;
  const boxY = clamp(preferredY, 4, Math.max(4, height - boxHeight - 4));
  const labelColor = geometry.useLightPalette && metrics.color === RULER_NEGATIVE_COLOR
    ? 'var(--rtx-light-quote-down, #a51f26)'
    : metrics.color;
  node('rect', { 'data-ruler-part': 'label', x: boxX, y: boxY, width: boxWidth, height: boxHeight, rx: 3, fill: labelColor });
  lines.forEach((text, index) => node('text', { x: boxX + boxWidth / 2, y: boxY + 19 + index * 20, fill: '#ffffff', 'font-size': 12, 'font-weight': 600, 'font-family': 'Arial, sans-serif', 'text-anchor': 'middle' }, text));
  // TradingView highlights both axis intervals in blue for either direction.
  const blue = '#2962ff';
  node('rect', { x: width, y: top, width: totalWidth - width, height: bottom - top, fill: blue, 'fill-opacity': .22 });
  node('rect', { x: left, y: height, width: right - left, height: totalHeight - height, fill: blue, 'fill-opacity': .22 });
  for (const point of [start, end]) {
    const y = geometry.y(point.price), x = geometry.x(point.logical);
    if (finite(y) && y >= 0 && y <= height) {
      const labelY = clamp(y - 9, 0, Math.max(0, height - 18));
      node('rect', { x: width, y: labelY, width: totalWidth - width, height: 18, fill: blue });
      node('text', { x: width + 4, y: labelY + 13, fill: '#fff', 'font-size': 11, 'font-family': 'Arial, sans-serif' }, geometry.formatPrice(point.price));
    }
    if (finite(x) && x >= 0 && x <= width) {
      const text = geometry.formatTime(point.time), labelWidth = Math.min(width, text.length * 6 + 12);
      const labelX = clamp(x - labelWidth / 2, 0, width - labelWidth);
      node('rect', { x: labelX, y: height, width: labelWidth, height: totalHeight - height, fill: blue });
      node('text', { x: labelX + labelWidth / 2, y: height + 14, fill: '#fff', 'font-size': 11, 'font-family': 'Arial, sans-serif', 'text-anchor': 'middle' }, text);
    }
  }
  svg.replaceChildren(content);
}

export interface ChartRulerOptions {
  container: HTMLElement;
  point: (x: number, y: number) => RulerPoint | null;
  geometry: () => RulerGeometry | null;
  metrics: (start: RulerPoint, end: RulerPoint) => RulerMetrics;
  resolve?: (point: RulerPoint) => RulerPoint;
  canStartShortcut: () => boolean;
  select: () => void;
  finish: () => void;
}

/** Ephemeral ruler: no saved drawing, selection handles, undo entry or API write. */
export function createChartRuler(options: ChartRulerOptions) {
  const { container } = options;
  let phase: 'idle' | 'armed' | 'measuring' | 'complete' = 'idle';
  let start: RulerPoint | null = null, end: RulerPoint | null = null;
  let pointer: number | null = null, press: { x: number; y: number } | null = null;
  let svg: SVGSVGElement | null = null, frame = 0, ownFinish = false, suppressClick = false;
  const release = () => { const id = pointer; pointer = null; if (id !== null) try { container.releasePointerCapture(id); } catch { /* Capture already ended. */ } };
  const render = () => {
    if (!start || !end) return;
    const geometry = options.geometry(); if (!geometry) return;
    start = options.resolve?.(start) ?? start;
    end = options.resolve?.(end) ?? end;
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('data-chart-ruler', 'true'); svg.setAttribute('aria-label', 'Chart measurement'); svg.setAttribute('role', 'img');
      Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '15', overflow: 'hidden' });
      container.appendChild(svg);
    }
    const metrics = options.metrics(start, end);
    svg.setAttribute('aria-label', `Chart measurement: ${metrics.price}; ${metrics.range}; ${metrics.volume}`);
    renderChartRuler(svg, start, end, metrics, geometry);
  };
  const refresh = () => { if (!frame && start) frame = requestAnimationFrame(() => { frame = 0; render(); }); };
  const clear = () => {
    release(); phase = 'idle'; start = end = null; press = null;
    delete container.dataset.chartRulerArmed; svg?.remove(); svg = null;
    if (frame) cancelAnimationFrame(frame); frame = 0;
  };
  const restore = () => { ownFinish = true; try { options.finish(); } finally { ownFinish = false; } };
  const complete = () => { phase = 'complete'; release(); delete container.dataset.chartRulerArmed; render(); restore(); };
  const consume = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const pointFor = (event: PointerEvent, bounded: boolean) => {
    const rect = container.getBoundingClientRect(), geometry = options.geometry();
    if (!geometry) return null;
    let x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (!bounded && (x < 0 || y < 0 || x >= geometry.width || y >= geometry.height)) return null;
    x = clamp(x, 0, geometry.width - 1); y = clamp(y, 0, geometry.height - 1);
    return options.point(x, y);
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    if ((event.target as Element)?.closest('button, input, select, textarea, [contenteditable="true"]')) return;
    const next = pointFor(event, false); if (!next) return;
    if (phase === 'complete') clear();
    if (phase === 'idle' && event.shiftKey && options.canStartShortcut()) options.select();
    if (phase !== 'armed' && phase !== 'measuring') return;
    consume(event); suppressClick = true;
    if (phase === 'measuring') { end = next; complete(); return; }
    phase = 'measuring'; start = end = next;
    pointer = event.pointerId; press = { x: event.clientX, y: event.clientY };
    try { container.setPointerCapture(pointer); } catch { /* Synthetic pointer / detached chart. */ }
    render();
  };
  const move = (event: PointerEvent) => {
    if (phase !== 'measuring' || (pointer !== null && pointer !== event.pointerId)) return;
    if (pointer === null && !container.contains(event.target as Node)) return;
    const next = pointFor(event, true); if (!next) return;
    consume(event); end = next; refresh();
  };
  const up = (event: PointerEvent) => {
    if (phase !== 'measuring' || pointer !== event.pointerId) return;
    consume(event); end = pointFor(event, true) ?? end;
    const dragged = press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 3;
    release(); if (dragged) complete(); else render();
  };
  const click = (event: MouseEvent) => { if (suppressClick) { suppressClick = false; consume(event); } };
  const cancel = () => { const active = phase === 'armed' || phase === 'measuring'; clear(); if (active) restore(); };
  const pointerCancel = (event: PointerEvent) => { if (pointer === event.pointerId) cancel(); };
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || phase === 'idle') return;
    if (shouldIgnoreShortcutEvent(event) || isShortcutInput(event) || isShortcutLocalScope(event) || isShortcutOverlay(event)) return;
    consume(event); cancel();
  };
  const blur = () => { if (phase === 'armed' || phase === 'measuring') cancel(); };
  container.addEventListener('pointerdown', down, true);
  container.addEventListener('click', click, true);
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', pointerCancel, true);
  window.addEventListener('keydown', key, true);
  window.addEventListener('blur', blur);
  const observer = new ResizeObserver(refresh); observer.observe(container);
  return {
    select(active: boolean) {
      if (ownFinish) return;
      // The rail may re-arm the same context when the pointer first enters it.
      if (active && (phase === 'armed' || phase === 'measuring')) return;
      clear(); if (active) { phase = 'armed'; container.dataset.chartRulerArmed = 'true'; }
    },
    refresh,
    destroy() {
      cancel(); observer.disconnect();
      container.removeEventListener('pointerdown', down, true); container.removeEventListener('click', click, true);
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', pointerCancel, true); window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', blur);
    },
  };
}
import { isShortcutInput, isShortcutLocalScope, isShortcutOverlay, shouldIgnoreShortcutEvent } from '../services/keyboardShortcutManager';

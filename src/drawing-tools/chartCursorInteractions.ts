import { drawingManager } from '../services/drawingManager';
import {
  chartCursorShowsCrosshair,
  useChartCursorStore,
  type ChartCursorMode,
} from '../store/useChartCursorStore';
import { activateActiveChartSource } from '../services/activeChartSource';

export const DEMONSTRATION_FADE_DELAY_MS = 700;
export const DEMONSTRATION_FADE_MS = 2600;
const DEMONSTRATION_COLOR = '#f5c542';
const DEMONSTRATION_POINT_SAMPLE_PX = 2;
const MAGIC_COLORS = ['#f5d76e', '#7dd3fc', '#f9a8d4', '#ffffff', '#c4b5fd'];
const ERASER_IGNORE = 'button, a, input, textarea, select, label, [role="button"], .rtx-trade-level-badge, .rtx-trade-level-hit-area, .rtx-chart-text-input-popover';

const svgNs = 'http://www.w3.org/2000/svg';

export const chartCursorAttribute = (mode: ChartCursorMode): string =>
  mode === 'arrow' ? 'select' : mode;

export const applyChartCursorMode = (
  wrapper: HTMLElement | null,
  mode: ChartCursorMode = useChartCursorStore.getState().mode,
): void => {
  if (!wrapper || wrapper.dataset.trendDrawingActive === 'true') return;
  wrapper.dataset.cursor = chartCursorAttribute(mode);
  wrapper.dataset.crosshair = chartCursorShowsCrosshair(mode) ? 'on' : 'off';
};

const drawingGroupId = (node: Element | null, wrapper: HTMLElement): string | null => {
  const group = node?.closest('g[data-id]');
  if (!group) return null;
  const overlay = wrapper.querySelector('.chart-drawing-overlay');
  if (overlay && !overlay.contains(group)) return null;
  const id = group.getAttribute('data-id');
  if (!id || id.endsWith('-preview') || id.endsWith('-construction') || id.includes('-construction')) return null;
  return id;
};

const drawingIdAt = (
  wrapper: HTMLElement,
  clientX: number,
  clientY: number,
  target: EventTarget | null,
): string | null => {
  const direct = target instanceof Element ? drawingGroupId(target, wrapper) : null;
  if (direct) return direct;
  if (typeof document.elementsFromPoint !== 'function') return null;
  for (const node of document.elementsFromPoint(clientX, clientY)) {
    const id = drawingGroupId(node, wrapper);
    if (id) return id;
  }
  return null;
};

const eraseDrawing = (contextId: string, id: string, erased: Set<string>): void => {
  if (erased.has(id)) return;
  const drawing = drawingManager.getDrawings(contextId).find((item) => item.id === id);
  if (!drawing || drawing.locked === true) {
    erased.add(id);
    return;
  }
  erased.add(id);
  drawingManager.deleteDrawing(id, contextId);
};

const localPoint = (wrapper: HTMLElement, event: PointerEvent): { x: number; y: number } => {
  const rect = wrapper.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};

const ensureDemonstrationLayer = (wrapper: HTMLElement): SVGSVGElement => {
  const existing = wrapper.querySelector<SVGSVGElement>(':scope > .rtx-demonstration-layer');
  if (existing) return existing;
  const layer = document.createElementNS(svgNs, 'svg');
  layer.setAttribute('class', 'rtx-demonstration-layer');
  layer.setAttribute('aria-hidden', 'true');
  wrapper.appendChild(layer);
  return layer;
};

export const scheduleDemonstrationFade = (mark: SVGElement): void => {
  window.setTimeout(() => {
    if (!mark.isConnected) return;
    mark.style.transition = `opacity ${DEMONSTRATION_FADE_MS}ms ease`;
    mark.style.opacity = '0';
    window.setTimeout(() => mark.remove(), DEMONSTRATION_FADE_MS + 40);
  }, DEMONSTRATION_FADE_DELAY_MS);
};

const createDemonstrationPath = (mark: SVGGElement): SVGPathElement => {
  const path = document.createElementNS(svgNs, 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', DEMONSTRATION_COLOR);
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  mark.appendChild(path);
  return path;
};

const paintDemonstration = (
  path: SVGPathElement,
  points: Array<{ x: number; y: number }>,
): void => {
  const start = points[0];
  const end = points[points.length - 1];
  const travel = Math.hypot(end.x - start.x, end.y - start.y);
  if (points.length < 2 || travel < 4) {
    path.setAttribute('d', `M${start.x} ${start.y} L${start.x} ${start.y}`);
    path.setAttribute('stroke-width', '14');
    path.setAttribute('stroke-opacity', '0.92');
    return;
  }
  path.setAttribute('d', points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' '));
  path.setAttribute('stroke-width', '16');
  path.setAttribute('stroke-opacity', '0.55');
};

const appendSampledPoint = (
  points: Array<{ x: number; y: number }>,
  point: { x: number; y: number },
  force = false,
): boolean => {
  const previous = points[points.length - 1];
  if (!force && Math.hypot(point.x - previous.x, point.y - previous.y) < DEMONSTRATION_POINT_SAMPLE_PX) {
    return false;
  }
  if (point.x === previous.x && point.y === previous.y) return false;
  points.push(point);
  return true;
};

const ensureMagicLayer = (wrapper: HTMLElement): HTMLElement => {
  const existing = wrapper.querySelector<HTMLElement>(':scope > .rtx-magic-layer');
  if (existing) return existing;
  const layer = document.createElement('div');
  layer.className = 'rtx-magic-layer';
  layer.setAttribute('aria-hidden', 'true');
  wrapper.appendChild(layer);
  return layer;
};

/** Glitter burst for the Magic cursor. The press itself still reaches the chart. */
const burstMagic = (wrapper: HTMLElement, x: number, y: number, count = 16): void => {
  const layer = ensureMagicLayer(wrapper);
  if (layer.childElementCount > 72) return;
  for (let index = 0; index < count; index += 1) {
    const spark = document.createElement('span');
    spark.className = 'rtx-magic-spark';
    if (index % 4 === 0) spark.dataset.shape = 'star';
    const angle = (Math.PI * 2 * index) / count + Math.random() * 0.45;
    const distance = 16 + Math.random() * 34;
    spark.style.left = `${x}px`;
    spark.style.top = `${y}px`;
    spark.style.background = MAGIC_COLORS[index % MAGIC_COLORS.length];
    spark.style.setProperty('--rtx-magic-dx', `${Math.cos(angle) * distance}px`);
    spark.style.setProperty('--rtx-magic-dy', `${Math.sin(angle) * distance}px`);
    layer.appendChild(spark);
    window.setTimeout(() => spark.remove(), 700);
  }
};

const cursorModeAllowsGesture = (wrapper: HTMLElement): boolean => {
  if (wrapper.dataset.trendDrawingActive === 'true') return false;
  const contextId = wrapper.dataset.chartContextId;
  return !contextId || !drawingManager.getActiveDrawing(contextId);
};

/**
 * Keeps the chart pointer, eraser, demonstration marks, and magic bursts
 * aligned with the Cursors flyout. Demonstration strokes follow TradingView:
 * hold Alt and click or drag; the mark fades after a few seconds and is not saved.
 * Magic scatters glitter on press and does not consume the click.
 */
export const installChartCursorInteractions = (wrapper: HTMLElement): (() => void) => {
  const abort = new AbortController();
  let activeGestureCleanup: (() => void) | null = null;
  const apply = () => applyChartCursorMode(wrapper);
  apply();
  const unsubscribe = useChartCursorStore.subscribe(apply);

  const beginGesture = (pointerId: number, onCleanup: () => void) => {
    activeGestureCleanup?.();
    const gestureAbort = new AbortController();
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      gestureAbort.abort();
      onCleanup();
      try {
        if (typeof wrapper.hasPointerCapture !== 'function' || wrapper.hasPointerCapture(pointerId)) {
          wrapper.releasePointerCapture(pointerId);
        }
      } catch { /* Capture may already have ended or be synthetic. */ }
      if (activeGestureCleanup === cleanup) activeGestureCleanup = null;
    };
    activeGestureCleanup = cleanup;
    return { cleanup, signal: gestureAbort.signal };
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !cursorModeAllowsGesture(wrapper)) return;
    const mode = useChartCursorStore.getState().mode;
    if (mode === 'demonstration') {
      if (!event.altKey) return;
      if (event.target instanceof Element && event.target.closest(ERASER_IGNORE)) return;
      if (wrapper.dataset.chartContextId) activateActiveChartSource(wrapper.dataset.chartContextId);
      event.preventDefault();
      event.stopPropagation();
      const points = [localPoint(wrapper, event)];
      const mark = document.createElementNS(svgNs, 'g');
      mark.setAttribute('class', 'rtx-demonstration-mark');
      ensureDemonstrationLayer(wrapper).appendChild(mark);
      const path = createDemonstrationPath(mark);
      paintDemonstration(path, points);
      let paintFrame = 0;
      let completed = false;
      const paint = () => {
        paintFrame = 0;
        paintDemonstration(path, points);
      };
      const schedulePaint = () => {
        if (paintFrame === 0) paintFrame = window.requestAnimationFrame(paint);
      };
      const flushPaint = () => {
        if (paintFrame !== 0) window.cancelAnimationFrame(paintFrame);
        paintFrame = 0;
        paintDemonstration(path, points);
      };
      const gesture = beginGesture(event.pointerId, () => {
        if (paintFrame !== 0) window.cancelAnimationFrame(paintFrame);
        paintFrame = 0;
        if (!completed) mark.remove();
      });
      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== event.pointerId) return;
        if (appendSampledPoint(points, localPoint(wrapper, move))) schedulePaint();
      };
      const finish = (up?: PointerEvent) => {
        if (up && up.pointerId !== event.pointerId) return;
        if (up) appendSampledPoint(points, localPoint(wrapper, up), true);
        flushPaint();
        completed = true;
        gesture.cleanup();
        scheduleDemonstrationFade(mark);
      };
      window.addEventListener('pointermove', onMove, { capture: true, signal: gesture.signal });
      window.addEventListener('pointerup', finish, { capture: true, signal: gesture.signal });
      window.addEventListener('pointercancel', finish, { capture: true, signal: gesture.signal });
      window.addEventListener('blur', () => finish(), { signal: gesture.signal });
      wrapper.addEventListener('lostpointercapture', finish, { signal: gesture.signal });
      try { wrapper.setPointerCapture(event.pointerId); } catch { /* Synthetic events have no capture. */ }
      return;
    }
    if (mode === 'magic') {
      if (event.target instanceof Element && event.target.closest(ERASER_IGNORE)) return;
      const origin = localPoint(wrapper, event);
      burstMagic(wrapper, origin.x, origin.y);
      let lastBurst = 0;
      const gesture = beginGesture(event.pointerId, () => undefined);
      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== event.pointerId || move.buttons === 0) return;
        const now = performance.now();
        if (now - lastBurst < 48) return;
        lastBurst = now;
        const next = localPoint(wrapper, move);
        burstMagic(wrapper, next.x, next.y, 8);
      };
      const finish = (up?: PointerEvent) => {
        if (up && up.pointerId !== event.pointerId) return;
        gesture.cleanup();
      };
      window.addEventListener('pointermove', onMove, { capture: true, signal: gesture.signal });
      window.addEventListener('pointerup', finish, { capture: true, signal: gesture.signal });
      window.addEventListener('pointercancel', finish, { capture: true, signal: gesture.signal });
      window.addEventListener('blur', () => finish(), { signal: gesture.signal });
      return;
    }
    if (mode !== 'eraser') return;
    if (event.target instanceof Element && event.target.closest(ERASER_IGNORE)) return;
    if (wrapper.dataset.chartContextId) activateActiveChartSource(wrapper.dataset.chartContextId);
    event.preventDefault();
    event.stopPropagation();
    const contextId = wrapper.dataset.chartContextId;
    if (!contextId) return;
    const erased = new Set<string>();
    const eraseAt = (gesture: { clientX: number; clientY: number; target: EventTarget | null }) => {
      const id = drawingIdAt(wrapper, gesture.clientX, gesture.clientY, gesture.target);
      if (id) eraseDrawing(contextId, id, erased);
    };
    eraseAt(event);
    let eraseFrame = 0;
    let pendingErase: { clientX: number; clientY: number; target: EventTarget | null } | null = null;
    const flushErase = () => {
      if (eraseFrame !== 0) window.cancelAnimationFrame(eraseFrame);
      eraseFrame = 0;
      const next = pendingErase;
      pendingErase = null;
      if (next) eraseAt(next);
    };
    const gesture = beginGesture(event.pointerId, () => {
      if (eraseFrame !== 0) window.cancelAnimationFrame(eraseFrame);
      eraseFrame = 0;
      pendingErase = null;
    });
    const onMove = (move: PointerEvent) => {
      if (move.pointerId !== event.pointerId || move.buttons === 0) return;
      pendingErase = { clientX: move.clientX, clientY: move.clientY, target: move.target };
      if (eraseFrame === 0) {
        eraseFrame = window.requestAnimationFrame(() => {
          eraseFrame = 0;
          const next = pendingErase;
          pendingErase = null;
          if (next) eraseAt(next);
        });
      }
    };
    const finish = (up?: PointerEvent) => {
      if (up && up.pointerId !== event.pointerId) return;
      flushErase();
      gesture.cleanup();
    };
    window.addEventListener('pointermove', onMove, { capture: true, signal: gesture.signal });
    window.addEventListener('pointerup', finish, { capture: true, signal: gesture.signal });
    window.addEventListener('pointercancel', finish, { capture: true, signal: gesture.signal });
    window.addEventListener('blur', () => finish(), { signal: gesture.signal });
    wrapper.addEventListener('lostpointercapture', finish, { signal: gesture.signal });
    try { wrapper.setPointerCapture(event.pointerId); } catch { /* Synthetic events have no capture. */ }
  };

  wrapper.addEventListener('pointerdown', onPointerDown, { capture: true, signal: abort.signal });
  return () => {
    activeGestureCleanup?.();
    activeGestureCleanup = null;
    abort.abort();
    unsubscribe();
    wrapper.querySelector(':scope > .rtx-demonstration-layer')?.remove();
    wrapper.querySelector(':scope > .rtx-magic-layer')?.remove();
  };
};

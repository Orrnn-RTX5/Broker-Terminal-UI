import { formatChartAxisPrice } from '../utils/chartPriceScale';
import { formatAreaPointHoverTime } from '../utils/chartTimeFormat';
import type { Time } from 'lightweight-charts';

const HOVER_IGNORE = 'button, a, input, textarea, select, label, [role="button"], .rtx-trade-level-badge, .rtx-trade-level-hit-area, .rtx-chart-text-input-popover';

export interface AreaPointHoverModel {
  price: string;
  date: string;
  time: string;
  /** Bar center, relative to the chart wrapper. */
  x: number;
  /** Close on the area line, relative to the chart wrapper. */
  y: number;
  color: string;
  /** Top of the plot, relative to the wrapper. */
  plotTop: number;
  /** Bottom of the plot, above the time scale. */
  plotBottom: number;
  plotLeft: number;
  plotRight: number;
}

export const buildAreaPointHoverLabel = (
  timeSeconds: number,
  price: number,
  digits: number | null,
  timeframe: string,
  offsetSeconds: number,
  locale = 'en',
): { price: string; date: string; time: string } | null => {
  if (!Number.isFinite(timeSeconds) || !Number.isFinite(price)) return null;
  const stamp = formatAreaPointHoverTime(timeSeconds as Time, timeframe, offsetSeconds, locale);
  if (!stamp) return null;
  return { price: formatChartAxisPrice(price, digits), date: stamp.date, time: stamp.time };
};

/**
 * Area charts follow the cursor with a point on the line and a price/time card.
 * Candles keep the OHLC legend; this readout is only painted when `read` returns a model.
 */
export const installChartAreaHover = (
  wrapper: HTMLElement,
  read: (point: { clientX: number; clientY: number }) => AreaPointHoverModel | null,
): (() => void) => {
  const layer = document.createElement('div');
  layer.className = 'rtx-area-hover';
  layer.dataset.visible = 'false';
  layer.setAttribute('aria-hidden', 'true');

  const line = document.createElement('div');
  line.className = 'rtx-area-hover__line';
  const dot = document.createElement('div');
  dot.className = 'rtx-area-hover__dot';
  const card = document.createElement('div');
  card.className = 'rtx-area-hover__card';
  const price = document.createElement('div');
  price.className = 'rtx-area-hover__price';
  const date = document.createElement('div');
  date.className = 'rtx-area-hover__date';
  const time = document.createElement('div');
  time.className = 'rtx-area-hover__time';
  card.append(price, date, time);
  layer.append(line, dot, card);
  wrapper.appendChild(layer);

  let frame = 0;
  let pending: { clientX: number; clientY: number } | null = null;

  const hide = () => {
    pending = null;
    if (frame !== 0) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }
    layer.dataset.visible = 'false';
  };

  const paint = () => {
    frame = 0;
    const point = pending;
    pending = null;
    if (!point) return;
    const model = read(point);
    if (!model) {
      hide();
      return;
    }

    const plotHeight = Math.max(0, model.plotBottom - model.plotTop);
    line.style.left = `${model.x}px`;
    line.style.top = `${model.plotTop}px`;
    line.style.height = `${plotHeight}px`;

    dot.style.left = `${model.x}px`;
    dot.style.top = `${model.y}px`;
    dot.style.background = model.color;

    price.textContent = model.price;
    date.textContent = model.date;
    time.textContent = model.time;
    time.hidden = model.time.length === 0;

    layer.dataset.visible = 'true';
    const cardWidth = card.offsetWidth;
    const cardHeight = card.offsetHeight;
    let left = model.x + 14;
    let top = model.y - cardHeight / 2;
    if (left + cardWidth > model.plotRight - 8) left = model.x - cardWidth - 14;
    if (top < model.plotTop + 4) top = model.plotTop + 4;
    if (top + cardHeight > model.plotBottom - 4) top = model.plotBottom - cardHeight - 4;
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  };

  const schedule = (clientX: number, clientY: number) => {
    pending = { clientX, clientY };
    if (frame === 0) frame = window.requestAnimationFrame(paint);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.buttons !== 0) {
      hide();
      return;
    }
    if (event.target instanceof Element && event.target.closest(HOVER_IGNORE)) {
      hide();
      return;
    }
    schedule(event.clientX, event.clientY);
  };

  const onPointerLeave = () => {
    hide();
  };

  wrapper.addEventListener('pointermove', onPointerMove);
  wrapper.addEventListener('pointerleave', onPointerLeave);

  return () => {
    if (frame !== 0) window.cancelAnimationFrame(frame);
    wrapper.removeEventListener('pointermove', onPointerMove);
    wrapper.removeEventListener('pointerleave', onPointerLeave);
    layer.remove();
  };
};

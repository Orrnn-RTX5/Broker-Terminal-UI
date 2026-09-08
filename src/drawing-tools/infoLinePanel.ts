import type { InfoLineMetricDisplay, ScreenPoint } from './geometry/tradingViewTrendGeometry';

export interface InfoLinePanelColors {
  background: string;
  text: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT_SIZE = 11;
const ROW_HEIGHT = 26;
const VERTICAL_PADDING = 8;
const TEXT_INSET = 42;
const RIGHT_PADDING = 12;
const EDGE_MARGIN = 4;
const GLYPHS = [
  'M3 1h8M3 13h8M7 3v8M4.5 5.5 7 3 9.5 5.5M4.5 8.5 7 11 9.5 8.5',
  'M1 2v10M13 2v10M3 7h8M5 4.5 2.5 7 5 9.5M9 4.5 11.5 7 9 9.5',
  'M2 12 6.5 2M2 12h11M6 12a4 4 0 0 0-2.35-3.64',
] as const;

let measurementContext: CanvasRenderingContext2D | null = null;

const getMeasurementContext = (): CanvasRenderingContext2D | null => {
  if (measurementContext) return measurementContext;
  if (typeof CanvasRenderingContext2D === 'undefined') return null;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return null;
  const fontFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim()
    || 'sans-serif';
  context.font = `400 ${FONT_SIZE}px ${fontFamily}`;
  measurementContext = context;
  return context;
};

const textWidth = (label: SVGTextElement): number => {
  const value = label.textContent ?? '';
  try {
    // The manager builds each SVG group before attaching it. A cached canvas
    // measures the same font without a layout read on every pointer update.
    const measured = getMeasurementContext()?.measureText(value).width
      ?? (label.isConnected ? label.getComputedTextLength?.() : undefined);
    if (measured !== undefined && Number.isFinite(measured) && measured > 0) return measured;
  } catch {
    // Detached/headless SVGs may not expose font measurements yet.
  }
  return value.length * FONT_SIZE * 0.5;
};

const fitLabel = (label: SVGTextElement, value: string, availableWidth: number): void => {
  if (textWidth(label) <= availableWidth) return;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    label.textContent = `${value.slice(0, midpoint)}\u2026`;
    if (textWidth(label) <= availableWidth) low = midpoint;
    else high = midpoint - 1;
  }
  label.textContent = low > 0 ? `${value.slice(0, low)}\u2026` : '';
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = value;
  label.appendChild(title);
};

/** The returned background can receive whole-drawing drag and context-menu handlers. */
export const appendInfoLinePanel = (
  parent: SVGGElement,
  start: ScreenPoint,
  end: ScreenPoint,
  display: InfoLineMetricDisplay,
  plotWidth: number,
  plotHeight: number,
  themeColors: InfoLinePanelColors,
): SVGRectElement => {
  let priceRow = display.priceChange;
  if (display.percentChange !== null) priceRow += ` (${display.percentChange}%)`;
  if (display.priceSteps !== null) priceRow += `, ${display.priceSteps}`;
  const rows = [
    priceRow,
    `${display.bars} (${display.elapsed}), distance: ${display.pixelDistance}`,
    display.angle,
  ];
  const panel = document.createElementNS(SVG_NS, 'g');
  panel.setAttribute('data-geometry-role', 'info-line-panel');
  parent.appendChild(panel);
  const background = document.createElementNS(SVG_NS, 'rect');
  background.setAttribute('rx', '4');
  background.setAttribute('fill', themeColors.background);
  background.setAttribute('fill-opacity', '0.96');
  background.setAttribute('data-geometry-role', 'measurement-panel');
  background.setAttribute('pointer-events', 'none');
  panel.appendChild(background);

  const labels = rows.map((row, index) => {
    const label = document.createElementNS(SVG_NS, 'text');
    label.textContent = row;
    label.setAttribute('fill', themeColors.text);
    label.setAttribute('font-family', 'var(--font-sans), sans-serif');
    label.setAttribute('font-size', String(FONT_SIZE));
    label.setAttribute('font-weight', '400');
    label.setAttribute('pointer-events', 'none');
    label.setAttribute('data-geometry-role', `measurement-row-${index + 1}`);
    panel.appendChild(label);
    return label;
  });

  const desiredWidth = Math.ceil(Math.max(...labels.map(textWidth)) + TEXT_INSET + RIGHT_PADDING);
  const width = Math.min(desiredWidth, Math.max(0, plotWidth - EDGE_MARGIN * 2));
  const height = rows.length * ROW_HEIGHT + VERTICAL_PADDING * 2;
  const midpointX = (start.x + end.x) / 2;
  const midpointY = (start.y + end.y) / 2;
  const left = Math.max(EDGE_MARGIN, Math.min(midpointX + 12, plotWidth - width - EDGE_MARGIN));
  const above = midpointY - 13 - height;
  const below = midpointY + 13;
  const preferredTop = above >= EDGE_MARGIN ? above : below;
  const top = Math.max(EDGE_MARGIN, Math.min(preferredTop, plotHeight - height - EDGE_MARGIN));
  background.setAttribute('x', String(left));
  background.setAttribute('y', String(top));
  background.setAttribute('width', String(width));
  background.setAttribute('height', String(height));

  labels.forEach((label, index) => {
    const centerY = top + VERTICAL_PADDING + ROW_HEIGHT * (index + 0.5);
    label.setAttribute('x', String(left + TEXT_INSET));
    label.setAttribute('y', String(centerY + 4));
    fitLabel(label, rows[index], Math.max(0, width - TEXT_INSET - RIGHT_PADDING));

    const glyph = document.createElementNS(SVG_NS, 'path');
    glyph.setAttribute('d', GLYPHS[index]);
    glyph.setAttribute('transform', `translate(${left + 14} ${centerY - 7})`);
    glyph.setAttribute('fill', 'none');
    glyph.setAttribute('stroke', themeColors.text);
    glyph.setAttribute('stroke-width', '0.85');
    glyph.setAttribute('stroke-linecap', 'round');
    glyph.setAttribute('stroke-linejoin', 'round');
    glyph.setAttribute('pointer-events', 'none');
    glyph.setAttribute('data-geometry-role', `measurement-glyph-${index + 1}`);
    panel.appendChild(glyph);
  });
  return background;
};

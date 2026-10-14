import { useUiTranslation } from '../hooks/useUiTranslation';
import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useCurrentTick } from '../store/useMarketDataStore';
import { useLiveOrderBook } from '../hooks/useLiveMarketData';
import './DepthOfMarket.css';

export type DepthOrderExecution = 'market' | 'limit';

export interface DepthOrderRequest {
    side: 'BUY' | 'SELL';
    price: number;
    volume: number;
    execution: DepthOrderExecution;
    priceSl?: number;
    priceTp?: number;
}

export const buildDepthOrderRequest = (
  side: DepthOrderRequest['side'],
  price: number,
  volume: number,
  execution: DepthOrderExecution,
  digits: number,
  stopLossPoints = 0,
  takeProfitPoints = 0,
): DepthOrderRequest => {
  const point = 10 ** -Math.max(0, digits);
  const roundPrice = (value: number) => Number(value.toFixed(Math.max(0, digits)));
  const request: DepthOrderRequest = { side, price, volume, execution };

  if (price > 0 && stopLossPoints > 0) {
    request.priceSl = roundPrice(
      side === 'BUY' ? price - (stopLossPoints * point) : price + (stopLossPoints * point),
    );
  }
  if (price > 0 && takeProfitPoints > 0) {
    request.priceTp = roundPrice(
      side === 'BUY' ? price + (takeProfitPoints * point) : price - (takeProfitPoints * point),
    );
  }

  return request;
};

interface DepthOfMarketProps {
    symbol: string;
    onClose?: () => void;
    onPlaceOrder?: (request: DepthOrderRequest) => void;
    onCloseBulk?: (type: 'ALL' | 'WINNERS' | 'LOSERS', symbol?: string) => void;
    onDragHandleMouseDown?: (e: React.MouseEvent) => void;
}

/* ─── Project Theme Fonts (from theme.css) ──────────────────────────── */
const FONT = "var(--font-sans, 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)";
const MONO = "var(--font-mono, 'Roboto Mono', 'Courier New', monospace)";

export const readDepthTypography = () => {
  const style = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
  const readNumber = (name: string, fallback: number) => {
    const value = Number.parseFloat(style?.getPropertyValue(name) || '');
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const fontSize = readNumber('--rtx-ui-font-size', 14);
  const lineHeight = Math.ceil(fontSize * 1.5);
  const isLight = typeof document !== 'undefined' && document.documentElement.classList.contains('rtx-skin-untitled-light');
  const fontFamily = style?.getPropertyValue(isLight ? '--rtx-ui-font-family' : '--font-mono').trim();
  return {
    fontSize,
    lineHeight,
    rowHeight: Math.max(26, lineHeight + 5),
    bodyWeight: readNumber('--rtx-font-weight-body', 400),
    controlWeight: readNumber('--rtx-font-weight-control', 400),
    headingWeight: readNumber('--rtx-font-weight-heading', 500),
    // Canvas2D needs a resolved font string, not CSS custom-property syntax.
    fontFamily: fontFamily && !fontFamily.includes('var(')
      ? fontFamily
      : isLight ? "'Segoe UI', Tahoma, Arial, sans-serif" : "'Courier New', monospace",
  };
};

type DepthTypography = ReturnType<typeof readDepthTypography>;

function useDepthTypography() {
  const [typography, setTypography] = useState(readDepthTypography);
  useEffect(() => {
    const update = () => setTypography(current => {
      const next = readDepthTypography();
      return Object.keys(next).every(key => (
        current[key as keyof DepthTypography] === next[key as keyof DepthTypography]
      )) ? current : next;
    });
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    return () => observer.disconnect();
  }, []);
  return typography;
}

/* ─── Chart display types ──────────────────────────────────────────── */
type ChartMode = 'bar' | 'candlestick' | 'line' | 'tick';

/** Splits a formatted price so the pip digits can carry visual emphasis. */
export const splitPipDigits = (formattedPrice: string): [string, string] => (
  formattedPrice.replace(/[.,]/g, '').length > 2
    ? [formattedPrice.slice(0, -2), formattedPrice.slice(-2)]
    : ['', formattedPrice]
);

/* ─── Dark Charcoal Theme Colors (from theme.css vars) ──────────────── */
const C = {
  bgPrimary:   '#0d0d11',
  bgSecondary: '#131316',
  bgTertiary:  '#191a1e',
  bgElevated:  '#222226',
  bgHover:     '#2a2a30',

  textPrimary:   '#e2e2e8',
  textSecondary: '#808088',
  textTertiary:  '#50505a',
  textDisabled:  '#36363e',

  borderPrimary:   '#28282e',
  borderSecondary: '#333338',
  borderHover:     '#404048',

  profit:    '#00c896',
  profitDim: '#00c89640',
  profitBg:  '#00c89618',
  loss:      '#ff4d4f',
  lossDim:   '#ff4d4f40',
  lossBg:    '#ff4d4f18',

  askBg:     'rgba(255, 77, 79, 0.08)',
  askBgBest: 'rgba(255, 77, 79, 0.18)',
  bidBg:     'rgba(0, 200, 150, 0.06)',
  bidBgBest: 'rgba(0, 200, 150, 0.16)',

  spreadBg:  '#1e1e24',
};

/* ─────────────────────────────────────────────────────────────────────── */
/*  Tick Chart Canvas (Left Panel) — supports bar/candle/line/tick modes  */
/* ─────────────────────────────────────────────────────────────────────── */
interface TickChartProps {
  symbol: string;
  width: number;
  height: number;
  chartMode: ChartMode;
  crosshair: boolean;
  zoomLevel: number; // 1=default, higher=zoomed in
  typography: DepthTypography;
  digits: number;
}

interface TickData {
  bid: number;
  ask: number;
  time: number;
  volume: number;
}

// Aggregate ticks into OHLC bars for candle/bar display
interface OHLCBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  time: number;
}

function aggregateToOHLC(ticks: TickData[], barCount: number): OHLCBar[] {
  if (ticks.length < 2) return [];
  const bars: OHLCBar[] = [];
  const perBar = Math.max(1, Math.floor(ticks.length / barCount));

  for (let i = 0; i < ticks.length; i += perBar) {
    const slice = ticks.slice(i, i + perBar);
    if (slice.length === 0) continue;
    const mid = (p: TickData) => (p.bid + p.ask) / 2;
    const prices = slice.map(mid);
    bars.push({
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1],
      volume: slice.reduce((s, t) => s + (t.volume || 1), 0),
      time: slice[0].time,
    });
  }
  return bars;
}

function TickChart({ symbol, width: fallbackWidth, height, chartMode, crosshair, zoomLevel, typography, digits }: TickChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tickHistoryRef = useRef<TickData[]>([]);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const MAX_TICKS = 500;

  const currentTick = useCurrentTick(symbol);

  // Accumulate ticks
  useEffect(() => {
    if (!currentTick) return;
    const history = tickHistoryRef.current;
    history.push({
      bid: currentTick.bid,
      ask: currentTick.ask,
      time: currentTick.timestamp || Date.now(),
      volume: currentTick.volume || 1,
    });
    if (history.length > MAX_TICKS) {
      history.splice(0, history.length - MAX_TICKS);
    }
  }, [currentTick]);

  // Mouse tracking for crosshair
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!crosshair) { mouseRef.current = null; return; }
    const rect = e.currentTarget.getBoundingClientRect();
    mouseRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, [crosshair]);

  const handleMouseLeave = useCallback(() => {
    mouseRef.current = null;
  }, []);

  // Draw chart at 10fps
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const interval = setInterval(() => {
      const allHistory = tickHistoryRef.current;
      if (allHistory.length < 2) return;

      // The canvas is in a flexible pane; drawing at its CSS width keeps text
      // at the selected size instead of stretching a fixed 250px bitmap.
      const width = canvas.clientWidth || fallbackWidth;
      const bodyFont = `${typography.bodyWeight} ${typography.fontSize}px ${typography.fontFamily}`;
      const controlFont = `${typography.controlWeight} ${typography.fontSize}px ${typography.fontFamily}`;
      const labelHeight = typography.lineHeight + 4;

      // Apply zoom — zoom in shows fewer ticks
      const visibleCount = Math.max(20, Math.floor(MAX_TICKS / zoomLevel));
      const history = allHistory.slice(-visibleCount);

      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      const isLight = document.documentElement.classList.contains('rtx-skin-untitled-light');

      // Dark/Light background
      const themeStyle = getComputedStyle(document.documentElement);
      const lightColor = (name: string, fallback: string) => themeStyle.getPropertyValue(name).trim() || fallback;
      ctx.fillStyle = isLight ? lightColor('--rtx-light-chart', '#d8dde2') : C.bgPrimary;
      ctx.fillRect(0, 0, width, height);

      const chartH = Math.max(labelHeight, (height - labelHeight) * 0.75);
      const volH = Math.max(0, height - chartH - labelHeight - 4);
      const volTop = chartH + 4;
      let minP = Infinity, maxP = -Infinity;
      let maxVol = 1;
      for (const t of history) {
        minP = Math.min(minP, t.bid, t.ask);
        maxP = Math.max(maxP, t.bid, t.ask);
        maxVol = Math.max(maxVol, t.volume);
      }
      const padding = (maxP - minP || 1) * 0.05;
      minP -= padding;
      maxP += padding;
      const totalRange = maxP - minP;

      // Draw grid lines (dark)
      ctx.strokeStyle = isLight ? lightColor('--rtx-light-border', '#bcc6d0') : '#1e1e24';
      ctx.lineWidth = 0.5;
      for (let i = 1; i < 5; i++) {
        const y = (chartH / 5) * i;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
      for (let i = 1; i < 4; i++) {
        const x = (width / 4) * i;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, chartH); ctx.stroke();
      }


      // Price scale on right
      ctx.fillStyle = isLight ? lightColor('--rtx-light-text-muted', '#455365') : C.textTertiary;
      ctx.font = bodyFont;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const priceIntervals = Math.max(1, Math.min(4, Math.floor(chartH / (labelHeight + 4))));
      for (let i = 0; i <= priceIntervals; i++) {
        const y = (chartH / priceIntervals) * i;
        const price = maxP - (i / priceIntervals) * totalRange;
        ctx.fillText(price.toFixed(digits), width - 3, Math.max(labelHeight / 2, Math.min(chartH - labelHeight / 2, y)));
      }

      // === CHART MODE RENDERING ===
      if (chartMode === 'tick' || chartMode === 'line') {
        // Line / Tick mode — draw continuous price line
        // Draw bid line (loss red)
        ctx.strokeStyle = C.loss;
        ctx.lineWidth = chartMode === 'tick' ? 1.0 : 1.5;
        ctx.beginPath();
        for (let i = 0; i < history.length; i++) {
          const x = (i / visibleCount) * width;
          const y = chartH - ((history[i].bid - minP) / totalRange) * chartH;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Draw ask line (profit teal — subtle)
        ctx.strokeStyle = 'rgba(0, 200, 150, 0.45)';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        for (let i = 0; i < history.length; i++) {
          const x = (i / visibleCount) * width;
          const y = chartH - ((history[i].ask - minP) / totalRange) * chartH;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Line mode: fill area under bid line
        if (chartMode === 'line') {
          ctx.beginPath();
          for (let i = 0; i < history.length; i++) {
            const x = (i / visibleCount) * width;
            const y = chartH - ((history[i].bid - minP) / totalRange) * chartH;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          const lastX = ((history.length - 1) / visibleCount) * width;
          ctx.lineTo(lastX, chartH);
          ctx.lineTo(0, chartH);
          ctx.closePath();
          const grad = ctx.createLinearGradient(0, 0, 0, chartH);
          grad.addColorStop(0, 'rgba(255, 77, 79, 0.15)');
          grad.addColorStop(1, 'rgba(255, 77, 79, 0.01)');
          ctx.fillStyle = grad;
          ctx.fill();
        }

        // Tick mode: draw dots at each point
        if (chartMode === 'tick') {
          for (let i = 0; i < history.length; i++) {
            const x = (i / visibleCount) * width;
            const y = chartH - ((history[i].bid - minP) / totalRange) * chartH;
            ctx.beginPath();
            ctx.arc(x, y, 1.5, 0, Math.PI * 2);
            ctx.fillStyle = C.loss;
            ctx.fill();
          }
        }

      } else {
        // Bar / Candlestick mode
        const barCount = Math.min(60, Math.floor(visibleCount / 3));
        const bars = aggregateToOHLC(history, barCount);
        if (bars.length > 0) {
          const bw = Math.max(3, (width / bars.length) - 2);

          // Recalc range for bars
          let bMinP = Infinity, bMaxP = -Infinity;
          for (const b of bars) {
            bMinP = Math.min(bMinP, b.low);
            bMaxP = Math.max(bMaxP, b.high);
          }
          const bPad = (bMaxP - bMinP || 1) * 0.05;
          bMinP -= bPad;
          bMaxP += bPad;
          const bRange = bMaxP - bMinP;

          for (let i = 0; i < bars.length; i++) {
            const bar = bars[i];
            const x = (i / bars.length) * width + bw / 2;
            const isUp = bar.close >= bar.open;
            const color = isUp ? C.profit : C.loss;
            const oY = chartH - ((bar.open - bMinP) / bRange) * chartH;
            const cY = chartH - ((bar.close - bMinP) / bRange) * chartH;
            const hY = chartH - ((bar.high - bMinP) / bRange) * chartH;
            const lY = chartH - ((bar.low - bMinP) / bRange) * chartH;

            if (chartMode === 'candlestick') {
              // Wick
              ctx.strokeStyle = color;
              ctx.lineWidth = 1;
              ctx.beginPath(); ctx.moveTo(x, hY); ctx.lineTo(x, lY); ctx.stroke();
              // Body
              const bodyTop = Math.min(oY, cY);
              const bodyH = Math.max(1, Math.abs(oY - cY));
              ctx.fillStyle = isUp ? C.profit : C.loss;
              ctx.fillRect(x - bw / 2, bodyTop, bw, bodyH);
              // Border
              ctx.strokeStyle = isUp ? '#00a07a' : '#cc3030';
              ctx.lineWidth = 0.5;
              ctx.strokeRect(x - bw / 2, bodyTop, bw, bodyH);
            } else {
              // Bar (OHLC) — wick + left/right ticks
              ctx.strokeStyle = color;
              ctx.lineWidth = 1;
              // Vertical line H-L
              ctx.beginPath(); ctx.moveTo(x, hY); ctx.lineTo(x, lY); ctx.stroke();
              // Open tick (left)
              ctx.beginPath(); ctx.moveTo(x - bw / 2, oY); ctx.lineTo(x, oY); ctx.stroke();
              // Close tick (right)
              ctx.beginPath(); ctx.moveTo(x, cY); ctx.lineTo(x + bw / 2, cY); ctx.stroke();
            }
          }

          // Recalc volume max for bars
          let bMaxVol = 1;
          for (const b of bars) bMaxVol = Math.max(bMaxVol, b.volume);

          // Draw volume bars for OHLC
          for (let i = 0; i < bars.length; i++) {
            const bar = bars[i];
            const x = (i / bars.length) * width + bw / 2;
            const bh = (bar.volume / bMaxVol) * volH;
            const isUp = bar.close >= bar.open;
            ctx.fillStyle = isUp ? 'rgba(0, 200, 150, 0.35)' : 'rgba(255, 77, 79, 0.35)';
            ctx.fillRect(x - bw / 2, volTop + volH - bh, bw, bh);
          }
        }
      }

      // Draw volume bars for tick/line modes
      if (chartMode === 'tick' || chartMode === 'line') {
        const barWidth = Math.max(1, width / visibleCount);
        for (let i = 0; i < history.length; i++) {
          const x = (i / visibleCount) * width;
          const bh = (history[i].volume / maxVol) * volH;
          ctx.fillStyle = 'rgba(0, 200, 150, 0.3)';
          ctx.fillRect(x, volTop + volH - bh, barWidth + 0.5, bh);
        }
      }

      // Border between chart and volume
      ctx.strokeStyle = isLight ? lightColor('--rtx-light-border', '#c5ced9') : C.borderPrimary;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, chartH + 1); ctx.lineTo(width, chartH + 1); ctx.stroke();

      // === CROSSHAIR ===
      if (crosshair && mouseRef.current) {
        const { x: mx, y: my } = mouseRef.current;
        ctx.strokeStyle = isLight ? 'rgba(71, 85, 105, 0.55)' : 'rgba(130, 130, 140, 0.6)';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([4, 3]);
        // Vertical
        ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, height); ctx.stroke();
        // Horizontal
        ctx.beginPath(); ctx.moveTo(0, my); ctx.lineTo(width, my); ctx.stroke();
        ctx.setLineDash([]);

        const badgeBg = isLight ? lightColor('--rtx-light-accent', '#2457a7') : '#333338';
        const badgeFg = isLight ? '#ffffff' : C.textPrimary;

        // Price label at crosshair Y
        if (my <= chartH) {
          const price = maxP - (my / chartH) * totalRange;
          const labelText = price.toFixed(digits);
          ctx.font = bodyFont;
          ctx.fillStyle = badgeBg;
          const tw = ctx.measureText(labelText).width + 8;
          const labelY = Math.max(0, Math.min(chartH - labelHeight, my - labelHeight / 2));
          ctx.fillRect(width - tw - 2, labelY, tw + 2, labelHeight);
          ctx.fillStyle = badgeFg;
          ctx.textAlign = 'right';
          ctx.fillText(labelText, width - 5, labelY + labelHeight / 2);
        }

        // Index label at crosshair X
        const idx = Math.floor((mx / width) * history.length);
        if (idx >= 0 && idx < history.length) {
          const tick = history[idx];
          const d = new Date(tick.time);
          const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
          ctx.font = bodyFont;
          const tw = ctx.measureText(timeStr).width + 8;
          const labelX = Math.max(0, Math.min(width - tw, mx - tw / 2));
          ctx.fillStyle = badgeBg;
          ctx.fillRect(labelX, height - labelHeight, tw, labelHeight);
          ctx.fillStyle = badgeFg;
          ctx.textAlign = 'center';
          ctx.fillText(timeStr, labelX + tw / 2, height - labelHeight / 2);
        }

        // Tooltip with bid/ask at cursor
        if (my <= chartH) {
          const idx2 = Math.min(history.length - 1, Math.max(0, Math.floor((mx / width) * history.length)));
          const t = history[idx2];
          if (t) {
            const tooltipLines = [
              `Bid: ${t.bid.toFixed(digits)}`,
              `Ask: ${t.ask.toFixed(digits)}`,
              `Vol: ${t.volume.toFixed(2)}`,
            ];
            ctx.font = bodyFont;
            const tooltipX = mx + 12;
            const tw = Math.max(...tooltipLines.map(line => ctx.measureText(line).width)) + 12;
            const th = tooltipLines.length * typography.lineHeight + 8;
            const tooltipY = Math.max(0, Math.min(my, chartH - th));
            ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(25, 26, 30, 0.92)';
            ctx.strokeStyle = isLight ? lightColor('--rtx-light-border-strong', '#9eacbd') : C.borderSecondary;
            ctx.lineWidth = 1;
            // Rounded rect
            const rx = Math.max(0, Math.min(tooltipX, width - tw - 4));
            ctx.beginPath();
            ctx.roundRect(rx, tooltipY, tw, th, 4);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = isLight ? lightColor('--rtx-light-text', '#182230') : C.textPrimary;
            ctx.textAlign = 'left';
            tooltipLines.forEach((line, li) => {
              ctx.fillText(line, rx + 6, tooltipY + 4 + typography.lineHeight * (li + 0.5));
            });
          }
        }
      }

      // Current price label on right edge
      if (history.length > 0) {
        const lastTick = history[history.length - 1];
        const lastY = chartH - ((lastTick.bid - minP) / totalRange) * chartH;
        ctx.font = controlFont;
        const priceText = lastTick.bid.toFixed(digits);
        const priceLabelWidth = ctx.measureText(priceText).width + 10;
        const priceLabelY = Math.max(0, Math.min(chartH - labelHeight, lastY - labelHeight / 2));
        // Price line
        ctx.strokeStyle = C.loss;
        ctx.lineWidth = 0.5;
        ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.moveTo(0, lastY); ctx.lineTo(width - priceLabelWidth, lastY); ctx.stroke();
        ctx.setLineDash([]);
        // Label
        ctx.fillStyle = isLight ? lightColor('--rtx-light-quote-down', '#a51f26') : C.loss;
        ctx.fillRect(width - priceLabelWidth, priceLabelY, priceLabelWidth, labelHeight);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(priceText, width - priceLabelWidth / 2, priceLabelY + labelHeight / 2);
      }

    }, 100);

    return () => clearInterval(interval);
  }, [fallbackWidth, height, symbol, chartMode, crosshair, zoomLevel, typography, digits]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height, display: 'block', cursor: crosshair ? 'crosshair' : 'default' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Toolbar (Fully Functional)                                            */
/* ─────────────────────────────────────────────────────────────────────── */
interface DOMToolbarProps {
  chartMode: ChartMode;
  crosshair: boolean;
  onChartModeChange: (mode: ChartMode) => void;
  onToggleCrosshair: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

function DOMToolbar({ chartMode, crosshair, onChartModeChange, onToggleCrosshair, onZoomIn, onZoomOut }: DOMToolbarProps) {
    const tr = useUiTranslation();
  const iconColor = 'var(--text-secondary, #9898a8)';
  const activeColor = 'var(--text-primary, #f0f0f8)';

  const iconBtn = (active: boolean) => `rtx-dom-toolbar-btn ${active ? 'is-active' : ''}`;

  return (
    <div
      className="flex items-center gap-[3px] px-1.5 py-[3px] border-b select-none shrink-0"
      style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-tertiary)' }}
    >
      {/* Bar Chart */}
      <button
        type="button"
        className={iconBtn(chartMode === 'bar')}
        onClick={() => onChartModeChange('bar')}
        title={tr("Bar Chart (OHLC)")}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="5" width="2.5" height="8" rx="0.5" fill={chartMode === 'bar' ? activeColor : iconColor}/>
          <rect x="6.5" y="2" width="2.5" height="12" rx="0.5" fill={chartMode === 'bar' ? activeColor : iconColor}/>
          <rect x="12" y="7" width="2.5" height="5" rx="0.5" fill={chartMode === 'bar' ? activeColor : iconColor}/>
        </svg>
      </button>

      {/* Candlestick */}
      <button
        type="button"
        className={iconBtn(chartMode === 'candlestick')}
        onClick={() => onChartModeChange('candlestick')}
        title={tr("Candlestick Chart")}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          {/* left candle — bearish red */}
          <line x1="4" y1="1" x2="4" y2="15" stroke={chartMode === 'candlestick' ? '#f87171' : iconColor} strokeWidth="1"/>
          <rect x="2" y="4" width="4" height="6" rx="0.5"
            fill={chartMode === 'candlestick' ? 'rgba(248,113,113,0.35)' : 'rgba(152,152,168,0.2)'}
            stroke={chartMode === 'candlestick' ? '#f87171' : iconColor} strokeWidth="1"/>
          {/* right candle — bullish green */}
          <line x1="12" y1="2" x2="12" y2="14" stroke={chartMode === 'candlestick' ? '#34d399' : iconColor} strokeWidth="1"/>
          <rect x="10" y="5" width="4" height="5" rx="0.5"
            fill={chartMode === 'candlestick' ? 'rgba(52,211,153,0.35)' : 'rgba(152,152,168,0.2)'}
            stroke={chartMode === 'candlestick' ? '#34d399' : iconColor} strokeWidth="1"/>
        </svg>
      </button>

      {/* Line Chart */}
      <button
        type="button"
        className={iconBtn(chartMode === 'line')}
        onClick={() => onChartModeChange('line')}
        title={tr("Line Chart")}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <polyline points="1,12 5,6 9,9 15,3"
            stroke={chartMode === 'line' ? '#3b82f6' : iconColor}
            fill="none" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Separator */}
      <div className="w-px h-4 mx-[3px]" style={{ background: 'var(--border-primary, #333338)' }} />

      {/* Tick Chart */}
      <button
        type="button"
        className={iconBtn(chartMode === 'tick')}
        onClick={() => onChartModeChange('tick')}
        title={tr("Tick Chart")}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <polyline points="0,9 3,5 6,10 9,4 12,11 16,3"
            stroke={chartMode === 'tick' ? '#f87171' : iconColor}
            fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Crosshair */}
      <button
        type="button"
        className={iconBtn(crosshair)}
        onClick={onToggleCrosshair}
        title={crosshair ? tr("Crosshair: ON") : tr("Crosshair: OFF")}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <line x1="8" y1="1" x2="8" y2="15"
            stroke={crosshair ? activeColor : iconColor} strokeWidth="1" strokeDasharray="2,1.5"/>
          <line x1="1" y1="8" x2="15" y2="8"
            stroke={crosshair ? activeColor : iconColor} strokeWidth="1" strokeDasharray="2,1.5"/>
          <circle cx="8" cy="8" r="2.5"
            stroke={crosshair ? activeColor : iconColor} fill="none" strokeWidth="1.2"/>
        </svg>
      </button>

      {/* Separator */}
      <div className="w-px h-4 mx-[3px]" style={{ background: 'var(--border-primary, #333338)' }} />

      {/* Zoom In */}
      <button
        type="button"
        className="rtx-dom-toolbar-btn"
        onClick={onZoomIn}
        title={tr("Zoom In")}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="4.5" stroke={iconColor} strokeWidth="1.2"/>
          <line x1="11" y1="11" x2="15" y2="15" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="5" y1="7" x2="9" y2="7" stroke={activeColor} strokeWidth="1.3" strokeLinecap="round"/>
          <line x1="7" y1="5" x2="7" y2="9" stroke={activeColor} strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Zoom Out */}
      <button
        type="button"
        className="rtx-dom-toolbar-btn"
        onClick={onZoomOut}
        title={tr("Zoom Out")}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="4.5" stroke={iconColor} strokeWidth="1.2"/>
          <line x1="11" y1="11" x2="15" y2="15" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="5" y1="7" x2="9" y2="7" stroke={activeColor} strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Main DepthOfMarket Component                                          */
/* ─────────────────────────────────────────────────────────────────────── */
export const DepthOfMarket: React.FC<DepthOfMarketProps> = ({
  symbol,
  onClose,
  onPlaceOrder,
  onCloseBulk,
  onDragHandleMouseDown,
}) => {
    const tr = useUiTranslation();
  const typography = useDepthTypography();
  const currentTick = useCurrentTick(symbol);
  // Inputs keep the raw text while typing (so clearing / "0." intermediates
  // work); orders always use the validated numeric values derived below.
  const [volumeInput, setVolumeInput] = useState('0.01');
  const [slInput, setSlInput] = useState('0');
  const [tpInput, setTpInput] = useState('0');
  const volume = useMemo(() => {
    const parsed = Number.parseFloat(volumeInput);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0.01;
  }, [volumeInput]);
  const sl = useMemo(() => {
    const parsed = Number.parseFloat(slInput);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  }, [slInput]);
  const tp = useMemo(() => {
    const parsed = Number.parseFloat(tpInput);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  }, [tpInput]);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const [mainContentHeight, setMainContentHeight] = useState(280);

  // Toolbar state
  const [chartMode, setChartMode] = useState<ChartMode>('tick');
  const [crosshair, setCrosshair] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);

  const handleZoomIn = useCallback(() => {
    setZoomLevel(prev => Math.min(8, prev * 1.5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomLevel(prev => Math.max(0.5, prev / 1.5));
  }, []);

  const ROW_H = typography.rowHeight;
  const COLUMN_HEADER_HEIGHT = Math.max(30, typography.lineHeight + 8);
  const ladderColumns = 'minmax(64px, 0.8fr) minmax(96px, 1.2fr) 52px';
  const availableForRows = Math.max(ROW_H * 6 * 2, mainContentHeight - COLUMN_HEADER_HEIGHT);
  const dynamicLevels = Math.max(6, Math.floor(availableForRows / ROW_H / 2));
  const { orderBook, loading: depthLoading, error: depthError } = useLiveOrderBook(symbol, dynamicLevels);
  const bestBid = currentTick?.bid ?? orderBook?.bids[0]?.price ?? 0;
  const bestAsk = currentTick?.ask ?? orderBook?.asks[0]?.price ?? 0;
  const hasDepthSurface = Boolean(currentTick || orderBook);

  useEffect(() => {
    const element = mainContentRef.current;
    if (!element) return;

    const updateHeight = () => setMainContentHeight(Math.max(120, element.getBoundingClientRect().height));
    updateHeight();

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setMainContentHeight(Math.max(120, entry.contentRect.height));
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasDepthSurface]);

  const digits = useMemo(() => {
    if (symbol.includes('JPY')) return 3;
    if (symbol.startsWith('BTC') || symbol.startsWith('ETH')) return 2;
    if (symbol.startsWith('XAU') || symbol.startsWith('XAG')) return 2;
    return 5;
  }, [symbol]);

  type DepthLevel = { price: number; volume: number };
  const depthLevels = useMemo(() => {
    if (orderBook && (orderBook.asks.length > 0 || orderBook.bids.length > 0)) {
      const asks = orderBook.asks.slice(0, dynamicLevels).reverse();
      const bids = orderBook.bids.slice(0, dynamicLevels);
      const maxVolume = Math.max(...[...asks, ...bids].map((level) => level.volume), 0);
      return { asks, bids, maxVolume, synthetic: false };
    }

    // Broker without a depth feed: build a one-point price ladder around the
    // live tick so limit-order entry keeps working. Prices are real (derived
    // from the current bid/ask); no liquidity volumes are invented.
    if (bestBid > 0 && bestAsk > 0) {
      const point = 10 ** -digits;
      const roundPrice = (value: number) => Number(value.toFixed(digits));
      const asks: DepthLevel[] = Array.from({ length: dynamicLevels }, (_, index) => ({
        price: roundPrice(bestAsk + (dynamicLevels - 1 - index) * point),
        volume: 0,
      }));
      const bids: DepthLevel[] = Array.from({ length: dynamicLevels }, (_, index) => ({
        price: roundPrice(bestBid - index * point),
        volume: 0,
      }));
      return { asks, bids, maxVolume: 0, synthetic: true };
    }

    return { asks: [] as DepthLevel[], bids: [] as DepthLevel[], maxVolume: 0, synthetic: false };
  }, [orderBook, dynamicLevels, bestBid, bestAsk, digits]);

  const handleCloseAll = useCallback(() => {
    onCloseBulk?.('ALL', symbol);
  }, [onCloseBulk, symbol]);

  if (!currentTick && !orderBook) {
    return (
      <div
        className="rtx-depth-of-market flex flex-col items-center justify-center h-full select-none"
        style={{ background: 'var(--bg-secondary)', fontFamily: FONT, fontSize: typography.fontSize, fontWeight: typography.bodyWeight, lineHeight: 1.5, color: C.textSecondary }}
      >
        <div className="text-center">
          {depthLoading && <div className="w-4 h-4 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin mx-auto mb-2" />}
          {depthError || `Waiting for ${symbol} market depth...`}
        </div>
      </div>
    );
  }

  return (
    <div
      className="rtx-depth-of-market flex flex-col w-full h-full select-none overflow-hidden"
      style={{ background: 'var(--bg-secondary)', fontFamily: FONT, fontSize: typography.fontSize, fontWeight: typography.bodyWeight, lineHeight: 1.5, borderRadius: 10 }}
    >
      {/* ── Title Bar ── */}
      <div
        className="rtx-dom-titlebar flex min-h-[30px] items-center justify-between px-2.5 py-1 border-b shrink-0 cursor-move"
        style={{
          background: 'var(--bg-tertiary)',
          borderColor: 'var(--border-primary)',
          color: C.textPrimary,
          borderRadius: '10px 10px 0 0',
        }}
        onMouseDown={onDragHandleMouseDown as any}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: C.profit, boxShadow: `0 0 4px ${C.profit}99` }} />
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="rtx-depth-of-market__heading uppercase tracking-normal shrink-0" style={{ color: C.textPrimary, fontSize: typography.fontSize, fontWeight: typography.headingWeight }}>
              {symbol}
            </span>
            <span className="rtx-dom-description text-[12px] leading-[18px] font-normal truncate" style={{ color: C.textTertiary, letterSpacing: 'normal' }}>
              {symbol.startsWith('BTC') ? tr("Bitcoin vs US Dollar") : symbol.startsWith('ETH') ? tr("Ethereum vs US Dollar") : symbol.startsWith('XAU') ? tr("Gold vs US Dollar") : symbol.startsWith('XAG') ? tr("Silver vs US Dollar") : symbol.replace(/([A-Z]{3})([A-Z]{3})/, '$1 / $2')}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <span className="rtx-dom-drag-hint" aria-hidden="true" title={tr("Drag to move")}>
            <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
              <circle cx="3" cy="3" r="1.1" /><circle cx="7" cy="3" r="1.1" />
              <circle cx="3" cy="7" r="1.1" /><circle cx="7" cy="7" r="1.1" />
              <circle cx="3" cy="11" r="1.1" /><circle cx="7" cy="11" r="1.1" />
            </svg>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rtx-dom-icon-btn rtx-dom-icon-btn--danger"
            onMouseDown={e => e.stopPropagation()}
            title={tr("Close")}
            aria-label={tr("Close")}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <line x1="2.5" y1="2.5" x2="9.5" y2="9.5" />
              <line x1="9.5" y1="2.5" x2="2.5" y2="9.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Toolbar (Functional) ── */}
      <DOMToolbar
        chartMode={chartMode}
        crosshair={crosshair}
        onChartModeChange={setChartMode}
        onToggleCrosshair={() => setCrosshair(prev => !prev)}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
      />

      {/* ── Main Content: Tick Chart + DOM Table ── */}
      <div ref={mainContentRef} className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left: Tick Chart ── */}
        <div className="flex-[55] border-r min-w-0" style={{ borderColor: 'var(--border-primary)' }}>
          <TickChart
            symbol={symbol}
            width={250}
            height={mainContentHeight}
            chartMode={chartMode}
            crosshair={crosshair}
            zoomLevel={zoomLevel}
            typography={typography}
            digits={digits}
          />
        </div>

        {/* ── Right: DOM Table ── */}
        <div className="flex-[45] flex flex-col min-w-[228px] overflow-hidden">
          {/* Column Headers */}
          <div
            className="rtx-depth-of-market__columns grid shrink-0 border-b"
            style={{
              gridTemplateColumns: ladderColumns,
              minHeight: COLUMN_HEADER_HEIGHT,
              fontSize: typography.fontSize,
              fontWeight: typography.controlWeight,
              borderColor: 'var(--border-primary)',
              background: 'var(--bg-tertiary)',
            }}
          >
            <div
              className="flex items-center justify-center border-r uppercase"
              style={{ borderColor: 'var(--border-primary)', color: C.textTertiary, letterSpacing: '0.06em' }}
              title={depthLevels.synthetic ? tr("No depth feed for this symbol — showing a price ladder around the live quote") : undefined}
            >
              {tr("Volume")}</div>
            <div className="flex items-center justify-center border-r uppercase" style={{ borderColor: 'var(--border-primary)', color: C.textTertiary, letterSpacing: '0.06em' }}>
              {tr("Price")}</div>
            <div className="flex items-center justify-center uppercase" style={{ color: C.textTertiary, letterSpacing: '0.06em' }}>
              {tr("Trade")}</div>
          </div>

          {/* Scrollable Price Levels */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ background: 'var(--bg-secondary)' }}>
            {depthLevels.asks.length === 0 && depthLevels.bids.length === 0 && (
              <div className="flex items-center justify-center h-full px-3 text-center text-[14px] leading-[21px] font-normal" style={{ color: C.textTertiary }}>
                {depthLoading ? tr("Loading market depth...") : depthError || tr("No market depth available")}
              </div>
            )}
            {/* ── ASK (Sell) rows ── */}
            {depthLevels.asks.map((level, i) => {
              const isNearSpread = i === depthLevels.asks.length - 1;
              const volPct = depthLevels.maxVolume > 0 ? (level.volume / depthLevels.maxVolume) * 100 : 0;
              const [priceBase, pricePips] = splitPipDigits(level.price.toFixed(digits));
              return (
                <div
                  key={`ask-${i}`}
                  className={`rtx-depth-of-market__row rtx-dom-level ${isNearSpread ? 'rtx-dom-level--best-ask' : ''} grid`}
                  style={{
                    gridTemplateColumns: ladderColumns,
                    height: ROW_H,
                    background: isNearSpread ? C.askBgBest : C.askBg,
                    borderBottom: '1px solid var(--border-primary)',
                  }}
                  onClick={() => onPlaceOrder?.(buildDepthOrderRequest('SELL', level.price, volume, 'limit', digits, sl, tp))}
                  onMouseDown={e => e.stopPropagation()}
                >
                  <div className="relative flex items-center justify-end pr-1 border-r" style={{ borderColor: 'var(--border-primary)' }}>
                    <div className="rtx-dom-volbar absolute left-0 top-0 bottom-0" style={{ width: `${volPct}%`, background: C.lossDim }} />
                    {level.volume > 0 && (
                      <span className="relative z-10" style={{ fontFamily: MONO, color: C.loss, opacity: isNearSpread ? 1 : 0.75 }}>
                        {level.volume.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-end pr-2 border-r" style={{ borderColor: 'var(--border-primary)' }}>
                    <span className="rtx-dom-price rtx-dom-price--ask" style={{ fontFamily: MONO, fontSize: typography.fontSize, color: '#e58a8a' }}>
                      {priceBase}<span style={{ color: '#fca5a5', fontWeight: 600 }}>{pricePips}</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-center">
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); onPlaceOrder?.(buildDepthOrderRequest('SELL', level.price, volume, 'limit', digits, sl, tp)); }}
                      onMouseDown={e => e.stopPropagation()}
                      className="rtx-dom-trade-btn"
                      style={{ color: C.loss }}
                      title={tr("Sell @ {{value0}}", { value0: level.price.toFixed(digits) })}
                      aria-label={tr("Sell @ {{value0}}", { value0: level.price.toFixed(digits) })}
                    >▼</button>
                  </div>
                </div>
              );
            })}

            {/* ── Spread row ── */}
            {(bestBid > 0 || bestAsk > 0) && (
              <div
                className="rtx-depth-of-market__row rtx-dom-spread flex items-center justify-center gap-1.5"
                style={{
                  height: ROW_H,
                  background: 'var(--bg-quaternary)',
                  borderBottom: '1px solid var(--border-secondary)',
                  borderTop: '1px solid var(--border-secondary)',
                }}
              >
                <span className="uppercase" style={{ color: C.textTertiary, fontSize: 11, letterSpacing: '0.08em' }}>
                  {tr("Spread")}</span>
                <span style={{ fontFamily: MONO, color: '#7aacca' }}>
                  {((bestAsk - bestBid) * Math.pow(10, digits)).toFixed(1)}</span>
                <span className="uppercase" style={{ color: C.textTertiary, fontSize: 11, letterSpacing: '0.08em' }}>
                  {tr(" pts")}</span>
              </div>
            )}

            {/* ── BID (Buy) rows ── */}
            {depthLevels.bids.map((level, i) => {
              const isNearSpread = i === 0;
              const volPct = depthLevels.maxVolume > 0 ? (level.volume / depthLevels.maxVolume) * 100 : 0;
              const [priceBase, pricePips] = splitPipDigits(level.price.toFixed(digits));
              return (
                <div
                  key={`bid-${i}`}
                  className={`rtx-depth-of-market__row rtx-dom-level ${isNearSpread ? 'rtx-dom-level--best-bid' : ''} grid`}
                  style={{
                    gridTemplateColumns: ladderColumns,
                    height: ROW_H,
                    background: isNearSpread ? C.bidBgBest : C.bidBg,
                    borderBottom: '1px solid var(--border-primary)',
                  }}
                  onClick={() => onPlaceOrder?.(buildDepthOrderRequest('BUY', level.price, volume, 'limit', digits, sl, tp))}
                  onMouseDown={e => e.stopPropagation()}
                >
                  <div className="relative flex items-center justify-end pr-1 border-r" style={{ borderColor: 'var(--border-primary)' }}>
                    <div className="rtx-dom-volbar absolute left-0 top-0 bottom-0" style={{ width: `${volPct}%`, background: C.profitDim }} />
                    {level.volume > 0 && (
                      <span className="relative z-10" style={{ fontFamily: MONO, color: C.profit, opacity: isNearSpread ? 1 : 0.75 }}>
                        {level.volume.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-end pr-2 border-r" style={{ borderColor: 'var(--border-primary)' }}>
                    <span className="rtx-dom-price rtx-dom-price--bid" style={{ fontFamily: MONO, fontSize: typography.fontSize, color: '#7ba4e0' }}>
                      {priceBase}<span style={{ color: '#93c5fd', fontWeight: 600 }}>{pricePips}</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-center">
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); onPlaceOrder?.(buildDepthOrderRequest('BUY', level.price, volume, 'limit', digits, sl, tp)); }}
                      onMouseDown={e => e.stopPropagation()}
                      className="rtx-dom-trade-btn"
                      style={{ color: C.profit }}
                      title={tr("Buy @ {{value0}}", { value0: level.price.toFixed(digits) })}
                      aria-label={tr("Buy @ {{value0}}", { value0: level.price.toFixed(digits) })}
                    >▲</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Bottom Controls: SL | Volume | TP ── */}
      <div
        className="flex items-center justify-between gap-2 px-2 py-[5px] border-t shrink-0"
        style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-tertiary)' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5">
          <span className="rtx-dom-stepper__label">{tr("sl")}</span>
          <div className="rtx-dom-stepper" title={tr("Stop Loss distance in points (0 = off)")}>
            <button type="button" className="rtx-dom-stepper__btn" onClick={() => setSlInput(String(Math.max(0, sl - 1)))} aria-label={tr("Decrease Stop Loss")}>−</button>
            <input
              type="number"
              value={slInput}
              min={0}
              step={1}
              onChange={e => setSlInput(e.target.value)}
              onBlur={() => setSlInput(String(sl))}
              className="rtx-dom-stepper__input"
              style={{ fontFamily: MONO }}
              aria-label={tr("Stop Loss points")}
            />
            <button type="button" className="rtx-dom-stepper__btn" onClick={() => setSlInput(String(sl + 1))} aria-label={tr("Increase Stop Loss")}>+</button>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="rtx-dom-stepper__label">{tr("Volume")}</span>
          <div className="rtx-dom-stepper" title={tr("Order volume in lots")}>
            <button type="button" className="rtx-dom-stepper__btn" onClick={() => setVolumeInput(Math.max(0.01, Math.round((volume - 0.01) * 100) / 100).toFixed(2))} aria-label={tr("Decrease volume")}>−</button>
            <input
              type="number"
              value={volumeInput}
              min={0.01}
              step={0.01}
              onChange={e => setVolumeInput(e.target.value)}
              onBlur={() => setVolumeInput(volume.toFixed(2))}
              className="rtx-dom-stepper__input"
              style={{ fontFamily: MONO, color: '#93c5fd' }}
              aria-label={tr("Order volume in lots")}
            />
            <button type="button" className="rtx-dom-stepper__btn" onClick={() => setVolumeInput((Math.round((volume + 0.01) * 100) / 100).toFixed(2))} aria-label={tr("Increase volume")}>+</button>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="rtx-dom-stepper__label">{tr("tp")}</span>
          <div className="rtx-dom-stepper" title={tr("Take Profit distance in points (0 = off)")}>
            <button type="button" className="rtx-dom-stepper__btn" onClick={() => setTpInput(String(Math.max(0, tp - 1)))} aria-label={tr("Decrease Take Profit")}>−</button>
            <input
              type="number"
              value={tpInput}
              min={0}
              step={1}
              onChange={e => setTpInput(e.target.value)}
              onBlur={() => setTpInput(String(tp))}
              className="rtx-dom-stepper__input"
              style={{ fontFamily: MONO }}
              aria-label={tr("Take Profit points")}
            />
            <button type="button" className="rtx-dom-stepper__btn" onClick={() => setTpInput(String(tp + 1))} aria-label={tr("Increase Take Profit")}>+</button>
          </div>
        </div>
      </div>

      {/* ── Sell / Close / Buy Buttons ── */}
      <div className="flex shrink-0" style={{ borderTop: '1px solid var(--border-primary)' }}>
        <button
          type="button"
          onClick={() => onPlaceOrder?.(buildDepthOrderRequest('SELL', bestBid, volume, 'market', digits, sl, tp))}
          onMouseDown={e => e.stopPropagation()}
          className="rtx-dom-exec-btn rtx-dom-exec-btn--sell"
          style={{ borderRight: `1px solid ${C.bgSecondary}` }}
          title={tr("Sell {{value0}} at market", { value0: volume.toFixed(2) })}
        >
          <span className="rtx-dom-exec-btn__caption">{tr("Sell")}</span>
          <span className="rtx-dom-exec-btn__price">{bestBid > 0 ? bestBid.toFixed(digits) : '—'}</span>
        </button>
        <button
          type="button"
          onClick={handleCloseAll}
          onMouseDown={e => e.stopPropagation()}
          className="rtx-dom-exec-btn rtx-dom-exec-btn--flat"
          style={{ borderRight: `1px solid ${C.bgSecondary}` }}
          title={tr("Close all {{value0}} positions", { value0: symbol })}
        >
          <span className="rtx-dom-exec-btn__caption">{tr("Close All")}</span>
          <span className="rtx-dom-exec-btn__price" style={{ fontSize: 12, fontWeight: 400, opacity: 0.8 }}>{symbol}</span>
        </button>
        <button
          type="button"
          onClick={() => onPlaceOrder?.(buildDepthOrderRequest('BUY', bestAsk, volume, 'market', digits, sl, tp))}
          onMouseDown={e => e.stopPropagation()}
          className="rtx-dom-exec-btn rtx-dom-exec-btn--buy"
          title={tr("Buy {{value0}} at market", { value0: volume.toFixed(2) })}
        >
          <span className="rtx-dom-exec-btn__caption">{tr("Buy")}</span>
          <span className="rtx-dom-exec-btn__price">{bestAsk > 0 ? bestAsk.toFixed(digits) : '—'}</span>
        </button>
      </div>
    </div>
  );
};

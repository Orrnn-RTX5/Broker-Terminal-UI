import { useUiTranslation } from '../hooks/useUiTranslation';
import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useCurrentTick } from '../store/useMarketDataStore';
import { useLiveOrderBook } from '../hooks/useLiveMarketData';
import { formatPrice } from '../utils/symbolUtils';
import { getFallbackSymbolDescription } from '../utils/symbolDescription';
import { inferObservedPriceDigits } from '../utils/chartPriceScale';
import { readRegisteredSymbolPriceSpec } from '../services/dailyChangePriceModeRegistry';
import { resolveMarketWatchPriceDigits } from './market-watch/marketWatchPanelModel';
import {
  buildDepthOrderRequest,
  depthExecutionForLevel,
  readDepthTypography,
  splitLadderPrice,
} from './depthOfMarketModel';
import type { DepthOrderRequest } from './depthOfMarketModel';
import './DepthOfMarket.css';

export type { DepthOrderExecution, DepthOrderRequest } from './depthOfMarketModel';

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

/* ─── Dark Charcoal Theme Colors (from theme.css vars) ──────────────── */
const C = {
  bgPrimary:   '#0f1117',
  bgSecondary: '#14171f',
  bgTertiary:  '#1a1e29',
  bgElevated:  '#222735',
  bgHover:     '#282e3e',

  textPrimary:   '#f1f5f9',
  textSecondary: '#94a3b8',
  textTertiary:  '#64748b',
  textDisabled:  '#475569',

  borderPrimary:   '#262b38',
  borderSecondary: '#333a4b',
  borderHover:     '#475569',

  profit:    '#4597ff',
  profitDim: 'rgba(69, 151, 255, 0.22)',
  profitBg:  'rgba(69, 151, 255, 0.10)',
  loss:      '#ff5858',
  lossDim:   'rgba(255, 88, 88, 0.22)',
  lossBg:    'rgba(255, 88, 88, 0.10)',

  askBg:     'rgba(255, 88, 88, 0.04)',
  askBgBest: 'rgba(255, 88, 88, 0.14)',
  bidBg:     'rgba(69, 151, 255, 0.04)',
  bidBgBest: 'rgba(69, 151, 255, 0.14)',

  spreadBg:  '#1a1e29',
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
  digits: number | null;
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

  // Draw chart at 10fps (plus immediate draw when props or tick update)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const renderFrame = () => {
      const rawHistory = tickHistoryRef.current;
      const allHistory = rawHistory.length >= 2
        ? rawHistory
        : rawHistory.length === 1
          ? [rawHistory[0], rawHistory[0]]
          : currentTick
            ? [
                { bid: currentTick.bid, ask: currentTick.ask, time: currentTick.timestamp || Date.now(), volume: currentTick.volume || 1 },
                { bid: currentTick.bid, ask: currentTick.ask, time: currentTick.timestamp || Date.now(), volume: currentTick.volume || 1 },
              ]
            : [];
      if (allHistory.length < 2) return;

      const width = canvas.clientWidth || fallbackWidth;
      const bodyFont = `${typography.bodyWeight} ${typography.fontSize}px ${typography.fontFamily}`;
      const controlFont = `${typography.controlWeight} ${typography.fontSize}px ${typography.fontFamily}`;
      const labelHeight = typography.lineHeight + 4;

      const visibleCount = Math.max(20, Math.floor(MAX_TICKS / zoomLevel));
      const history = allHistory.slice(-visibleCount);

      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      const isLight = document.documentElement.classList.contains('rtx-skin-untitled-light');
      const upColor = isLight ? '#2563eb' : '#4597ff';
      const downColor = isLight ? '#dc2626' : '#ff5858';

      const themeStyle = getComputedStyle(document.documentElement);
      const lightColor = (name: string, fallback: string) => themeStyle.getPropertyValue(name).trim() || fallback;
      ctx.fillStyle = isLight ? lightColor('--rtx-light-panel', '#fafbfc') : C.bgPrimary;
      ctx.fillRect(0, 0, width, height);

      const chartH = Math.max(labelHeight, (height - labelHeight) * 0.78);
      const volH = Math.max(0, height - chartH - labelHeight - 6);
      const volTop = chartH + 4;
      let minP = Infinity, maxP = -Infinity;
      let minVol = Infinity, maxVol = 1;
      for (const t of history) {
        minP = Math.min(minP, t.bid, t.ask);
        maxP = Math.max(maxP, t.bid, t.ask);
        minVol = Math.min(minVol, t.volume);
        maxVol = Math.max(maxVol, t.volume);
      }
      const spreadSpan = Math.max(maxP - minP, (history[history.length - 1]?.ask - history[history.length - 1]?.bid) || 1);
      const padding = spreadSpan * 0.18;
      minP -= padding;
      maxP += padding;
      const totalRange = Math.max(maxP - minP, 1e-9);

      const scaleDigits = digits ?? inferObservedPriceDigits(null, [minP, maxP, currentTick?.bid, currentTick?.ask]) ?? 5;
      ctx.font = bodyFont;
      const sampleLabel = formatPrice(maxP, scaleDigits);
      const axisWidth = Math.min(Math.max(58, ctx.measureText(sampleLabel).width + 14), Math.floor(width * 0.36));
      const plotWidth = Math.max(40, width - axisWidth);
      const plotLeft = 6;
      const plotInnerW = Math.max(20, plotWidth - plotLeft - 6);

      // Right price-axis background strip
      ctx.fillStyle = isLight ? lightColor('--rtx-light-panel-subtle', '#f1f5f9') : '#12151e';
      ctx.fillRect(plotWidth, 0, axisWidth, height);

      // Subtle dashed grid lines inside plot area
      ctx.strokeStyle = isLight ? 'rgba(100, 116, 139, 0.14)' : 'rgba(148, 163, 184, 0.08)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 5; i++) {
        const y = Math.round((chartH / 5) * i) + 0.5;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotWidth, y); ctx.stroke();
      }
      for (let i = 1; i < 4; i++) {
        const x = Math.round((plotWidth / 4) * i) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, chartH); ctx.stroke();
      }

      // Vertical separator between plot and price scale
      ctx.strokeStyle = isLight ? lightColor('--rtx-light-border', '#cbd5e1') : C.borderPrimary;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(plotWidth + 0.5, 0); ctx.lineTo(plotWidth + 0.5, height); ctx.stroke();

      // Price scale on right (skip labels that would collide with the live price badge)
      const lastLabelCenterY = history.length > 0
        ? Math.max(labelHeight / 2, Math.min(chartH - labelHeight / 2, chartH - ((history[history.length - 1].bid - minP) / totalRange) * chartH))
        : null;
      ctx.fillStyle = isLight ? lightColor('--rtx-light-text-secondary', '#475569') : C.textSecondary;
      ctx.font = bodyFont;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const priceIntervals = Math.max(1, Math.min(4, Math.floor(chartH / (labelHeight + 6))));
      for (let i = 0; i <= priceIntervals; i++) {
        const y = (chartH / priceIntervals) * i;
        const clampedY = Math.max(labelHeight / 2, Math.min(chartH - labelHeight / 2, y));
        if (lastLabelCenterY !== null && Math.abs(clampedY - lastLabelCenterY) < labelHeight * 0.95) continue;
        const price = maxP - (i / priceIntervals) * totalRange;
        ctx.fillText(formatPrice(price, scaleDigits), width - 5, clampedY);
      }

      const pointCount = Math.max(history.length - 1, 1);
      const xForIndex = (index: number) => plotLeft + (index / pointCount) * plotInnerW;

      // === CHART MODE RENDERING ===
      if (chartMode === 'tick' || chartMode === 'line') {
        // Area fill under Bid line
        ctx.beginPath();
        for (let i = 0; i < history.length; i++) {
          const x = xForIndex(i);
          const y = chartH - ((history[i].bid - minP) / totalRange) * chartH;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.lineTo(xForIndex(history.length - 1), chartH);
        ctx.lineTo(xForIndex(0), chartH);
        ctx.closePath();
        if (typeof ctx.createLinearGradient === 'function') {
          const grad = ctx.createLinearGradient(0, 0, 0, chartH);
          grad.addColorStop(0, isLight ? 'rgba(220, 38, 38, 0.12)' : 'rgba(255, 88, 88, 0.16)');
          grad.addColorStop(1, isLight ? 'rgba(220, 38, 38, 0.01)' : 'rgba(255, 88, 88, 0.01)');
          ctx.fillStyle = grad;
        } else {
          ctx.fillStyle = isLight ? 'rgba(220, 38, 38, 0.06)' : 'rgba(255, 88, 88, 0.08)';
        }
        ctx.fill();

        // Draw Ask line (Blue — dashed)
        ctx.strokeStyle = isLight ? 'rgba(37, 99, 235, 0.75)' : 'rgba(69, 151, 255, 0.75)';
        ctx.lineWidth = 1.25;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        for (let i = 0; i < history.length; i++) {
          const x = xForIndex(i);
          const y = chartH - ((history[i].ask - minP) / totalRange) * chartH;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw Bid line (Red — solid)
        ctx.strokeStyle = downColor;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let i = 0; i < history.length; i++) {
          const x = xForIndex(i);
          const y = chartH - ((history[i].bid - minP) / totalRange) * chartH;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Tick mode: draw subtle nodes at latest points
        if (chartMode === 'tick') {
          const step = Math.max(1, Math.floor(history.length / 28));
          for (let i = 0; i < history.length; i += step) {
            const x = xForIndex(i);
            const y = chartH - ((history[i].bid - minP) / totalRange) * chartH;
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fillStyle = downColor;
            ctx.fill();
          }
        }
      } else {
        // Bar / Candlestick mode
        const barCount = Math.max(6, Math.min(36, Math.floor(history.length / 2) || 6));
        const bars = aggregateToOHLC(history, barCount);
        if (bars.length > 0) {
          const slotW = plotInnerW / Math.max(bars.length, 1);
          const bw = Math.max(3, Math.min(12, slotW * 0.65));

          let bMinP = Infinity, bMaxP = -Infinity;
          for (const b of bars) {
            bMinP = Math.min(bMinP, b.low);
            bMaxP = Math.max(bMaxP, b.high);
          }
          const bPad = (bMaxP - bMinP || 1) * 0.12;
          bMinP -= bPad;
          bMaxP += bPad;
          const bRange = Math.max(bMaxP - bMinP, 1e-9);

          for (let i = 0; i < bars.length; i++) {
            const bar = bars[i];
            const x = plotLeft + (i + 0.5) * slotW;
            const isUp = bar.close >= bar.open;
            const color = isUp ? upColor : downColor;
            const oY = chartH - ((bar.open - bMinP) / bRange) * chartH;
            const cY = chartH - ((bar.close - bMinP) / bRange) * chartH;
            const hY = chartH - ((bar.high - bMinP) / bRange) * chartH;
            const lY = chartH - ((bar.low - bMinP) / bRange) * chartH;

            if (chartMode === 'candlestick') {
              ctx.strokeStyle = color;
              ctx.lineWidth = 1.2;
              ctx.beginPath(); ctx.moveTo(x, hY); ctx.lineTo(x, lY); ctx.stroke();
              const bodyTop = Math.min(oY, cY);
              const bodyH = Math.max(2, Math.abs(oY - cY));
              ctx.fillStyle = color;
              ctx.fillRect(x - bw / 2, bodyTop, bw, bodyH);
            } else {
              ctx.strokeStyle = color;
              ctx.lineWidth = 1.3;
              ctx.beginPath(); ctx.moveTo(x, hY); ctx.lineTo(x, lY); ctx.stroke();
              ctx.beginPath(); ctx.moveTo(x - bw / 2, oY); ctx.lineTo(x, oY); ctx.stroke();
              ctx.beginPath(); ctx.moveTo(x, cY); ctx.lineTo(x + bw / 2, cY); ctx.stroke();
            }
          }

          let bMaxVol = 1;
          let bMinVol = Infinity;
          for (const b of bars) {
            bMaxVol = Math.max(bMaxVol, b.volume);
            bMinVol = Math.min(bMinVol, b.volume);
          }
          const uniformBarVol = bMaxVol <= bMinVol;

          for (let i = 0; i < bars.length; i++) {
            const bar = bars[i];
            const x = plotLeft + (i + 0.5) * slotW;
            const bh = uniformBarVol ? volH * 0.32 : (bar.volume / bMaxVol) * (volH * 0.72);
            const isUp = bar.close >= bar.open;
            ctx.fillStyle = isUp
              ? (isLight ? 'rgba(37, 99, 235, 0.28)' : 'rgba(69, 151, 255, 0.30)')
              : (isLight ? 'rgba(220, 38, 38, 0.28)' : 'rgba(255, 88, 88, 0.30)');
            ctx.fillRect(x - bw / 2, volTop + volH - bh, bw, bh);
          }
        }
      }

      // Draw volume bars for tick/line modes (spread cleanly across plot area)
      if ((chartMode === 'tick' || chartMode === 'line') && volH > 4) {
        const uniformVol = maxVol <= minVol;
        const slotW = plotInnerW / Math.max(history.length, 1);
        const barWidth = Math.max(1.5, Math.min(6, slotW * 0.65));
        for (let i = 0; i < history.length; i++) {
          const x = xForIndex(i) - barWidth / 2;
          const bh = uniformVol ? volH * 0.28 : (history[i].volume / maxVol) * (volH * 0.68);
          const isUp = i === 0 || history[i].bid >= history[i - 1].bid;
          ctx.fillStyle = isUp
            ? (isLight ? 'rgba(37, 99, 235, 0.24)' : 'rgba(69, 151, 255, 0.26)')
            : (isLight ? 'rgba(220, 38, 38, 0.24)' : 'rgba(255, 88, 88, 0.26)');
          ctx.fillRect(x, volTop + volH - bh, barWidth, bh);
        }
      }

      // Border between chart and volume
      ctx.strokeStyle = isLight ? lightColor('--rtx-light-border', '#cbd5e1') : C.borderPrimary;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, Math.round(chartH) + 0.5); ctx.lineTo(plotWidth, Math.round(chartH) + 0.5); ctx.stroke();

      // === CROSSHAIR ===
      if (crosshair && mouseRef.current) {
        const { x: mx, y: my } = mouseRef.current;
        const clampedMx = Math.min(mx, plotWidth);
        ctx.strokeStyle = isLight ? 'rgba(71, 85, 105, 0.55)' : 'rgba(148, 163, 184, 0.55)';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(clampedMx, 0); ctx.lineTo(clampedMx, height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, my); ctx.lineTo(plotWidth, my); ctx.stroke();
        ctx.setLineDash([]);

        const badgeBg = isLight ? lightColor('--rtx-light-accent', '#2563eb') : '#334155';
        const badgeFg = '#ffffff';

        if (my <= chartH) {
          const price = maxP - (my / chartH) * totalRange;
          const labelText = formatPrice(price, digits ?? undefined);
          ctx.font = bodyFont;
          ctx.fillStyle = badgeBg;
          const labelY = Math.max(0, Math.min(chartH - labelHeight, my - labelHeight / 2));
          ctx.fillRect(plotWidth + 1, labelY, axisWidth - 1, labelHeight);
          ctx.fillStyle = badgeFg;
          ctx.textAlign = 'right';
          ctx.fillText(labelText, width - 5, labelY + labelHeight / 2);
        }

        const idx = Math.min(history.length - 1, Math.max(0, Math.floor((clampedMx / plotWidth) * history.length)));
        if (idx >= 0 && idx < history.length) {
          const tick = history[idx];
          const d = new Date(tick.time);
          const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
          ctx.font = bodyFont;
          const tw = ctx.measureText(timeStr).width + 10;
          const labelX = Math.max(0, Math.min(plotWidth - tw, clampedMx - tw / 2));
          ctx.fillStyle = badgeBg;
          ctx.fillRect(labelX, height - labelHeight, tw, labelHeight);
          ctx.fillStyle = badgeFg;
          ctx.textAlign = 'center';
          ctx.fillText(timeStr, labelX + tw / 2, height - labelHeight / 2);
        }

        if (my <= chartH) {
          const t = history[idx];
          if (t) {
            const tooltipLines = [
              `Bid: ${formatPrice(t.bid, digits ?? undefined)}`,
              `Ask: ${formatPrice(t.ask, digits ?? undefined)}`,
              `Vol: ${t.volume.toFixed(2)}`,
            ];
            ctx.font = bodyFont;
            const tooltipX = clampedMx + 10;
            const tw = Math.max(...tooltipLines.map(line => ctx.measureText(line).width)) + 14;
            const th = tooltipLines.length * typography.lineHeight + 8;
            const tooltipY = Math.max(4, Math.min(my, chartH - th - 4));
            ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(20, 23, 31, 0.94)';
            ctx.strokeStyle = isLight ? lightColor('--rtx-light-border-strong', '#94a3b8') : C.borderSecondary;
            ctx.lineWidth = 1;
            const rx = Math.max(4, Math.min(tooltipX, plotWidth - tw - 4));
            ctx.beginPath();
            ctx.roundRect(rx, tooltipY, tw, th, 4);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = isLight ? lightColor('--rtx-light-text', '#0f172a') : C.textPrimary;
            ctx.textAlign = 'left';
            tooltipLines.forEach((line, li) => {
              ctx.fillText(line, rx + 7, tooltipY + 4 + typography.lineHeight * (li + 0.5));
            });
          }
        }
      }

      // Current price line & badge in the right axis strip
      if (history.length > 0) {
        const lastTick = history[history.length - 1];
        const lastY = chartH - ((lastTick.bid - minP) / totalRange) * chartH;
        ctx.font = controlFont;
        const priceText = formatPrice(lastTick.bid, scaleDigits);
        const priceLabelY = Math.max(0, Math.min(chartH - labelHeight, lastY - labelHeight / 2));

        ctx.strokeStyle = downColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 2]);
        ctx.beginPath(); ctx.moveTo(0, lastY); ctx.lineTo(plotWidth, lastY); ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = downColor;
        ctx.fillRect(plotWidth + 1, priceLabelY, axisWidth - 1, labelHeight);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'right';
        ctx.fillText(priceText, width - 5, priceLabelY + labelHeight / 2);
      }
    };

    renderFrame();
    const interval = setInterval(renderFrame, 100);

    return () => clearInterval(interval);
  }, [fallbackWidth, height, symbol, chartMode, crosshair, zoomLevel, typography, digits, currentTick]);

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
  const iconBtn = (active: boolean) => `rtx-dom-toolbar-btn ${active ? 'is-active' : ''}`;

  return (
    <div
      className="rtx-dom-toolbar flex items-center gap-1 px-2.5 py-1 border-b select-none shrink-0"
      style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-tertiary)' }}
    >
      {/* Bar Chart */}
      <button
        type="button"
        className={iconBtn(chartMode === 'bar')}
        onClick={() => onChartModeChange('bar')}
        title={tr("Bar Chart (OHLC)")}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <rect x="1.5" y="5" width="2.5" height="8" rx="0.5" fill="currentColor"/>
          <rect x="6.75" y="2" width="2.5" height="12" rx="0.5" fill="currentColor"/>
          <rect x="12" y="7" width="2.5" height="5" rx="0.5" fill="currentColor"/>
        </svg>
      </button>

      {/* Candlestick */}
      <button
        type="button"
        className={iconBtn(chartMode === 'candlestick')}
        onClick={() => onChartModeChange('candlestick')}
        title={tr("Candlestick Chart")}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <line x1="4" y1="1.5" x2="4" y2="14.5" stroke={chartMode === 'candlestick' ? '#dc2626' : 'currentColor'} strokeWidth="1.2"/>
          <rect x="2" y="4" width="4" height="6" rx="0.5"
            fill={chartMode === 'candlestick' ? 'rgba(220,38,38,0.28)' : 'currentColor'}
            fillOpacity={chartMode === 'candlestick' ? 1 : 0.18}
            stroke={chartMode === 'candlestick' ? '#dc2626' : 'currentColor'} strokeWidth="1.1"/>
          <line x1="12" y1="2" x2="12" y2="14" stroke={chartMode === 'candlestick' ? '#2563eb' : 'currentColor'} strokeWidth="1.2"/>
          <rect x="10" y="5" width="4" height="5" rx="0.5"
            fill={chartMode === 'candlestick' ? 'rgba(37,99,235,0.28)' : 'currentColor'}
            fillOpacity={chartMode === 'candlestick' ? 1 : 0.18}
            stroke={chartMode === 'candlestick' ? '#2563eb' : 'currentColor'} strokeWidth="1.1"/>
        </svg>
      </button>

      {/* Line Chart */}
      <button
        type="button"
        className={iconBtn(chartMode === 'line')}
        onClick={() => onChartModeChange('line')}
        title={tr("Line Chart")}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <polyline points="1.5,12 5.5,6 9.5,9 14.5,3.5"
            stroke={chartMode === 'line' ? '#2563eb' : 'currentColor'}
            fill="none" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Separator */}
      <div className="w-px h-3.5 mx-0.5" style={{ background: 'var(--border-primary, #333a4b)' }} />

      {/* Tick Chart */}
      <button
        type="button"
        className={iconBtn(chartMode === 'tick')}
        onClick={() => onChartModeChange('tick')}
        title={tr("Tick Chart")}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <polyline points="1,9.5 3.8,5 6.5,10 9.5,4 12.2,11 15,3.5"
            stroke={chartMode === 'tick' ? '#dc2626' : 'currentColor'}
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
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <line x1="8" y1="1.5" x2="8" y2="14.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2,1.5"/>
          <line x1="1.5" y1="8" x2="14.5" y2="8" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2,1.5"/>
          <circle cx="8" cy="8" r="2.5" stroke="currentColor" fill="none" strokeWidth="1.2"/>
        </svg>
      </button>

      {/* Separator */}
      <div className="w-px h-3.5 mx-0.5" style={{ background: 'var(--border-primary, #333a4b)' }} />

      {/* Zoom In */}
      <button
        type="button"
        className="rtx-dom-toolbar-btn"
        onClick={onZoomIn}
        title={tr("Zoom In")}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
          <line x1="10.5" y1="10.5" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="5" y1="7" x2="9" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          <line x1="7" y1="5" x2="7" y2="9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Zoom Out */}
      <button
        type="button"
        className="rtx-dom-toolbar-btn"
        onClick={onZoomOut}
        title={tr("Zoom Out")}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
          <line x1="10.5" y1="10.5" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="5" y1="7" x2="9" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
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
  const COLUMN_HEADER_HEIGHT = 28;
  const ladderColumns = 'minmax(58px, 0.8fr) minmax(94px, 1.25fr) 48px';
  const symbolDescription = useMemo(() => getFallbackSymbolDescription(symbol), [symbol]);
  const availableForRows = Math.max(ROW_H * 6 * 2, mainContentHeight - COLUMN_HEADER_HEIGHT);
  const dynamicLevels = Math.max(6, Math.floor(availableForRows / ROW_H / 2));
  const requestLevels = Math.max(10, dynamicLevels);
  const { orderBook, loading: depthLoading, error: depthError } = useLiveOrderBook(symbol, requestLevels);
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

  // Catalog (symbol-data) digits: the broker instrument catalog first, then
  // broker tick metadata. Unknown precision stays null and renders raw —
  // never guessed from the symbol name. Read on every render (cheap): the
  // catalog registry is not reactive, so a memo could pin a stale null.
  // (MarketData Tick carries no typed digits field; read defensively.)
  const currentTickDigits = (currentTick as { digits?: unknown } | null | undefined)?.digits;
  const digits = resolveMarketWatchPriceDigits(
    symbol,
    readRegisteredSymbolPriceSpec(symbol).digits,
    currentTickDigits,
    bestBid,
    bestAsk,
  );

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
      if (digits === null) {
        // Unknown precision: expose the live quote raw — no point-step
        // expansion and no rounding.
        return {
          asks: [{ price: bestAsk, volume: 0 }],
          bids: [{ price: bestBid, volume: 0 }],
          maxVolume: 0,
          synthetic: true,
        };
      }
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
      style={{ background: 'var(--bg-secondary)', fontFamily: FONT, fontSize: typography.fontSize, fontWeight: typography.bodyWeight, lineHeight: 1.5, borderRadius: 8 }}
    >
      {/* ── Title Bar ── */}
      <div
        className="rtx-dom-titlebar flex min-h-[34px] items-center justify-between px-3 py-1 border-b shrink-0 cursor-move"
        style={{
          background: 'var(--bg-tertiary)',
          borderColor: 'var(--border-primary)',
          color: C.textPrimary,
          borderRadius: '8px 8px 0 0',
        }}
        onMouseDown={onDragHandleMouseDown}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="rtx-dom-status-dot w-2 h-2 rounded-full shrink-0" />
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="rtx-depth-of-market__heading uppercase tracking-normal shrink-0" style={{ color: C.textPrimary, fontSize: typography.fontSize, fontWeight: 600 }}>
              {symbol}
            </span>
            {symbolDescription && (
              <span className="rtx-dom-description text-[12px] leading-[18px] font-normal truncate" style={{ color: C.textSecondary, letterSpacing: 'normal' }}>
                {tr(symbolDescription)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
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
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
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
        <div className="flex-[54] border-r min-w-0" style={{ borderColor: 'var(--border-primary)' }}>
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
        <div className="flex-[46] flex flex-col min-w-[216px] overflow-hidden">
          {/* Column Headers */}
          <div
            className="rtx-depth-of-market__columns grid shrink-0 border-b"
            style={{
              gridTemplateColumns: ladderColumns,
              minHeight: COLUMN_HEADER_HEIGHT,
              fontSize: 11,
              fontWeight: 600,
              borderColor: 'var(--border-primary)',
              background: 'var(--bg-tertiary)',
            }}
          >
            <div
              className="flex items-center justify-end pr-2 border-r uppercase"
              style={{ borderColor: 'var(--border-primary)', color: C.textSecondary, letterSpacing: '0.05em' }}
              title={depthLevels.synthetic ? tr("No depth feed for this symbol — showing a price ladder around the live quote") : undefined}
            >
              {tr("Volume")}</div>
            <div className="flex items-center justify-end pr-2.5 border-r uppercase" style={{ borderColor: 'var(--border-primary)', color: C.textSecondary, letterSpacing: '0.05em' }}>
              {tr("Price")}</div>
            <div className="flex items-center justify-center uppercase" style={{ color: C.textSecondary, letterSpacing: '0.05em' }}>
              {tr("Trade")}</div>
          </div>

          {/* Scrollable Price Levels */}
          <div className="rtx-dom-ladder-scroll flex-1 overflow-y-auto overflow-x-hidden" style={{ background: 'var(--bg-secondary)' }}>
            {depthLevels.asks.length === 0 && depthLevels.bids.length === 0 && (
              <div className="flex items-center justify-center h-full px-3 text-center text-[13px] leading-[20px] font-normal" style={{ color: C.textTertiary }}>
                {depthLoading ? tr("Loading market depth...") : depthError || tr("No market depth available")}
              </div>
            )}
            {/* ── ASK (Sell) rows ── */}
            {depthLevels.asks.map((level, i) => {
              const isNearSpread = i === depthLevels.asks.length - 1;
              const volPct = depthLevels.maxVolume > 0 ? (level.volume / depthLevels.maxVolume) * 100 : 0;
              const [priceBase, pricePips] = splitLadderPrice(level.price, digits);
              return (
                <div
                  key={`ask-${i}`}
                  className={`rtx-depth-of-market__row rtx-dom-level rtx-dom-level--ask ${isNearSpread ? 'rtx-dom-level--best-ask' : ''} grid`}
                  style={{
                    gridTemplateColumns: ladderColumns,
                    height: ROW_H,
                    background: isNearSpread ? C.askBgBest : C.askBg,
                    borderBottom: '1px solid var(--border-primary)',
                  }}
                  onClick={() => onPlaceOrder?.(buildDepthOrderRequest('SELL', level.price, volume, depthExecutionForLevel('SELL', level.price, bestBid, bestAsk), digits, sl, tp))}
                  onMouseDown={e => e.stopPropagation()}
                >
                  <div className="relative flex items-center justify-end pr-2 border-r" style={{ borderColor: 'var(--border-primary)' }}>
                    <div className="rtx-dom-volbar absolute left-0 top-0 bottom-0" style={{ width: `${volPct}%`, background: C.lossDim }} />
                    {level.volume > 0 ? (
                      <span className="relative z-10 text-[12px]" style={{ fontFamily: MONO, color: C.loss, opacity: isNearSpread ? 1 : 0.8 }}>
                        {level.volume.toFixed(2)}
                      </span>
                    ) : (
                      <span className="rtx-dom-vol-placeholder relative z-10 text-[11px]" style={{ fontFamily: MONO }}>—</span>
                    )}
                  </div>
                  <div className="flex items-center justify-end pr-2.5 border-r" style={{ borderColor: 'var(--border-primary)' }}>
                    <span className="rtx-dom-price rtx-dom-price--ask" style={{ fontFamily: MONO, fontSize: typography.fontSize, color: C.loss }}>
                      {priceBase}<span className="rtx-dom-price__pips" style={{ fontWeight: 600 }}>{pricePips}</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-center">
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); onPlaceOrder?.(buildDepthOrderRequest('SELL', level.price, volume, depthExecutionForLevel('SELL', level.price, bestBid, bestAsk), digits, sl, tp)); }}
                      onMouseDown={e => e.stopPropagation()}
                      className="rtx-dom-trade-btn rtx-dom-trade-btn--sell"
                      title={tr("Sell @ {{value0}}", { value0: formatPrice(level.price, digits ?? undefined) })}
                      aria-label={tr("Sell @ {{value0}}", { value0: formatPrice(level.price, digits ?? undefined) })}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                        <path d="M2 3.5L5 6.8L8 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}

            {/* ── Spread row ── */}
            {(bestBid > 0 || bestAsk > 0) && (
              <div
                className="rtx-depth-of-market__row rtx-dom-spread flex items-center justify-center gap-2"
                style={{
                  height: ROW_H,
                  background: 'var(--bg-quaternary)',
                  borderBottom: '1px solid var(--border-secondary)',
                  borderTop: '1px solid var(--border-secondary)',
                }}
              >
                <span className="rtx-dom-spread__label uppercase" style={{ color: C.textSecondary, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em' }}>
                  {tr("Spread")}</span>
                <span className="rtx-dom-spread__badge uppercase" style={{ fontFamily: MONO }}>
                  {digits === null
                    ? String(Number((bestAsk - bestBid).toFixed(8)))
                    : `${((bestAsk - bestBid) * Math.pow(10, digits)).toFixed(1)} ${tr("pts")}`}
                </span>
              </div>
            )}

            {/* ── BID (Buy) rows ── */}
            {depthLevels.bids.map((level, i) => {
              const isNearSpread = i === 0;
              const volPct = depthLevels.maxVolume > 0 ? (level.volume / depthLevels.maxVolume) * 100 : 0;
              const [priceBase, pricePips] = splitLadderPrice(level.price, digits);
              return (
                <div
                  key={`bid-${i}`}
                  className={`rtx-depth-of-market__row rtx-dom-level rtx-dom-level--bid ${isNearSpread ? 'rtx-dom-level--best-bid' : ''} grid`}
                  style={{
                    gridTemplateColumns: ladderColumns,
                    height: ROW_H,
                    background: isNearSpread ? C.bidBgBest : C.bidBg,
                    borderBottom: '1px solid var(--border-primary)',
                  }}
                  onClick={() => onPlaceOrder?.(buildDepthOrderRequest('BUY', level.price, volume, depthExecutionForLevel('BUY', level.price, bestBid, bestAsk), digits, sl, tp))}
                  onMouseDown={e => e.stopPropagation()}
                >
                  <div className="relative flex items-center justify-end pr-2 border-r" style={{ borderColor: 'var(--border-primary)' }}>
                    <div className="rtx-dom-volbar absolute left-0 top-0 bottom-0" style={{ width: `${volPct}%`, background: C.profitDim }} />
                    {level.volume > 0 ? (
                      <span className="relative z-10 text-[12px]" style={{ fontFamily: MONO, color: C.profit, opacity: isNearSpread ? 1 : 0.8 }}>
                        {level.volume.toFixed(2)}
                      </span>
                    ) : (
                      <span className="rtx-dom-vol-placeholder relative z-10 text-[11px]" style={{ fontFamily: MONO }}>—</span>
                    )}
                  </div>
                  <div className="flex items-center justify-end pr-2.5 border-r" style={{ borderColor: 'var(--border-primary)' }}>
                    <span className="rtx-dom-price rtx-dom-price--bid" style={{ fontFamily: MONO, fontSize: typography.fontSize, color: C.profit }}>
                      {priceBase}<span className="rtx-dom-price__pips" style={{ fontWeight: 600 }}>{pricePips}</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-center">
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); onPlaceOrder?.(buildDepthOrderRequest('BUY', level.price, volume, depthExecutionForLevel('BUY', level.price, bestBid, bestAsk), digits, sl, tp)); }}
                      onMouseDown={e => e.stopPropagation()}
                      className="rtx-dom-trade-btn rtx-dom-trade-btn--buy"
                      title={tr("Buy @ {{value0}}", { value0: formatPrice(level.price, digits ?? undefined) })}
                      aria-label={tr("Buy @ {{value0}}", { value0: formatPrice(level.price, digits ?? undefined) })}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                        <path d="M2 6.5L5 3.2L8 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Bottom Controls: SL | Volume | TP ── */}
      <div
        className="rtx-dom-params-bar grid grid-cols-3 items-center gap-2 px-2.5 py-1.5 border-t shrink-0"
        style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-tertiary)' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="rtx-dom-param-group flex items-center justify-between gap-1.5">
          <span className="rtx-dom-stepper__label">{tr("SL")}</span>
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

        <div className="rtx-dom-param-group flex items-center justify-center gap-1.5">
          <span className="rtx-dom-stepper__label">{tr("Volume")}</span>
          <div className="rtx-dom-stepper rtx-dom-stepper--volume" title={tr("Order volume in lots")}>
            <button type="button" className="rtx-dom-stepper__btn" onClick={() => setVolumeInput(Math.max(0.01, Math.round((volume - 0.01) * 100) / 100).toFixed(2))} aria-label={tr("Decrease volume")}>−</button>
            <input
              type="number"
              value={volumeInput}
              min={0.01}
              step={0.01}
              onChange={e => setVolumeInput(e.target.value)}
              onBlur={() => setVolumeInput(volume.toFixed(2))}
              className="rtx-dom-stepper__input rtx-dom-stepper__input--volume"
              style={{ fontFamily: MONO }}
              aria-label={tr("Order volume in lots")}
            />
            <button type="button" className="rtx-dom-stepper__btn" onClick={() => setVolumeInput((Math.round((volume + 0.01) * 100) / 100).toFixed(2))} aria-label={tr("Increase volume")}>+</button>
          </div>
        </div>

        <div className="rtx-dom-param-group flex items-center justify-end gap-1.5">
          <span className="rtx-dom-stepper__label">{tr("TP")}</span>
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
      <div className="rtx-dom-exec-footer flex shrink-0" style={{ borderTop: '1px solid var(--border-primary)' }}>
        <button
          type="button"
          onClick={() => onPlaceOrder?.(buildDepthOrderRequest('SELL', bestBid, volume, 'market', digits, sl, tp))}
          onMouseDown={e => e.stopPropagation()}
          className="rtx-dom-exec-btn rtx-dom-exec-btn--sell"
          title={tr("Sell {{value0}} at market", { value0: volume.toFixed(2) })}
        >
          <span className="rtx-dom-exec-btn__caption">{tr("Sell")}</span>
          <span className="rtx-dom-exec-btn__price">{bestBid > 0 ? formatPrice(bestBid, digits ?? undefined) : '—'}</span>
        </button>
        <button
          type="button"
          onClick={handleCloseAll}
          onMouseDown={e => e.stopPropagation()}
          className="rtx-dom-exec-btn rtx-dom-exec-btn--flat"
          title={tr("Close all {{value0}} positions", { value0: symbol })}
        >
          <span className="rtx-dom-exec-btn__caption">{tr("Close All")}</span>
          <span className="rtx-dom-exec-btn__price rtx-dom-exec-btn__symbol">{symbol}</span>
        </button>
        <button
          type="button"
          onClick={() => onPlaceOrder?.(buildDepthOrderRequest('BUY', bestAsk, volume, 'market', digits, sl, tp))}
          onMouseDown={e => e.stopPropagation()}
          className="rtx-dom-exec-btn rtx-dom-exec-btn--buy"
          title={tr("Buy {{value0}} at market", { value0: volume.toFixed(2) })}
        >
          <span className="rtx-dom-exec-btn__caption">{tr("Buy")}</span>
          <span className="rtx-dom-exec-btn__price">{bestAsk > 0 ? formatPrice(bestAsk, digits ?? undefined) : '—'}</span>
        </button>
      </div>
    </div>
  );
};

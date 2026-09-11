import { useUiTranslation } from '../hooks/useUiTranslation';
import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useCurrentTick } from '../store/useMarketDataStore';
import { useLiveOrderBook } from '../hooks/useLiveMarketData';

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

/* ─── Chart display types ──────────────────────────────────────────── */
type ChartMode = 'bar' | 'candlestick' | 'line' | 'tick';

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

  sellBtn:   'linear-gradient(180deg, #dc2626 0%, #b91c1c 50%, #991b1b 100%)',
  buyBtn:    'linear-gradient(180deg, #2563eb 0%, #1d4ed8 50%, #1e40af 100%)',
  closeBtn:  '#333338',

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

function TickChart({ symbol, width, height, chartMode, crosshair, zoomLevel }: TickChartProps) {
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

      // Apply zoom — zoom in shows fewer ticks
      const visibleCount = Math.max(20, Math.floor(MAX_TICKS / zoomLevel));
      const history = allHistory.slice(-visibleCount);

      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      const isLight = document.documentElement.classList.contains('rtx-skin-untitled-light');

      // Dark/Light background
      ctx.fillStyle = isLight ? '#f8fafc' : C.bgPrimary;
      ctx.fillRect(0, 0, width, height);

      const chartH = height * 0.72;
      const volH = height * 0.22;
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
      ctx.strokeStyle = '#1e1e24';
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
      ctx.fillStyle = C.textTertiary;
      ctx.font = `9px ${MONO}`;
      ctx.textAlign = 'right';
      for (let i = 0; i <= 4; i++) {
        const y = (chartH / 4) * i;
        const price = maxP - (i / 4) * totalRange;
        ctx.fillText(price.toFixed(2), width - 3, y + 3);
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
      ctx.strokeStyle = C.borderPrimary;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, chartH + 1); ctx.lineTo(width, chartH + 1); ctx.stroke();

      // === CROSSHAIR ===
      if (crosshair && mouseRef.current) {
        const { x: mx, y: my } = mouseRef.current;
        ctx.strokeStyle = 'rgba(130, 130, 140, 0.6)';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([4, 3]);
        // Vertical
        ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, height); ctx.stroke();
        // Horizontal
        ctx.beginPath(); ctx.moveTo(0, my); ctx.lineTo(width, my); ctx.stroke();
        ctx.setLineDash([]);

        // Price label at crosshair Y
        if (my <= chartH) {
          const price = maxP - (my / chartH) * totalRange;
          const labelText = price.toFixed(2);
          ctx.fillStyle = '#333338';
          const tw = ctx.measureText(labelText).width + 8;
          ctx.fillRect(width - tw - 2, my - 8, tw + 2, 16);
          ctx.fillStyle = C.textPrimary;
          ctx.font = `9px ${MONO}`;
          ctx.textAlign = 'right';
          ctx.fillText(labelText, width - 5, my + 3);
        }

        // Index label at crosshair X
        const idx = Math.floor((mx / width) * history.length);
        if (idx >= 0 && idx < history.length) {
          const tick = history[idx];
          const d = new Date(tick.time);
          const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
          const tw = ctx.measureText(timeStr).width + 8;
          ctx.fillStyle = '#333338';
          ctx.fillRect(mx - tw / 2, height - 14, tw, 14);
          ctx.fillStyle = C.textPrimary;
          ctx.font = `9px ${MONO}`;
          ctx.textAlign = 'center';
          ctx.fillText(timeStr, mx, height - 3);
        }

        // Tooltip with bid/ask at cursor
        if (my <= chartH) {
          const idx2 = Math.min(history.length - 1, Math.max(0, Math.floor((mx / width) * history.length)));
          const t = history[idx2];
          if (t) {
            const tooltipLines = [
              `Bid: ${t.bid.toFixed(5)}`,
              `Ask: ${t.ask.toFixed(5)}`,
              `Vol: ${t.volume.toFixed(2)}`,
            ];
            const tooltipX = mx + 12;
            const tooltipY = Math.min(my, chartH - 40);
            ctx.fillStyle = 'rgba(25, 26, 30, 0.92)';
            ctx.strokeStyle = C.borderSecondary;
            ctx.lineWidth = 1;
            const tw = 90;
            const th = 38;
            // Rounded rect
            const rx = Math.min(tooltipX, width - tw - 4);
            ctx.beginPath();
            ctx.roundRect(rx, tooltipY, tw, th, 4);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = C.textPrimary;
            ctx.font = `9px ${MONO}`;
            ctx.textAlign = 'left';
            tooltipLines.forEach((line, li) => {
              ctx.fillText(line, rx + 4, tooltipY + 11 + li * 12);
            });
          }
        }
      }

      // Current price label on right edge
      if (history.length > 0) {
        const lastTick = history[history.length - 1];
        const lastY = chartH - ((lastTick.bid - minP) / totalRange) * chartH;
        // Price line
        ctx.strokeStyle = C.loss;
        ctx.lineWidth = 0.5;
        ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.moveTo(0, lastY); ctx.lineTo(width - 50, lastY); ctx.stroke();
        ctx.setLineDash([]);
        // Label
        ctx.fillStyle = C.loss;
        ctx.fillRect(width - 50, lastY - 7, 50, 14);
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold 9px ${MONO}`;
        ctx.textAlign = 'center';
        ctx.fillText(lastTick.bid.toFixed(2), width - 25, lastY + 3);
      }

    }, 100);

    return () => clearInterval(interval);
  }, [width, height, symbol, chartMode, crosshair, zoomLevel]);

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
  const iconColor = '#9898a8';
  const activeColor = '#f0f0f8';
  const activeGlow = '#00c896';

  const iconBtn = (active: boolean) =>
    `w-[26px] h-[22px] flex items-center justify-center rounded cursor-pointer transition-all ${
      active ? 'ring-1 ring-[#505058]' : ''
    }`;

  const btnStyle = (active: boolean): React.CSSProperties => ({
    background: active ? '#2e2e36' : 'transparent',
    boxShadow: active ? `0 0 6px ${activeGlow}50` : 'none',
  });

  return (
    <div
      className="flex items-center gap-[3px] px-1.5 py-[3px] border-b select-none shrink-0"
      style={{ borderColor: C.borderPrimary, background: C.bgTertiary }}
    >
      {/* Bar Chart */}
      <button
        className={iconBtn(chartMode === 'bar')}
        style={btnStyle(chartMode === 'bar')}
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
        className={iconBtn(chartMode === 'candlestick')}
        style={btnStyle(chartMode === 'candlestick')}
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
        className={iconBtn(chartMode === 'line')}
        style={btnStyle(chartMode === 'line')}
        onClick={() => onChartModeChange('line')}
        title={tr("Line Chart")}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <polyline points="1,12 5,6 9,9 15,3"
            stroke={chartMode === 'line' ? '#7aacca' : iconColor}
            fill="none" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Separator */}
      <div className="w-px h-4 mx-[3px]" style={{ background: C.borderSecondary }} />

      {/* Tick Chart */}
      <button
        className={iconBtn(chartMode === 'tick')}
        style={btnStyle(chartMode === 'tick')}
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
        className={iconBtn(crosshair)}
        style={btnStyle(crosshair)}
        onClick={onToggleCrosshair}
        title={crosshair ? tr("Crosshair: ON") : tr("Crosshair: OFF")}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <line x1="8" y1="1" x2="8" y2="15"
            stroke={crosshair ? activeColor : iconColor} strokeWidth="1" strokeDasharray="2,1.5"/>
          <line x1="1" y1="8" x2="15" y2="8"
            stroke={crosshair ? activeColor : iconColor} strokeWidth="1" strokeDasharray="2,1.5"/>
          <circle cx="8" cy="8" r="2.5"
            stroke={crosshair ? activeGlow : iconColor} fill="none" strokeWidth="1.2"/>
        </svg>
      </button>

      {/* Separator */}
      <div className="w-px h-4 mx-[3px]" style={{ background: C.borderSecondary }} />

      {/* Zoom In */}
      <button
        className="w-[26px] h-[22px] flex items-center justify-center rounded cursor-pointer transition-all hover:bg-[#333338] active:bg-[#404048]"
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
        className="w-[26px] h-[22px] flex items-center justify-center rounded cursor-pointer transition-all hover:bg-[#333338] active:bg-[#404048]"
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
  const currentTick = useCurrentTick(symbol);
  const [volume, setVolume] = useState(0.01);
  const [sl, setSl] = useState(0);
  const [tp, setTp] = useState(0);
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

  const ROW_H = 19;
  const COLUMN_HEADER_HEIGHT = 30;
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

  const depthLevels = useMemo(() => {
    if (orderBook && (orderBook.asks.length > 0 || orderBook.bids.length > 0)) {
      const asks = orderBook.asks.slice(0, dynamicLevels).reverse();
      const bids = orderBook.bids.slice(0, dynamicLevels);
      const maxVolume = Math.max(...[...asks, ...bids].map((level) => level.volume), 0);
      return { asks, bids, maxVolume };
    }

    return { asks: [] as any[], bids: [] as any[], maxVolume: 0 };
  }, [orderBook, dynamicLevels]);

  const digits = useMemo(() => {
    if (symbol.includes('JPY')) return 3;
    if (symbol.startsWith('BTC') || symbol.startsWith('ETH')) return 2;
    if (symbol.startsWith('XAU') || symbol.startsWith('XAG')) return 2;
    return 5;
  }, [symbol]);

  const handleCloseAll = useCallback(() => {
    onCloseBulk?.('ALL', symbol);
  }, [onCloseBulk, symbol]);

  if (!currentTick && !orderBook) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full select-none"
        style={{ background: C.bgSecondary, fontFamily: FONT, fontSize: 14, fontWeight: 400, lineHeight: '21px', color: C.textSecondary }}
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
      className="flex flex-col w-full h-full select-none overflow-hidden"
      style={{ background: C.bgSecondary, fontFamily: FONT, fontSize: 12, fontWeight: 400, borderRadius: 10 }}
    >
      {/* ── Title Bar ── */}
      <div
        className="flex min-h-[30px] items-center justify-between px-2.5 py-1 border-b shrink-0 cursor-move"
        style={{
          background: C.bgTertiary,
          borderColor: C.borderPrimary,
          color: C.textPrimary,
          borderRadius: '10px 10px 0 0',
        }}
        onMouseDown={onDragHandleMouseDown as any}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: C.profit, boxShadow: `0 0 6px ${C.profit}` }} />
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="text-[14px] leading-[21px] font-normal uppercase tracking-normal shrink-0" style={{ color: C.textPrimary }}>
              {symbol}
            </span>
            <span className="text-[12px] leading-[18px] font-normal truncate" style={{ color: C.textTertiary, letterSpacing: 'normal' }}>
              {symbol.startsWith('BTC') ? tr("Bitcoin vs US Dollar") : symbol.startsWith('ETH') ? tr("Ethereum vs US Dollar") : symbol.startsWith('XAU') ? tr("Gold vs US Dollar") : symbol.startsWith('XAG') ? tr("Silver vs US Dollar") : symbol.replace(/([A-Z]{3})([A-Z]{3})/, '$1 / $2')}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <div className="px-1 text-[12px] leading-none" style={{ color: C.textTertiary }}>⠿</div>
          <button
            onClick={onClose}
            className="px-1 py-0.5 rounded text-[14px] font-normal leading-none transition-colors"
            style={{ color: C.textSecondary }}
            onMouseDown={e => e.stopPropagation()}
            onMouseEnter={e => { e.currentTarget.style.color = C.textPrimary; e.currentTarget.style.background = C.bgElevated; }}
            onMouseLeave={e => { e.currentTarget.style.color = C.textSecondary; e.currentTarget.style.background = 'transparent'; }}
            title={tr("Close")}
          >
            ✕
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
        <div className="flex-[55] border-r min-w-0" style={{ borderColor: C.borderPrimary }}>
          <TickChart
            symbol={symbol}
            width={250}
            height={mainContentHeight}
            chartMode={chartMode}
            crosshair={crosshair}
            zoomLevel={zoomLevel}
          />
        </div>

        {/* ── Right: DOM Table ── */}
        <div className="flex-[45] flex flex-col min-w-0 overflow-hidden">
          {/* Column Headers */}
          <div
            className="grid shrink-0 border-b"
            style={{
              gridTemplateColumns: '50px 1fr 42px',
              borderColor: C.borderPrimary,
              background: C.bgTertiary,
            }}
          >
            <div className="flex min-h-[30px] items-center justify-center border-r text-[12px] leading-[18px] font-normal uppercase tracking-normal" style={{ borderColor: C.borderPrimary, color: C.textTertiary }}>
              {tr("Volume")}</div>
            <div className="flex min-h-[30px] items-center justify-center border-r text-[12px] leading-[18px] font-normal uppercase tracking-normal" style={{ borderColor: C.borderPrimary, color: C.textTertiary }}>
              {tr("Price")}</div>
            <div className="flex min-h-[30px] items-center justify-center text-[12px] leading-[18px] font-normal uppercase tracking-normal" style={{ color: C.textTertiary }}>
              {tr("Trade")}</div>
          </div>

          {/* Scrollable Price Levels */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ background: C.bgSecondary }}>
            {depthLevels.asks.length === 0 && depthLevels.bids.length === 0 && (
              <div className="flex items-center justify-center h-full px-3 text-center text-[14px] leading-[21px] font-normal" style={{ color: C.textTertiary }}>
                {depthLoading ? tr("Loading market depth...") : depthError || 'No market depth available'}
              </div>
            )}
            {/* ── ASK (Sell) rows ── */}
            {depthLevels.asks.map((level, i) => {
              const isNearSpread = i === depthLevels.asks.length - 1;
              const volPct = (level.volume / depthLevels.maxVolume) * 100;
              return (
                <div
                  key={`ask-${i}`}
                  className="grid cursor-pointer transition-colors"
                  style={{
                    gridTemplateColumns: '50px 1fr 42px',
                    height: ROW_H,
                    background: isNearSpread ? C.askBgBest : C.askBg,
                    borderBottom: `1px solid ${C.borderPrimary}`,
                  }}
                  onClick={() => onPlaceOrder?.(buildDepthOrderRequest('SELL', level.price, volume, 'limit', digits, sl, tp))}
                  onMouseDown={e => e.stopPropagation()}
                  onMouseEnter={e => { e.currentTarget.style.background = C.bgElevated; }}
                  onMouseLeave={e => { e.currentTarget.style.background = isNearSpread ? C.askBgBest : C.askBg; }}
                >
                  <div className="relative flex items-center justify-end pr-1 border-r" style={{ borderColor: C.borderPrimary }}>
                    <div className="absolute left-0 top-0 bottom-0" style={{ width: `${volPct}%`, background: C.lossDim }} />
                    {isNearSpread && (
                      <span className="relative z-10 text-[12px] font-normal" style={{ fontFamily: MONO, color: C.loss }}>
                        {level.volume.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-end pr-2 border-r" style={{ borderColor: C.borderPrimary }}>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: '#f87171' }}>
                      {level.price.toFixed(digits)}
                    </span>
                  </div>
                  <div className="flex items-center justify-center gap-1">
                    <span style={{ color: C.loss, fontSize: 9, cursor: 'pointer' }} title={tr("Sell @ {{value0}}", { value0: level.price.toFixed(digits) })}>▼</span>
                    <span style={{ color: C.profit, fontSize: 9, cursor: 'pointer', opacity: 0.2 }}>▲</span>
                  </div>
                </div>
              );
            })}

            {/* ── Spread row ── */}
            {(bestBid > 0 || bestAsk > 0) && (
              <div
                className="grid"
                style={{
                  gridTemplateColumns: '50px 1fr 42px',
                  height: ROW_H,
                  background: C.spreadBg,
                  borderBottom: `1px solid ${C.borderSecondary}`,
                  borderTop: `1px solid ${C.borderSecondary}`,
                }}
              >
                <div className="flex items-center justify-center border-r" style={{ borderColor: C.borderSecondary }} />
                <div className="flex items-center justify-center border-r text-[12px] font-normal uppercase tracking-normal" style={{ borderColor: C.borderSecondary, color: '#7aacca' }}>
                  ↕ {((bestAsk - bestBid) * Math.pow(10, digits)).toFixed(1)} {tr(" pts")}</div>
                <div className="flex items-center justify-center" />
              </div>
            )}

            {/* ── BID (Buy) rows ── */}
            {depthLevels.bids.map((level, i) => {
              const isNearSpread = i === 0;
              const volPct = (level.volume / depthLevels.maxVolume) * 100;
              return (
                <div
                  key={`bid-${i}`}
                  className="grid cursor-pointer transition-colors"
                  style={{
                    gridTemplateColumns: '50px 1fr 42px',
                    height: ROW_H,
                    background: isNearSpread ? C.bidBgBest : C.bidBg,
                    borderBottom: `1px solid ${C.borderPrimary}`,
                  }}
                  onClick={() => onPlaceOrder?.(buildDepthOrderRequest('BUY', level.price, volume, 'limit', digits, sl, tp))}
                  onMouseDown={e => e.stopPropagation()}
                  onMouseEnter={e => { e.currentTarget.style.background = C.bgElevated; }}
                  onMouseLeave={e => { e.currentTarget.style.background = isNearSpread ? C.bidBgBest : C.bidBg; }}
                >
                  <div className="relative flex items-center justify-end pr-1 border-r" style={{ borderColor: C.borderPrimary }}>
                    <div className="absolute left-0 top-0 bottom-0" style={{ width: `${volPct}%`, background: C.profitDim }} />
                    {isNearSpread && (
                      <span className="relative z-10 text-[12px] font-normal" style={{ fontFamily: MONO, color: C.profit }}>
                        {level.volume.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-end pr-2 border-r" style={{ borderColor: C.borderPrimary }}>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: '#60a5fa' }}>
                      {level.price.toFixed(digits)}
                    </span>
                  </div>
                  <div className="flex items-center justify-center gap-1">
                    <span style={{ color: C.loss, fontSize: 9, cursor: 'pointer', opacity: 0.2 }}>▼</span>
                    <span style={{ color: C.profit, fontSize: 9, cursor: 'pointer' }} title={tr("Buy @ {{value0}}", { value0: level.price.toFixed(digits) })}>▲</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Bottom Controls: SL | Volume | TP ── */}
      <div
        className="flex items-center gap-1 px-1.5 py-[4px] border-t shrink-0"
        style={{ borderColor: C.borderPrimary, background: C.bgTertiary }}
      >
        <div className="flex items-center gap-0.5">
          <label className="text-[12px] leading-[18px] font-normal uppercase" style={{ color: C.textTertiary }}>{tr("sl")}</label>
          <input
            type="number"
            value={sl}
            min={0}
            step={1}
            onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0) setSl(v); }}
            onMouseDown={e => e.stopPropagation()}
            className="w-[42px] text-[14px] leading-[21px] font-normal text-center border rounded-sm px-0.5 py-[1px] outline-none focus:border-blue-500"
            style={{ fontFamily: MONO, borderColor: C.borderSecondary, background: C.bgElevated, color: C.textPrimary }}
          />
          <div className="flex flex-col">
            <button onClick={() => setSl(v => v + 1)} className="text-[6px] leading-none" style={{ color: C.textSecondary }} onMouseDown={e => e.stopPropagation()}>▲</button>
            <button onClick={() => setSl(v => Math.max(0, v - 1))} className="text-[6px] leading-none" style={{ color: C.textSecondary }} onMouseDown={e => e.stopPropagation()}>▼</button>
          </div>
        </div>

        <div className="w-px h-4" style={{ background: C.borderSecondary }} />

        <div className="flex items-center gap-0.5 flex-1 justify-center">
          <input
            type="number"
            value={volume}
            min={0.01}
            step={0.01}
            onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setVolume(Math.round(v * 100) / 100); }}
            onMouseDown={e => e.stopPropagation()}
            className="w-[54px] text-[14px] leading-[21px] text-center border rounded-sm px-0.5 py-[1px] font-normal outline-none focus:border-blue-500"
            style={{ fontFamily: MONO, borderColor: '#1d4ed8', background: C.bgElevated, color: '#60a5fa' }}
          />
          <div className="flex flex-col">
            <button onClick={() => setVolume(v => Math.round((v + 0.01) * 100) / 100)} className="text-[6px] leading-none" style={{ color: C.textSecondary }} onMouseDown={e => e.stopPropagation()}>▲</button>
            <button onClick={() => setVolume(v => Math.max(0.01, Math.round((v - 0.01) * 100) / 100))} className="text-[6px] leading-none" style={{ color: C.textSecondary }} onMouseDown={e => e.stopPropagation()}>▼</button>
          </div>
        </div>

        <div className="w-px h-4" style={{ background: C.borderSecondary }} />

        <div className="flex items-center gap-0.5">
          <label className="text-[12px] leading-[18px] font-normal uppercase" style={{ color: C.textTertiary }}>{tr("tp")}</label>
          <input
            type="number"
            value={tp}
            min={0}
            step={1}
            onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0) setTp(v); }}
            onMouseDown={e => e.stopPropagation()}
            className="w-[42px] text-[14px] leading-[21px] font-normal text-center border rounded-sm px-0.5 py-[1px] outline-none focus:border-blue-500"
            style={{ fontFamily: MONO, borderColor: C.borderSecondary, background: C.bgElevated, color: C.textPrimary }}
          />
          <div className="flex flex-col">
            <button onClick={() => setTp(v => v + 1)} className="text-[6px] leading-none" style={{ color: C.textSecondary }} onMouseDown={e => e.stopPropagation()}>▲</button>
            <button onClick={() => setTp(v => Math.max(0, v - 1))} className="text-[6px] leading-none" style={{ color: C.textSecondary }} onMouseDown={e => e.stopPropagation()}>▼</button>
          </div>
        </div>
      </div>

      {/* ── Sell / Close / Buy Buttons ── */}
      <div className="flex shrink-0" style={{ borderTop: `1px solid ${C.borderPrimary}` }}>
        <button
          onClick={() => onPlaceOrder?.(buildDepthOrderRequest('SELL', bestBid, volume, 'market', digits, sl, tp))}
          onMouseDown={e => e.stopPropagation()}
          className="flex-1 py-[6px] text-[14px] leading-[21px] font-semibold text-white transition-all"
          style={{ background: C.sellBtn, borderRight: `1px solid ${C.bgSecondary}`, borderRadius: '0 0 0 10px' }}
          onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.2)')}
          onMouseLeave={e => (e.currentTarget.style.filter = 'none')}
        >
          {tr("Sell")}</button>
        <button
          onClick={handleCloseAll}
          onMouseDown={e => e.stopPropagation()}
          className="flex-1 py-[6px] text-[14px] leading-[21px] font-semibold transition-all"
          style={{ background: C.closeBtn, borderRight: `1px solid ${C.bgSecondary}`, color: C.textSecondary }}
          onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.3)'; e.currentTarget.style.color = C.textPrimary; }}
          onMouseLeave={e => { e.currentTarget.style.filter = 'none'; e.currentTarget.style.color = C.textSecondary; }}
        >
          {tr("Close")}</button>
        <button
          onClick={() => onPlaceOrder?.(buildDepthOrderRequest('BUY', bestAsk, volume, 'market', digits, sl, tp))}
          onMouseDown={e => e.stopPropagation()}
          className="flex-1 py-[6px] text-[14px] leading-[21px] font-semibold text-white transition-all"
          style={{ background: C.buyBtn, borderRadius: '0 0 10px 0' }}
          onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.2)')}
          onMouseLeave={e => (e.currentTarget.style.filter = 'none')}
        >
          {tr("Buy")}</button>
      </div>
    </div>
  );
};

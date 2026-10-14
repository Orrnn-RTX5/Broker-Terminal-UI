import { useUiTranslation } from '../hooks/useUiTranslation';
/**
 * DataWindow — MT5-style floating Data Window panel
 * Shows OHLCV + Spread data for the candle under the crosshair.
 * Reads the active chart's current or hovered candle through its registered source.
 * Toggled via Ctrl+D, View menu, or Charts menu.
 */

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

import { getActiveChartSource, subscribeActiveChartSource } from '../services/activeChartSource';
import type { ChartDataSnapshot } from '../services/chartDataSnapshot';

export type CrosshairData = ChartDataSnapshot;

interface DataWindowProps {
  onClose: () => void;
  initialPos?: { x: number; y: number };
  onDragHandleMouseDown?: (e: React.MouseEvent) => void;
}

const fmt = (n: number, digits = 5): string => {
  if (!n && n !== 0) return '—';
  return n.toFixed(digits);
};

const DataRow = ({ label, value }: { label: string; value: string }) => {
  const tr = useUiTranslation();
  return (
    <div
      className="rtx-data-window__row"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        alignItems: 'center',
        minHeight: 24,
        padding: '2px 10px',
        borderBottom: '1px solid var(--border-primary, rgba(255,255,255,0.06))',
      }}
    >
      <span
        className="rtx-data-window__label"
        style={{
          color: 'var(--text-secondary, #999)',
          fontSize: 14, fontWeight: 400, lineHeight: '21px',
          fontFamily: 'var(--font-sans)',
        }}
      >
        {tr(label)}
      </span>
      <span
        className="rtx-data-window__value font-mono tabular-nums"
        style={{
          color: 'var(--text-primary, #e0e0e0)',
          fontSize: 14,
          fontWeight: 400,
          lineHeight: '21px',
          fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
          textAlign: 'right',
          minWidth: 78,
        }}
      >
        {value}
      </span>
    </div>
  );
};

export const DataWindow: React.FC<DataWindowProps> = ({
  onClose,
  onDragHandleMouseDown,
}) => {
  const tr = useUiTranslation();
  const [data, setData] = useState<CrosshairData | null>(null);

  // Pull only while the panel is open. The registered reader uses current candle
  // refs, so opening after history loads does not depend on a missed event.
  useEffect(() => {
    const refresh = () => setData(getActiveChartSource()?.getDataWindowData?.() ?? null);
    refresh();
    const unsubscribe = subscribeActiveChartSource(refresh);
    const timer = window.setInterval(refresh, 200);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, []);

  const digits = data?.digits ?? 5;

  const header = data ? `${data.symbol},${data.timeframe}` : '—';

  return (
    <div
      className="rtx-data-window"
      style={{
        background: 'var(--bg-secondary, #131316)',
        border: '1px solid var(--border-primary, #2a2e39)',
        boxShadow: 'var(--shadow-lg, 0 8px 32px rgba(0,0,0,0.7))',
        borderRadius: 4,
        width: '100%',
        height: '100%',
        minWidth: 200,
        userSelect: 'none',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Title Bar */}
      <div
        className="rtx-data-window__titlebar"
        onMouseDown={onDragHandleMouseDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 30,
          padding: '0 8px 0 10px',
          background: 'var(--bg-tertiary, #1a1d26)',
          cursor: onDragHandleMouseDown ? 'move' : 'default',
          borderBottom: '1px solid var(--border-primary, #2a2e39)',
        }}
      >
        <span
          className="rtx-data-window__title"
          style={{
            color: 'var(--text-primary, #c0c0c0)',
            fontSize: 14, fontWeight: 400, lineHeight: '21px',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {tr("Data Window")}
        </span>
        <button
          type="button"
          className="rtx-data-window__close dock-panel__action dock-panel__action--close flex h-5 w-5 shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-red-500/80 hover:text-white"
          onClick={onClose}
          style={{
            color: 'var(--text-secondary, #888)',
            cursor: 'pointer',
          }}
          title={tr("Close")}
          aria-label={tr("Close")}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Symbol + Timeframe row */}
      <div
        className="rtx-data-window__symbol"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minHeight: 30,
          padding: '4px 10px',
          borderBottom: '1px solid var(--border-primary, #2a2e39)',
          background: 'var(--bg-secondary, #131316)',
        }}
      >
        {/* Small line-chart icon */}
        <svg width="12" height="10" viewBox="0 0 12 10" fill="none" stroke="var(--color-profit, #5a9f7a)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1,9 4,5 7,7 11,1" />
        </svg>
        <span
          className="rtx-data-window__symbol-label font-mono tabular-nums"
          style={{
            color: 'var(--text-primary, #c8c8c8)',
            fontSize: 14,
            lineHeight: '21px',
            fontFamily: 'var(--font-mono)',
            fontWeight: 400,
          }}
        >
          {tr(header)}
        </span>
      </div>

      {/* Data Rows */}
      <div
        className="rtx-data-window__body custom-scrollbar"
        style={{
          background: 'var(--bg-secondary, #131316)',
          paddingBottom: 2,
          overflowY: 'auto',
          flex: 1,
        }}
      >
        <DataRow label={tr("Date")} value={data?.date ?? '—'} />
        <DataRow label={tr("Time")} value={data?.time ?? '—'} />
        <DataRow label={tr("Open")}  value={data ? fmt(data.open, digits)  : '—'} />
        <DataRow label={tr("High")}  value={data ? fmt(data.high, digits)  : '—'} />
        <DataRow label={tr("Low")}   value={data ? fmt(data.low, digits)   : '—'} />
        <DataRow label={tr("Close")} value={data ? fmt(data.close, digits) : '—'} />
        <DataRow label={tr("Volume")}      value={data ? String(data.volume ?? 0)      : '—'} />
        <DataRow label={tr("Tick Volume")} value={data ? (data.tickVolume == null ? '\u2014' : String(data.tickVolume))  : '—'} />
        <DataRow label={tr("Spread")}      value={data ? (data.spread == null ? '\u2014' : String(data.spread))      : '—'} />
      </div>
    </div>
  );
};

export default DataWindow;


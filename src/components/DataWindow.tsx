import { useUiTranslation } from '../hooks/useUiTranslation';
/**
 * DataWindow — MT5-style floating Data Window panel
 * Shows OHLCV + Spread data for the candle under the crosshair.
 * Reads the active chart's current or hovered candle through its registered source.
 * Toggled via Ctrl+D, View menu, or Charts menu.
 */

import React, { useEffect, useRef, useState } from 'react';

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

const DataRow = ({ label, value }: { label: string; value: string }) => { const tr = useUiTranslation(); return ((
  <div
    className="rtx-data-window__row"
    style={{
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      alignItems: 'center',
      minHeight: 24,
      padding: '1px 8px',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
    }}
  >
    <span className="rtx-data-window__label" style={{ color: '#999', fontSize: 14, fontWeight: 400, lineHeight: '21px', fontFamily: 'var(--font-sans)' }}>
      {tr(label)}
    </span>
    <span
      className="rtx-data-window__value"
      style={{
        color: '#e0e0e0',
        fontSize: 14,
        fontWeight: 400,
        lineHeight: '21px',
        fontFamily: 'var(--font-mono)',
        textAlign: 'right',
        minWidth: 78,
      }}
    >
      {value}
    </span>
  </div>
)); };

export const DataWindow: React.FC<DataWindowProps> = ({
  onClose,
  initialPos = { x: 0, y: 0 },
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
        background: '#131316',
        border: '1px solid #2a2e39',
        boxShadow: '0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05)',
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
          padding: '0 8px',
          background: '#1a1d26',
          cursor: 'move',
          borderBottom: '1px solid #2a2e39',
        }}
      >
        <span className="rtx-data-window__title" style={{ color: '#c0c0c0', fontSize: 14, fontWeight: 400, lineHeight: '21px', fontFamily: 'var(--font-sans)' }}>
          {tr("Data Window")}</span>
        <button
          className="rtx-data-window__close"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: 13,
            lineHeight: 1,
            padding: '0 2px',
            display: 'flex',
            alignItems: 'center',
          }}
          title={tr("Close")}
        >
          ✕
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
          padding: '4px 8px',
          borderBottom: '1px solid #2a2e39',
          background: '#131316',
        }}
      >
        {/* Small line-chart icon */}
        <svg width="12" height="10" viewBox="0 0 12 10" fill="none" stroke="#5a9f7a" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1,9 4,5 7,7 11,1" />
        </svg>
        <span className="rtx-data-window__symbol-label" style={{ color: '#c8c8c8', fontSize: 14, lineHeight: '21px', fontFamily: 'var(--font-mono)', fontWeight: 400 }}>
          {tr(header)}
        </span>
      </div>

      {/* Data Rows */}
      <div className="rtx-data-window__body" style={{ background: '#131316', paddingBottom: 2, overflowY: 'auto', flex: 1 }}>
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

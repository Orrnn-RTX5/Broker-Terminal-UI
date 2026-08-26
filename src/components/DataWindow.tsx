/**
 * DataWindow — MT5-style floating Data Window panel
 * Shows OHLCV + Spread data for the candle under the crosshair.
 * Listens to 'chart:crosshair' CustomEvent dispatched by TradingChart.
 * Toggled via Ctrl+D, View menu, or Charts menu.
 */

import React, { useEffect, useRef, useState } from 'react';

export interface CrosshairData {
  symbol: string;
  timeframe: string;
  date: string;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickVolume: number;
  spread: number;
}

interface DataWindowProps {
  onClose: () => void;
  initialPos?: { x: number; y: number };
  onDragHandleMouseDown?: (e: React.MouseEvent) => void;
}

const fmt = (n: number, digits = 5): string => {
  if (!n && n !== 0) return '—';
  return n.toFixed(digits);
};

const DataRow = ({ label, value }: { label: string; value: string }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      alignItems: 'center',
      minHeight: 24,
      padding: '1px 8px',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
    }}
  >
    <span style={{ color: '#999', fontSize: 14, fontWeight: 400, lineHeight: '21px', fontFamily: 'var(--font-sans)' }}>
      {label}
    </span>
    <span
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
);

export const DataWindow: React.FC<DataWindowProps> = ({
  onClose,
  initialPos = { x: 0, y: 0 },
  onDragHandleMouseDown,
}) => {
  const [data, setData] = useState<CrosshairData | null>(null);

  // Listen to crosshair data from any TradingChart
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<CrosshairData>).detail;
      if (detail) setData(detail);
    };
    window.addEventListener('chart:crosshair', handler);
    return () => window.removeEventListener('chart:crosshair', handler);
  }, []);

  const digits = data
    ? data.symbol.includes('JPY') || data.symbol.includes('XAU')
      ? 2
      : data.symbol.includes('BTC') || data.symbol.includes('ETH')
      ? 2
      : 5
    : 5;

  const header = data ? `${data.symbol},${data.timeframe}` : '—';

  return (
    <div
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
        <span style={{ color: '#c0c0c0', fontSize: 14, fontWeight: 400, lineHeight: '21px', fontFamily: 'var(--font-sans)' }}>
          Data Window
        </span>
        <button
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
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Symbol + Timeframe row */}
      <div
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
        <span style={{ color: '#c8c8c8', fontSize: 14, lineHeight: '21px', fontFamily: 'var(--font-mono)', fontWeight: 400 }}>
          {header}
        </span>
      </div>

      {/* Data Rows */}
      <div style={{ background: '#131316', paddingBottom: 2, overflowY: 'auto', flex: 1 }}>
        <DataRow label="Date" value={data?.date ?? '—'} />
        <DataRow label="Time" value={data?.time ?? '—'} />
        <DataRow label="Open"  value={data ? fmt(data.open, digits)  : '—'} />
        <DataRow label="High"  value={data ? fmt(data.high, digits)  : '—'} />
        <DataRow label="Low"   value={data ? fmt(data.low, digits)   : '—'} />
        <DataRow label="Close" value={data ? fmt(data.close, digits) : '—'} />
        <DataRow label="Volume"      value={data ? String(data.volume ?? 0)      : '—'} />
        <DataRow label="Tick Volume" value={data ? String(data.tickVolume ?? 0)  : '—'} />
        <DataRow label="Spread"      value={data ? String(data.spread ?? 0)      : '—'} />
      </div>
    </div>
  );
};

export default DataWindow;

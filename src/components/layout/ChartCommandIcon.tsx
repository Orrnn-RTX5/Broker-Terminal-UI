import type { ReactNode } from 'react';
import { ReferenceToolbarGlyph } from '../ui/ReferenceToolbarGlyph';

export type ChartCommandIconName = 'bar-chart' | 'candlestick' | 'line-chart' | 'area-chart'
  | 'zoom-in' | 'zoom-out' | 'grid' | 'refresh' | 'chart-shift' | 'indicator-list'
  | 'camera' | 'period-separator' | 'sliders-horizontal' | 'add-chart';

const glyphs: Record<'area-chart' | 'refresh' | 'chart-shift' | 'period-separator' | 'sliders-horizontal' | 'add-chart', ReactNode> = {
  'area-chart': <>
    <path fill="currentColor" fillOpacity=".08" stroke="none" d="m5.5 19.5 5.5-6.5 4.5 4 7-9.5v14h-17Z" />
    <path d="m5.5 19.5 5.5-6.5 4.5 4 7-9.5M5.5 21.5h17" />
  </>,
  refresh: <>
    <path d="M22.5 11.5a9 9 0 0 0-15.9-3M22.5 5.5v6h-6M5.5 16.5a9 9 0 0 0 15.9 3M5.5 22.5v-6h6" />
  </>,
  'chart-shift': <>
    <path d="M8.5 5.5v3m0 10v4M14.5 14.5h7m-3.5-3.5 3.5 3.5-3.5 3.5M23.5 5.5v17" />
    <rect x="6.5" y="8.5" width="4" height="10" rx=".5" />
  </>,
  'period-separator': <>
    <path d="M7.5 5.5v3m0 9v5M20.5 7.5v3m0 7v5M14.5 5.5v2.5m0 2.5v2.5m0 2.5v2.5m0 2.5v2" />
    <rect x="5.5" y="8.5" width="4" height="9" rx=".5" />
    <rect x="18.5" y="10.5" width="4" height="7" rx=".5" />
  </>,
  'sliders-horizontal': <>
    <path d="M5.5 7.5h3m4 0h10M5.5 14.5h11m4 0h2M5.5 21.5h3m4 0h10" />
    <circle cx="10.5" cy="7.5" r="2" />
    <circle cx="18.5" cy="14.5" r="2" />
    <circle cx="10.5" cy="21.5" r="2" />
  </>,
  'add-chart': <>
    <path d="M14.5 22.5h-9v-17h17v9M7.5 18.5l4-5.5 3.5 2.5 4.5-6M19.5 16.5v6M16.5 19.5h6" />
  </>,
};

/** Reuse the sidebar outline artwork; toolbar CSS sets its rendered size. */
export function ChartCommandIcon({ name }: { name: ChartCommandIconName }) {
  switch (name) {
    case 'bar-chart':
    case 'candlestick':
    case 'line-chart':
    case 'grid':
    case 'indicator-list':
    case 'camera':
    case 'zoom-in':
    case 'zoom-out':
      return <ReferenceToolbarGlyph name={name === 'zoom-in' ? 'zoom' : name}
        className="rtx-chart-command-icon" data-chart-command-icon={name} />;
    default:
      return <svg className="rtx-chart-command-icon" width="28" height="28" viewBox="0 0 28 28"
        fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true" data-chart-command-icon={name}>
        {glyphs[name]}
      </svg>;
  }
}

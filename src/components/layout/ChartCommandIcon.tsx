import type { ReactNode } from 'react';
import { ReferenceToolbarGlyph } from '../ui/ReferenceToolbarGlyph';

export type ChartCommandIconName = 'bar-chart' | 'candlestick' | 'line-chart' | 'area-chart'
  | 'zoom-in' | 'zoom-out' | 'grid' | 'refresh' | 'chart-shift' | 'indicator-list'
  | 'camera' | 'period-separator' | 'sliders-horizontal' | 'add-chart';

const glyphs: Record<'area-chart' | 'refresh' | 'chart-shift' | 'period-separator' | 'sliders-horizontal' | 'add-chart', ReactNode> = {
  'area-chart': <>
    <path fill="currentColor" fillOpacity=".08" stroke="none" d="m3.5 20.5 6.5-8 6 5.5 8.5-10.5v16h-21Z" />
    <path d="m3.5 20.5 6.5-8 6 5.5 8.5-10.5M3.5 23.5h21" />
  </>,
  refresh: <>
    <path d="M22.5 11.5a9 9 0 0 0-15.9-3M22.5 5.5v6h-6M5.5 16.5a9 9 0 0 0 15.9 3M5.5 22.5v-6h6" />
  </>,
  'chart-shift': <>
    <path d="M8.5 4.5v4m0 11v4M14.5 14.5h8m-4-4 4 4-4 4M24.5 4.5v19" />
    <rect x="6.5" y="8.5" width="4" height="11" rx=".5" />
  </>,
  'period-separator': <>
    <path d="M6.5 4.5v4m0 9v4M21.5 7.5v4m0 7v4M14.5 3.5v3m0 3v3m0 3v3m0 3v3" />
    <rect x="4.5" y="8.5" width="4" height="9" rx=".5" />
    <rect x="19.5" y="11.5" width="4" height="7" rx=".5" />
  </>,
  'sliders-horizontal': <>
    <path d="M4.5 7.5h4m4 0h11M4.5 14.5h12m4 0h3M4.5 21.5h4m4 0h11" />
    <circle cx="10.5" cy="7.5" r="2" />
    <circle cx="18.5" cy="14.5" r="2" />
    <circle cx="10.5" cy="21.5" r="2" />
  </>,
  'add-chart': <>
    <path d="M14.5 23.5h-10v-19h19v10M7.5 18.5l4-6 4 3 5-7M20.5 17.5v7M17 21h7" />
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

import type { ReactNode } from 'react';

export type ChartCommandIconName = 'bar-chart' | 'candlestick' | 'line-chart' | 'area-chart'
  | 'zoom-in' | 'zoom-out' | 'grid' | 'refresh' | 'chart-shift' | 'indicator-list'
  | 'camera' | 'period-separator' | 'sliders-horizontal' | 'add-chart';

const zoomOutline = <path fillRule="evenodd" d="M12 3a9 9 0 1 0 5.8 15.88L23.94 25 25 23.94l-6.12-6.14A9 9 0 0 0 12 3Zm0 1.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15Z" />;
const trendLine = <path d="m3.4 20.5 6.5-8.1 5 3.1 8.5-11 1.2.9-9.3 12-5.1-3.1-5.6 7.2Z" />;

/** Native-size filled outlines retain their weight across theme stroke overrides. */
export function ChartCommandIcon({ name }: { name: ChartCommandIconName }) {
  if (name === 'period-separator') {
    return <svg className="rtx-chart-command-icon" width="28" height="28" viewBox="0 0 28 28"
      fill="currentColor" stroke="none" aria-hidden="true" data-chart-command-icon={name}>
      {/* Pixel-aligned candle outlines and a clear divider stay legible at toolbar size. */}
      <path fillRule="evenodd" d="M6 4h1v4h2v9H7v4H6v-4H4V8h2V4ZM5 9v7h3V9H5ZM21 7h1v4h2v8h-2v4h-1v-4h-2v-8h2V7Zm-1 5v6h3v-6h-3Z" />
      <path className="rtx-chart-command-icon__active-fill" fill="none" d="M4 8h5v9H4zM19 11h5v8h-5z" />
      <path d="M13 3h2v3h-2zM13 8h2v3h-2zM13 13h2v3h-2zM13 18h2v3h-2zM13 23h2v2h-2z" />
    </svg>;
  }
  const glyphs: Record<Exclude<ChartCommandIconName, 'period-separator'>, ReactNode> = {
    'add-chart': <><path fillRule="evenodd" d="M3 4h22v13h-1.5V5.5h-19v17H16V24H3V4Z" /><path d="M20 17h1.5v3H25v1.5h-3.5V25H20v-3.5h-3V20h3Z" />{trendLine}</>,
    'bar-chart': <path d="M8 4h1.5v6H13v1.5H9.5V23H8v-6H4v-1.5h4V4Zm11 3h1.5v6H24v1.5h-3.5V24H19v-6h-4v-1.5h4V7Z" />,
    candlestick: <><path fillRule="evenodd" d="M8 3h1.5v5H13v12H9.5v5H8v-5H5V8h3V3ZM6.5 9.5v9h5v-9h-5ZM19 5h1.5v5H24v9h-3.5v4H19v-4h-3v-9h3V5Zm-1.5 6.5v6h5v-6h-5Z" /><path className="rtx-chart-command-icon__active-fill" fill="none" d="M5 8h8v12H5zM16 10h8v9h-8z" /></>,
    'line-chart': trendLine,
    'area-chart': <><path opacity=".12" d="m4 21 6-7.7 5 3.1L24 5v19H4Z" />{trendLine}<path d="M4 23h20v1.5H4z" /></>,
    'zoom-in': <>{zoomOutline}<path d="M11.25 7.5h1.5v3.75h3.75v1.5h-3.75v3.75h-1.5v-3.75H7.5v-1.5h3.75Z" /></>,
    'zoom-out': <>{zoomOutline}<path d="M7.5 11.25h9v1.5h-9Z" /></>,
    grid: <path fillRule="evenodd" d="M4 4h8.5v8.5H4V4Zm1.5 1.5V11H11V5.5H5.5ZM15.5 4H24v8.5h-8.5V4ZM17 5.5V11h5.5V5.5H17ZM4 15.5h8.5V24H4v-8.5ZM5.5 17v5.5H11V17H5.5Zm10-1.5H24V24h-8.5v-8.5ZM17 17v5.5h5.5V17H17Z" />,
    refresh: <path d="M14 4a10 10 0 0 1 8.5 4.73V4H24v8h-8v-1.5h5.8a8.5 8.5 0 0 0-15.32-.46l-1.33-.7A10 10 0 0 1 14 4Zm-8.5 15.27V24H4v-8h8v1.5H6.2a8.5 8.5 0 0 0 15.32.46l1.33.7A10 10 0 0 1 5.5 19.27Z" />,
    'chart-shift': <><path fillRule="evenodd" d="M7 4h1.5v4H11v12H8.5v4H7v-4H4V8h3V4ZM5.5 9.5v9h4v-9h-4Z" /><path d="M23 4h1.5v20H23zM16.5 8.5l5.5 5.5-5.5 5.5-1.06-1.06 3.69-3.69H13v-1.5h6.13l-3.69-3.69Z" /></>,
    'indicator-list': <><path d="m3.5 11.5 6-6 5 3 6-5H24V5h-3l-6.35 5.3-4.9-2.94-5.19 5.2Z" /><path fillRule="evenodd" d="M4 17h5v7H4v-7Zm1.5 1.5v4h2v-4h-2ZM11.5 13h5v11h-5V13Zm1.5 1.5v8h2v-8h-2ZM19 9h5v15h-5V9Zm1.5 1.5v12h2v-12h-2Z" /></>,
    camera: <><path fillRule="evenodd" d="M10 4h8l2 3h3a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l2-3Zm.8 1.5-2 3H5a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 .5.5h18a.5.5 0 0 0 .5-.5V9a.5.5 0 0 0-.5-.5h-3.8l-2-3h-6.4ZM14 10a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm0 1.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z" /><circle cx="21" cy="11" r="1" /></>,
    'sliders-horizontal': <>
      <path d="M3 6.25h4.5v1.5H3zm10.5 0H25v1.5H13.5zM3 13.25h12.5v1.5H3zm18.5 0H25v1.5h-3.5zM3 20.25h4.5v1.5H3zm10.5 0H25v1.5H13.5z" />
      <path fillRule="evenodd" d="M10.5 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm8 5.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm-8 5.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z" />
    </>,
  };

  return <svg className="rtx-chart-command-icon" width="28" height="28" viewBox="0 0 28 28"
    fill="currentColor" stroke="none" aria-hidden="true" data-chart-command-icon={name}>
    {glyphs[name]}
  </svg>;
}

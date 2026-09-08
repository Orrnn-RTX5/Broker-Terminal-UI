import type { ForecastingMeasurementToolId } from './forecastingMeasurementToolCatalog';

interface ForecastingMeasurementToolIconProps {
  id: ForecastingMeasurementToolId;
  size?: number;
}

const dot = (cx: number, cy: number, key: string) => (
  <circle key={key} cx={cx} cy={cy} r="1.35" fill="currentColor" stroke="none" />
);

export function ForecastingMeasurementToolIcon({
  id,
  size = 20,
}: ForecastingMeasurementToolIconProps) {
  const content = (() => {
    switch (id) {
      case 'long_position':
        return <>
          <path d="M4 12h16M6 12V4h12v8M7 12v8h10v-8" />
          <path d="m9 8 3-3 3 3M12 5v5" />
        </>;
      case 'short_position':
        return <>
          <path d="M4 12h16M7 4h10v8M6 12v8h12v-8" />
          <path d="m9 16 3 3 3-3M12 14v5" />
        </>;
      case 'position_forecast':
        return <>
          <path d="M3 19 9 13l4 2 8-10" />
          <path d="M16 5h5v5" />
          {dot(3, 19, 'a')}{dot(9, 13, 'b')}{dot(13, 15, 'c')}
        </>;
      case 'bars_pattern':
        return <>
          <path d="M4 7v10M2 10h4M10 4v12M8 7h4M16 9v11M14 12h4M20 5v10M18 8h4" />
          <path d="m8 20 4 2 4-2" />
        </>;
      case 'ghost_feed':
        return <>
          <path d="M3 18c3-8 5-1 8-8s5 3 10-6" strokeDasharray="2.5 2.5" />
          {dot(3, 18, 'a')}{dot(11, 10, 'b')}{dot(21, 4, 'c')}
        </>;
      case 'sector':
        return <>
          <path d="M3 21 9 3M3 21l18-6M5 15.5a6 6 0 0 0 4.5 4M7 9.8a12 12 0 0 0 9 8" />
          {dot(3, 21, 'a')}{dot(9, 3, 'b')}{dot(21, 15, 'c')}
        </>;
      case 'anchored_vwap':
        return <>
          <path d="M4 5v16M2 5h4M4 17c4-8 8-9 17-5" />
          {dot(4, 17, 'a')}
        </>;
      case 'fixed_range_volume_profile':
        return <>
          <path d="M3 3v18M21 3v18M3 5h7M3 9h13M3 13h18M3 17h11M3 21h5" />
        </>;
      case 'anchored_volume_profile':
        return <>
          <path d="M4 3v18M4 5h6M4 9h11M4 13h17M4 17h9M4 21h5" />
          {dot(4, 13, 'a')}
        </>;
      case 'price_range':
        return <>
          <path d="M4 4h16M4 20h16M12 5v14M9 8l3-3 3 3M9 16l3 3 3-3" />
        </>;
      case 'date_range':
        return <>
          <path d="M4 4v16M20 4v16M5 12h14M8 9l-3 3 3 3M16 9l3 3-3 3" />
        </>;
      case 'date_and_price_range':
        return <>
          <rect x="4" y="4" width="16" height="16" />
          <path d="M7 12h10M9 10l-2 2 2 2M15 10l2 2-2 2M12 7v10M10 9l2-2 2 2M10 15l2 2 2-2" />
        </>;
    }
  })();

  return (
    <svg
      aria-hidden="true"
      className="web-drawing-tools-menu__tool-icon"
      data-tool-icon={id}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.35"
    >
      {content}
    </svg>
  );
}

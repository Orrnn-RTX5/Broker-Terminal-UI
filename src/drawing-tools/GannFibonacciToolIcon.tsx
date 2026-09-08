import type { GannFibonacciToolId } from './gannFibonacciToolCatalog';

interface GannFibonacciToolIconProps {
  id: GannFibonacciToolId;
  size?: number;
}

const dot = (cx: number, cy: number, key: string) => (
  <circle key={key} cx={cx} cy={cy} r="1.35" fill="currentColor" stroke="none" />
);

export function GannFibonacciToolIcon({ id, size = 20 }: GannFibonacciToolIconProps) {
  const content = (() => {
    switch (id) {
      case 'fib_retracement':
        return <>
          <path d="M5 4h16M5 10h12M5 16h16M5 21h10" />
          {dot(2.5, 4, 'a')}{dot(2.5, 10, 'b')}{dot(2.5, 16, 'c')}{dot(2.5, 21, 'd')}
        </>;
      case 'trend_based_fib_extension':
        return <>
          <path d="M3 20 9 7l5 5 7-9M6 5h15M8 10h13M11 15h10M3 20h18" />
          {dot(3, 20, 'a')}{dot(9, 7, 'b')}{dot(14, 12, 'c')}
        </>;
      case 'fib_channel':
        return <>
          <path d="m3 20 16-10M3 14 19 4M3 8l8-5" />
          <path d="M6 18v-5M10 15v-5M14 12V7" opacity=".7" />
          {dot(3, 20, 'a')}{dot(19, 10, 'b')}{dot(3, 14, 'c')}
        </>;
      case 'fib_time_zone':
        return <>
          <path d="M4 3v18M10 3v18M15 3v18M21 3v18M2 18 12 6" />
          {dot(4, 18, 'a')}{dot(12, 6, 'b')}
        </>;
      case 'fib_speed_resistance_fan':
        return <>
          <path d="M3 21 21 3M3 21 21 8M3 21h18M3 21l8-18M3 3v18M3 8h18M3 14h18" />
          {dot(3, 21, 'a')}{dot(21, 3, 'b')}
        </>;
      case 'trend_based_fib_time':
        return <>
          <path d="M3 20 8 6l5 14M5 3v18M10 3v18M15 3v18M21 3v18" />
          {dot(3, 20, 'a')}{dot(8, 6, 'b')}{dot(13, 20, 'c')}
        </>;
      case 'fib_circles':
        return <>
          <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="3" />{dot(12, 12, 'a')}
        </>;
      case 'fib_spiral':
        return <path d="M13 12c0-1.7-2.5-2.3-3.5-.9-1.5 2.2.3 5.2 3.2 5.1 4.3-.1 6.4-5 4.3-8.5C14 2.8 6.3 3.6 3.8 9c-3.1 6.8 2.8 13.1 9.4 11.9 4.2-.8 7.2-4.1 7.8-8.1" />;
      case 'fib_speed_resistance_arcs':
        return <>
          <path d="M3 20a5 5 0 0 0 5-5M3 20a10 10 0 0 0 10-10M3 20A15 15 0 0 0 18 5M3 20A19 19 0 0 0 22 1" />
          {dot(3, 20, 'a')}{dot(18, 5, 'b')}
        </>;
      case 'fib_wedge':
        return <>
          <path d="M3 21 8 3M3 21l18-5M4.5 16.2a5 5 0 0 0 3.5 3.4M5.8 11.5a10 10 0 0 0 7.2 7M7.2 6.8a15 15 0 0 0 10.8 10.3" />
          {dot(3, 21, 'a')}{dot(21, 16, 'b')}
        </>;
      case 'pitchfan':
        return <>
          <path d="M3 21 9 4M3 21l18-8M3 21l18-2M3 21 15 4M9 4l12 15" />
          {dot(3, 21, 'a')}{dot(9, 4, 'b')}{dot(21, 19, 'c')}
        </>;
      case 'gann_box':
        return <>
          <rect x="3" y="3" width="18" height="18" />
          <path d="M9 3v18M15 3v18M3 9h18M3 15h18M3 21 21 3" />
        </>;
      case 'gann_square_fixed':
        return <>
          <rect x="3" y="3" width="18" height="18" />
          <path d="M3 3l18 18M21 3 3 21M12 3v18M3 12h18M3 3l9 9 9-9M3 21l9-9 9 9" />
        </>;
      case 'gann_square':
        return <>
          <rect x="3" y="3" width="18" height="18" />
          <path d="M3 3l18 18M21 3 3 21M8 3v18M15 3v18M3 8h18M3 15h18" />
        </>;
      case 'gann_fan':
        return <>
          <path d="M3 21 21 3M3 21 21 8M3 21l18-1M3 21 14 3M3 21 8 3M3 21h18" />
          {dot(3, 21, 'a')}{dot(21, 3, 'b')}
        </>;
    }
  })();

  return (
    <svg
      aria-hidden="true"
      className="web-drawing-tools-menu__tool-icon"
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

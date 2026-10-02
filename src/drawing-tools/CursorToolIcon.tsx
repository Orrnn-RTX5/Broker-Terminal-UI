import type { ChartCursorMode } from '../store/useChartCursorStore';

interface CursorToolIconProps {
  id: ChartCursorMode;
  size?: number;
}

export function CursorToolIcon({ id, size = 20 }: CursorToolIconProps) {
  const content = (() => {
    switch (id) {
      case 'cross':
        return <path d="M13.15 4.5h1.7v7.65h7.65v1.7h-7.65v7.65h-1.7v-7.65H5.5v-1.7h7.65V4.5Z" />;
      case 'dot':
        return <circle cx="14" cy="14" r="2.7" />;
      case 'arrow':
        return <path d="M7.2 4.4 20.8 14.1h-6.15l2.45 7.35-1.85.62-2.45-7.4-5.6 4.35V4.4Z" />;
      case 'demonstration':
        return <>
          <path fillRule="evenodd" d="M14 4.4a9.6 9.6 0 1 0 0 19.2 9.6 9.6 0 0 0 0-19.2Zm0 1.7a7.9 7.9 0 1 1 0 15.8 7.9 7.9 0 0 1 0-15.8Z" />
          <path d="M12.15 10.05v7.9l6.7-3.95-6.7-3.95Z" />
        </>;
      case 'magic':
        return <>
          <path d="M7.2 18.7 16.4 9.5l2.1 2.1-9.2 9.2c-.6.6-1.5.6-2.1 0l-1.1-1.1c-.6-.6-.6-1.5 0-2.1Z" />
          <path d="M19.2 3.6 20.5 7.1 24 8.4 20.5 9.7 19.2 13.2 17.9 9.7 14.4 8.4 17.9 7.1Z" />
        </>;
      case 'eraser':
        return <path d="M9.05 20.2H19.6v-1.6h-8.9l6.55-6.55a1.6 1.6 0 0 0 0-2.26L12.7 5.24a1.6 1.6 0 0 0-2.26 0L4.4 11.28a1.6 1.6 0 0 0 0 2.26l4.65 4.66Zm1.7-1.6-.55-.55 3.55-3.55 1.13 1.13-3.55 3.55-.58-.58Zm-4.7-6.05 4.55-4.55 5.55 5.55-2.7 2.7-4.55-4.55-2.85 2.85Z" />;
      default:
        return null;
    }
  })();

  return (
    <svg
      className={size >= 28 ? 'web-drawing-tools-rail__glyph' : undefined}
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      data-tool-icon={id}
    >
      {content}
    </svg>
  );
}

export interface StampGlyphDefinition {
  kind?: 'icon' | 'label';
  path?: string;
  color: string;
  size: number;
  bg?: string;
  side?: 'left' | 'right';
  filled?: boolean;
}

/** Legacy vector stamps retained for persisted drawing compatibility. */
export const STAMP_GLYPHS: Record<string, StampGlyphDefinition> = {
  thumbsUp: {
    path: 'M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3',
    color: '#22c55e', size: 24,
  },
  thumbsDown: {
    path: 'M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17',
    color: '#ef4444', size: 24,
  },
  arrowUp: {
    path: 'M12 19V5M5 12l7-7 7 7',
    color: '#22c55e', size: 24,
  },
  arrowDown: {
    path: 'M12 5v14M19 12l-7 7-7-7',
    color: '#ef4444', size: 24,
  },
  arrow: {
    path: 'M5 12h14M13 6l6 6-6 6',
    color: '#3b82f6', size: 24,
  },
  stopSign: {
    path: 'M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z',
    color: '#ef4444', size: 24,
  },
  checkSign: {
    path: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3',
    color: '#22c55e', size: 24,
  },
  buy: {
    path: 'M12 3L23 21H1Z',
    color: '#22c55e', size: 24, filled: true,
  },
  sell: {
    path: 'M12 21L1 3H23Z',
    color: '#ef4444', size: 24, filled: true,
  },
  leftPriceLabel: {
    kind: 'label', color: '#2563eb', size: 24, bg: '#2563eb', side: 'left',
  },
  rightPriceLabel: {
    kind: 'label', color: '#2563eb', size: 24, bg: '#2563eb', side: 'right',
  },
};

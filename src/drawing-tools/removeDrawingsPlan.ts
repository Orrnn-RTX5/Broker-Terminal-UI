export interface RemovalCounts {
  drawings: number;
  indicators: number;
}

export type RemovalScope = 'drawings' | 'indicators' | 'both';

export interface RemovalMenuItem {
  scope: RemovalScope;
  label: string;
}

export interface LockableDrawing {
  locked?: boolean;
}

const pluralize = (count: number, singular: string): string =>
  `${count} ${singular}${count === 1 ? '' : 's'}`;

export const formatDrawingCount = (count: number): string => pluralize(count, 'drawing');

export const formatIndicatorCount = (count: number): string => pluralize(count, 'indicator');

export function buildRemovalMenuItems(counts: RemovalCounts): RemovalMenuItem[] {
  const items: RemovalMenuItem[] = [];
  const drawingsLabel = formatDrawingCount(counts.drawings);
  const indicatorsLabel = formatIndicatorCount(counts.indicators);

  if (counts.drawings > 0) {
    items.push({ scope: 'drawings', label: `Remove ${drawingsLabel}` });
  }
  if (counts.indicators > 0) {
    items.push({ scope: 'indicators', label: `Remove ${indicatorsLabel}` });
  }
  if (counts.drawings > 0 && counts.indicators > 0) {
    items.push({ scope: 'both', label: `Remove ${drawingsLabel} & ${indicatorsLabel}` });
  }
  return items;
}

export function selectRemovableDrawings<T extends LockableDrawing>(
  drawings: readonly T[],
  alwaysRemoveLocked: boolean,
): T[] {
  if (alwaysRemoveLocked) return [...drawings];
  return drawings.filter((drawing) => !drawing.locked);
}

export function countRemovableDrawings(
  drawings: readonly LockableDrawing[],
  alwaysRemoveLocked: boolean,
): number {
  return selectRemovableDrawings(drawings, alwaysRemoveLocked).length;
}

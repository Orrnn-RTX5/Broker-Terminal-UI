import type { Logical } from 'lightweight-charts';

interface DrawingLogicalTimeScale {
  logicalToCoordinate(logical: Logical): number | null;
}

/** Preserve sub-bar placement with chart versions that only project integer indices. */
export const drawingLogicalToCoordinate = (
  timeScale: DrawingLogicalTimeScale,
  logical: number,
): number | null => {
  if (!Number.isFinite(logical)) return null;
  const leftIndex = Math.floor(logical);
  const left = timeScale.logicalToCoordinate(leftIndex as Logical);
  if (left === null || !Number.isFinite(left)) return null;
  if (leftIndex === logical) return left;

  const right = timeScale.logicalToCoordinate((leftIndex + 1) as Logical);
  if (right === null || !Number.isFinite(right)) return null;
  return left + ((right - left) * (logical - leftIndex));
};

export interface LiveCandleMutationScope {
  selectionKey: string;
  generationFloor: number;
}

/** Keep mutation generations monotonic, isolating each committed selection. */
export function selectLiveCandleMutationScope(
  previous: LiveCandleMutationScope,
  selectionKey: string,
  currentGeneration: number,
): LiveCandleMutationScope {
  return previous.selectionKey === selectionKey
    ? previous
    : { selectionKey, generationFloor: currentGeneration };
}

/** A request for another selection cannot reuse the active selection's ticks. */
export function getStartupHistoryMutationFloor(
  scope: LiveCandleMutationScope,
  requestSelectionKey: string,
  requestGeneration: number,
): number {
  return scope.selectionKey === requestSelectionKey ? scope.generationFloor : requestGeneration;
}

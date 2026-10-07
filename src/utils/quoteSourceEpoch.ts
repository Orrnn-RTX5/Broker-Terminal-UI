/** Only explicit, positive broker source revisions establish an epoch. */
export const knownQuoteSourceRevision = (value: unknown): number | undefined => {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : undefined;
};

/** Missing revision, source text, transport and opaque tick IDs cannot reset order. */
export const compareQuoteSourceRevision = (next: unknown, previous: unknown): number | undefined => {
  const nextRevision = knownQuoteSourceRevision(next);
  const previousRevision = knownQuoteSourceRevision(previous);
  if (nextRevision === undefined || previousRevision === undefined) return undefined;
  return nextRevision === previousRevision ? 0 : nextRevision > previousRevision ? 1 : -1;
};

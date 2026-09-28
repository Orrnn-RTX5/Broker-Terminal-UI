import { getCanonicalTickTimestamp } from '../utils/liveTickSemantics';

type DailyChangeTimedTick = {
  timestamp: number;
  sourceTimestamp?: number;
  dailyChange?: number;
  dailyChangeSourceTimestamp?: number;
};

type LastTimedTick = {
  timestamp: number;
  sourceTimestamp?: number;
  last?: number;
  lastSourceTimestamp?: number;
};

const UTC_QUOTE_DAY_MS = 24 * 60 * 60 * 1_000;

/** Returns the broker event that owns the tick's Daily Change value. */
export const getDailyChangeAuthorityTimestamp = (tick: DailyChangeTimedTick): number | null => {
  if (typeof tick.dailyChange !== 'number' || !Number.isFinite(tick.dailyChange)) return null;
  if (
    typeof tick.dailyChangeSourceTimestamp === 'number'
    && Number.isFinite(tick.dailyChangeSourceTimestamp)
    && tick.dailyChangeSourceTimestamp > 0
  ) {
    return tick.dailyChangeSourceTimestamp;
  }
  const timestamp = getCanonicalTickTimestamp(tick);
  return timestamp !== null && timestamp > 0 ? timestamp : null;
};

const belongsToSelectedQuoteDay = (
  authorityTimestamp: number | null,
  selected: DailyChangeTimedTick,
): authorityTimestamp is number => {
  const selectedTimestamp = getCanonicalTickTimestamp(selected);
  return authorityTimestamp !== null
    && selectedTimestamp !== null
    && selectedTimestamp > 0
    && Math.floor(authorityTimestamp / UTC_QUOTE_DAY_MS)
      === Math.floor(selectedTimestamp / UTC_QUOTE_DAY_MS);
};

/**
 * Sparse quotes omit optional metadata. Preserve Daily Change only while the
 * selected quote remains in the same inferred UTC quote day; broker/account
 * changes clear the owning stores through resetLiveMarketDataSession.
 */
export const retainSameQuoteDayDailyChange = <T extends DailyChangeTimedTick>(
  candidate: DailyChangeTimedTick | undefined,
  selected: T,
): T => {
  const selectedAuthority = getDailyChangeAuthorityTimestamp(selected);
  const candidateAuthority = candidate ? getDailyChangeAuthorityTimestamp(candidate) : null;
  const selectedIsUsable = belongsToSelectedQuoteDay(selectedAuthority, selected);
  const candidateIsUsable = candidate !== undefined
    && belongsToSelectedQuoteDay(candidateAuthority, selected);

  const useCandidate = candidateIsUsable
    && (!selectedIsUsable || candidateAuthority > selectedAuthority);
  const chosen = useCandidate ? candidate : selectedIsUsable ? selected : undefined;
  const chosenAuthority = useCandidate ? candidateAuthority : selectedIsUsable ? selectedAuthority : null;

  if (chosen && chosenAuthority !== null) {
    if (
      selected.dailyChange === chosen.dailyChange
      && selected.dailyChangeSourceTimestamp === chosenAuthority
    ) return selected;
    return {
      ...selected,
      dailyChange: chosen.dailyChange,
      dailyChangeSourceTimestamp: chosenAuthority,
    };
  }

  if (selected.dailyChange === undefined && selected.dailyChangeSourceTimestamp === undefined) {
    return selected;
  }
  const withoutDailyChange = { ...selected };
  delete withoutDailyChange.dailyChange;
  delete withoutDailyChange.dailyChangeSourceTimestamp;
  return withoutDailyChange;
};

/** Returns the broker event that owns the tick's exchange Last value. */
export const getLastAuthorityTimestamp = (tick: LastTimedTick): number | null => {
  if (typeof tick.last !== 'number' || !Number.isFinite(tick.last) || tick.last <= 0) return null;
  if (
    typeof tick.lastSourceTimestamp === 'number'
    && Number.isFinite(tick.lastSourceTimestamp)
    && tick.lastSourceTimestamp > 0
  ) {
    return tick.lastSourceTimestamp;
  }
  const timestamp = getCanonicalTickTimestamp(tick);
  return timestamp !== null && timestamp > 0 ? timestamp : null;
};

/** Preserve a real exchange Last only inside the selected quote's UTC day. */
export const retainSameQuoteDayLast = <T extends LastTimedTick>(
  candidate: LastTimedTick | undefined,
  selected: T,
): T => {
  const selectedAuthority = getLastAuthorityTimestamp(selected);
  const candidateAuthority = candidate ? getLastAuthorityTimestamp(candidate) : null;
  const selectedIsUsable = belongsToSelectedQuoteDay(selectedAuthority, selected);
  const candidateIsUsable = candidate !== undefined
    && belongsToSelectedQuoteDay(candidateAuthority, selected);
  const useCandidate = candidateIsUsable
    && (!selectedIsUsable || candidateAuthority > selectedAuthority);
  const chosen = useCandidate ? candidate : selectedIsUsable ? selected : undefined;
  const chosenAuthority = useCandidate ? candidateAuthority : selectedIsUsable ? selectedAuthority : null;

  if (chosen && chosenAuthority !== null) {
    if (selected.last === chosen.last && selected.lastSourceTimestamp === chosenAuthority) return selected;
    return {
      ...selected,
      last: chosen.last,
      lastSourceTimestamp: chosenAuthority,
    };
  }

  if (selected.last === undefined && selected.lastSourceTimestamp === undefined) return selected;
  const withoutLast = { ...selected };
  delete withoutLast.last;
  delete withoutLast.lastSourceTimestamp;
  return withoutLast;
};

export const retainSameQuoteDayDisplayFields = <T extends DailyChangeTimedTick & LastTimedTick>(
  candidate: (DailyChangeTimedTick & LastTimedTick) | undefined,
  selected: T,
): T => retainSameQuoteDayLast(candidate, retainSameQuoteDayDailyChange(candidate, selected));

export interface MarketWatchSourceOptions {
  activeWatchlistId?: string | null;
  activeWatchlistIsDefault?: boolean;
}

export const shouldUseWatchlistAsMarketWatchSource = ({
  activeWatchlistId,
  activeWatchlistIsDefault,
}: MarketWatchSourceOptions): boolean => {
  const id = String(activeWatchlistId ?? '').trim();
  return Boolean(id && activeWatchlistIsDefault === false);
};

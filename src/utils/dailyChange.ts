/**
 * Resolves the MetaTrader-style Daily Change percentage for a Bid-priced quote.
 *
 * The backend value is authoritative. When it is absent, the only equivalent
 * client-side fallback is Bid versus the previous session close. Daily open,
 * midpoint, and rolling 24-hour values describe different measurements.
 */
export const resolveDailyChangePercent = (
  upstreamDailyChange: unknown,
  bid: number,
  previousClose: unknown,
): number | undefined => {
  if (upstreamDailyChange !== undefined && upstreamDailyChange !== null && upstreamDailyChange !== '') {
    const normalizedUpstreamValue = Number(upstreamDailyChange);
    if (Number.isFinite(normalizedUpstreamValue)) {
      return normalizedUpstreamValue;
    }
  }

  const normalizedPreviousClose = Number(previousClose);
  if (!Number.isFinite(bid) || bid <= 0 || !Number.isFinite(normalizedPreviousClose) || normalizedPreviousClose <= 0) {
    return undefined;
  }

  return ((bid - normalizedPreviousClose) / normalizedPreviousClose) * 100;
};

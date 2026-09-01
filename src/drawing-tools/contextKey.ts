export interface DrawingContextIdentity {
  contextId: string;
  symbol: string;
  timeframe: string;
  accountScope?: string;
}

// Unscoped keys intentionally retain the pre-account storage namespace so
// existing browser drawings can be migrated into the live account scope.
const LEGACY_ACCOUNT_SCOPE = 'legacy';

const normalizePart = (value: string | undefined): string => value?.trim() ?? '';

export const buildDrawingContextKey = (
  identity: Pick<DrawingContextIdentity, 'symbol' | 'timeframe' | 'accountScope'>,
): string => [
  normalizePart(identity.accountScope) || LEGACY_ACCOUNT_SCOPE,
  normalizePart(identity.symbol).toUpperCase(),
  normalizePart(identity.timeframe).toUpperCase(),
].join('::');

export const buildDrawingStorageKey = (
  identity: Pick<DrawingContextIdentity, 'symbol' | 'timeframe' | 'accountScope'>,
): string => {
  const symbol = normalizePart(identity.symbol).toUpperCase();
  const timeframe = normalizePart(identity.timeframe).toUpperCase();
  if (!symbol || !timeframe) {
    throw new Error('Drawing storage requires the active symbol and timeframe');
  }
  const accountScope = identity.accountScope?.trim();
  return accountScope
    ? `drawings-${encodeURIComponent(accountScope)}-${symbol}-${timeframe}`
    : `drawings-${symbol}-${timeframe}`;
};

export const isSameDrawingContext = (
  left: DrawingContextIdentity | null | undefined,
  right: DrawingContextIdentity | null | undefined,
): boolean => Boolean(left && right && left.contextId === right.contextId);

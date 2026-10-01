export const parseStoredTokenExpiryMs = (expiresAt: unknown): number | null => {
  if (expiresAt === undefined || expiresAt === null || expiresAt === '') return null;

  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
    return expiresAt < 100_000_000_000 ? expiresAt * 1000 : expiresAt;
  }

  const raw = String(expiresAt).trim();
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    return numeric < 100_000_000_000 ? numeric * 1000 : numeric;
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
};

export const getStoredTokenExpiryMs = (): number | null => {
  if (typeof window === 'undefined') return null;
  return parseStoredTokenExpiryMs(localStorage.getItem('token_expires_at'));
};

export const getStoredAuthToken = (): string | null => {
  return getAccessToken();
};

export const hasTokenExpiryElapsed = (expiresAt: unknown, now = Date.now()): boolean => {
  const expiryMs = parseStoredTokenExpiryMs(expiresAt);
  return Boolean(expiryMs && expiryMs <= now);
};
import { getAccessToken } from '../../services/brokerSession';

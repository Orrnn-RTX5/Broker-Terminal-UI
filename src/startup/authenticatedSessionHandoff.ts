export const AUTHENTICATED_SESSION_HANDOFF_MAX_AGE_MS = 30_000;

export interface AuthenticatedSessionHandoff {
  accountId: string;
  token: string;
  expiresAt: number | null;
  committedAt: number;
}

export const parseSessionExpiryMs = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 100_000_000_000 ? value * 1_000 : value;
  }

  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    return numeric < 100_000_000_000 ? numeric * 1_000 : numeric;
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
};

export const createAuthenticatedSessionHandoff = ({
  accountId,
  token,
  expiresAt,
  now = Date.now(),
}: {
  accountId: unknown;
  token: unknown;
  expiresAt?: unknown;
  now?: number;
}): AuthenticatedSessionHandoff | null => {
  const normalizedAccountId = String(accountId ?? '').trim();
  const normalizedToken = String(token ?? '').trim();
  const normalizedExpiry = parseSessionExpiryMs(expiresAt);

  if (!normalizedAccountId || !normalizedToken) return null;
  if (normalizedExpiry !== null && normalizedExpiry <= now) return null;

  return {
    accountId: normalizedAccountId,
    token: normalizedToken,
    expiresAt: normalizedExpiry,
    committedAt: now,
  };
};

export const isAuthenticatedSessionHandoffValid = (
  handoff: AuthenticatedSessionHandoff | null | undefined,
  {
    storedToken,
    now = Date.now(),
  }: {
    storedToken: string | null | undefined;
    now?: number;
  },
): handoff is AuthenticatedSessionHandoff => Boolean(
  handoff
  && handoff.accountId
  && handoff.token
  && handoff.token === storedToken
  && now >= handoff.committedAt
  && now - handoff.committedAt <= AUTHENTICATED_SESSION_HANDOFF_MAX_AGE_MS
  && (handoff.expiresAt === null || handoff.expiresAt > now)
);

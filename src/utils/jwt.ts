/**
 * Safe, client-side JWT payload decoding.
 *
 * SECURITY NOTE: The browser CANNOT verify a JWT signature (it has no access to
 * the signing key), so any claim read here is UNTRUSTED and advisory only. It
 * MUST NOT be used as an authorization decision — the gateway is the sole
 * authority for which account a token may act on. These helpers exist purely so
 * the client can pre-fill a best-effort hint (e.g. the login number to display)
 * without crashing on malformed input.
 *
 * Hardening over a raw `atob(token.split('.')[1])`:
 *  - Decodes base64URL (`-`/`_`) as well as standard base64.
 *  - Restores missing `=` padding so `atob` does not throw.
 *  - Validates the JWT shape (exactly 3 dot-separated segments).
 *  - Returns null on any malformed / non-object payload instead of throwing.
 */

const base64UrlToBase64 = (segment: string): string => {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  return normalized + '='.repeat(padLength);
};

/**
 * Decode the (unverified) payload of a JWT.
 * @returns the payload object, or null if the token is malformed.
 */
export const decodeJwtPayload = (token: unknown): Record<string, unknown> | null => {
  if (typeof token !== 'string' || token.length === 0) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const payloadSegment = parts[1];
  if (!payloadSegment) return null;

  try {
    const json = atob(base64UrlToBase64(payloadSegment));
    const parsed = JSON.parse(json);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

/**
 * Read a single (unverified) claim from a JWT payload as a string.
 * @returns the claim value, or undefined if absent / token malformed.
 */
export const readJwtClaim = (token: unknown, claim: string): string | undefined => {
  const payload = decodeJwtPayload(token);
  if (!payload) return undefined;
  const value = payload[claim];
  return value === undefined || value === null ? undefined : String(value);
};

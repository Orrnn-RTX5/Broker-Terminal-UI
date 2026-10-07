import type { AuthTokenResponse } from '../types/api';

/** Account labels must use an owner's name, never an email/login identifier. */
export const pickAccountDisplayName = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const name = value.trim();
    if (name && !name.includes('@')) return name;
  }
  return '';
};

export const getAuthenticatedAccountName = (response: AuthTokenResponse): string => (
  pickAccountDisplayName(response.user?.name, response.name)
);

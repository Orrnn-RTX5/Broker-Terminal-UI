import { getAccessToken } from './brokerSession';

export const INVESTOR_READ_ONLY_MESSAGE = 'Read-only investor session. Sign in with the master password to trade or change passwords.';

const readInvestorClaim = (token: string | null | undefined): boolean => {
  if (!token) return false;
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims: unknown = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')));
    return typeof claims === 'object' && claims !== null
      && 'investor' in claims && claims.investor === true;
  } catch {
    return false;
  }
};

let lastToken: string | null | undefined;
let lastInvestor = false;
/** UI hint from the issued token; signature and permissions remain server enforced. */
export const isInvestorToken = (token: string | null | undefined): boolean => {
  if (token !== lastToken) {
    lastToken = token;
    lastInvestor = readInvestorClaim(token);
  }
  return lastInvestor;
};

export const isInvestorSession = (): boolean => isInvestorToken(getAccessToken());

export class InvestorReadOnlyError extends Error {
  readonly code = 'INVESTOR_READ_ONLY';
  readonly status = 403;
  constructor() {
    super(INVESTOR_READ_ONLY_MESSAGE);
    this.name = 'InvestorReadOnlyError';
  }
}

export const assertInvestorCanTrade = (token = getAccessToken()): void => {
  if (isInvestorToken(token)) throw new InvestorReadOnlyError();
};

/** Block account mutations while retaining reads, calculations and watchlists. */
export const isInvestorRestrictedRequest = (method: string, endpoint: string): boolean => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return false;
  const path = new URL(endpoint, 'https://terminal.invalid').pathname.replace(/^.*\/api\/v\d+/, '');
  return /^\/(orders|positions|trade)(\/|$)/.test(path)
    || /^\/accounts?\/[^/]+\/(close-all|investor-password|password)(\/|$)/.test(path)
    || /^\/auth\/change-password\/?$/.test(path);
};

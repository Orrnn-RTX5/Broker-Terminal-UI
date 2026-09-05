export interface BrokerAuthLoginInput {
  username?: string | number;
  login?: string | number;
  email?: string;
  password: string;
  broker_id?: string;
}

export interface BrokerAuthLoginPayload {
  username?: string;
  login?: number;
  password: string;
  broker_id?: string;
}

const parseAccountLogin = (value: unknown): number | undefined => {
  const normalized = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(normalized)) return undefined;

  const login = Number(normalized);
  return Number.isSafeInteger(login) ? login : undefined;
};

/**
 * Account-number authentication is a distinct backend contract: numeric IDs
 * must be sent as `login`, while email/name authentication uses `username`.
 */
export const normalizeBrokerAuthLoginPayload = (
  credentials: BrokerAuthLoginInput,
): BrokerAuthLoginPayload => {
  const identity = credentials.login ?? credentials.username ?? credentials.email;
  const accountLogin = parseAccountLogin(identity);

  return {
    ...(accountLogin !== undefined
      ? { login: accountLogin }
      : identity !== undefined
        ? { username: String(identity).trim() }
        : {}),
    password: credentials.password,
    ...(credentials.broker_id ? { broker_id: credentials.broker_id } : {}),
  };
};

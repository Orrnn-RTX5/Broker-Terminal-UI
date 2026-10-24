export interface CachedAccountSession {
  login: string;
  brokerId: string;
  serverUrl: string;
  authToken: string;
  refreshToken?: string;
  expiresAt?: number;
  password?: string;
  updatedAt: number;
}

interface PersistedAccountSessionRecord extends Omit<CachedAccountSession, 'password'> {
  password?: string;
  authSecret?: string;
}

const LEGACY_SESSION_STORAGE_KEY = 'rtx_account_sessions_v1';
const SESSION_STORAGE_KEY = 'rtx_account_sessions_v2';
const EXPIRY_BUFFER_MS = 5_000;

const memorySessions = new Map<string, CachedAccountSession>();
let hasStorageWritten = false;

const normalizeKeyPart = (value: string | undefined | null): string =>
  String(value || '').trim();

const encodeSessionSecret = (secret: string | undefined): string | undefined => {
  if (!secret) return undefined;
  try {
    const bytes = new TextEncoder().encode(secret);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i] ^ 0x5a);
    }
    return typeof btoa === 'function' ? btoa(binary) : undefined;
  } catch {
    return undefined;
  }
};

const decodeSessionSecret = (encoded: string | undefined): string | undefined => {
  if (!encoded || typeof atob !== 'function') return undefined;
  try {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i) ^ 0x5a;
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
};

const normalizeSessionServerUrl = (value: string): string => {
  const text = value.trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}${url.hash}`;
    }
  } catch {
    // Keep non-URL server identifiers as-is
  }
  return text;
};

const buildExactKey = (brokerId: string, serverUrl: string, login: string): string =>
  JSON.stringify([
    normalizeKeyPart(brokerId).toLowerCase(),
    normalizeSessionServerUrl(normalizeKeyPart(serverUrl)).toLowerCase(),
    normalizeKeyPart(login),
  ]);

const buildBrokerKey = (brokerId: string, login: string): string =>
  JSON.stringify([
    normalizeKeyPart(brokerId).toLowerCase(),
    '',
    normalizeKeyPart(login),
  ]);

const buildServerKey = (serverUrl: string, login: string): string =>
  JSON.stringify([
    '',
    normalizeSessionServerUrl(normalizeKeyPart(serverUrl)).toLowerCase(),
    normalizeKeyPart(login),
  ]);

const syncMemoryWithStorage = (): void => {
  if (typeof window !== 'undefined') {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
    } catch {
      // Ignore storage access errors
    }
  }
  if (!hasStorageWritten || typeof window === 'undefined') return;
  try {
    const hasSession = typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SESSION_STORAGE_KEY) !== null;
    const hasLocal = typeof localStorage !== 'undefined' && localStorage.getItem(SESSION_STORAGE_KEY) !== null;
    if (!hasSession && !hasLocal) {
      memorySessions.clear();
      hasStorageWritten = false;
    }
  } catch {
    // Ignore storage access errors
  }
};

const hydrateSessionRecord = (raw: PersistedAccountSessionRecord | undefined): CachedAccountSession | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const { authSecret, password, ...rest } = raw;
  const resolvedPassword = password || decodeSessionSecret(authSecret);
  return {
    ...rest,
    ...(resolvedPassword ? { password: resolvedPassword } : {}),
  };
};

const readPersistedSessions = (): Record<string, CachedAccountSession> => {
  if (typeof window === 'undefined') return {};
  const merged: Record<string, CachedAccountSession> = {};
  try {
    if (typeof localStorage !== 'undefined') {
      const rawLocal = localStorage.getItem(SESSION_STORAGE_KEY);
      if (rawLocal) {
        const parsedLocal = JSON.parse(rawLocal) as Record<string, PersistedAccountSessionRecord>;
        if (parsedLocal && typeof parsedLocal === 'object') {
          for (const [key, value] of Object.entries(parsedLocal)) {
            const hydrated = hydrateSessionRecord(value);
            if (hydrated) merged[key] = hydrated;
          }
        }
      }
    }
  } catch {
    // Ignore localStorage parse errors
  }
  try {
    if (typeof sessionStorage !== 'undefined') {
      const rawSession = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (rawSession) {
        const parsedSession = JSON.parse(rawSession) as Record<string, PersistedAccountSessionRecord>;
        if (parsedSession && typeof parsedSession === 'object') {
          for (const [key, value] of Object.entries(parsedSession)) {
            const hydrated = hydrateSessionRecord(value);
            if (hydrated) {
              merged[key] = {
                ...(merged[key] || {}),
                ...hydrated,
                authToken: hydrated.authToken || merged[key]?.authToken || '',
                ...((hydrated.password || merged[key]?.password)
                  ? { password: hydrated.password || merged[key]?.password }
                  : {}),
              };
            }
          }
        }
      }
    }
  } catch {
    // Ignore sessionStorage parse errors
  }
  return merged;
};

const writePersistedSessions = (records: Record<string, CachedAccountSession>): void => {
  if (typeof window === 'undefined') return;
  const sessionScoped: Record<string, PersistedAccountSessionRecord> = {};
  const localSanitized: Record<string, PersistedAccountSessionRecord> = {};
  for (const [key, value] of Object.entries(records)) {
    if (!value) continue;
    const { password, ...rest } = value;
    const authSecret = encodeSessionSecret(password);
    sessionScoped[key] = {
      ...rest,
      ...(authSecret ? { authSecret } : {}),
    };
    localSanitized[key] = {
      ...rest,
      ...(authSecret ? { authSecret } : {}),
    };
  }
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionScoped));
      hasStorageWritten = true;
    }
  } catch {
    // Ignore storage quota or security errors
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(localSanitized));
      hasStorageWritten = true;
    }
  } catch {
    // Ignore storage quota or security errors
  }
};

const isSessionFresh = (session: CachedAccountSession | undefined): boolean => {
  if (!session || !session.authToken) return false;
  if (typeof session.expiresAt === 'number' && Number.isFinite(session.expiresAt)) {
    if (session.expiresAt <= Date.now() + EXPIRY_BUFFER_MS) return false;
  }
  return true;
};

export const rememberAccountSession = (input: {
  brokerId?: string | null;
  serverUrl?: string | null;
  login?: string | number | null;
  authToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: number | null;
  password?: string | null;
}): void => {
  syncMemoryWithStorage();
  const login = normalizeKeyPart(input.login != null ? String(input.login) : '');
  const authToken = normalizeKeyPart(input.authToken);
  const password = input.password ? String(input.password) : '';
  const brokerId = normalizeKeyPart(input.brokerId);
  const serverUrl = normalizeKeyPart(input.serverUrl);
  if (!login || (!authToken && !password) || (!brokerId && !serverUrl)) return;

  const exactKey = buildExactKey(brokerId, serverUrl, login);
  const brokerKey = brokerId ? buildBrokerKey(brokerId, login) : '';
  const serverKey = serverUrl ? buildServerKey(serverUrl, login) : '';

  const existingMemory = memorySessions.get(exactKey)
    || (brokerKey ? memorySessions.get(brokerKey) : undefined)
    || (serverKey ? memorySessions.get(serverKey) : undefined);

  const persisted = readPersistedSessions();
  const existingPersisted = persisted[exactKey]
    || (brokerKey ? persisted[brokerKey] : undefined)
    || (serverKey ? persisted[serverKey] : undefined);

  const resolvedAuthToken = authToken || existingMemory?.authToken || existingPersisted?.authToken || '';
  const resolvedRefreshToken = input.refreshToken !== undefined
    ? (input.refreshToken || undefined)
    : (existingMemory?.refreshToken || existingPersisted?.refreshToken);
  const resolvedExpiresAt = typeof input.expiresAt === 'number' && Number.isFinite(input.expiresAt)
    ? input.expiresAt
    : (existingMemory?.expiresAt ?? existingPersisted?.expiresAt);
  const resolvedPassword = password || existingMemory?.password || existingPersisted?.password;

  const entry: CachedAccountSession = {
    login,
    brokerId: brokerId || existingMemory?.brokerId || existingPersisted?.brokerId || '',
    serverUrl: serverUrl || existingMemory?.serverUrl || existingPersisted?.serverUrl || '',
    authToken: resolvedAuthToken,
    ...(resolvedRefreshToken ? { refreshToken: resolvedRefreshToken } : {}),
    ...(typeof resolvedExpiresAt === 'number' && Number.isFinite(resolvedExpiresAt) ? { expiresAt: resolvedExpiresAt } : {}),
    ...(resolvedPassword ? { password: resolvedPassword } : {}),
    updatedAt: Date.now(),
  };

  memorySessions.set(exactKey, entry);
  if (brokerKey) {
    memorySessions.set(brokerKey, entry);
  }
  if (serverKey) {
    memorySessions.set(serverKey, entry);
  }

  persisted[exactKey] = entry;
  if (brokerKey) {
    persisted[brokerKey] = entry;
  }
  if (serverKey) {
    persisted[serverKey] = entry;
  }
  writePersistedSessions(persisted);
};

export const getCachedAccountSession = (query: {
  brokerId?: string | null;
  serverUrl?: string | null;
  login: string | number;
}): CachedAccountSession | null => {
  syncMemoryWithStorage();
  const login = normalizeKeyPart(String(query.login));
  const brokerId = normalizeKeyPart(query.brokerId);
  const serverUrl = normalizeKeyPart(query.serverUrl);
  if (!login || (!brokerId && !serverUrl)) return null;

  const exactKey = buildExactKey(brokerId, serverUrl, login);
  const brokerKey = brokerId ? buildBrokerKey(brokerId, login) : '';
  const serverKey = serverUrl ? buildServerKey(serverUrl, login) : '';

  const fromMemory = memorySessions.get(exactKey)
    || (brokerKey ? memorySessions.get(brokerKey) : undefined)
    || (serverKey ? memorySessions.get(serverKey) : undefined);

  const persisted = readPersistedSessions();
  const fromStorage = persisted[exactKey]
    || (brokerKey ? persisted[brokerKey] : undefined)
    || (serverKey ? persisted[serverKey] : undefined);

  const combined: CachedAccountSession | undefined = fromMemory || fromStorage
    ? {
        ...(fromStorage || {}),
        ...(fromMemory || {}),
        authToken: fromMemory?.authToken || fromStorage?.authToken || '',
        ...((fromMemory?.password || fromStorage?.password) ? { password: fromMemory?.password || fromStorage?.password } : {}),
      } as CachedAccountSession
    : undefined;

  if (!combined) return null;

  if (isSessionFresh(combined)) {
    memorySessions.set(exactKey, combined);
    if (brokerKey) memorySessions.set(brokerKey, combined);
    if (serverKey) memorySessions.set(serverKey, combined);
    return combined;
  }

  if (combined.password) {
    return {
      ...combined,
      authToken: '',
    };
  }

  return null;
};

export const invalidateAccountSessionToken = (query: {
  brokerId?: string | null;
  serverUrl?: string | null;
  login: string | number;
}): void => {
  syncMemoryWithStorage();
  const login = normalizeKeyPart(String(query.login));
  const brokerId = normalizeKeyPart(query.brokerId);
  const serverUrl = normalizeKeyPart(query.serverUrl);
  if (!login) return;

  const exactKey = buildExactKey(brokerId, serverUrl, login);
  const brokerKey = brokerId ? buildBrokerKey(brokerId, login) : '';
  const serverKey = serverUrl ? buildServerKey(serverUrl, login) : '';
  const keys = [exactKey, brokerKey, serverKey].filter(Boolean);

  for (const key of keys) {
    const mem = memorySessions.get(key);
    if (mem) {
      if (mem.password) {
        memorySessions.set(key, {
          ...mem,
          authToken: '',
          refreshToken: undefined,
          expiresAt: undefined,
          updatedAt: Date.now(),
        });
      } else {
        memorySessions.delete(key);
      }
    }
  }

  const persisted = readPersistedSessions();
  let modified = false;
  for (const [key, record] of Object.entries(persisted)) {
    if (!record) continue;
    const matchesKey = keys.includes(key) || (
      record.login === login
      && (!brokerId || !record.brokerId || record.brokerId.toLowerCase() === brokerId.toLowerCase())
    );
    if (!matchesKey) continue;
    modified = true;
    if (record.password) {
      persisted[key] = {
        ...record,
        authToken: '',
        refreshToken: undefined,
        expiresAt: undefined,
        updatedAt: Date.now(),
      };
    } else {
      delete persisted[key];
    }
  }
  if (modified) {
    writePersistedSessions(persisted);
  }
};

export const forgetAccountSession = (query: {
  brokerId?: string | null;
  serverUrl?: string | null;
  login: string | number;
}): void => {
  syncMemoryWithStorage();
  const login = normalizeKeyPart(String(query.login));
  const brokerId = normalizeKeyPart(query.brokerId);
  const serverUrl = normalizeKeyPart(query.serverUrl);
  if (!login) return;

  const exactKey = buildExactKey(brokerId, serverUrl, login);
  const brokerKey = brokerId ? buildBrokerKey(brokerId, login) : '';
  const serverKey = serverUrl ? buildServerKey(serverUrl, login) : '';
  memorySessions.delete(exactKey);
  if (brokerKey) memorySessions.delete(brokerKey);
  if (serverKey) memorySessions.delete(serverKey);

  const persisted = readPersistedSessions();
  delete persisted[exactKey];
  if (brokerKey) delete persisted[brokerKey];
  if (serverKey) delete persisted[serverKey];
  writePersistedSessions(persisted);
};

export const clearCachedAccountSessions = (): void => {
  memorySessions.clear();
  hasStorageWritten = false;
  if (typeof window !== 'undefined') {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        sessionStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
      }
    } catch {
      // Ignore
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
      }
    } catch {
      // Ignore
    }
  }
};

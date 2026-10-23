import { normalizeSavedAccountServer } from './savedAccountScope';

export interface CachedAccountSession {
  login: string;
  brokerId: string;
  serverUrl: string;
  authToken: string;
  refreshToken?: string;
  expiresAt?: number;
  updatedAt: number;
}

const SESSION_STORAGE_KEY = 'rtx_account_sessions_v1';
const EXPIRY_BUFFER_MS = 5_000;

const memorySessions = new Map<string, CachedAccountSession>();

const normalizeKeyPart = (value: string | undefined | null): string =>
  String(value || '').trim();

const buildExactKey = (brokerId: string, serverUrl: string, login: string): string =>
  JSON.stringify([
    normalizeKeyPart(brokerId).toLowerCase(),
    normalizeSavedAccountServer(normalizeKeyPart(serverUrl)).toLowerCase(),
    normalizeKeyPart(login),
  ]);

const buildBrokerKey = (brokerId: string, login: string): string =>
  JSON.stringify([
    normalizeKeyPart(brokerId).toLowerCase(),
    '',
    normalizeKeyPart(login),
  ]);

const readPersistedSessions = (): Record<string, CachedAccountSession> => {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, CachedAccountSession>) : {};
  } catch {
    return {};
  }
};

const writePersistedSessions = (records: Record<string, CachedAccountSession>): void => {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage quota or security errors
  }
};

const isSessionFresh = (session: CachedAccountSession | undefined): session is CachedAccountSession => {
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
}): void => {
  const login = normalizeKeyPart(input.login != null ? String(input.login) : '');
  const authToken = normalizeKeyPart(input.authToken);
  const brokerId = normalizeKeyPart(input.brokerId);
  const serverUrl = normalizeKeyPart(input.serverUrl);
  if (!login || !authToken || (!brokerId && !serverUrl)) return;

  const entry: CachedAccountSession = {
    login,
    brokerId,
    serverUrl,
    authToken,
    ...(input.refreshToken ? { refreshToken: input.refreshToken } : {}),
    ...(typeof input.expiresAt === 'number' && Number.isFinite(input.expiresAt) ? { expiresAt: input.expiresAt } : {}),
    updatedAt: Date.now(),
  };

  const exactKey = buildExactKey(brokerId, serverUrl, login);
  memorySessions.set(exactKey, entry);
  if (brokerId) {
    memorySessions.set(buildBrokerKey(brokerId, login), entry);
  }

  const persisted = readPersistedSessions();
  persisted[exactKey] = entry;
  if (brokerId) {
    persisted[buildBrokerKey(brokerId, login)] = entry;
  }
  writePersistedSessions(persisted);
};

export const getCachedAccountSession = (query: {
  brokerId?: string | null;
  serverUrl?: string | null;
  login: string | number;
}): CachedAccountSession | null => {
  const login = normalizeKeyPart(String(query.login));
  const brokerId = normalizeKeyPart(query.brokerId);
  const serverUrl = normalizeKeyPart(query.serverUrl);
  if (!login || (!brokerId && !serverUrl)) return null;

  const exactKey = buildExactKey(brokerId, serverUrl, login);
  const fallbackKey = brokerId ? buildBrokerKey(brokerId, login) : '';

  const fromMemory = memorySessions.get(exactKey) || (fallbackKey ? memorySessions.get(fallbackKey) : undefined);
  if (isSessionFresh(fromMemory)) {
    return fromMemory;
  }

  const persisted = readPersistedSessions();
  const fromStorage = persisted[exactKey] || (fallbackKey ? persisted[fallbackKey] : undefined);
  if (isSessionFresh(fromStorage)) {
    memorySessions.set(exactKey, fromStorage);
    return fromStorage;
  }

  return null;
};

export const forgetAccountSession = (query: {
  brokerId?: string | null;
  serverUrl?: string | null;
  login: string | number;
}): void => {
  const login = normalizeKeyPart(String(query.login));
  const brokerId = normalizeKeyPart(query.brokerId);
  const serverUrl = normalizeKeyPart(query.serverUrl);
  if (!login) return;

  const exactKey = buildExactKey(brokerId, serverUrl, login);
  const fallbackKey = brokerId ? buildBrokerKey(brokerId, login) : '';
  memorySessions.delete(exactKey);
  if (fallbackKey) memorySessions.delete(fallbackKey);

  const persisted = readPersistedSessions();
  delete persisted[exactKey];
  if (fallbackKey) delete persisted[fallbackKey];
  writePersistedSessions(persisted);
};

export const clearCachedAccountSessions = (): void => {
  memorySessions.clear();
  if (typeof window !== 'undefined' && typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
};

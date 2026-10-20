import { useSyncExternalStore } from 'react';
import { getRuntimeBrokerConfiguration, isDesktopBackendTarget } from '../config/backendTarget.js';

/**
 * The server name the broker publishes (white-label, display only).
 *
 * Source: the broker's own `/api/v2/broker/config` `server_name`, or the
 * `/api/v2/broker/servers` entry of the current broker when the config has no
 * server name. The value is shown exactly as the broker set it.
 *
 * The build fallback DEFAULT_MT5_SERVER is the only value ever replaced, and
 * only while this broker-published name is known. No word lists, no broker
 * literals. Routing and login never read this module.
 */

const STORAGE_KEY = 'rtx_broker_server_identity_v1';

type StoredIdentity = { brokerId: string; serverName: string };

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const sameLabel = (a: unknown, b: unknown): boolean => {
  const x = text(a).toLowerCase();
  return Boolean(x) && x === text(b).toLowerCase();
};

const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

const readRuntime = (): { brokerId: string; defaultMt5Server: string } => {
  try {
    const config = getRuntimeBrokerConfiguration() as { brokerId?: unknown; defaultMt5Server?: unknown } | null;
    return { brokerId: text(config?.brokerId), defaultMt5Server: text(config?.defaultMt5Server) };
  } catch {
    return { brokerId: '', defaultMt5Server: '' };
  }
};

const readStorage = (key: string): string => {
  try {
    return typeof localStorage === 'undefined' ? '' : localStorage.getItem(key) || '';
  } catch {
    return '';
  }
};

const isDesktop = (): boolean => {
  try {
    return isDesktopBackendTarget();
  } catch {
    return false;
  }
};

/**
 * The broker this terminal talks to: the pinned deployment broker on web,
 * the selected broker on desktop (a desktop build can switch brokers).
 */
export const getCurrentBrokerId = (): string => {
  const selected = text(readStorage('broker_id')) || text(readStorage('rtx_broker_id'));
  const deployment = readRuntime().brokerId;
  return isDesktop() ? selected || deployment : deployment || selected;
};

/** The build fallback server label (runtime DEFAULT_MT5_SERVER). */
export const getBuildFallbackServer = (): string => readRuntime().defaultMt5Server;

const readStoredIdentity = (): StoredIdentity | null => {
  try {
    const parsed = JSON.parse(readStorage(STORAGE_KEY) || 'null') as Partial<StoredIdentity> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const serverName = text(parsed.serverName);
    return serverName ? { brokerId: text(parsed.brokerId), serverName } : null;
  } catch {
    return null;
  }
};

/** The broker-published server name for the current broker, or '' when unknown. */
export const getKnownBrokerServerName = (): string => {
  const stored = readStoredIdentity();
  if (!stored) return '';
  const brokerId = getCurrentBrokerId();
  if (stored.brokerId && brokerId && stored.brokerId !== brokerId) return '';
  return stored.serverName;
};

type ServerEntry = { broker_id?: unknown; server?: unknown };

/**
 * The current broker's `/broker/servers` entry label: the entry the session
 * selected (remembered server) when listed, otherwise the broker's first one.
 * Entries of other brokers, or without a broker id while one is known, never
 * name this broker.
 */
const selectServerEntryLabel = (servers: readonly unknown[], brokerId: string): string => {
  const labels = servers
    .filter((entry): entry is ServerEntry => Boolean(entry) && typeof entry === 'object')
    .filter(entry => (brokerId ? text(entry.broker_id) === brokerId : true))
    .map(entry => text(entry.server))
    .filter(Boolean);
  const remembered = text(readStorage('rtx_broker_server'));
  return labels.find(label => sameLabel(label, remembered)) || labels[0] || '';
};

/**
 * Remember the broker-published server name from a broker config document
 * and, when it has none, from the current broker's `/broker/servers` entry.
 * Returns the recorded name ('' when the documents carry none for this broker).
 */
export const recordBrokerServerIdentity = (config: unknown, servers: readonly unknown[] = []): string => {
  const brokerId = getCurrentBrokerId();
  const document = config && typeof config === 'object'
    ? config as { server_name?: unknown; serverName?: unknown; broker_id?: unknown; brokerId?: unknown }
    : null;
  const documentBrokerId = text(document?.broker_id) || text(document?.brokerId);
  const fromConfig = documentBrokerId && brokerId && documentBrokerId !== brokerId
    ? ''
    : text(document?.server_name) || text(document?.serverName);
  const serverName = fromConfig || selectServerEntryLabel(servers, brokerId);
  if (!serverName) return '';
  const current = readStoredIdentity();
  if (current?.serverName === serverName && current.brokerId === brokerId) return serverName;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ brokerId, serverName } satisfies StoredIdentity));
  } catch {
    // Display metadata only: a storage failure must not interrupt the terminal.
  }
  notify();
  return serverName;
};

/** Forget the recorded server name (tests; a broker switch is handled by the broker id key). */
export const clearKnownBrokerServerName = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored.
  }
  notify();
};

/**
 * Display label for a server value: the build fallback DEFAULT_MT5_SERVER is
 * replaced by the broker-published server name when that name is known.
 * Every other value, including an empty one, is returned unchanged.
 */
export const resolveServerDisplayLabel = (value: unknown): string => {
  const label = typeof value === 'string' ? value : String(value ?? '');
  const fallback = getBuildFallbackServer();
  if (!fallback || !sameLabel(label, fallback)) return label;
  return getKnownBrokerServerName() || label;
};

export const subscribeKnownBrokerServerName = (listener: () => void): (() => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) listener();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
};

/** Re-render when the broker-published server name becomes known or changes. */
export const useKnownBrokerServerName = (): string =>
  useSyncExternalStore(subscribeKnownBrokerServerName, getKnownBrokerServerName, () => '');

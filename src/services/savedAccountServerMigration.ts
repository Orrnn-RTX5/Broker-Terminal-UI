import { useEffect } from 'react';
import { useAppStore, type SavedAccount } from '../store/useAppStore';
import {
  getBuildFallbackServer,
  getCurrentBrokerId,
  getKnownBrokerServerName,
  subscribeKnownBrokerServerName,
  useKnownBrokerServerName,
} from './brokerServerIdentity';

/**
 * Saved accounts written under the build fallback server key.
 *
 * A login made while only the build fallback DEFAULT_MT5_SERVER was known
 * saved its account under that label, so the Navigator showed a second group
 * for the same broker. Once the broker config is available, those accounts
 * move to the broker's real key: the key its other saved accounts already
 * use, otherwise the broker-published server name.
 *
 * Guarantees: only fallback-key rows of the current broker change; no saved
 * login is ever dropped; a same-login row is merged only into a row with a
 * compatible broker id and endpoint, keeping its name, favourite, account
 * type and endpoint; running again changes nothing. Passwords are not part of
 * a saved account (they live in a separate encrypted vault keyed by broker id
 * and endpoint) and are never read here.
 */
export interface SavedAccountServerMigrationContext {
  fallbackServer: string;
  brokerId: string;
  serverName: string;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const sameLabel = (a: unknown, b: unknown): boolean => {
  const x = text(a).toLowerCase();
  return Boolean(x) && x === text(b).toLowerCase();
};
const compatible = (a?: string, b?: string): boolean => !a || !b || a === b;

/** Context for the current broker, or null while the broker config is unavailable. */
export const getSavedAccountServerMigrationContext = (): SavedAccountServerMigrationContext | null => {
  const fallbackServer = getBuildFallbackServer();
  const serverName = getKnownBrokerServerName();
  if (!fallbackServer || !serverName) return null;
  return { fallbackServer, brokerId: getCurrentBrokerId(), serverName };
};

const isFallbackRow = (account: SavedAccount, ctx: SavedAccountServerMigrationContext): boolean => (
  sameLabel(account.server, ctx.fallbackServer)
  && (!account.brokerId || !ctx.brokerId || account.brokerId === ctx.brokerId)
);

/** The key the broker's other saved accounts use most, else the published server name. */
const resolveTargetKey = (accounts: readonly SavedAccount[], ctx: SavedAccountServerMigrationContext): string => {
  const usage = new Map<string, { count: number; lastUsed: number; order: number }>();
  accounts.forEach((account, order) => {
    if (sameLabel(account.server, ctx.fallbackServer)) return;
    const sameBroker = account.brokerId
      ? Boolean(ctx.brokerId) && account.brokerId === ctx.brokerId
      : sameLabel(account.server, ctx.brokerId) || sameLabel(account.server, ctx.serverName);
    if (!sameBroker) return;
    const entry = usage.get(account.server) ?? { count: 0, lastUsed: 0, order };
    entry.count += 1;
    entry.lastUsed = Math.max(entry.lastUsed, account.lastUsed ?? 0);
    usage.set(account.server, entry);
  });
  const [best] = [...usage.entries()].sort(([, a], [, b]) => (
    b.count - a.count || b.lastUsed - a.lastUsed || a.order - b.order
  ));
  return best?.[0] ?? ctx.serverName;
};

const mergeRows = (rows: readonly SavedAccount[]): SavedAccount => {
  // The most recently used row wins; empty fields are filled from the others.
  const [primary, ...others] = [...rows].sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0));
  const pick = <K extends keyof SavedAccount>(key: K): SavedAccount[K] | undefined => (
    [primary, ...others].map(row => row[key]).find(value => value !== undefined && value !== '')
  );
  const merged: SavedAccount = { ...primary };
  const name = pick('name');
  if (name !== undefined) merged.name = name;
  const brokerId = pick('brokerId');
  if (brokerId !== undefined) merged.brokerId = brokerId;
  const serverUrl = pick('serverUrl');
  if (serverUrl !== undefined) merged.serverUrl = serverUrl;
  const accountType = pick('accountType');
  if (accountType !== undefined) {
    merged.accountType = accountType;
    merged.isLive = accountType === 'real';
  } else {
    const isLive = pick('isLive');
    if (isLive !== undefined) merged.isLive = isLive;
  }
  if (rows.some(row => row.isFavorite === true)) merged.isFavorite = true;
  else if (rows.some(row => row.isFavorite === false)) merged.isFavorite = false;
  const lastUsed = Math.max(...rows.map(row => row.lastUsed ?? Number.NEGATIVE_INFINITY));
  if (Number.isFinite(lastUsed)) merged.lastUsed = lastUsed;
  return merged;
};

/**
 * Pure migration. Returns the same array when nothing changes (idempotent).
 */
export const migrateFallbackServerAccounts = (
  accounts: readonly SavedAccount[],
  ctx: SavedAccountServerMigrationContext,
): SavedAccount[] => {
  const source = accounts as SavedAccount[];
  if (!text(ctx.fallbackServer) || !text(ctx.serverName)) return source;
  if (!accounts.some(account => isFallbackRow(account, ctx))) return source;
  const target = resolveTargetKey(accounts, ctx);

  // Output slots in original order; a migrated row either joins a compatible
  // same-login slot under the target key or keeps its own slot.
  const slots: SavedAccount[][] = [];
  const migratedSlots = new Set<number>();
  accounts.forEach((account) => {
    if (!isFallbackRow(account, ctx)) {
      slots.push([account]);
      return;
    }
    const moved: SavedAccount = { ...account, server: target };
    const joinIndex = slots.findIndex(rows => {
      const head = rows[0];
      return head.login === moved.login
        && head.server === target
        && rows.every(row => compatible(row.brokerId, moved.brokerId) && compatible(row.serverUrl, moved.serverUrl));
    });
    if (joinIndex >= 0) {
      slots[joinIndex].push(moved);
      migratedSlots.add(joinIndex);
    } else {
      slots.push([moved]);
      migratedSlots.add(slots.length - 1);
    }
  });
  return slots.map((rows, index) => (migratedSlots.has(index) && rows.length > 1 ? mergeRows(rows) : rows[0]));
};

/** Apply the migration to the saved-account store. Returns true when it changed. */
export const applySavedAccountServerMigration = (): boolean => {
  const ctx = getSavedAccountServerMigrationContext();
  if (!ctx) return false;
  const current = useAppStore.getState().savedAccounts;
  const next = migrateFallbackServerAccounts(current, ctx);
  if (next === current) return false;
  useAppStore.setState({ savedAccounts: next });
  return true;
};

/**
 * Keep saved accounts on the broker's real key: runs when the broker config
 * becomes available and after every saved-account change (a login made while
 * only the fallback was known is merged right away). Idempotent.
 */
export const useSavedAccountServerMigration = (): void => {
  const serverName = useKnownBrokerServerName();
  const savedAccounts = useAppStore(state => state.savedAccounts);
  useEffect(() => {
    applySavedAccountServerMigration();
  }, [serverName, savedAccounts]);
};

/**
 * App-wide installation without React re-renders: migrates now, when the
 * broker config becomes available, and after every saved-account change.
 * Returns the unsubscribe function.
 */
export const installSavedAccountServerMigration = (): (() => void) => {
  applySavedAccountServerMigration();
  const stopIdentity = subscribeKnownBrokerServerName(() => { applySavedAccountServerMigration(); });
  const stopStore = useAppStore.subscribe((state, previous) => {
    if (state.savedAccounts !== previous.savedAccounts) applySavedAccountServerMigration();
  });
  return () => {
    stopIdentity();
    stopStore();
  };
};

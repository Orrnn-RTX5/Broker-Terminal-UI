/**
 * Saved-account migration from the build fallback server key (white-label).
 *
 * Accounts saved under the build fallback DEFAULT_MT5_SERVER for the current
 * broker move to the broker's real server key once the broker config is
 * available. The merge is idempotent, de-duplicated and never drops a saved
 * login or a favourite. Accounts of other brokers and every non-fallback key
 * stay untouched. Saved passwords are never read or written (they live in a
 * separate encrypted vault keyed by broker id and endpoint, not by label).
 *
 * Fixtures are neutral: no real broker, host or account literals.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SAVED_ACCOUNTS_STORAGE_KEY, useAppStore, type SavedAccount } from '../store/useAppStore';
import {
  applySavedAccountServerMigration,
  getSavedAccountServerMigrationContext,
  migrateFallbackServerAccounts,
  type SavedAccountServerMigrationContext,
} from './savedAccountServerMigration';
import { clearKnownBrokerServerName, recordBrokerServerIdentity } from './brokerServerIdentity';

type RuntimeWindow = Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> };

const API_HOST = 'https://broker.example';
const BROKER_ID = 'example-broker';
const FALLBACK = 'local-dev';
const SERVER_NAME = 'Example Markets';

const ctx: SavedAccountServerMigrationContext = {
  fallbackServer: FALLBACK,
  brokerId: BROKER_ID,
  serverName: SERVER_NAME,
};

const account = (login: number, server: string, extra: Partial<SavedAccount> = {}): SavedAccount => ({
  login, name: `Account ${login}`, server, ...extra,
});

const logins = (accounts: readonly SavedAccount[]) => [...new Set(accounts.map(a => a.login))].sort();

describe('migrateFallbackServerAccounts (pure)', () => {
  it('merges fallback-key accounts into the existing real key of the same broker', () => {
    const accounts = [
      account(200001, BROKER_ID, { brokerId: BROKER_ID, serverUrl: API_HOST, lastUsed: 10 }),
      account(200002, FALLBACK, { brokerId: BROKER_ID, serverUrl: API_HOST, lastUsed: 20, isFavorite: true }),
      account(200003, FALLBACK, { lastUsed: 5 }),
    ];

    const migrated = migrateFallbackServerAccounts(accounts, ctx);

    expect(migrated.map(a => a.server)).toEqual([BROKER_ID, BROKER_ID, BROKER_ID]);
    expect(logins(migrated)).toEqual([200001, 200002, 200003]);
    expect(migrated.find(a => a.login === 200002)).toMatchObject({ isFavorite: true, brokerId: BROKER_ID, serverUrl: API_HOST });
    expect(new Set(migrated.map(a => a.server)).size).toBe(1);
  });

  it('uses the broker config server name when no other key exists for the broker', () => {
    const migrated = migrateFallbackServerAccounts([account(200004, FALLBACK)], ctx);
    expect(migrated).toEqual([account(200004, SERVER_NAME)]);
  });

  it('de-duplicates the same login saved under both keys without losing name, favourite or endpoint', () => {
    const accounts = [
      account(200005, BROKER_ID, { name: '', brokerId: BROKER_ID, lastUsed: 100 }),
      account(200005, FALLBACK, { name: 'Main account', serverUrl: API_HOST, isFavorite: true, accountType: 'real', isLive: true, lastUsed: 50 }),
    ];

    const migrated = migrateFallbackServerAccounts(accounts, ctx);

    expect(migrated).toHaveLength(1);
    expect(migrated[0]).toMatchObject({
      login: 200005,
      server: BROKER_ID,
      name: 'Main account',
      brokerId: BROKER_ID,
      serverUrl: API_HOST,
      isFavorite: true,
      accountType: 'real',
      lastUsed: 100,
    });
  });

  it('keeps both rows when the same login belongs to different endpoints', () => {
    const accounts = [
      account(200006, BROKER_ID, { brokerId: BROKER_ID, serverUrl: API_HOST }),
      account(200006, FALLBACK, { brokerId: BROKER_ID, serverUrl: 'https://other-endpoint.example' }),
    ];
    const migrated = migrateFallbackServerAccounts(accounts, ctx);
    expect(migrated).toHaveLength(2);
    expect(migrated.every(a => a.server === BROKER_ID)).toBe(true);
  });

  it('is idempotent and returns the same array when nothing needs to change', () => {
    const accounts = [
      account(200001, BROKER_ID, { brokerId: BROKER_ID }),
      account(200002, FALLBACK, { brokerId: BROKER_ID, isFavorite: true }),
      account(200002, BROKER_ID, { brokerId: BROKER_ID }),
    ];
    const once = migrateFallbackServerAccounts(accounts, ctx);
    const twice = migrateFallbackServerAccounts(once, ctx);
    expect(twice).toBe(once);
    expect(twice).toEqual(once);
    expect(migrateFallbackServerAccounts(twice, ctx)).toBe(twice);
  });

  it('never touches other brokers or non-fallback keys', () => {
    const accounts = [
      account(300001, FALLBACK, { brokerId: 'another-broker' }),
      account(300002, 'Another-Live', { brokerId: 'another-broker' }),
      account(300003, 'dev', { brokerId: BROKER_ID }),
      account(300004, 'test', {}),
    ];
    expect(migrateFallbackServerAccounts(accounts, ctx)).toBe(accounts);
  });

  it('matches the fallback key case-insensitively and ignores surrounding spaces', () => {
    const migrated = migrateFallbackServerAccounts([account(200007, ' LOCAL-DEV ')], ctx);
    expect(migrated[0].server).toBe(SERVER_NAME);
  });
});

describe('saved-account migration against the store', () => {
  beforeEach(() => {
    localStorage.clear();
    clearKnownBrokerServerName();
    (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__ = {
      CONFIG_SOURCE: 'build', BACKEND_TARGET: 'web', API_HOST, API_HOST_EXT: API_HOST,
      WS_HOST: 'wss://broker.example', BROKER_ID, BROKER_NAME: '', DEFAULT_MT5_SERVER: FALLBACK,
      DISCOVERY_BASE_URL: API_HOST,
    };
    useAppStore.setState({ savedAccounts: [] });
  });

  afterEach(() => {
    clearKnownBrokerServerName();
    delete (window as RuntimeWindow).__RTX_RUNTIME_CONFIG__;
    useAppStore.setState({ savedAccounts: [] });
    localStorage.clear();
  });

  it('does nothing until the broker config is available', () => {
    const accounts = [account(200001, FALLBACK), account(200002, BROKER_ID)];
    useAppStore.setState({ savedAccounts: accounts });

    expect(getSavedAccountServerMigrationContext()).toBeNull();
    expect(applySavedAccountServerMigration()).toBe(false);
    expect(useAppStore.getState().savedAccounts).toBe(accounts);
  });

  it('merges into one key per broker, persists it, and is idempotent', () => {
    useAppStore.setState({
      savedAccounts: [
        account(200001, BROKER_ID, { brokerId: BROKER_ID, isFavorite: true }),
        account(200002, FALLBACK, { isFavorite: true }),
        account(200001, FALLBACK, { name: 'Owner' }),
      ],
    });
    recordBrokerServerIdentity({ server_name: SERVER_NAME });

    expect(getSavedAccountServerMigrationContext()).toEqual(ctx);
    expect(applySavedAccountServerMigration()).toBe(true);

    const migrated = useAppStore.getState().savedAccounts;
    expect(logins(migrated)).toEqual([200001, 200002]);
    expect(new Set(migrated.map(a => a.server))).toEqual(new Set([BROKER_ID]));
    expect(migrated.filter(a => a.isFavorite).map(a => a.login).sort()).toEqual([200001, 200002]);
    const persisted = JSON.parse(localStorage.getItem(SAVED_ACCOUNTS_STORAGE_KEY) || '[]') as SavedAccount[];
    expect(persisted).toEqual(migrated);
    expect(JSON.stringify(persisted)).not.toMatch(/password/i);

    expect(applySavedAccountServerMigration()).toBe(false);
    expect(useAppStore.getState().savedAccounts).toBe(migrated);
  });

  it('leaves every account alone when the broker publishes the fallback label as its server name', () => {
    const accounts = [
      account(200001, FALLBACK, { isFavorite: true }),
      account(200002, BROKER_ID, { brokerId: BROKER_ID }),
    ];
    useAppStore.setState({ savedAccounts: accounts });
    recordBrokerServerIdentity({ server_name: ' Local-Dev ' });

    expect(getSavedAccountServerMigrationContext()).toBeNull();
    expect(applySavedAccountServerMigration()).toBe(false);
    expect(useAppStore.getState().savedAccounts).toBe(accounts);
    expect(migrateFallbackServerAccounts(accounts, { ...ctx, serverName: 'LOCAL-DEV' })).toBe(accounts);
  });
});

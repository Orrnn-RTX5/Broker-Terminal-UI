export interface SavedLoginScope {
  brokerId: string;
  serverUrl: string;
}

interface EncryptedLogin {
  kind: 'login';
  scope: string;
  login: string;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
  lastUsed: number;
}

const DATABASE = 'rtx-saved-logins-v1';
const STORE = 'vault';
const KEY = 'encryption-key';
const encoder = new TextEncoder();

export const supportsSavedLogins = (): boolean =>
  typeof indexedDB !== 'undefined' && Boolean(globalThis.crypto?.subtle);

export const savedLoginScopeKey = ({ brokerId, serverUrl }: SavedLoginScope): string => {
  const url = new URL(serverUrl);
  url.hash = '';
  return JSON.stringify([brokerId.trim(), url.href.replace(/\/$/, '')]);
};

const recordKey = (scope: string, login: string) => `login:${JSON.stringify([scope, login.trim()])}`;

interface VaultMemoryCache {
  hydrated: boolean;
  hydratePromise?: Promise<void>;
  records: Map<string, EncryptedLogin>;
  key?: CryptoKey;
}

const vaultCacheByFactory = new WeakMap<IDBFactory, VaultMemoryCache>();

const getVaultCache = (): VaultMemoryCache | null => {
  if (typeof indexedDB === 'undefined' || !indexedDB) return null;
  let cache = vaultCacheByFactory.get(indexedDB);
  if (!cache) {
    cache = { hydrated: false, records: new Map() };
    vaultCacheByFactory.set(indexedDB, cache);
  }
  return cache;
};

// IndexedDB can persist a non-extractable CryptoKey. Passwords never enter
// localStorage, sessionStorage, account metadata, or application logs.
const transact = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, done: (value: T) => void) => void): Promise<T> => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Saved password storage is unavailable.'));
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      let result: T;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error || new Error('Saved password storage is unavailable.'));
      transaction.onerror = () => reject(transaction.error);
      work(transaction.objectStore(STORE), value => { result = value; });
    });
  } finally {
    db.close();
  }
};

const read = <T>(key: string) => transact<T | undefined>('readonly', (store, done) => {
  const request = store.get(key);
  request.onsuccess = () => done(request.result);
});

const hydrateVaultCache = async (cache: VaultMemoryCache): Promise<void> => {
  if (cache.hydrated) return;
  if (!cache.hydratePromise) {
    cache.hydratePromise = transact<{ all: unknown[]; key?: CryptoKey }>('readonly', (store, done) => {
      let all: unknown[] = [];
      let key: CryptoKey | undefined;
      const allReq = store.getAll();
      const keyReq = store.get(KEY);
      allReq.onsuccess = () => { all = Array.isArray(allReq.result) ? allReq.result : []; };
      keyReq.onsuccess = () => {
        key = keyReq.result as CryptoKey | undefined;
        done({ all, key });
      };
    }).then(({ all, key }) => {
      for (const item of all) {
        const record = item as EncryptedLogin | undefined;
        if (record && record.kind === 'login' && typeof record.scope === 'string' && typeof record.login === 'string') {
          const id = recordKey(record.scope, record.login);
          if (!cache.records.has(id)) {
            cache.records.set(id, record);
          }
        }
      }
      if (key && !cache.key) cache.key = key;
      cache.hydrated = true;
    }).finally(() => {
      cache.hydratePromise = undefined;
    });
  }
  await cache.hydratePromise;
};

const getEncryptionKey = async (): Promise<CryptoKey> => {
  const cache = getVaultCache();
  if (cache?.key) return cache.key;
  const stored = await read<CryptoKey>(KEY);
  if (stored) {
    if (cache) cache.key = stored;
    return stored;
  }
  const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  // Serialize installation across tabs so concurrent first saves share a key.
  const key = await transact<CryptoKey>('readwrite', (store, done) => {
    const request = store.get(KEY);
    request.onsuccess = () => {
      const resolvedKey = request.result || candidate;
      if (!request.result) store.put(resolvedKey, KEY);
      done(resolvedKey);
    };
  });
  if (cache) cache.key = key;
  return key;
};

export const saveLogin = async (scope: SavedLoginScope, login: string, password: string): Promise<void> => {
  if (!supportsSavedLogins()) throw new Error('Saving passwords is unavailable on this device.');
  const scopeKey = savedLoginScopeKey(scope);
  const id = recordKey(scopeKey, login);
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(id) }, key, encoder.encode(password));
  const record: EncryptedLogin = { kind: 'login', scope: scopeKey, login: login.trim(), iv, ciphertext, lastUsed: Date.now() };
  await transact<void>('readwrite', (store, done) => { store.put(record, id); done(); });
  const cache = getVaultCache();
  if (cache) {
    cache.records.set(id, record);
    cache.key = key;
  }
};

export const loadSavedLogin = async (scope: SavedLoginScope, login = ''): Promise<{ login: string; password: string } | null> => {
  if (!supportsSavedLogins()) return null;
  const scopeKey = savedLoginScopeKey(scope);
  const trimmedLogin = login.trim();
  const cache = getVaultCache();
  let record: EncryptedLogin | undefined;
  if (cache) {
    await hydrateVaultCache(cache);
    if (trimmedLogin) {
      record = cache.records.get(recordKey(scopeKey, trimmedLogin));
    } else {
      record = [...cache.records.values()]
        .filter(item => item.kind === 'login' && item.scope === scopeKey)
        .sort((a, b) => b.lastUsed - a.lastUsed)[0];
    }
  } else {
    record = trimmedLogin
      ? await read<EncryptedLogin>(recordKey(scopeKey, trimmedLogin))
      : await transact<EncryptedLogin | undefined>('readonly', (store, done) => {
        const request = store.getAll();
        request.onsuccess = () => done((request.result as EncryptedLogin[])
          .filter(item => item.kind === 'login' && item.scope === scopeKey)
          .sort((a, b) => b.lastUsed - a.lastUsed)[0]);
      });
  }
  if (!record) return null;
  const key = cache?.key ?? await read<CryptoKey>(KEY);
  if (!key) throw new Error('Saved password is unavailable. Please enter it again.');
  if (cache) cache.key = key;
  const plaintext = await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: record.iv, additionalData: encoder.encode(recordKey(record.scope, record.login)),
  }, key, record.ciphertext);
  return { login: record.login, password: new TextDecoder().decode(plaintext) };
};

export const forgetSavedLogin = async (scope: SavedLoginScope, login: string): Promise<void> => {
  if (!supportsSavedLogins() || !login.trim()) return;
  const id = recordKey(savedLoginScopeKey(scope), login);
  await transact<void>('readwrite', (store, done) => {
    store.delete(id);
    done();
  });
  const cache = getVaultCache();
  cache?.records.delete(id);
};

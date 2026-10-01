// @vitest-environment node
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetSavedLogin, loadSavedLogin, saveLogin, supportsSavedLogins } from './savedLogins';

const scope = { brokerId: 'Nexa', serverUrl: 'https://broker.example' };
const inspectVault = async () => {
  const db = await new Promise<IDBDatabase>(resolve => {
    const request = indexedDB.open('rtx-saved-logins-v1', 1);
    request.onsuccess = () => resolve(request.result);
  });
  try {
    return await new Promise<unknown[]>(resolve => {
      const request = db.transaction('vault').objectStore('vault').getAll();
      request.onsuccess = () => resolve(request.result);
    });
  } finally { db.close(); }
};

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => vi.unstubAllGlobals());

describe('saved account passwords', () => {
  it('persists encrypted passwords across module reloads with a non-extractable key', async () => {
    await saveLogin(scope, '12345', 'fixture-password');
    const records = await inspectVault();
    expect(JSON.stringify(records)).not.toContain('fixture-password');
    const key = records.find(record => (record as CryptoKey).type === 'secret') as CryptoKey;
    const encrypted = records.find(record => (record as { kind: string }).kind === 'login') as { ciphertext: ArrayBuffer };
    expect(Buffer.from(encrypted.ciphertext).includes(Buffer.from('fixture-password'))).toBe(false);
    expect(encrypted.ciphertext.byteLength).toBe(Buffer.byteLength('fixture-password') + 16);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
    vi.resetModules();
    const reloaded = await import('./savedLogins');
    expect(await reloaded.loadSavedLogin(scope, '12345')).toEqual({ login: '12345', password: 'fixture-password' });
  });

  it('isolates account, broker identity including case, and server endpoint', async () => {
    await saveLogin(scope, '12345', 'fixture-password');
    expect(await loadSavedLogin(scope, '54321')).toBeNull();
    expect(await loadSavedLogin({ ...scope, brokerId: 'nexa' }, '12345')).toBeNull();
    expect(await loadSavedLogin({ ...scope, serverUrl: 'https://other.example' }, '12345')).toBeNull();
    expect(await loadSavedLogin({ ...scope, serverUrl: 'https://broker.example?tenant=other' }, '12345')).toBeNull();
    expect(await loadSavedLogin({ ...scope, serverUrl: 'https://broker.example/' }, '12345')).toEqual({ login: '12345', password: 'fixture-password' });
  });

  it('remembers the last account when the login field is empty and updates its password', async () => {
    await saveLogin(scope, '12345', 'old-fixture');
    await saveLogin(scope, '12345', 'new-fixture');
    expect(await loadSavedLogin(scope)).toEqual({ login: '12345', password: 'new-fixture' });
  });

  it('deletes only the matching saved account', async () => {
    await saveLogin(scope, '12345', 'fixture-one');
    await saveLogin(scope, '54321', 'fixture-two');
    await forgetSavedLogin(scope, '12345');
    expect(await loadSavedLogin(scope, '12345')).toBeNull();
    expect(await loadSavedLogin(scope, '54321')).toEqual({ login: '54321', password: 'fixture-two' });
  });

  it('keeps concurrent first saves decryptable', async () => {
    await Promise.all([saveLogin(scope, '12345', 'fixture-one'), saveLogin(scope, '54321', 'fixture-two')]);
    expect((await loadSavedLogin(scope, '12345'))?.password).toBe('fixture-one');
    expect((await loadSavedLogin(scope, '54321'))?.password).toBe('fixture-two');
  });

  it('does not offer persistence when encrypted storage is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    expect(supportsSavedLogins()).toBe(false);
    expect(await loadSavedLogin(scope)).toBeNull();
    await expect(saveLogin(scope, '12345', 'fixture')).rejects.toThrow('unavailable');
  });
});

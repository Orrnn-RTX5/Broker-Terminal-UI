// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LoginDialog } from './LoginDialog';
import { useAppStore } from '../store/useAppStore';
import { loadSavedLogin, saveLogin } from '../services/savedLogins';

const runtime = vi.hoisted(() => ({ login: vi.fn() }));
const scope = { brokerId: 'runtime-broker', serverUrl: 'https://broker.test' };
vi.mock('../api/trade', () => ({ authV2Api: { login: runtime.login } }));
vi.mock('../services/brokerSession', async importOriginal => ({
  ...await importOriginal<typeof import('../services/brokerSession')>(),
  persistBrokerSessionDiscovery: vi.fn(),
}));
vi.mock('../services/brokerDirectory', () => ({ loadAppBrokerDirectory: async () => [{ broker_id: 'runtime-broker', broker_name: 'Runtime Broker', server_url: 'https://broker.test' }] }));
vi.mock('../hooks/useUiTranslation', () => ({ useUiTranslation: () => (text: string) => text }));
vi.mock('../config/backendTarget.js', async importOriginal => ({
  ...await importOriginal<typeof import('../config/backendTarget.js')>(),
  isDesktopBackendTarget: () => false,
  getBackendTarget: () => 'https://broker.test',
  resolveBrokerExtApiUrl: () => 'https://broker.test',
  resolveBrokerBackendUrl: () => 'https://broker.test',
}));

beforeEach(() => {
  (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = { CONFIG_SOURCE: 'deployment', API_HOST: 'https://broker.test', WS_HOST: 'wss://broker.test', BROKER_ID: 'runtime-broker', DEFAULT_MT5_SERVER: 'Runtime Broker' };
  localStorage.clear();
  sessionStorage.clear();
  useAppStore.getState().reset();
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  runtime.login.mockReset().mockResolvedValue({ access_token: 'fixture-token', account_login: 12345, broker_id: 'runtime-broker' });
});
afterEach(() => {
  delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;
  vi.unstubAllGlobals();
});

const openDialog = () => render(<LoginDialog isOpen onClose={vi.fn()} lockedBrokerId="runtime-broker" />);
const ready = async () => {
  await screen.findByText('Server online');
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Save password' })).toBeEnabled());
};
const enterCredentials = () => {
  fireEvent.change(screen.getByLabelText('Account ID'), { target: { value: '12345' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fixture-password' } });
};

// Deterministic vault: every hook restore resolves in microtasks (null —
// nothing saved yet in these flows), so every ready() below is independent of
// vault timing under load. Direct loadSavedLogin assertions keep using the
// real vault (restore the spy first); reopen flows are untouched. saveLogin is
// a different function and is never mocked: saves still hit the real vault.
const steadyVault = async () => {
  const savedLogins = await import('../services/savedLogins');
  const spy = vi.spyOn(savedLogins, 'loadSavedLogin').mockResolvedValue(null);
  return () => spy.mockRestore();
};

it('saves on successful opt-in login and fills the masked password on reopening', async () => {
  const unvault = await steadyVault();
  const first = openDialog();
  await ready();
  expect(screen.getByRole('checkbox', { name: 'Save password' })).not.toBeChecked();
  enterCredentials();
  await ready();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Save password' }));
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
  await waitFor(() => expect(useAppStore.getState().isAuthenticated).toBe(true));
  unvault();
  expect(await loadSavedLogin(scope, '12345')).toEqual({ login: '12345', password: 'fixture-password' });
  expect(localStorage.getItem('rtx_saved_password')).toBeNull();
  first.unmount();
  openDialog();
  await ready();
  await waitFor(() => expect(screen.getByLabelText('Password')).toHaveValue('fixture-password'));
  expect(screen.getByLabelText('Password')).toHaveClass('rtx-secret-input');
  expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
  expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'off');
  expect(screen.getByRole('checkbox', { name: 'Save password' })).toBeChecked();
});

it('does not save passwords from unchecked or rejected logins', async () => {
  const unvault = await steadyVault();
  const first = openDialog();
  await ready();
  enterCredentials();
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
  await waitFor(() => expect(useAppStore.getState().isAuthenticated).toBe(true));
  unvault();
  expect(await loadSavedLogin(scope, '12345')).toBeNull();
  first.unmount();
  runtime.login.mockRejectedValue(new Error('Invalid login'));
  const unvault2 = await steadyVault();
  openDialog();
  await ready();
  enterCredentials();
  await ready();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Save password' }));
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
  await screen.findByText('Invalid login');
  unvault2();
  expect(await loadSavedLogin(scope, '12345')).toBeNull();
});

it('forgets the saved password when unchecked without requiring another login', async () => {
  await saveLogin(scope, '12345', 'fixture-password');
  openDialog();
  await ready();
  await waitFor(() => expect(screen.getByLabelText('Password')).toHaveValue('fixture-password'));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Save password' }));
  await waitFor(async () => expect(await loadSavedLogin(scope, '12345')).toBeNull());
  expect(runtime.login).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Password')).toHaveValue('fixture-password');
});

it('clears restored credentials when the account ID changes', async () => {
  await saveLogin(scope, '12345', 'fixture-password');
  openDialog();
  await ready();
  await waitFor(() => expect(screen.getByLabelText('Password')).toHaveValue('fixture-password'));
  fireEvent.change(screen.getByLabelText('Account ID'), { target: { value: '54321' } });
  expect(screen.getByLabelText('Password')).toHaveValue('');
  expect(screen.getByRole('checkbox', { name: 'Save password' })).not.toBeChecked();
});

// Deterministic restore-race regression test: no timeout options anywhere —
// every wait uses default budgets and targets a locally-controlled state
// transition. The vault restore is held pending behind a manual gate, so the
// test ENTERS the exact race window the full suite hits under load (restore
// in-flight while waiting on the checkbox) and then releases it. If the gate
// never resolved, the final wait would time out and fail — the test is
// sensitive to the race by construction.
it('keeps Save password disabled until the vault restore settles', async () => {
  const savedLogins = await import('../services/savedLogins');
  let resolveRestore!: (value: Awaited<ReturnType<typeof loadSavedLogin>>) => void;
  const restoreGate = new Promise<Awaited<ReturnType<typeof loadSavedLogin>>>((resolve) => { resolveRestore = resolve; });
  const restoreSpy = vi.spyOn(savedLogins, 'loadSavedLogin').mockReturnValue(restoreGate);
  try {
    openDialog();
    await screen.findByText('Server online');
    // Restore effect has started (spy called ⇒ setRestoring(true) queued)...
    await waitFor(() => expect(restoreSpy).toHaveBeenCalled());
    // ...and once React re-renders, the checkbox reflects it. Waiting (not a
    // sync assert) because the re-render lands on a later microtask.
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Save password' })).toBeDisabled());
    // End the restore; the checkbox must enable on the real readiness signal.
    resolveRestore(null);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Save password' })).toBeEnabled());
  } finally {
    restoreSpy.mockRestore();
  }
});

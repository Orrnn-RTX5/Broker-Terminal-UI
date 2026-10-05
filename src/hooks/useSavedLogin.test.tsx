// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSavedLogin } from './useSavedLogin';
import { loadSavedLogin } from '../services/savedLogins';

vi.mock('../services/savedLogins', () => ({
  supportsSavedLogins: () => true,
  savedLoginScopeKey: (scope: { brokerId: string; serverUrl: string }) => JSON.stringify([scope.brokerId, scope.serverUrl]),
  loadSavedLogin: vi.fn(), forgetSavedLogin: vi.fn().mockResolvedValue(undefined), saveLogin: vi.fn(),
}));
const scope = { brokerId: 'Nexa', serverUrl: 'https://broker.test' };
const pending = () => {
  let resolve!: (value: { login: string; password: string } | null) => void;
  const promise = new Promise<{ login: string; password: string } | null>(done => { resolve = done; });
  return { promise, resolve };
};
beforeEach(() => vi.mocked(loadSavedLogin).mockReset().mockResolvedValue(null));

it('does not replace a password entered while saved credentials are loading', async () => {
  const response = pending();
  vi.mocked(loadSavedLogin).mockReturnValue(response.promise);
  const { result } = renderHook(() => useSavedLogin(true, '12345', scope));
  act(() => result.current.setPassword('new-fixture'));
  await act(async () => response.resolve({ login: '12345', password: 'old-fixture' }));
  expect(result.current.password).toBe('new-fixture');
  expect(result.current.savePassword).toBe(false);
});

it('rejects a late restore from the previous account or broker', async () => {
  const response = pending();
  vi.mocked(loadSavedLogin).mockReturnValueOnce(response.promise);
  const { result, rerender } = renderHook(({ broker }) => useSavedLogin(true, '12345', broker), { initialProps: { broker: scope } });
  act(() => result.current.setLogin('54321'));
  rerender({ broker: { ...scope, brokerId: 'Other' } });
  await act(async () => response.resolve({ login: '12345', password: 'old-fixture' }));
  expect(result.current.login).toBe('54321');
  expect(result.current.password).toBe('');
  expect(result.current.savePassword).toBe(false);
});

it('rejects a pending restore after closing the dialog', async () => {
  const response = pending();
  vi.mocked(loadSavedLogin).mockReturnValue(response.promise);
  const { result, rerender } = renderHook(({ open }) => useSavedLogin(open, '12345', scope), { initialProps: { open: true } });
  rerender({ open: false });
  await act(async () => response.resolve({ login: '12345', password: 'old-fixture' }));
  expect(result.current.password).toBe('');
});

it('clears the restored password and loads only the new broker scope', async () => {
  vi.mocked(loadSavedLogin).mockResolvedValueOnce({ login: '12345', password: 'fixture' });
  const { result, rerender } = renderHook(({ broker }) => useSavedLogin(true, '12345', broker), { initialProps: { broker: scope } });
  await waitFor(() => expect(result.current.password).toBe('fixture'));
  rerender({ broker: { ...scope, serverUrl: 'https://other.test' } });
  await waitFor(() => expect(result.current.restoring).toBe(false));
  expect(result.current.password).toBe('');
  expect(result.current.savePassword).toBe(false);
  expect(loadSavedLogin).toHaveBeenLastCalledWith({ ...scope, serverUrl: 'https://other.test' }, '12345');
});

const firstScope = scope;
const secondScope = { brokerId: 'second', serverUrl: 'https://second.example' };

describe('saved login restoration ownership', () => {
  it('finishes a reset when the new initial login already matches the edited login', async () => {
    const { result, rerender } = renderHook(({ initialLogin }) => useSavedLogin(true, initialLogin, firstScope), {
      initialProps: { initialLogin: '100' },
    });
    await waitFor(() => expect(result.current.restoring).toBe(false));
    act(() => result.current.setLogin('200'));
    await waitFor(() => expect(result.current.restoring).toBe(false));
    rerender({ initialLogin: '200' });
    await waitFor(() => expect(result.current.restoring).toBe(false));
    expect(result.current.login).toBe('200');
  });

  it('clears the old password before exposing a new scope and ignores its late restore', async () => {
    let finishOldRestore!: (value: { login: string; password: string }) => void;
    vi.mocked(loadSavedLogin).mockReturnValueOnce(new Promise(resolve => { finishOldRestore = resolve; }));
    const { result, rerender } = renderHook(({ scope }) => useSavedLogin(true, '123', scope), {
      initialProps: { scope: firstScope },
    });
    act(() => result.current.setPassword('typed-old-password'));
    rerender({ scope: secondScope });
    expect(result.current.password).toBe('');
    expect(result.current.savePassword).toBe(false);
    await act(async () => finishOldRestore({ login: '123', password: 'late-old-password' }));
    await waitFor(() => expect(result.current.restoring).toBe(false));
    expect(result.current.password).toBe('');
  });

  it('reports restoration pending again when the same dialog is reopened', async () => {
    const { result, rerender } = renderHook(({ open }) => useSavedLogin(open, '123', firstScope), {
      initialProps: { open: true },
    });
    await waitFor(() => expect(result.current.restoring).toBe(false));
    act(() => result.current.setPassword('old-password'));
    rerender({ open: false });
    let finishRestore!: (value: null) => void;
    vi.mocked(loadSavedLogin).mockReturnValueOnce(new Promise(resolve => { finishRestore = resolve; }));
    rerender({ open: true });
    expect(result.current.password).toBe('');
    expect(result.current.restoring).toBe(true);
    await act(async () => finishRestore(null));
    expect(result.current.restoring).toBe(false);
  });
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { scheduleFeatureWarmup } from './scheduleFeatureWarmup';

let frames: FrameRequestCallback[];
let idle: Map<number, () => void>;
let cancel: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  frames = [];
  idle = new Map();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('requestIdleCallback', (callback: () => void) => { idle.set(++id, callback); return id; });
  vi.stubGlobal('cancelIdleCallback', (id: number) => idle.delete(id));
});
afterEach(() => {
  cancel?.();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const paint = () => { frames.splice(0).forEach(callback => callback(16)); vi.runOnlyPendingTimers(); };
const idleTurn = () => { const jobs = [...idle.values()]; idle.clear(); jobs.forEach(job => job()); };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

it('waits for terminal paint, then downloads one feature per idle turn without mounting it', async () => {
  document.body.innerHTML = '<div data-terminal-startup="pending"></div>';
  let finish!: () => void;
  const first = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const second = vi.fn(async () => undefined);
  cancel = scheduleFeatureWarmup([first, second]);
  paint(); idleTurn();
  expect(first).not.toHaveBeenCalled();
  document.querySelector('div')!.setAttribute('data-terminal-startup', 'ready');
  await flush();
  paint();
  expect(first).not.toHaveBeenCalled();
  idleTurn();
  expect(first).toHaveBeenCalledOnce();
  idleTurn();
  expect(second).not.toHaveBeenCalled();
  finish(); await flush(); idleTurn();
  expect(second).toHaveBeenCalledOnce();
});

it('continues warming other tools after a failed import and cancels on terminal unmount', async () => {
  const failed = vi.fn(async () => { throw new Error('offline'); });
  const next = vi.fn(async () => undefined);
  cancel = scheduleFeatureWarmup([failed, next]);
  paint(); idleTurn(); await flush();
  expect(idle.size).toBe(1);
  cancel(); idleTurn();
  expect(next).not.toHaveBeenCalled();
});

it('uses cancellable deferred turns where idle callbacks are unavailable', async () => {
  vi.stubGlobal('requestIdleCallback', undefined);
  const load = vi.fn(async () => undefined);
  cancel = scheduleFeatureWarmup([load]);
  paint();
  expect(load).not.toHaveBeenCalled();
  cancel();
  vi.advanceTimersByTime(1000);
  expect(load).not.toHaveBeenCalled();
});

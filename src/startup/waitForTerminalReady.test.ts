import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSelectedTimeframeHistoryCoordinator, fetchOlderHistoryPage } from '../services/chartHistoryLoader';
import { waitForTerminalReady } from './waitForTerminalReady';

vi.mock('../services/chartDataService', () => ({ chartDataService: { fetchCandles: vi.fn() } }));

let frames: Map<number, FrameRequestCallback>;
let nextFrame = 0;
let controllers: AbortController[];

beforeEach(() => {
  vi.useFakeTimers();
  frames = new Map();
  controllers = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});

afterEach(() => {
  controllers.forEach(controller => controller.abort());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const owner = () => {
  const controller = new AbortController();
  controllers.push(controller);
  return controller;
};

const pendingTerminal = () => {
  const boundary = document.createElement('div');
  boundary.dataset.terminalStartup = 'pending';
  document.body.appendChild(boundary);
  return boundary;
};

const paint = () => {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach(callback => callback(16));
};

it('allows automatic expansion only after terminal reveal and its paint turn', async () => {
  const boundary = pendingTerminal();
  const controller = owner();
  const expansion = vi.fn();
  const work = waitForTerminalReady(controller.signal).then(ready => { if (ready) expansion(); });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(expansion).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);

  boundary.dataset.terminalStartup = 'ready';
  await Promise.resolve();
  expect(expansion).not.toHaveBeenCalled();
  paint();
  expect(expansion).not.toHaveBeenCalled();
  await vi.runOnlyPendingTimersAsync();
  await work;
  expect(expansion).toHaveBeenCalledOnce();
  boundary.appendChild(document.createElement('span'));
  await Promise.resolve();
  expect(frames.size).toBe(0);
});

it('resolves cancelled owners without leaving an observer or abort listener', async () => {
  const boundary = pendingTerminal();
  const controller = owner();
  const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
  const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
  const work = waitForTerminalReady(controller.signal);
  controller.abort();
  await expect(work).resolves.toBe(false);
  expect(disconnect).toHaveBeenCalled();
  expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  boundary.dataset.terminalStartup = 'ready';
  await Promise.resolve();
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['before-frame', 'after-frame'] as const)('cancels after reveal %s before expansion starts', async stage => {
  const controller = owner();
  const work = waitForTerminalReady(controller.signal);
  if (stage === 'after-frame') paint();
  controller.abort();
  await expect(work).resolves.toBe(false);
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not schedule an already cancelled selection', async () => {
  const controller = owner();
  controller.abort();
  const observe = vi.spyOn(MutationObserver.prototype, 'observe');
  await expect(waitForTerminalReady(controller.signal)).resolves.toBe(false);
  expect(observe).not.toHaveBeenCalled();
});

it.each([
  { symbol: 'ETHUSD', timeframe: 'M1' },
  { symbol: 'BTCUSD', timeframe: 'M5' },
])('cancels old expansion when selection changes to $symbol $timeframe', async selection => {
  const boundary = pendingTerminal();
  const coordinator = createSelectedTimeframeHistoryCoordinator();
  const fetchInitial = vi.fn(async () => []);
  const first = coordinator.start({ symbol: 'BTCUSD', timeframe: 'M1', count: 500 }, fetchInitial);
  const expandFirst = vi.fn();
  const work = waitForTerminalReady(first.signal).then(ready => { if (ready) expandFirst(); });
  const second = coordinator.start({ ...selection, count: 500 }, fetchInitial);
  await work;
  expect(first.signal.aborted).toBe(true);
  // Both required initial requests start while the terminal is still pending.
  expect(fetchInitial).toHaveBeenCalledTimes(2);
  expect(second.isCurrent()).toBe(true);

  boundary.dataset.terminalStartup = 'ready';
  await Promise.resolve();
  paint();
  await vi.runOnlyPendingTimersAsync();
  expect(expandFirst).not.toHaveBeenCalled();
  coordinator.abort();
});

it('keeps user-requested older pages independent of the pending startup gate', async () => {
  pendingTerminal();
  const controller = owner();
  const automatic = waitForTerminalReady(controller.signal);
  const fetchCandles = vi.fn(async () => [{ time: 60, open: 1, high: 2, low: 1, close: 2, volume: 1 }]);
  const older = await fetchOlderHistoryPage({
    symbol: 'BTCUSD', timeframe: 'M1', olderThanRaw: 120,
    signal: controller.signal, pageSize: 5000, fetchCandles,
  });
  expect(fetchCandles).toHaveBeenCalledOnce();
  expect(older.candles).toHaveLength(1);
  expect(document.querySelector('[data-terminal-startup="pending"]')).not.toBeNull();
  controller.abort();
  await expect(automatic).resolves.toBe(false);
});

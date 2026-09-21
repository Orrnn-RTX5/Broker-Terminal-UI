import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runAfterTerminalReady } from './runAfterTerminalReady';

let nextFrame = 0;
let frames: Map<number, FrameRequestCallback>;
let cancellations: Array<() => void>;

beforeEach(() => {
  vi.useFakeTimers();
  frames = new Map();
  cancellations = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});

afterEach(() => {
  cancellations.forEach(cancel => cancel());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const start = (task: () => void) => {
  const cancel = runAfterTerminalReady(task);
  cancellations.push(cancel);
  return cancel;
};

const paint = () => {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach(callback => callback(16));
};

const pendingTerminal = () => {
  const boundary = document.createElement('div');
  boundary.dataset.terminalStartup = 'pending';
  document.body.appendChild(boundary);
  return boundary;
};

it('does not compete with chart loading and starts once after the real terminal reveals', async () => {
  const boundary = pendingTerminal();
  const task = vi.fn();
  start(task);
  vi.advanceTimersByTime(30_000);
  expect(frames.size).toBe(0);
  expect(task).not.toHaveBeenCalled();

  boundary.dataset.terminalStartup = 'ready';
  await Promise.resolve();
  paint();
  expect(task).not.toHaveBeenCalled();
  vi.runOnlyPendingTimers();
  expect(task).toHaveBeenCalledOnce();

  boundary.appendChild(document.createElement('span'));
  await Promise.resolve();
  expect(frames.size).toBe(0);
});

it('continues after a paint for login surfaces without a terminal boundary', () => {
  const task = vi.fn();
  start(task);
  expect(frames.size).toBe(1);
  paint();
  vi.runOnlyPendingTimers();
  expect(task).toHaveBeenCalledOnce();
});

it('waits through session restoration before the workspace startup boundary exists', async () => {
  const loader = document.createElement('div');
  loader.dataset.terminalModuleLoading = 'true';
  document.body.appendChild(loader);
  const task = vi.fn();
  start(task);
  paint();
  vi.runOnlyPendingTimers();
  expect(task).not.toHaveBeenCalled();

  const boundary = pendingTerminal();
  loader.remove();
  await Promise.resolve();
  expect(frames.size).toBe(0);
  boundary.dataset.terminalStartup = 'ready';
  await Promise.resolve();
  paint();
  vi.runOnlyPendingTimers();
  expect(task).toHaveBeenCalledOnce();
});

it('rechecks startup if a pending boundary appears before the scheduled task executes', async () => {
  const task = vi.fn();
  start(task);
  const boundary = pendingTerminal();
  paint();
  vi.runOnlyPendingTimers();
  expect(task).not.toHaveBeenCalled();

  boundary.dataset.terminalStartup = 'ready';
  await Promise.resolve();
  paint();
  vi.runOnlyPendingTimers();
  expect(task).toHaveBeenCalledOnce();
});

it('cancels unmounted owners before readiness or before their deferred task starts', async () => {
  const boundary = pendingTerminal();
  const task = vi.fn();
  start(task)();
  boundary.dataset.terminalStartup = 'ready';
  await Promise.resolve();
  expect(frames.size).toBe(0);

  const cancel = start(task);
  paint();
  cancel();
  vi.runOnlyPendingTimers();
  expect(task).not.toHaveBeenCalled();
});

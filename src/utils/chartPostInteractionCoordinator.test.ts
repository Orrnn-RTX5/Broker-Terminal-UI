import { describe, expect, it, vi } from 'vitest';
import { createChartPostInteractionCoordinator } from './chartPostInteractionCoordinator';

type CallbackPhase = 'history' | 'live-prepare' | 'model' | 'live-finalize' | 'separators' | 'overlay';

const triggerForPhase: Record<CallbackPhase, Parameters<ReturnType<typeof createChartPostInteractionCoordinator>['request']>[0]> = {
  history: { history: true },
  'live-prepare': { live: true },
  model: { model: true },
  'live-finalize': { live: true },
  separators: { separators: true },
  overlay: { overlay: true },
};

const runReentrantScenario = (
  callbackPhase: CallbackPhase,
  requestedWork: Parameters<ReturnType<typeof createChartPostInteractionCoordinator>['request']>[0],
) => {
  const order: CallbackPhase[] = [];
  let coordinator: ReturnType<typeof createChartPostInteractionCoordinator>;
  const visit = (phase: CallbackPhase) => {
    order.push(phase);
    if (phase === callbackPhase) coordinator.request(requestedWork);
  };
  coordinator = createChartPostInteractionCoordinator({
    consumeHistory: () => visit('history'),
    prepareLiveModel: () => visit('live-prepare'),
    paintModel: () => {
      visit('model');
      return false;
    },
    paintLive: () => visit('live-finalize'),
    paintSeparators: () => visit('separators'),
    layoutOverlay: () => visit('overlay'),
  });
  coordinator.request(triggerForPhase[callbackPhase]);

  expect(coordinator.flush()).toBe(true);
  expect(coordinator.hasPending()).toBe(false);
  expect(coordinator.flush()).toBe(false);
  return order;
};

describe('chart post-interaction coordinator', () => {
  it('paints model, separators, and overlay once in deterministic order', () => {
    const order: string[] = [];
    let coordinator: ReturnType<typeof createChartPostInteractionCoordinator>;
    coordinator = createChartPostInteractionCoordinator({
      consumeHistory: () => order.push('history'),
      prepareLiveModel: () => order.push('live-prepare'),
      paintModel: () => {
        order.push('model');
        coordinator.request({ separators: true, overlay: true });
        return true;
      },
      paintLive: fullPainted => order.push(`live:${fullPainted}`),
      paintSeparators: () => order.push('separators'),
      layoutOverlay: () => order.push('overlay'),
    });

    coordinator.request({ history: true, model: true, live: true, separators: true, overlay: true });
    expect(coordinator.flush()).toBe(true);
    expect(order).toEqual(['history', 'live-prepare', 'model', 'live:true', 'separators', 'overlay']);
    expect(coordinator.hasPending()).toBe(false);
  });

  it('coalesces repeated requests and never paints live twice after one full model paint', () => {
    const paintModel = vi.fn(() => true);
    const paintLive = vi.fn();
    const paintSeparators = vi.fn();
    const layoutOverlay = vi.fn();
    const coordinator = createChartPostInteractionCoordinator({
      consumeHistory: vi.fn(),
      prepareLiveModel: vi.fn(),
      paintModel,
      paintLive,
      paintSeparators,
      layoutOverlay,
    });

    coordinator.request({ model: true, live: true });
    coordinator.request({ model: true, live: true, separators: true, overlay: true });
    coordinator.flush();

    expect(paintModel).toHaveBeenCalledTimes(1);
    expect(paintLive).toHaveBeenCalledTimes(1);
    expect(paintLive).toHaveBeenCalledWith(true);
    expect(paintSeparators).toHaveBeenCalledTimes(1);
    expect(layoutOverlay).toHaveBeenCalledTimes(1);
  });

  it('absorbs a model request raised while preparing deferred live data', () => {
    let coordinator: ReturnType<typeof createChartPostInteractionCoordinator>;
    const paintModel = vi.fn(() => true);
    coordinator = createChartPostInteractionCoordinator({
      consumeHistory: vi.fn(),
      prepareLiveModel: () => coordinator.request({ model: true }),
      paintModel,
      paintLive: vi.fn(),
      paintSeparators: vi.fn(),
      layoutOverlay: vi.fn(),
    });

    coordinator.request({ live: true });
    coordinator.flush();

    expect(paintModel).toHaveBeenCalledTimes(1);
    expect(coordinator.hasPending()).toBe(false);
    expect(coordinator.flush()).toBe(false);
  });

  it.each<[CallbackPhase, CallbackPhase[]]>([
    ['history', ['history']],
    ['live-prepare', ['live-prepare', 'model', 'live-finalize']],
    ['model', ['model']],
    ['live-finalize', ['live-prepare', 'model', 'live-finalize']],
    ['separators', ['separators']],
    ['overlay', ['overlay']],
  ])('absorbs an own-phase request from %s', (phase, expectedOrder) => {
    expect(runReentrantScenario(phase, triggerForPhase[phase])).toEqual(expectedOrder);
  });

  it.each<[CallbackPhase, Parameters<ReturnType<typeof createChartPostInteractionCoordinator>['request']>[0], CallbackPhase[]]>([
    ['history', {}, ['history']],
    ['live-prepare', { history: true }, ['live-prepare', 'model', 'live-finalize']],
    ['model', { history: true, model: true }, ['model']],
    ['live-finalize', { history: true, model: true, live: true }, ['live-prepare', 'model', 'live-finalize']],
    ['separators', { history: true, model: true, live: true, separators: true }, ['separators']],
    ['overlay', { history: true, model: true, live: true, separators: true, overlay: true }, ['overlay']],
  ])('absorbs same and earlier phases requested from %s', (phase, request, expectedOrder) => {
    expect(runReentrantScenario(phase, request)).toEqual(expectedOrder);
  });

  it.each<[CallbackPhase, Parameters<ReturnType<typeof createChartPostInteractionCoordinator>['request']>[0], CallbackPhase[]]>([
    ['history', { model: true, live: true, separators: true, overlay: true }, ['history', 'live-prepare', 'model', 'live-finalize', 'separators', 'overlay']],
    ['live-prepare', { model: true, separators: true, overlay: true }, ['live-prepare', 'model', 'live-finalize', 'separators', 'overlay']],
    ['model', { live: true, separators: true, overlay: true }, ['model', 'live-finalize', 'separators', 'overlay']],
    ['live-finalize', { separators: true, overlay: true }, ['live-prepare', 'model', 'live-finalize', 'separators', 'overlay']],
    ['separators', { overlay: true }, ['separators', 'overlay']],
    ['overlay', {}, ['overlay']],
  ])('merges later phases requested from %s into the active pass', (phase, request, expectedOrder) => {
    expect(runReentrantScenario(phase, request)).toEqual(expectedOrder);
  });

  it.each<[CallbackPhase, CallbackPhase[]]>([
    ['history', ['history', 'live-prepare', 'model', 'live-finalize', 'separators', 'overlay']],
    ['live-prepare', ['live-prepare', 'model', 'live-finalize', 'separators', 'overlay']],
    ['model', ['model', 'live-finalize', 'separators', 'overlay']],
    ['live-finalize', ['live-prepare', 'model', 'live-finalize', 'separators', 'overlay']],
    ['separators', ['separators', 'overlay']],
    ['overlay', ['overlay']],
  ])('absorbs earlier phases and merges later phases when %s requests all work', (phase, expectedOrder) => {
    expect(runReentrantScenario(phase, {
      history: true,
      model: true,
      live: true,
      separators: true,
      overlay: true,
    })).toEqual(expectedOrder);
  });

  it('allows a request made after flush returns to form a later pass', () => {
    const order: CallbackPhase[] = [];
    const coordinator = createChartPostInteractionCoordinator({
      consumeHistory: () => order.push('history'),
      prepareLiveModel: () => order.push('live-prepare'),
      paintModel: () => false,
      paintLive: () => order.push('live-finalize'),
      paintSeparators: () => order.push('separators'),
      layoutOverlay: () => order.push('overlay'),
    });

    coordinator.request({ history: true });
    expect(coordinator.flush()).toBe(true);
    coordinator.request({ overlay: true });
    expect(coordinator.hasPending()).toBe(true);
    expect(coordinator.flush()).toBe(true);
    expect(order).toEqual(['history', 'overlay']);
  });

  it('clears stale pending work without running callbacks', () => {
    const callbacks = {
      consumeHistory: vi.fn(),
      prepareLiveModel: vi.fn(),
      paintModel: vi.fn(() => false),
      paintLive: vi.fn(),
      paintSeparators: vi.fn(),
      layoutOverlay: vi.fn(),
    };
    const coordinator = createChartPostInteractionCoordinator(callbacks);
    coordinator.request({ history: true, model: true, live: true, separators: true, overlay: true });
    coordinator.clear();

    expect(coordinator.flush()).toBe(false);
    Object.values(callbacks).forEach(callback => expect(callback).not.toHaveBeenCalled());
  });
});

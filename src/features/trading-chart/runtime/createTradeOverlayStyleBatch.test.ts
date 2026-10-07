import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTradeOverlayStyleBatchCache, memoizeTradeOverlayCoordinate } from './createTradeOverlayStyleBatch';
import { setTradeOverlayStyle } from '../../../utils/tradeOverlayStyle';

afterEach(() => vi.restoreAllMocks());
const properties = { display: 'block', top: '100px', left: '0px', right: '60px', width: '200px', transform: 'rotate(20deg)' } as const;

describe('geometry style batches', () => {
  it('reduces unchanged 50-node CSSOM reads from 300 to zero with one attribute read per element', () => {
    const nodes = Array.from({ length: 50 }, () => document.createElement('div'));
    const cache = createTradeOverlayStyleBatchCache();
    const run = () => {
      const batch = cache.begin();
      try { for (const node of nodes) for (const [property, value] of Object.entries(properties)) {
        batch.set(node, property as keyof typeof properties, value);
      } } finally { batch.finish(); }
    };
    run();
    const reads = nodes.flatMap(node => Object.keys(properties).map(property => vi.spyOn(node.style, property as keyof typeof properties, 'get')));
    const attributes = nodes.map(node => vi.spyOn(node, 'getAttribute'));
    run();
    expect(reads.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBe(0);
    expect(attributes.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBe(50);
    for (const node of nodes) for (const [property, value] of Object.entries(properties)) {
      setTradeOverlayStyle(node, property as keyof typeof properties, value);
    }
    expect(reads.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBe(300);
  });

  it.each(['property', 'cssText', 'removeAttribute'] as const)('repairs external %s mutation without touching independent nodes', mutation => {
    const a = document.createElement('div'), b = document.createElement('div');
    const cache = createTradeOverlayStyleBatchCache();
    const run = () => { const batch = cache.begin(); for (const node of [a, b]) batch.set(node, 'top', '100px'); batch.finish(); };
    run();
    const bWrite = vi.spyOn(b.style, 'top', 'set');
    if (mutation === 'property') a.style.top = '25px';
    if (mutation === 'cssText') a.style.cssText = 'color:red;top:25px';
    if (mutation === 'removeAttribute') a.removeAttribute('style');
    run();
    expect(a.style.top).toBe('100px');
    expect(b.style.top).toBe('100px'); expect(bWrite).not.toHaveBeenCalled();
  });

  it('preserves CSS normalization and rejected-value behavior without repeated writes', () => {
    const node = document.createElement('div');
    const cache = createTradeOverlayStyleBatchCache();
    const run = () => { const batch = cache.begin(); batch.set(node, 'color', '#ff0000'); batch.set(node, 'top', 'invalid'); batch.finish(); };
    run();
    expect(node.style.color).toBe('rgb(255, 0, 0)'); expect(node.style.top).toBe('');
    const color = vi.spyOn(node.style, 'color', 'set'), top = vi.spyOn(node.style, 'top', 'set');
    run(); run(); expect(color).not.toHaveBeenCalled(); expect(top).not.toHaveBeenCalled();
    node.style.color = 'blue'; run(); expect(node.style.color).toBe('rgb(255, 0, 0)');
  });

  it('does not bless external writes made after validation, including dirty-node finalization', () => {
    const node = document.createElement('div');
    const cache = createTradeOverlayStyleBatchCache();
    let batch = cache.begin(); batch.set(node, 'top', '100px'); batch.finish();
    batch = cache.begin(); batch.set(node, 'top', '100px'); node.style.top = '25px'; batch.finish();
    batch = cache.begin(); batch.set(node, 'top', '100px'); batch.set(node, 'left', '20px');
    node.style.top = '30px'; batch.finish();
    batch = cache.begin(); batch.set(node, 'top', '100px'); batch.finish();
    expect(node.style.top).toBe('100px'); expect(node.style.left).toBe('20px');
  });

  it('finalizes after caller exceptions and invalidates failed finalization before a retry', () => {
    const node = document.createElement('div');
    const cache = createTradeOverlayStyleBatchCache();
    let batch = cache.begin();
    expect(() => { try { batch.set(node, 'top', '100px'); throw new Error('caller'); } finally { batch.finish(); } }).toThrow('caller');
    batch = cache.begin(); batch.set(node, 'top', '120px');
    const attribute = vi.spyOn(node, 'getAttribute').mockImplementationOnce(() => { throw new Error('attribute'); });
    expect(() => batch.finish()).toThrow('attribute'); attribute.mockRestore();
    node.style.top = '25px';
    batch = cache.begin(); batch.set(node, 'top', '120px'); batch.finish();
    expect(node.style.top).toBe('120px');
  });

  it('clears ownership without stale batches repopulating or mutating replacement state', () => {
    const node = document.createElement('div');
    const cache = createTradeOverlayStyleBatchCache();
    const old = cache.begin(); old.set(node, 'top', '100px'); cache.clear();
    const current = cache.begin(); current.set(node, 'top', '200px'); current.finish();
    old.set(node, 'top', '100px'); old.finish(); old.finish();
    expect(node.style.top).toBe('200px');
    current.set(node, 'top', '300px'); expect(node.style.top).toBe('200px');
  });

  it('does not trust a failed setter and permits repair in the next finalized pass', () => {
    const node = document.createElement('div');
    const cache = createTradeOverlayStyleBatchCache();
    let batch = cache.begin(); batch.set(node, 'top', '100px'); batch.finish();
    const setter = vi.spyOn(node.style, 'top', 'set').mockImplementationOnce(() => { throw new Error('setter'); });
    batch = cache.begin();
    expect(() => { try { batch.set(node, 'top', '120px'); } finally { batch.finish(); } }).toThrow('setter');
    setter.mockRestore();
    batch = cache.begin(); batch.set(node, 'top', '120px'); batch.finish();
    expect(node.style.top).toBe('120px');
  });
});

describe('one-pass exact coordinate memoization', () => {
  it('caches exact inputs and null outputs, without reusing a previous pass', () => {
    let factor = 1;
    const project = vi.fn((value: number) => value === 0 ? null : value * factor);
    const first = memoizeTradeOverlayCoordinate(project);
    expect(first(1)).toBe(1); expect(first(1)).toBe(1); expect(first(1.0000001)).toBe(1.0000001);
    expect(first(0)).toBeNull(); expect(first(0)).toBeNull(); expect(project).toHaveBeenCalledTimes(3);
    factor = 2;
    const next = memoizeTradeOverlayCoordinate(project);
    expect(next(1)).toBe(2); expect(project).toHaveBeenCalledTimes(4);
  });

  it('does not memoize thrown projection failures', () => {
    const project = vi.fn().mockImplementationOnce(() => { throw new Error('projection'); }).mockReturnValue(42);
    const memo = memoizeTradeOverlayCoordinate(project);
    expect(() => memo(1)).toThrow('projection'); expect(memo(1)).toBe(42); expect(project).toHaveBeenCalledTimes(2);
  });
});

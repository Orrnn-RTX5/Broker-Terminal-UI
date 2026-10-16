import { Suspense, useEffect, type JSX } from 'react';
import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createPreloadableFeature } from './createPreloadableFeature';

it('renders a warmed tool on its first render without suspending or mounting it during preload', async () => {
  const mounted = vi.fn();
  const loader = vi.fn(async () => ({ default: function Tool({ symbol }: { symbol: string }) {
    useEffect(() => { mounted(); }, []);
    return <div role="dialog">{symbol}</div>;
  } }));
  const feature = createPreloadableFeature(loader);
  expect(loader).not.toHaveBeenCalled();
  const first = feature.preload();
  expect(feature.preload()).toBe(first);
  await first;
  expect(mounted).not.toHaveBeenCalled();
  const Tool = feature.Component;
  render(<Suspense fallback={<div role="status">Loading</div>}><Tool symbol="XAUUSD.r" /></Suspense>);
  expect(screen.getByRole('dialog')).toHaveTextContent('XAUUSD.r');
  expect(screen.queryByRole('status')).toBeNull();
  expect(loader).toHaveBeenCalledOnce();
});

it('shares an in-flight preload with a click and resolves the currently requested symbol', async () => {
  let finish!: (value: { default: (props: { symbol: string }) => JSX.Element }) => void;
  const loader = vi.fn(() => new Promise<{ default: (props: { symbol: string }) => JSX.Element }>(resolve => { finish = resolve; }));
  const feature = createPreloadableFeature(loader);
  void feature.preload();
  const Tool = feature.Component;
  const view = (symbol: string) => <Suspense fallback={<div role="status">Loading</div>}><Tool symbol={symbol} /></Suspense>;
  const mounted = render(view('XAUUSD'));
  mounted.rerender(view('EURJPY'));
  expect(screen.getByRole('status')).toBeInTheDocument();
  await act(async () => finish({ default: ({ symbol }) => <div role="dialog">{symbol}</div> }));
  expect(screen.getByRole('dialog')).toHaveTextContent('EURJPY');
  expect(loader).toHaveBeenCalledOnce();
});

it('allows a click to retry after a failed speculative download', async () => {
  const loader = vi.fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ default: () => <div role="dialog">Ready</div> });
  const feature = createPreloadableFeature(loader);
  await expect(feature.preload()).rejects.toThrow('offline');
  const Tool = feature.Component;
  render(<Suspense fallback={null}><Tool /></Suspense>);
  expect(await screen.findByRole('dialog')).toHaveTextContent('Ready');
  expect(loader).toHaveBeenCalledTimes(2);
});


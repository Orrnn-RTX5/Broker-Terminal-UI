import { lazy, useEffect, useState, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RetainedLazyFeature } from './RetainedLazyFeature';

afterEach(cleanup);

it('downloads only on first open and preserves draft state and callbacks after closing', async () => {
  const unmounted = vi.fn();
  const onApply = vi.fn();
  const load = vi.fn(async () => ({
    default: function Feature({ isOpen }: { isOpen: boolean }) {
      const [draft, setDraft] = useState('');
      useEffect(() => () => { unmounted(); }, []);
      if (!isOpen) return null;
      return <>
        <input aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)} />
        <button onClick={() => onApply(draft)}>Apply</button>
      </>;
    },
  }));
  const Feature = lazy(load);
  const view = (active: boolean) => <RetainedLazyFeature active={active}><Feature isOpen={active} /></RetainedLazyFeature>;
  const mounted = render(view(false));
  expect(load).not.toHaveBeenCalled();

  mounted.rerender(view(true));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Draft' }), { target: { value: 'saved draft' } });
  mounted.rerender(view(false));
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(unmounted).not.toHaveBeenCalled();
  mounted.rerender(view(true));
  expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('saved draft');
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenCalledWith('saved draft');
  expect(load).toHaveBeenCalledOnce();
});

it('does not reopen a feature closed while its chunk is still downloading', async () => {
  let finish!: (value: { default: (props: { isOpen: boolean }) => ReactNode }) => void;
  const Feature = lazy(() => new Promise<{ default: (props: { isOpen: boolean }) => ReactNode }>(resolve => { finish = resolve; }));
  const view = (active: boolean) => <RetainedLazyFeature active={active}><Feature isOpen={active} /></RetainedLazyFeature>;
  const mounted = render(view(true));
  mounted.rerender(view(false));
  await act(async () => finish({ default: ({ isOpen }) => isOpen ? <div role="dialog">Feature</div> : null }));
  expect(screen.queryByRole('dialog')).toBeNull();
  mounted.rerender(view(true));
  expect(screen.getByRole('dialog')).toHaveTextContent('Feature');
});

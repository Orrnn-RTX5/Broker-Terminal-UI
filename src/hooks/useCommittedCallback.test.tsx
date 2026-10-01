import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useCommittedCallback } from './useCommittedCallback';

it('keeps memoized workspace actions stable while switching to the current account handler', () => {
  const oldAccount = vi.fn(() => 'old');
  const newAccount = vi.fn((ticket: number) => `new:${ticket}`);
  const { result, rerender } = renderHook(({ callback }) => useCommittedCallback(callback), {
    initialProps: { callback: oldAccount as (ticket: number) => string },
  });
  const action = result.current;
  rerender({ callback: newAccount });
  expect(result.current).toBe(action);
  expect(action(123)).toBe('new:123');
  expect(oldAccount).not.toHaveBeenCalled();
  expect(newAccount).toHaveBeenCalledWith(123);
});

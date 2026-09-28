import { describe, expect, it, vi } from 'vitest';
import {
  commitIfCurrentTradeOperation,
  createSessionScopedTicketKey,
  createTradeOperationContext,
  isSameTradeOperationContext,
} from './tradeOperationContext';

describe('trade operation context', () => {
  it('admits a completion only in the initiating broker/account auth generation', () => {
    const started = createTradeOperationContext('authenticated|100|broker-a|https://a', 100, 4);

    expect(isSameTradeOperationContext(started, { ...started })).toBe(true);
    expect(isSameTradeOperationContext(started, { ...started, login: 200 })).toBe(false);
    expect(isSameTradeOperationContext(started, { ...started, sessionScope: 'authenticated|100|broker-b|https://b' })).toBe(false);
    expect(isSameTradeOperationContext(started, { ...started, authGeneration: 5 })).toBe(false);
    expect(isSameTradeOperationContext(started, null)).toBe(false);
  });

  it('does not let equal ticket numbers collide across sessions', () => {
    expect(createSessionScopedTicketKey('session-a', 42)).not.toBe(
      createSessionScopedTicketKey('session-b', 42),
    );
    expect(createSessionScopedTicketKey('session-a', 42)).toBe(
      createSessionScopedTicketKey('session-a', 42),
    );
  });

  it('never commits a completed request into a replacement session', () => {
    const commit = vi.fn();
    const started = createTradeOperationContext('session-a', 100, 1);

    expect(commitIfCurrentTradeOperation(
      started,
      () => createTradeOperationContext('session-b', 200, 2),
      commit,
    )).toBe(false);
    expect(commit).not.toHaveBeenCalled();

    expect(commitIfCurrentTradeOperation(started, () => ({ ...started }), commit)).toBe(true);
    expect(commit).toHaveBeenCalledOnce();
  });
});

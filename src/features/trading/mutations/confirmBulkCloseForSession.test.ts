import { describe, expect, it, vi } from 'vitest';
import { confirmBulkCloseForSession } from './confirmBulkCloseForSession';

describe('confirmBulkCloseForSession', () => {
  it('confirms only while the preview session remains current', async () => {
    let listener: (() => void) | undefined;
    const result = await confirmBulkCloseForSession({
      sessionScope: 'session-a',
      getCurrentSessionScope: () => 'session-a',
      subscribeToSessionChange: (next) => {
        listener = next;
        return vi.fn();
      },
      showConfirmation: async () => true,
      cancelConfirmation: vi.fn(),
    });

    expect(listener).toBeTypeOf('function');
    expect(result).toBe(true);
  });

  it('cancels and rejects a pending confirmation after a session change', async () => {
    let currentScope = 'session-a';
    let listener: (() => void) | undefined;
    let resolveConfirmation!: (confirmed: boolean) => void;
    const cancelConfirmation = vi.fn(() => resolveConfirmation(false));
    const unsubscribe = vi.fn();

    const confirmation = confirmBulkCloseForSession({
      sessionScope: 'session-a',
      getCurrentSessionScope: () => currentScope,
      subscribeToSessionChange: (next) => {
        listener = next;
        return unsubscribe;
      },
      showConfirmation: () => new Promise<boolean>((resolve) => {
        resolveConfirmation = resolve;
      }),
      cancelConfirmation,
    });

    currentScope = 'session-b';
    listener?.();

    await expect(confirmation).resolves.toBe(false);
    expect(cancelConfirmation).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not open the dialog when the session changes while subscribing', async () => {
    let currentScope = 'session-a';
    const showConfirmation = vi.fn(async () => true);

    await expect(confirmBulkCloseForSession({
      sessionScope: 'session-a',
      getCurrentSessionScope: () => currentScope,
      subscribeToSessionChange: () => {
        currentScope = 'session-b';
        return vi.fn();
      },
      showConfirmation,
      cancelConfirmation: vi.fn(),
    })).resolves.toBe(false);

    expect(showConfirmation).not.toHaveBeenCalled();
  });
});

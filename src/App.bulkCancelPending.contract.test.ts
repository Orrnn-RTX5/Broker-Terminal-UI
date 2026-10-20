import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// T5: pending bulk cancel must ask ONE confirm up front (not N), then cancel
// sequentially, and rethrow/surface failures (never swallow). Single cancel
// stays untouched. Source-contract tests in the style of
// App.bulkClose.contract.test.ts: they pin the handler structure without
// mounting the app. Per-call Idempotency-Key behaviour is covered at the
// fetch level in src/api/pendingCancelIdempotency.test.ts.

const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

const coreStart = appSource.indexOf('const cancelPendingOrderWithoutConfirm = async (orderId: string)');
const singleStart = appSource.indexOf(
  'const handleCancelOrder = async (orderId: string, options?: { skipConfirm?: boolean })',
);
const bulkStart = appSource.indexOf(
  'const handleCancelPendingBulkOrders = async (orderIds: Array<string | number>)',
);
const modifyStart = appSource.indexOf(
  'const handleModifyPosition = async (id: number, sl: number, tp: number)',
  bulkStart,
);

const coreHandler = appSource.slice(coreStart, singleStart);
const singleHandler = appSource.slice(singleStart, bulkStart);
const bulkHandler = appSource.slice(bulkStart, modifyStart);

const countOccurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

describe('T5 bulk pending cancel — one confirm, sequential cancels', () => {
  it('bulk handler exists and is sliced cleanly for the contract below', () => {
    expect(coreStart).toBeGreaterThan(-1);
    expect(singleStart).toBeGreaterThan(coreStart);
    expect(bulkStart).toBeGreaterThan(singleStart);
    expect(modifyStart).toBeGreaterThan(bulkStart);
  });

  it('asks exactly ONE confirm up front for the whole set (not N)', () => {
    expect(countOccurrences(bulkHandler, 'showConfirm')).toBe(1);
    // The single confirm runs before any cancel is issued.
    expect(bulkHandler.indexOf('showConfirm')).toBeLessThan(
      bulkHandler.indexOf('for (const ticket of tickets)'),
    );
    // An empty set confirms nothing and cancels nothing.
    expect(bulkHandler).toContain('if (tickets.length === 0) return;');
  });

  it('cancels sequentially through the shared no-confirm core (no fan-out, no per-item confirm path)', () => {
    expect(bulkHandler).toContain('for (const ticket of tickets)');
    expect(bulkHandler).toContain('await cancelPendingOrderWithoutConfirm(ticket);');
    expect(bulkHandler).not.toContain('Promise.all');
    // The bulk loop must never route through the confirming single path.
    expect(bulkHandler).not.toContain('handleCancelOrder(');
  });

  it('continues through every ticket, then surfaces a done X/Y summary, refreshes, and rethrows (never swallows)', () => {
    expect(bulkHandler).toContain('catch (err)');
    expect(bulkHandler).toContain('firstReason');
    expect(bulkHandler).toContain('publishOrderFeedback(');
    expect(bulkHandler).toContain("'error'");
    expect(bulkHandler).toContain('throw new Error(summary);');
    // Rows reflect backend truth after the run, including on failure.
    expect(bulkHandler).toContain('getPendingOrders(loginId)');
    expect(bulkHandler).toContain('ordersPayload !== null');
    expect(bulkHandler).toContain('useAppStore.getState().setOrders(ordersPayload as any);');
  });
});

describe('T5 cancel core — no confirm, no swallow, refresh never blanks the list', () => {
  it('carries no confirmation dialog; per-ticket transport mints each Idempotency-Key', () => {
    expect(coreHandler).not.toContain('showConfirm');
    expect(coreHandler).toContain('await api.orders.cancelOrder(orderId);');
    // The cancel itself is unguarded: a rejection propagates to the caller.
    expect(coreHandler).not.toContain('cancelOrder(orderId).catch');
    expect(coreHandler).not.toContain('try {');
  });

  it('fails closed without an account and replaces rows only from the backend payload', () => {
    expect(coreHandler).toContain(
      "throw new Error('No trading account is selected. Please sign in again.');",
    );
    expect(coreHandler).toContain('useAppStore.getState().setOrders(ordersPayload as any);');
    expect(coreHandler).not.toContain('.filter(');
  });

  it('a failed post-cancel refresh keeps existing rows instead of blanking them', () => {
    expect(coreHandler).toContain('.catch(() => null)');
    expect(coreHandler).toContain('ordersPayload === null');
  });
});

describe('T5 single pending cancel — unaffected', () => {
  it('still confirms per cancel, delegates to the shared core, and surfaces + rethrows', () => {
    expect(singleHandler).toContain('options?: { skipConfirm?: boolean }');
    expect(singleHandler).toContain('if (!options?.skipConfirm)');
    expect(countOccurrences(singleHandler, 'showConfirm')).toBe(1);
    expect(singleHandler).toContain('await cancelPendingOrderWithoutConfirm(orderId);');
    expect(singleHandler).toContain('publishOrderFeedback(');
    expect(singleHandler).toContain("'error'");
    expect(singleHandler).toContain('throw err;');
  });

  it('bulk entry point exists alongside (not replacing) single cancel', () => {
    expect(appSource).toContain('const handleCancelPendingBulkOrders');
    expect(singleStart).toBeLessThan(bulkStart);
  });
});

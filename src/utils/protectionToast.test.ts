import { describe, expect, it } from 'vitest';

import { describeProtectionRefusal, formatOrderError } from './orderError';

// ApiError ctor (src/api/client.ts) is (status: number, message: string, data?: unknown).
// Tests below use plain objects shaped like the real gateway shape
// ({ status, code, message, data: { code, message } }) instead of instantiating it.

// Generic quote fixture (no brand/host/symbol): BUY is measured vs Bid, SELL vs Ask.
const BID = 100.0;
const ASK = 100.05;
const DIGITS = 2;

// Bare-code echo inside the gateway wrapper: message === code, so
// readStructuredBackendError treats it as "no detail" (code === message → null)
// and formatOrderError falls through to the mapped plain-words copy instead of
// returning a "CODE: CODE" echo. Keeps the real gateway shape while asserting
// the mapped toast path.
const makeGatewayErr = (code: 'INVALID_STOPS' | 'INVALID_SL_TP') => ({
  status: 400,
  code,
  message: code,
  data: { code, message: code },
});

type Combo = {
  side: 'BUY' | 'SELL';
  role: 'SL' | 'TP';
  code: 'INVALID_STOPS' | 'INVALID_SL_TP';
  sl?: number;
  tp?: number;
  levelLabel: string;
  closeLabel: string;
};

const COMBOS: Combo[] = [
  // BUY SL must be below Bid → violation is sl >= Bid.
  { side: 'BUY', role: 'SL', code: 'INVALID_STOPS', sl: 100.1, levelLabel: 'Stop loss', closeLabel: 'Bid' },
  { side: 'BUY', role: 'SL', code: 'INVALID_SL_TP', sl: 100.1, levelLabel: 'Stop loss', closeLabel: 'Bid' },
  // BUY TP must be above Bid → violation is tp <= Bid.
  { side: 'BUY', role: 'TP', code: 'INVALID_STOPS', tp: 99.9, levelLabel: 'Take profit', closeLabel: 'Bid' },
  { side: 'BUY', role: 'TP', code: 'INVALID_SL_TP', tp: 99.9, levelLabel: 'Take profit', closeLabel: 'Bid' },
  // SELL SL must be above Ask → violation is sl <= Ask.
  { side: 'SELL', role: 'SL', code: 'INVALID_STOPS', sl: 99.9, levelLabel: 'Stop loss', closeLabel: 'Ask' },
  { side: 'SELL', role: 'SL', code: 'INVALID_SL_TP', sl: 99.9, levelLabel: 'Stop loss', closeLabel: 'Ask' },
  // SELL TP must be below Ask → violation is tp >= Ask.
  { side: 'SELL', role: 'TP', code: 'INVALID_STOPS', tp: 100.15, levelLabel: 'Take profit', closeLabel: 'Ask' },
  { side: 'SELL', role: 'TP', code: 'INVALID_SL_TP', tp: 100.15, levelLabel: 'Take profit', closeLabel: 'Ask' },
];

describe('protection toast (SL/TP refusal)', () => {
  it.each(COMBOS)(
    '$side $role-violation $code shows plain-words toast without raw code',
    ({ side, code, sl, tp, levelLabel, closeLabel }) => {
      const err = makeGatewayErr(code);

      const refusal = describeProtectionRefusal(err, {
        side,
        sl: sl ?? null,
        tp: tp ?? null,
        bid: BID,
        ask: ASK,
        digits: DIGITS,
      });

      // Plain-words sentence names the offending level vs the live Bid/Ask + side.
      expect(refusal).not.toBeNull();
      expect(refusal!).toContain(levelLabel);
      expect(refusal!).toContain(closeLabel);
      expect(refusal!).toContain(side);

      // Toast fallback is mapped copy, not a raw-code echo and not Failed-only.
      const formatted = formatOrderError(err);
      expect(formatted).not.toContain(code);
      expect(formatted).not.toBe('Order failed. Please try again.');
      expect(formatted).toMatch(/^Order failed: .+/);
      expect(formatted).toMatch(/stop loss/i);
      expect(formatted.length).toBeGreaterThan(20);
    },
  );

  it('T3 bare-code echo INVALID_STOPS maps to plain-words instead of echoing the code', () => {
    // ApiError-shaped, no structured data/message detail.
    const err = { status: 400, code: 'INVALID_STOPS', message: 'HTTP Error: 400' };

    const formatted = formatOrderError(err);

    expect(formatted).not.toBe('INVALID_STOPS');
    expect(formatted).not.toContain('INVALID_STOPS');
    expect(formatted).toMatch(/stop loss/i);
    expect(formatted).toContain('wrong side');
  });

  it('unknown code falls back to the server message (non-empty, no throw)', () => {
    const serverMessage = 'The order could not be completed at this time, please try again.';
    const err = { status: 400, code: 'UNKNOWN_ORDER_REASON', message: serverMessage };

    let formatted = '';
    expect(() => {
      formatted = formatOrderError(err);
    }).not.toThrow();
    expect(formatted).not.toBe('');
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted).toContain(serverMessage);
    // T3 filter pin: the unknown raw code must not leak into the toast.
    expect(formatted).not.toContain('UNKNOWN_ORDER_REASON');
  });
});

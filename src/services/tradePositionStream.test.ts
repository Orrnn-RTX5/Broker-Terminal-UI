import { describe, expect, it } from 'vitest';
import { applyPositionStreamUpdate, decodePositionStreamMessage, positionStreamNeedsReconciliation } from './tradePositionStream';

// Models the existing normalizer's zero/default behavior. The stream reducer
// must prevent those defaults from overwriting fields absent from a delta.
const normalize = (raw: Record<string, any>) => ({
  id: Number(raw.ticket),
  symbol: raw.symbol ?? '',
  side: raw.side ?? 'BUY',
  volume: raw.volume_lots ?? 0,
  quantity: raw.volume_lots ?? 0,
  openPrice: raw.price_open ?? 0,
  open_price: raw.price_open ?? 0,
  price_open: raw.price_open ?? 0,
  currentPrice: raw.price_current ?? raw.price_open ?? 0,
  current_price: raw.price_current ?? raw.price_open ?? 0,
  price_current: raw.price_current ?? raw.price_open ?? 0,
  profit: raw.profit ?? 0,
  unrealizedPnL: raw.profit ?? 0,
  sl: raw.price_sl ?? 0,
  tp: raw.price_tp ?? 0,
  swap: raw.swap ?? 0,
  commission: raw.commission ?? 0,
  openTime: raw.time_create ?? '',
});

const position = (overrides: Record<string, any> = {}) => ({
  ...normalize({ ticket: 17, symbol: 'BTCUSD', side: 'SELL', volume_lots: 0.2,
    price_open: 81000, price_current: 80900, profit: 20, price_sl: 82000,
    price_tp: 78000, time_create: '2026-09-21T09:00:00Z', swap: -1, commission: -0.5 }),
  state_version: '9007199254740993', price_time_msc: 2000,
  hasBackendProfit: true, hasBackendCurrentPrice: true,
  ...overrides,
});

const decode = (frame: unknown) => {
  const decoded = decodePositionStreamMessage(frame);
  expect(decoded).not.toBeNull();
  return decoded!;
};

const pnlFrame = (patch: Record<string, any> = {}) => ({
  channel: 'positions.200001',
  data: { type: 'position_update', data: [{ ticket: 17, update_kind: 'pnl',
    state_version: '9007199254740993', price_time_msc: 3000,
    price_current: 80800, profit: 40, margin: 100, ...patch }] },
});

describe('broker position stream decoding', () => {
  it('unwraps the actual gateway display array as patches and retains unrelated tickets', () => {
    const original = position();
    const other = position({ id: 18 });
    const frame = decode(pnlFrame());
    expect(frame.kind).toBe('patch');
    const result = applyPositionStreamUpdate([original, other], frame, normalize);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ ...original, currentPrice: 80800, current_price: 80800,
      price_current: 80800, profit: 40, unrealizedPnL: 40, margin: 100, price_time_msc: 3000 });
    expect(result[1]).toBe(other);
  });

  it.each([
    { channel: 'positions.200001', data: { positions: [] } },
    { type: 'channel_message', channel: 'positions.200001', data: [] },
    { type: 'update', data: { positions: [] } },
  ])('retains full-snapshot semantics including authoritative empty snapshots: %j', frame => {
    const decoded = decode(frame);
    expect(decoded.kind).toBe('snapshot');
    expect(applyPositionStreamUpdate([position()], decoded, normalize)).toEqual([]);
  });

  it('treats a structural row snapshot as an upsert with pending display values', () => {
    const decoded = decode({ channel: 'positions.200001', data: { type: 'position_opened', data: {
      ticket: 19, update_kind: 'snapshot', state_version: '1', pnl_available: false,
      symbol: 'EURUSD', side: 'buy', lots: 0.1, price_open: 1.1, price_sl: null, price_tp: null,
    } } });
    expect(decoded.kind).toBe('patch');
    const result = applyPositionStreamUpdate([position()], decoded, normalize);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ id: 19, symbol: 'EURUSD', side: 'BUY', volume: 0.1,
      state_version: '1', sl: 0, tp: 0, hasBackendProfit: false, hasBackendCurrentPrice: false });
  });

  it('extracts nested close identity while preserving exact version text', () => {
    const decoded = decode({ channel: 'positions.200001', data: { type: 'position_closed', data: {
      ticket: 17, status: 'closed', state_version: 9007199254740992,
      state_version_text: '9007199254740994',
    } } });
    expect(decoded.closedTickets).toEqual([17]);
    expect(applyPositionStreamUpdate([position(), position({ id: 18 })], decoded, normalize)
      .map(row => row.id)).toEqual([18]);
  });

  it.each([
    { type: 'subscribed', channel: 'positions.200001' },
    { channel: 'positions.200001', data: { type: 'position_update' } },
    'not json',
  ])('ignores control or malformed envelopes: %j', frame => {
    expect(decodePositionStreamMessage(frame)).toBeNull();
  });
});

describe('position stream ordering and sparse updates', () => {
  it.each([
    { state_version: '9007199254740992' },
    { state_version: '9007199254740994' },
    { price_time_msc: 1999 },
  ])('does not apply a quote from another structural version or an older tick: %j', patch => {
    const original = position();
    expect(applyPositionStreamUpdate([original], decode(pnlFrame(patch)), normalize)[0]).toBe(original);
  });

  it('rejects versioned display patches until existing structural metadata is known', () => {
    const original = position({ state_version: undefined });
    expect(applyPositionStreamUpdate([original], decode(pnlFrame()), normalize)[0]).toBe(original);
  });

  it('does not create an unknown ticket from a display patch or an incomplete legacy delta', () => {
    expect(applyPositionStreamUpdate([], decode(pnlFrame()), normalize)).toEqual([]);
    expect(applyPositionStreamUpdate([], decode({ data: { ticket: 17, profit: 2 } }), normalize)).toEqual([]);
  });

  it('preserves structure and existing money when a legacy delta contains only profit', () => {
    const original = position();
    const result = applyPositionStreamUpdate([original], decode({ data: { position: { ticket: 17, profit: 0 } } }), normalize);
    expect(result[0]).toEqual({ ...original, profit: 0, unrealizedPnL: 0 });
  });

  it('ignores invalid money without replacing known values with normalizer defaults', () => {
    const original = position();
    const result = applyPositionStreamUpdate([original], decode({ data: { ticket: 17,
      price_current: null, profit: 'not finite', commission: null, swap: undefined } }), normalize);
    expect(result[0]).toEqual(original);
  });

  it('applies explicit null protection clears and invalidates prior-volume display values', () => {
    const original = position();
    const result = applyPositionStreamUpdate([original], decode({ data: { type: 'position_update', data: {
      ticket: 17, update_kind: 'snapshot', state_version: '9007199254740994',
      volume: 0.1, price_sl: null, pnl_available: false,
    } } }), normalize);
    expect(result[0]).toMatchObject({ symbol: 'BTCUSD', side: 'SELL', volume: 0.1,
      quantity: 0.1, sl: 0, tp: 78000, state_version: '9007199254740994',
      hasBackendProfit: false, hasBackendCurrentPrice: false });
  });

  it('rejects an older structural delta and an older close without numeric precision loss', () => {
    const original = position();
    for (const data of [
      { ticket: 17, state_version: '9007199254740992', volume: 0.05 },
      { ticket: 17, status: 'closed', state_version_text: '9007199254740992' },
    ]) {
      expect(applyPositionStreamUpdate([original], decode({ data }), normalize)[0]).toBe(original);
    }
  });

  it('accepts equal quote timestamps for a freshly updated structural version', () => {
    const original = position({ state_version: '9007199254740994', hasBackendProfit: false,
      hasBackendCurrentPrice: false, pnl_available: false });
    const result = applyPositionStreamUpdate([original], decode(pnlFrame({
      state_version: '9007199254740994', price_time_msc: 2000,
    })), normalize);
    expect(result[0]).toMatchObject({ profit: 40, hasBackendProfit: true,
      hasBackendCurrentPrice: true, pnl_available: true });
  });

  it('does not accept updates for a different position account or broker', () => {
    const original = position({ account_login: 200001, broker_id: 'broker-a' });
    for (const patch of [{ account_login: 200002 }, { broker_id: 'broker-b' }]) {
      expect(applyPositionStreamUpdate([original], decode(pnlFrame(patch)), normalize)[0]).toBe(original);
    }
  });

  it('does not let an unclocked same-version list snapshot overwrite a newer display patch', () => {
    const original = position();
    const frame = decode({ data: { positions: [{ ticket: 17, symbol: 'BTCUSD', side: 'sell',
      volume: 0.2, price_open: 81000, price_current: 81000, profit: 0,
      state_version: '9007199254740993' }] } });
    expect(applyPositionStreamUpdate([original], frame, normalize)[0]).toMatchObject({
      price_current: 80900, currentPrice: 80900, current_price: 80900,
      profit: 20, unrealizedPnL: 20, price_time_msc: 2000,
      hasBackendProfit: true, hasBackendCurrentPrice: true,
    });
  });

  it('preserves an already received quote when its same-version structural event arrives late', () => {
    const original = position({ pnl_available: true });
    const frame = decode({ data: { ticket: 17, update_kind: 'snapshot',
      state_version: '9007199254740993', pnl_available: false, price_sl: null } });
    expect(applyPositionStreamUpdate([original], frame, normalize)[0]).toMatchObject({
      sl: 0, profit: 20, hasBackendProfit: true, hasBackendCurrentPrice: true, pnl_available: true,
    });
  });

  it('requests reconciliation for unknown/newer structural state, not obsolete quotes', () => {
    expect(positionStreamNeedsReconciliation([], decode(pnlFrame()))).toBe(true);
    expect(positionStreamNeedsReconciliation([position()], decode(pnlFrame({ state_version: '9007199254740994' })))).toBe(true);
    expect(positionStreamNeedsReconciliation([position({ state_version: undefined })], decode(pnlFrame()))).toBe(true);
    expect(positionStreamNeedsReconciliation([position()], decode(pnlFrame({ state_version: '9007199254740992' })))).toBe(false);
    expect(positionStreamNeedsReconciliation([position()], decode(pnlFrame()))).toBe(false);
  });

  it('preserves explicit unavailable flags on normalized REST placeholder numbers', () => {
    const placeholder = position({ profit: 0, unrealizedPnL: 0, currentPrice: 0,
      current_price: 0, price_current: 0, hasBackendProfit: false, hasBackendCurrentPrice: false });
    const result = applyPositionStreamUpdate([], decode({ data: [placeholder] }), normalize);
    expect(result[0]).toMatchObject({ profit: 0, currentPrice: 0,
      hasBackendProfit: false, hasBackendCurrentPrice: false });
  });

  it('retains live quote ordering when an in-flight REST snapshot is admitted as a patch', () => {
    const original = position();
    const newlyOpened = position({ id: 18 });
    const decoded = decode({ data: { positions: [{ ticket: 17, symbol: 'BTCUSD', side: 'sell',
      volume: 0.2, price_open: 81000, price_current: 81000, profit: 0,
      state_version: '9007199254740993' }] } });
    const result = applyPositionStreamUpdate([original, newlyOpened], {
      ...decoded, kind: 'patch', source: 'rest',
    }, normalize);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ price_current: 80900, currentPrice: 80900,
      profit: 20, unrealizedPnL: 20, price_time_msc: 2000 });
    expect(result[1]).toBe(newlyOpened);
  });

  it.each([
    [{ ticket: 17, profit: 2 }],
    [null, { ticket: 17 }],
    ['invalid'],
    [{ symbol: 'BTCUSD', volume: 1, price_open: 100, side: 'buy' }],
  ])('does not delete existing positions for malformed or sparse snapshot rows: %j', (...rows) => {
    const originals = [position(), position({ id: 18 })];
    const decoded = decode({ data: { positions: rows } });
    expect(decoded.kind).toBe('patch');
    expect(applyPositionStreamUpdate(originals, decoded, normalize).map(row => row.id)).toEqual([17, 18]);
  });

  it('does not accept booleans or empty Money amounts as numeric display data', () => {
    const original = position();
    const result = applyPositionStreamUpdate([original], decode({ data: { ticket: 17,
      profit: false, price_current: { amount: '' }, margin: true } }), normalize);
    expect(result[0]).toEqual(original);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../services/aggregationWorkerManager', () => ({ cancelPendingAggregations: vi.fn(), getWorkerManager: () => ({ aggregateSymbols: vi.fn() }) }));
import { normalizeTick, upsertTick } from './marketDataNormalization';
import { processIncomingQuotePayload } from '../../services/quotePayloadNormalizer';
import { resetLiveTickDispatcherForTests } from '../../services/liveTickDispatcher';
import { calibrateTerminalQuoteClock, getTerminalQuoteFreshness, resetTerminalQuoteFreshness } from '../../services/terminalQuoteFreshness';

const epoch = 1_800_000_000_000;
const wire = { symbol: 'BTCUSD', bid: 86000, ask: 86015, provider_timestamp: epoch,
  source: 'cserver', sequence: '18446744073709551614', stale: false, tradable: true, source_mismatch: false };

describe('REST and socket provider evidence parity', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(epoch); vi.spyOn(performance, 'now').mockReturnValue(0);
    (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__ = { TERMINAL_QUOTE_FRESHNESS: true };
    resetLiveTickDispatcherForTests(); resetTerminalQuoteFreshness();
    calibrateTerminalQuoteClock(epoch, 0, epoch, 0, epoch);
  });
  afterEach(() => {
    resetLiveTickDispatcherForTests(); vi.restoreAllMocks(); vi.useRealTimers();
    delete (window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown> }).__RTX_RUNTIME_CONFIG__;
  });
  const transports = [
    ['REST seed', (raw: unknown) => normalizeTick(raw)],
    ['socket/recovery', (raw: unknown) => processIncomingQuotePayload(raw)[0]],
  ] as const;

  describe.each(transports)('%s', (_name, normalize) => {
    it('retains provider time/source/exact sequence and passes the strict dispatcher', () => {
      const tick = normalize(wire)!;
      expect(tick).toMatchObject(wire);
      upsertTick(tick);
      expect(getTerminalQuoteFreshness('BTCUSD').live).toBe(true);
    });
    it('reads raw outer provider evidence without losing it to a synthesized undefined sentinel', () => {
      const tick = normalize({ provider_timestamp: epoch, source: 'cserver', sequence: '99', stale: true,
        data: { tradable: false, quote: { symbol: 'BTCUSD', bid: 1, ask: 2, stale: false, tradable: true } } })!;
      expect(tick).toMatchObject({ provider_timestamp: epoch, source: 'cserver', sequence: '99', stale: true, tradable: false });
      upsertTick(tick);
      expect(getTerminalQuoteFreshness('BTCUSD').reason).toBe('not-tradable');
    });
    it.each([
      { provider_timestamp: undefined, timestamp: epoch },
      { provider_timestamp: undefined, sourceTimestamp: epoch },
      { provider_timestamp: 'invalid', time_ms: epoch },
      { ask: undefined }, { bid: undefined }, { ask: null }, { ask: '' }, { ask: 'bad' },
      { ask: 0 }, { bid: 0 }, { ask: 85000 }, { bid: true },
    ])('rejects display fallback or invalid sides %j', overrides => {
      const tick = normalize({ ...wire, ...overrides });
      if (tick) upsertTick(tick);
      expect(getTerminalQuoteFreshness('BTCUSD').reason).toBe('unavailable');
    });
    it('never infers provider time from an event timestamp or receipt time', () => {
      const { provider_timestamp: ignored, ...withoutProvider } = wire;
      void ignored;
      const tick = normalize({ ...withoutProvider, timestamp: epoch, event_timestamp: epoch })!;
      expect(tick).toHaveProperty('provider_timestamp', undefined);
      upsertTick(tick);
      expect(getTerminalQuoteFreshness('BTCUSD').reason).toBe('unavailable');
    });
    it.each([{ stale: true }, { tradable: false }, { source_mismatch: true }])('preserves duplicate veto %j', flags => {
      upsertTick(normalize(wire)!);
      upsertTick(normalize({ ...wire, ...flags })!);
      upsertTick(normalize(wire)!);
      expect(getTerminalQuoteFreshness('BTCUSD').live).toBe(false);
    });
    it('does not overwrite a newer restricted websocket event with an older REST row', () => {
      upsertTick(normalize({ ...wire, source_mismatch: true })!);
      upsertTick(normalize({ ...wire, provider_timestamp: epoch - 100, sequence: '2' })!);
      expect(getTerminalQuoteFreshness('BTCUSD').reason).toBe('source-mismatch');
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitBrokerAccountSessionScope } from '../services/brokerSession';
import {
  registerDailyChangePriceModes,
  resetDailyChangePriceModeRegistryForTests,
} from '../services/dailyChangePriceModeRegistry';
import {
  formatSpreadDisplay,
  formatSpreadDisplayWithUnit,
  getSpreadDisplay,
  getSpreadPipFactor,
  resolveRawSpread,
  resolveSpreadDigits,
} from './spread';

const commitScope = () => commitBrokerAccountSessionScope({
  authenticated: true,
  accountId: '1001',
  brokerId: 'broker-a',
  serverUrl: 'https://broker-a.test',
});

describe('spread display formatting (broker digits only)', () => {
  beforeEach(() => {
    commitScope();
    resetDailyChangePriceModeRegistryForTests();
  });

  afterEach(() => {
    commitBrokerAccountSessionScope({ authenticated: false, brokerId: '', serverUrl: '' });
    resetDailyChangePriceModeRegistryForTests();
  });

  it('derives the pip factor from digits (3/5 fractional pips, else one point)', () => {
    expect(getSpreadPipFactor(5)).toBe(10000);
    expect(getSpreadPipFactor(3)).toBe(100);
    expect(getSpreadPipFactor(2)).toBe(100);
    expect(getSpreadPipFactor(4)).toBe(10000);
    expect(getSpreadPipFactor(1)).toBe(10);
    expect(getSpreadPipFactor(0)).toBe(1);
  });

  it('shows pips from the caller digits for 5-digit quotes', () => {
    expect(formatSpreadDisplay('EURUSD', 0.0002, undefined, undefined, 5)).toBe('2');
    expect(formatSpreadDisplayWithUnit('EURUSD', 0.00017, undefined, undefined, 5)).toBe('1.7 pips');
  });

  it('keeps fractional 3-digit spreads visible instead of rounding to zero', () => {
    expect(formatSpreadDisplay('USDJPY', 0.001, undefined, undefined, 3)).toBe('0.1');
  });

  it('shows 2-digit quotes as point pips', () => {
    expect(formatSpreadDisplay('XAUUSD', 0.11, undefined, undefined, 2)).toBe('11');
  });

  it('applies digits to any symbol name, including non-FX ones', () => {
    expect(formatSpreadDisplayWithUnit('BTCUSD', 12.5, undefined, undefined, 2)).toBe('1250 pips');
    expect(formatSpreadDisplayWithUnit('BROKER.CUSTOM', 0.0003, undefined, undefined, '5')).toBe('3 pips');
  });

  it('shows the raw price spread when no digits are known, never guessing by name', () => {
    expect(formatSpreadDisplay('EURUSD', 0.0002)).toBe('0.0002');
    expect(formatSpreadDisplay('USDJPY', 0.021)).toBe('0.02');
    expect(formatSpreadDisplayWithUnit('XAUUSD', 0.11)).toBe('0.11');
    expect(getSpreadDisplay('USDJPY', 0.021).unit).toBe('price');
    expect(getSpreadDisplay('XAUUSD', 0.11).unit).toBe('price');
    expect(formatSpreadDisplay('BTCUSD', 111.37)).toBe('111.37');
    expect(formatSpreadDisplay('US30', 0.7)).toBe('0.70');
  });

  it('ignores invalid caller digits', () => {
    expect(resolveSpreadDigits('EURUSD', 9)).toBeNull();
    expect(resolveSpreadDigits('EURUSD', 2.5)).toBeNull();
    expect(resolveSpreadDigits('EURUSD', '')).toBeNull();
    expect(getSpreadDisplay('EURUSD', 0.0002, undefined, undefined, -1).unit).toBe('price');
  });

  it('prefers broker catalog digits over the caller digits', () => {
    registerDailyChangePriceModes([
      { symbol: 'XAUUSD', brokerSpecification: { digits: 3 } },
      { symbol: 'EURUSD.r', brokerSpecification: { digits: 5 } },
    ]);

    expect(resolveSpreadDigits('XAUUSD', 2)).toBe(3);
    expect(formatSpreadDisplay('XAUUSD', 0.11, undefined, undefined, 2)).toBe('11');
    expect(formatSpreadDisplay('XAUUSD', 0.115, undefined, undefined, 2)).toBe('12');
    expect(formatSpreadDisplayWithUnit('EURUSD.r', 0.0002)).toBe('2 pips');
    // Catalog digits are exact per broker symbol; an unlisted name stays raw.
    expect(formatSpreadDisplay('EURUSD', 0.0002)).toBe('0.0002');
  });

  it('ignores catalog digits registered for another broker scope', () => {
    registerDailyChangePriceModes([{ symbol: 'EURUSD', brokerSpecification: { digits: 5 } }]);
    commitBrokerAccountSessionScope({
      authenticated: true,
      accountId: '2002',
      brokerId: 'broker-b',
      serverUrl: 'https://broker-b.test',
    });
    expect(getSpreadDisplay('EURUSD', 0.0002).unit).toBe('price');
  });

  it('falls back to ask minus bid when spread is missing or zero', () => {
    expect(resolveRawSpread(undefined, 7572.9, 7573.2)).toBeCloseTo(0.3, 8);
    expect(formatSpreadDisplay('US500', 0, 7572.9, 7573.2)).toBe('0.30');
    expect(formatSpreadDisplay('US500', 0, 7572.9, 7573.2, 1)).toBe('3');
  });

  it('keeps real zero spread visible with the data-driven unit', () => {
    expect(formatSpreadDisplay('EURUSD', 0, 1.16008, 1.16008, 5)).toBe('0');
    expect(getSpreadDisplay('EURUSD', 0, 1.16008, 1.16008, 5).unit).toBe('pips');
    expect(formatSpreadDisplayWithUnit('EURUSD', 0, 1.16008, 1.16008)).toBe('0');
    expect(getSpreadDisplay('EURUSD', 0, 1.16008, 1.16008).unit).toBe('price');
  });

  it('exposes the unit for callers that need a suffix', () => {
    expect(getSpreadDisplay('EURUSD', 0.0002, undefined, undefined, 5).unit).toBe('pips');
    expect(getSpreadDisplay('BTCUSD', 111.37).unit).toBe('price');
  });
});

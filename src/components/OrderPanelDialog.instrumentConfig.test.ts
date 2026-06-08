import { describe, expect, it } from 'vitest';
import { getInstrumentConfig } from './OrderPanelDialog';

describe('getInstrumentConfig (fe-11)', () => {
  it('falls back to prefix heuristics when no live digits are provided', () => {
    expect(getInstrumentConfig('EURUSD')).toMatchObject({ digits: 5, pipSize: 0.0001 });
    expect(getInstrumentConfig('USDJPY')).toMatchObject({ digits: 3, pipSize: 0.01 });
    expect(getInstrumentConfig('XAUUSD')).toMatchObject({ digits: 2, pipSize: 0.01, contractSize: 100 });
    expect(getInstrumentConfig('BTCUSD')).toMatchObject({ digits: 2, pipSize: 1, contractSize: 1 });
  });

  it('prefers broker-reported digits over the heuristic', () => {
    // A broker that quotes EURUSD at 4 digits (whole pip) instead of the 5-digit guess.
    const cfg = getInstrumentConfig('EURUSD', 4);
    expect(cfg.digits).toBe(4);
    expect(cfg.pipSize).toBe(0.0001);
    // contractSize/currency still come from the heuristic base.
    expect(cfg.contractSize).toBe(100000);
  });

  it('derives fractional-pip pipSize for 5-digit and 3-digit feeds', () => {
    expect(getInstrumentConfig('EURUSD', 5).pipSize).toBeCloseTo(0.0001, 10);
    expect(getInstrumentConfig('USDJPY', 3).pipSize).toBeCloseTo(0.01, 10);
  });

  it('derives whole-pip pipSize for 2-digit feeds', () => {
    expect(getInstrumentConfig('XAUUSD', 2)).toMatchObject({ digits: 2, pipSize: 0.01 });
  });

  it('ignores invalid live digits and uses the heuristic', () => {
    expect(getInstrumentConfig('EURUSD', NaN)).toMatchObject({ digits: 5, pipSize: 0.0001 });
    expect(getInstrumentConfig('EURUSD', -1)).toMatchObject({ digits: 5, pipSize: 0.0001 });
    expect(getInstrumentConfig('EURUSD', 1.5)).toMatchObject({ digits: 5, pipSize: 0.0001 });
    expect(getInstrumentConfig('EURUSD', 99)).toMatchObject({ digits: 5, pipSize: 0.0001 });
  });
});

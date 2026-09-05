import { beforeEach, describe, expect, it } from 'vitest';

import {
  getHiddenSymbols,
  hideSymbol,
  hideSymbols,
  showAllSymbols,
  showSymbol,
} from './marketWatchActions';

describe('Market Watch hidden-symbol persistence', () => {
  beforeEach(() => {
    localStorage.removeItem('rtx5_hidden_symbols');
  });

  it('normalizes, deduplicates, restores, and clears hidden symbols', () => {
    expect(hideSymbol(' xauusd ')).toEqual(['XAUUSD']);
    expect(hideSymbols(['BTCUSD', 'xauusd', 'bad symbol'])).toEqual(['XAUUSD', 'BTCUSD']);
    expect(getHiddenSymbols()).toEqual(['XAUUSD', 'BTCUSD']);

    expect(showSymbol('xauusd')).toEqual(['BTCUSD']);
    showAllSymbols();
    expect(getHiddenSymbols()).toEqual([]);
  });

  it('recovers safely from malformed persisted data', () => {
    localStorage.setItem('rtx5_hidden_symbols', '{broken');

    expect(getHiddenSymbols()).toEqual([]);
    expect(localStorage.getItem('rtx5_hidden_symbols')).toBeNull();
  });
});

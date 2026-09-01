import { describe, expect, it } from 'vitest';
import {
  buildChartSelectionPresentationKey,
  createChartSelectionPresentationGate,
  isChartSelectionLivePaintAllowed,
  releaseChartSelectionLivePaint,
  selectChartPresentation,
  shouldCommitFirstLiveSelectionBaseline,
} from './chartSelectionPresentation';

const key = (sessionScope: string, symbol: string, timeframe = 'M5') => (
  buildChartSelectionPresentationKey({ sessionScope, symbol, timeframe })
);

describe('chart selection presentation gate', () => {
  it('buffers live painting until the current selection baseline is committed', () => {
    const xau = key('account-a', 'XAUUSD');
    let gate = createChartSelectionPresentationGate(xau);

    expect(isChartSelectionLivePaintAllowed(gate, xau)).toBe(false);

    gate = releaseChartSelectionLivePaint(gate, xau);
    expect(isChartSelectionLivePaintAllowed(gate, xau)).toBe(true);
  });

  it('blocks immediately on a symbol switch and ignores the stale history release', () => {
    const xau = key('account-a', 'XAUUSD');
    const eur = key('account-a', 'EURUSD');
    let gate = releaseChartSelectionLivePaint(
      createChartSelectionPresentationGate(xau),
      xau,
    );

    gate = selectChartPresentation(gate, eur);
    expect(isChartSelectionLivePaintAllowed(gate, eur)).toBe(false);

    const afterStaleRelease = releaseChartSelectionLivePaint(gate, xau);
    expect(afterStaleRelease).toBe(gate);
    expect(isChartSelectionLivePaintAllowed(afterStaleRelease, eur)).toBe(false);

    gate = releaseChartSelectionLivePaint(gate, eur);
    expect(isChartSelectionLivePaintAllowed(gate, eur)).toBe(true);
  });

  it('treats timeframe and account changes as new selections without relocking stable renders', () => {
    const m5 = key('account-a', 'xauusd', 'm5');
    const h1 = key('account-a', 'XAUUSD', 'H1');
    const otherAccount = key('account-b', 'XAUUSD', 'H1');
    let gate = releaseChartSelectionLivePaint(
      createChartSelectionPresentationGate(m5),
      m5,
    );

    expect(selectChartPresentation(gate, m5)).toBe(gate);

    gate = selectChartPresentation(gate, h1);
    expect(isChartSelectionLivePaintAllowed(gate, h1)).toBe(false);
    gate = releaseChartSelectionLivePaint(gate, h1);

    gate = selectChartPresentation(gate, otherAccount);
    expect(isChartSelectionLivePaintAllowed(gate, otherAccount)).toBe(false);
  });

  it('allows a validated first live candle to become the web or desktop selection baseline', () => {
    const eur = key('account-a', 'EURUSD');
    const gate = createChartSelectionPresentationGate(eur);

    expect(shouldCommitFirstLiveSelectionBaseline({
      gate,
      selectionKey: eur,
      active: true,
      disposed: false,
      rebuilding: false,
      hasSeries: true,
      hasCurrentCandle: true,
    })).toBe(true);
  });

  it('keeps the first-live fast path disabled for stale or unsafe selections', () => {
    const xau = key('account-a', 'XAUUSD');
    const eur = key('account-a', 'EURUSD');
    const gate = createChartSelectionPresentationGate(eur);
    const ready = {
      gate,
      selectionKey: eur,
      active: true,
      disposed: false,
      rebuilding: false,
      hasSeries: true,
      hasCurrentCandle: true,
    };

    expect(shouldCommitFirstLiveSelectionBaseline({
      ...ready,
      selectionKey: xau,
    })).toBe(false);
    expect(shouldCommitFirstLiveSelectionBaseline({
      ...ready,
      gate: releaseChartSelectionLivePaint(gate, eur),
    })).toBe(false);
    expect(shouldCommitFirstLiveSelectionBaseline({
      ...ready,
      active: false,
    })).toBe(false);
    expect(shouldCommitFirstLiveSelectionBaseline({
      ...ready,
      hasCurrentCandle: false,
    })).toBe(false);
    expect(shouldCommitFirstLiveSelectionBaseline({
      ...ready,
      disposed: true,
    })).toBe(false);
    expect(shouldCommitFirstLiveSelectionBaseline({
      ...ready,
      rebuilding: true,
    })).toBe(false);
    expect(shouldCommitFirstLiveSelectionBaseline({
      ...ready,
      hasSeries: false,
    })).toBe(false);
  });
});

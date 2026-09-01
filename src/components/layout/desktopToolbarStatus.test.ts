import { describe, expect, it } from 'vitest';
import {
  formatDesktopAccountBadge,
  resolveDesktopToolbarStatus,
  type DesktopToolbarStatusInput,
} from './desktopToolbarStatus';

const makeInput = (
  overrides: Partial<DesktopToolbarStatusInput> = {},
): DesktopToolbarStatusInput => ({
  symbol: 'EURUSD.r',
  connectionState: 'connected',
  transportSecurity: 'secure',
  feed: {
    symbols: ['EURUSD.R'],
    loading: false,
    settled: true,
    current: true,
    error: null,
  },
  ...overrides,
});

describe('desktop toolbar status', () => {
  it('verifies the exact selected broker symbol and stays stable during polling', () => {
    const status = resolveDesktopToolbarStatus(makeInput({
      feed: {
        symbols: ['EURUSD.R'],
        loading: true,
        settled: true,
        current: true,
        error: null,
      },
    }));

    expect(status).toMatchObject({
      feedState: 'live',
      fillPercent: 100,
      securityTone: 'secure',
      feedLabel: 'EURUSD.R live feed verified',
    });
  });

  it('does not treat a base symbol as a suffixed broker symbol match', () => {
    const status = resolveDesktopToolbarStatus(makeInput({
      symbol: 'EURUSD',
      feed: {
        symbols: ['EURUSD.R'],
        loading: false,
        settled: true,
        current: true,
        error: null,
      },
    }));

    expect(status.feedState).toBe('silent');
    expect(status.fillPercent).toBe(20);
  });

  it('distinguishes initial checking, unverified status, and an offline socket', () => {
    expect(resolveDesktopToolbarStatus(makeInput({
      feed: { symbols: [], loading: true, settled: false, current: false, error: null },
    }))).toMatchObject({ feedState: 'checking', fillPercent: 50 });

    expect(resolveDesktopToolbarStatus(makeInput({
      feed: { symbols: ['EURUSD.R'], loading: false, settled: true, current: false, error: 'status failed' },
    }))).toMatchObject({ feedState: 'unverified', fillPercent: 0 });

    expect(resolveDesktopToolbarStatus(makeInput({
      connectionState: 'offline',
    }))).toMatchObject({ feedState: 'offline', fillPercent: 0, securityTone: 'offline' });
  });

  it('reports an insecure configured transport without presenting it as secure', () => {
    const status = resolveDesktopToolbarStatus(makeInput({ transportSecurity: 'insecure' }));
    expect(status.securityTone).toBe('insecure');
    expect(status.summary).toContain('insecure transport');
  });

  it('formats only real saved-account counts', () => {
    expect(formatDesktopAccountBadge(0)).toBeNull();
    expect(formatDesktopAccountBadge(Number.NaN)).toBeNull();
    expect(formatDesktopAccountBadge(2)).toBe('2');
    expect(formatDesktopAccountBadge(105)).toBe('99+');
  });
});

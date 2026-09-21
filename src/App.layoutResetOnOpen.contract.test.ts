import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

const bootStart = source.indexOf('// Every launch opens the shipped default arrangement');
const bootEnd = source.indexOf('// Broker config', bootStart);
const bootEffect = source.slice(bootStart, bootEnd);

describe('layout reset on open', () => {
  it('opens every authenticated session on the default arrangement', () => {
    expect(bootStart).toBeGreaterThan(-1);
    expect(bootEnd).toBeGreaterThan(bootStart);
    expect(bootEffect).toContain('useDockLayoutStore.getState().resetToDefaultLayout();');
    expect(bootEffect).toContain('setSelectedSymbol(DEFAULT_CHART_SYMBOL);');
    expect(bootEffect).toContain('setTimeframe(DEFAULT_CHART_TIMEFRAME);');
    expect(bootEffect).toContain('setRestoredLayoutAccountId(accountId);');
    expect(bootEffect.indexOf('resetToDefaultLayout()')).toBeLessThan(bootEffect.indexOf('setRestoredLayoutAccountId(accountId)'));
    expect(source).toContain('useState<Timeframe>(DEFAULT_CHART_TIMEFRAME)');
  });

  it('never restores or auto-saves per-account layouts at boot', () => {
    expect(bootEffect).not.toContain('loadLayout(');
    expect(bootEffect).not.toContain('saveLayout(');
    expect(bootEffect).not.toContain('useDockLayoutStore.subscribe');
  });
});

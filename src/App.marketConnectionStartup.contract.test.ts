import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/App.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('App market connection startup contract', () => {
  it('mounts chart data from the public catalog without weakening authenticated selection diagnostics', () => {
    const readinessStart = source.indexOf('const chartSelectionReadiness = useMemo');
    const runtimeEnd = source.indexOf('useEffect(() => {', readinessStart);
    const startupReadiness = source.slice(readinessStart, runtimeEnd);

    expect(startupReadiness).toContain('catalogSettled: hasLoadedSymbols && !isLoadingSymbols');
    expect(startupReadiness).toContain('const chartRuntimeReady = shouldMountChartRuntime({');
    expect(startupReadiness).toContain('catalogSettled: hasLoadedChartSymbols');
  });

  it('subscribes the rendered active chart channels immediately after the socket opens', () => {
    const effectStart = source.indexOf('// Keep only the selected chart');
    const effectBodyStart = source.indexOf('useEffect(() => {', effectStart);
    const effectEnd = source.indexOf('useEffect(() => {', effectBodyStart + 1);
    const subscriptionEffect = source.slice(effectBodyStart, effectEnd);

    expect(subscriptionEffect).toContain('getActiveChartCommandTarget(selectedSymbol, timeframe)');
    expect(subscriptionEffect).toContain('const selected = normalizeSymbolName(activeChartTarget.symbol)');
    expect(subscriptionEffect).toContain("chartEligibleSymbolsKey.split(',').includes(selected)");
    expect(subscriptionEffect).toContain('subscribe(`ticks.${selected}`');
    expect(subscriptionEffect).toContain('subscribe(`candles.${selected}.${toV2Timeframe(selectedTimeframe)}`');
    const dependencyStart = subscriptionEffect.lastIndexOf('}, [');
    const subscriptionDependencies = subscriptionEffect.slice(dependencyStart);
    expect(subscriptionDependencies).toContain('chartEligibleSymbolsKey');
    expect(subscriptionDependencies).not.toContain('chartEligibleSymbolSet');
    expect(subscriptionEffect).not.toContain('setTimeout');
    expect(subscriptionEffect).not.toContain('500');
  });

  it('uses the shared market-instrument hook as the only authenticated catalog owner', () => {
    expect(source).toContain('marketInstrumentsSnapshot.authorizationSettled');
    expect(source).toContain('marketInstrumentsSnapshot.authorizedSymbols');
    expect(source).not.toContain('marketV2Api.getAuthorizedInstruments()');
  });
});

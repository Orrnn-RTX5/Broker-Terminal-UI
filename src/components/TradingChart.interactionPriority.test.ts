import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Normalize CRLF so the multi-line anchors keep matching on Windows checkouts
// (core.autocrlf=true materializes the working tree with \r\n).
const readChartSource = (relativePath: string) => readFileSync(
  resolve(process.cwd(), relativePath),
  'utf8',
).replace(/\r\n/g, '\n');

// TradingChart remains the public facade, while its lifecycle, interaction,
// live-candle, trade-overlay, command, and view implementations are now owned
// by focused modules. Treat those production files as one component contract.
const chartFacadeSource = readChartSource('src/components/TradingChart.tsx');
const commandsSource = readChartSource('src/features/trading-chart/runtime/useTradingChartCommands.ts');
const liveCandleSource = readChartSource('src/features/trading-chart/runtime/useTradingChartLiveCandleRuntime.ts');
const initializationSource = readChartSource('src/features/trading-chart/runtime/useTradingChartInitialization.ts');
const reconfigurationSource = readChartSource('src/features/trading-chart/runtime/useTradingChartReconfiguration.ts');
const drawingCommandsSource = readChartSource('src/features/trading-chart/runtime/useTradingChartDrawingCommands.ts');
const historyCacheSource = readChartSource('src/features/trading-chart/runtime/useTradingChartHistoryCache.ts');
const historyLoadingSource = readChartSource('src/features/trading-chart/runtime/useTradingChartHistoryLoading.ts');
const livePriceOverlaySource = readChartSource('src/features/trading-chart/presentation/useTradingChartLivePriceOverlay.ts');
const loadingPresentationSource = readChartSource('src/features/trading-chart/presentation/useTradingChartLoadingPresentation.ts');
const viewportResetSource = readChartSource('src/features/trading-chart/runtime/useTradingChartViewportReset.ts');
const tradeRuntimeSource = [
  'src/features/trading-chart/runtime/useTradingChartTradeRuntime.ts',
  'src/features/trading-chart/runtime/createTradeOverlayModelRuntime.ts',
  'src/features/trading-chart/runtime/createTradeOverlayDomRuntime.ts',
  'src/features/trading-chart/runtime/useTradingChartTradeOverlayRenderer.ts',
  'src/features/trading-chart/runtime/bindTradeOverlayRuntimeSubscriptions.ts',
  'src/features/trading-chart/runtime/useTradingChartTradeLevelDrag.ts',
  'src/features/trading-chart/runtime/tradeOverlayRuntimeConstants.ts',
].map(readChartSource).join('\n');
const tradeSubscriptionsSource = readChartSource(
  'src/features/trading-chart/runtime/bindTradeOverlayRuntimeSubscriptions.ts',
);
const chartViewSource = readChartSource('src/features/trading-chart/presentation/TradingChartView.tsx');
const chartRuntimeContractsSource = readChartSource('src/features/trading-chart/runtime/chartRuntimeContracts.ts');
const source = [
  chartFacadeSource,
  commandsSource,
  liveCandleSource,
  initializationSource,
  reconfigurationSource,
  drawingCommandsSource,
  historyCacheSource,
  historyLoadingSource,
  livePriceOverlaySource,
  loadingPresentationSource,
  viewportResetSource,
  tradeRuntimeSource,
  chartViewSource,
  chartRuntimeContractsSource,
].join('\n');

describe('TradingChart interaction-priority contract', () => {
  it('renders first history before scheduling cancellable background gap repairs', () => {
    const load = historyLoadingSource.slice(
      historyLoadingSource.indexOf('const loadHistory = useCallback'),
      historyLoadingSource.indexOf('// Load more historical data'),
    );
    const firstRender = load.indexOf("reason: 'initial-history'");
    const background = load.indexOf('void (async () =>');
    const repair = load.indexOf('await backfillRecentInteriorHistoryGaps(');
    expect(firstRender).toBeGreaterThan(0);
    expect(background).toBeGreaterThan(firstRender);
    expect(repair).toBeGreaterThan(background);
    expect(load.slice(background, repair)).toContain('if (!isCurrentHistoryLoad()) return;');
    expect(load.slice(repair)).toContain('if (!isCurrentHistoryLoad() || gapBackfill.addedCandles === 0) return;');
    expect(load.slice(background, repair)).toContain('mergeMissingHistoryCandles(');
    expect(load.slice(repair)).toContain('applyAdditionalHistory(gapBackfill.candles');
  });

  it('requests a small cold M1 page and expands only after first paint under the same cancellation signal', () => {
    const load = historyLoadingSource.slice(
      historyLoadingSource.indexOf('const loadHistory = useCallback'),
      historyLoadingSource.indexOf('// Load more historical data'),
    );
    expect(load).toContain("const useProgressiveInitialHistory = activeTf === 'M1' && !hydratedFromCache;");
    expect(load).toContain('count: useProgressiveInitialHistory ? FIRST_PAINT_HISTORY_COUNT : getInitialHistoryCount(activeTf)');
    const firstRender = load.indexOf("reason: 'initial-history'");
    const background = load.indexOf('void (async () =>');
    const expansion = load.indexOf('const extendedHistory = await chartDataService.fetchCandles(');
    const terminalPaint = load.indexOf('if (!await waitForTerminalReady(historyRequest.signal)) return;');
    expect(background).toBeGreaterThan(firstRender);
    expect(terminalPaint).toBeGreaterThan(background);
    expect(terminalPaint).toBeLessThan(load.indexOf('await waitForProgressiveHistoryIdleTurn(historyRequest.signal);', background));
    expect(expansion).toBeGreaterThan(background);
    expect(load.slice(expansion)).toContain('signal: historyRequest.signal');
    expect(load.slice(expansion)).toContain("if (!isCurrentHistoryLoad()) return;\n              const addedCount = applyAdditionalHistory");
    expect(load.indexOf('warmOtherTimeframeCaches();')).toBeGreaterThan(background);
    expect(load).toContain('if (useProgressiveInitialHistory && receivedHistoryCount >= FIRST_PAINT_HISTORY_COUNT)');
  });

  it('keeps startup readiness out of initial and user-requested history loaders', () => {
    const initialStart = historyLoadingSource.indexOf('const loadHistory = useCallback');
    const background = historyLoadingSource.indexOf('void (async () =>', initialStart);
    expect(historyLoadingSource.slice(initialStart, background)).not.toContain('waitForTerminalReady(');
    const olderStart = historyCacheSource.indexOf('const fetchOlderHistoryPage = useCallback');
    const olderEnd = historyCacheSource.indexOf('const validateRenderedCandlesAgainstLivePrice', olderStart);
    expect(historyCacheSource.slice(olderStart, olderEnd)).not.toContain('waitForTerminalReady(');
    const loadMoreStart = historyLoadingSource.indexOf('const loadMoreHistory = useCallback');
    const loadMoreEnd = historyLoadingSource.indexOf('return { loadHistory, loadMoreHistory };', loadMoreStart);
    expect(loadMoreEnd).toBeGreaterThan(loadMoreStart);
    expect(historyLoadingSource.slice(loadMoreStart, loadMoreEnd)).not.toContain('waitForTerminalReady(');
  });

  it('uses M1-derived history as the primary source for every higher timeframe', () => {
    const loadStart = historyLoadingSource.indexOf('const loadHistory = useCallback');
    const loadEnd = historyLoadingSource.indexOf('// Load more historical data', loadStart);
    const loadHistory = historyLoadingSource.slice(loadStart, loadEnd);

    expect(loadHistory).toContain('const deriveInitialHistoryFromM1 = isM1DerivedFallbackTimeframe(activeTf)');
    expect(loadHistory).toContain('fetchDerivedTimeframeCandlesFromM1({');
    expect(loadHistory).toContain("targetTimeframe: activeTf");
    expect(loadHistory).toContain('maxM1Pages: 1');
    expect(loadHistory.indexOf('fetchDerivedTimeframeCandlesFromM1({'))
      .toBeLessThan(loadHistory.lastIndexOf('chartDataService.fetchCandles(options)'));
    expect(loadHistory).toContain("historySource: CandleCacheSource = deriveInitialHistoryFromM1 ? 'derived-m1' : 'backend'");
  });

  it('reuses warm M1 aggregation before waiting for another timeframe history request', () => {
    const cacheStart = historyCacheSource.indexOf('const hydrateHistoryFromCache = useCallback');
    const cacheEnd = historyCacheSource.indexOf('const restoreProtectedDisplayedHistory = useCallback', cacheStart);
    const cacheHydration = historyCacheSource.slice(cacheStart, cacheEnd);

    expect(cacheHydration).toContain("candleAggregationService.getCandles(symbol, 'M1', true, false)");
    expect(cacheHydration).toContain('omitPartialLeadingM1Aggregate(');
    expect(cacheHydration).toContain('candleAggregationService.getCandles(symbol, activeTf as AggTimeframe, true, false)');
    expect(cacheHydration).toContain("source: 'derived-m1'");
    expect(cacheHydration.indexOf('candleAggregationService.getCandles('))
      .toBeLessThan(cacheHydration.indexOf("if (!cached || cached.candles.length === 0) return false;"));
  });

  it('paints cached timeframe data before starting a broker refresh and prewarms later selections', () => {
    const loadStart = historyLoadingSource.indexOf('const loadHistory = useCallback');
    const loadEnd = historyLoadingSource.indexOf('// Load more historical data', loadStart);
    const loadHistory = historyLoadingSource.slice(loadStart, loadEnd);

    expect(loadHistory.indexOf("hydrateHistoryFromCache(activeTf, 'cached-history')"))
      .toBeLessThan(loadHistory.indexOf('historyRequestCoordinatorRef.current.start({'));
    expect(loadHistory).toContain('for (const targetTf of CANDLE_TIMEFRAMES)');
    expect(loadHistory).toContain("if (targetTf === 'M1' || targetTf === activeTf) continue;");
    expect(loadHistory).toContain('warmCandles.length > (existingWarmCache?.candles.length ?? 0)');
    expect(loadHistory).toContain('omitPartialLeadingM1Aggregate(');
    expect(loadHistory).toContain("setHistoryCache(\n              targetTf as Timeframe,");
    expect(loadHistory).toContain("'derived-m1',");
  });

  it('clears stale chart-interaction ownership before a timeframe repaint', () => {
    const commandStart = source.indexOf("const unsubTimeframe = commandBus.subscribe('SET_TIMEFRAME'");
    const commandEnd = source.indexOf('return () => {', commandStart);
    const timeframeCommand = source.slice(commandStart, commandEnd);
    const hydrate = timeframeCommand.indexOf("hydrateHistoryFromCache(newTimeframe as Timeframe, 'cached-timeframe-command')");

    expect(timeframeCommand.indexOf('clearLocalChartPointerStateRef.current();')).toBeLessThan(hydrate);
    expect(timeframeCommand.indexOf('isChartInteractionActiveRef.current = false;')).toBeLessThan(hydrate);
    expect(timeframeCommand.indexOf('chartInteractionOwnershipRef.current?.reset();')).toBeLessThan(hydrate);
    expect(timeframeCommand.indexOf('postInteractionCoordinatorRef.current?.clear();')).toBeLessThan(hydrate);
  });

  it('keeps the canonical M1 candle socket mounted across timeframe switches', () => {
    const liveEffectStart = liveCandleSource.indexOf('useActiveChartRuntimeEffect(visibleRuntime.candle, () => {');
    const liveEffectEnd = liveCandleSource.indexOf('// The primary tick aggregation interval', liveEffectStart);
    const liveEffect = liveCandleSource.slice(liveEffectStart, liveEffectEnd);

    expect(liveEffect).toContain("const streamTimeframe: AggTimeframe = 'M1';");
    expect(liveEffect).toContain('const getDisplayedStreamTimeframe = (): AggTimeframe => (');
    expect(liveEffect).toContain('const displayedStreamTimeframe = getDisplayedStreamTimeframe();');
    expect(liveEffect).not.toContain('prevTimeframeRef.current || activeTimeframe');
    expect(liveEffect).not.toMatch(/\n\s+activeTimeframe,\n/);
  });

  it('classifies legacy M1 finals and scopes finalized guards by displayed timeframe', () => {
    const liveEffectStart = liveCandleSource.indexOf('useActiveChartRuntimeEffect(visibleRuntime.candle, () => {');
    const liveEffectEnd = liveCandleSource.indexOf('// The primary tick aggregation interval', liveEffectStart);
    const liveEffect = liveCandleSource.slice(liveEffectStart, liveEffectEnd);

    expect(liveEffect).toContain('const finalizedCandleTimeByTimeframe = new Map<string, number>();');
    expect(liveEffect).toContain('isCandleAtOrBeforeFinalizedTime(finalizedCandleTimeByTimeframe, activeTf, candleTime)');
    expect(liveEffect).toContain('resolveCandleFinalityFromActivePeriod(candle, activeM1Period?.startTime)');
    expect(liveEffect).toContain("applyServerCandle(reconcileServerM1Candle(validatedCandle), 'backend', 'M1')");
    expect(liveEffect).toContain('markFinalizedCandleTime(finalizedCandleTimeByTimeframe, displayedStreamTimeframe, snapshotCandle.time)');
  });

  it('keeps backend timestamps and OHLC exact instead of guessing time or price scale', () => {
    const historyStart = historyLoadingSource.indexOf('const loadHistory = useCallback');
    const historyEnd = historyLoadingSource.indexOf('// Load more historical data', historyStart);
    const history = historyLoadingSource.slice(historyStart, historyEnd);
    const priceGuardStart = historyCacheSource.indexOf('const validateRenderedCandlesAgainstLivePrice = useCallback');
    const priceGuardEnd = historyCacheSource.indexOf('return {', priceGuardStart);
    const priceGuard = historyCacheSource.slice(priceGuardStart, priceGuardEnd);

    expect(history).not.toContain('Math.round(rawOffset / 1800)');
    expect(history).not.toContain('Date.now() / 1000');
    expect(history).not.toContain('detectedBrokerOffsetSecs');
    expect(priceGuardStart).toBeGreaterThan(-1);
    expect(priceGuardEnd).toBeGreaterThan(priceGuardStart);
    expect(priceGuard).toContain('isPriceCompatibleWithReference(price, reference)');
    expect(priceGuard).not.toContain('scaleCandlePrices');
    expect(source).not.toContain('live-quote-scale-normalization');
    expect(source).not.toContain("status === 'scaled'");
  });

  it('labels timeframe history work as receiving instead of reconnecting the feed', () => {
    const commandStart = source.indexOf("const unsubTimeframe = commandBus.subscribe('SET_TIMEFRAME'");
    const commandEnd = source.indexOf('return () => {', commandStart);
    const timeframeCommand = source.slice(commandStart, commandEnd);

    expect(source).toContain("loadingPhase === 'connecting'");
    expect(source).toContain("? [tr('Connecting to market data…')]");
    expect(source).toContain("`${symbol} ${activeTimeframe} · ${tr('Loading…')}`");
    expect(timeframeCommand).toContain("setLoadingPhase('receiving')");
    expect(timeframeCommand).not.toContain("setLoadingPhase('connecting')");
    expect(historyLoadingSource.slice(
      historyLoadingSource.indexOf('const loadHistory = useCallback'),
      historyLoadingSource.indexOf('// Load more historical data'),
    )).toContain("setLoadingPhase('receiving')");
  });

  it('keeps tick ingestion running while chart painting is deferred', () => {
    const tickLoopStart = source.indexOf('const interval = setInterval(() => {');
    const tickLoopEnd = source.indexOf('}, LIVE_CHART_UPDATE_INTERVAL_MS);', tickLoopStart);
    const tickLoop = source.slice(tickLoopStart, tickLoopEnd);

    expect(tickLoopStart).toBeGreaterThan(-1);
    expect(tickLoopEnd).toBeGreaterThan(tickLoopStart);
    expect(tickLoop).toContain('Model ingestion must never pause for a pan');
    expect(tickLoop).not.toMatch(/if\s*\([^)]*isChartInteractionActiveRef\.current[^)]*\)\s*return/);
    expect(tickLoop).not.toMatch(/if\s*\([^)]*!isActiveRef\.current[^)]*\)\s*return/);
    expect(tickLoop).toContain('applyTickToFormingCandle(currentCandleRef.current, price)');
    expect(tickLoop).not.toContain('currentCandleRef.current.volume === 0');
    expect(tickLoop).toContain("window.dispatchEvent(new Event('rtx:force-refresh-positions'))");
    expect(tickLoop).toContain('candleAggregationService.processTick');
    expect(tickLoop).toContain('const m1DerivedCandle = latestAggregatedCandle');
    expect(tickLoop).toContain('const derivedCurrentCandle: Candle | null');
    expect(tickLoop).toContain('repaintLivePriceOverlayOrDefer(currentCandleRef.current)');
    expect(tickLoop.indexOf('synchronizeChartMarketClock(tick?.sourceTimestamp ?? tick?.timestamp)'))
      .toBeLessThan(tickLoop.indexOf('if (tickKey === lastTickKey) return;'));
    expect(tickLoop.indexOf('reconcileSynchronizedCandleBoundary()'))
      .toBeLessThan(tickLoop.indexOf('if (tickKey === lastTickKey) return;'));
    expect(tickLoop).toContain('tick.sourceTimestamp ?? tick.timestamp');
    expect(tickLoop).toContain('getTimeframePeriodSeconds(');
    expect(tickLoop).toContain('brokerTimeOffsetSecRef.current');
  });

  it('releases hidden-tab runtime and restores only visible chart work', () => {
    const liveEffectStart = liveCandleSource.indexOf('useActiveChartRuntimeEffect(visibleRuntime.candle, () => {');
    const liveEffectEnd = liveCandleSource.lastIndexOf('\n};');
    const liveEffect = liveCandleSource.slice(liveEffectStart, liveEffectEnd);

    expect(liveEffect).toContain('useActiveChartRuntimeEffect(visibleRuntime.candle');
    expect(liveEffect).toContain('if (!isActive || !symbol) return;');
    expect(liveEffect).toContain('chartDataService.subscribeCandles({');
    expect(liveEffect).toContain("const streamTimeframe: AggTimeframe = 'M1';");
    expect(liveEffect).toContain('candleAggregationService.reconcileServerCandle(');
    expect(liveEffect).toContain("classifiedCandle.closed === true");
    expect(liveEffect).toContain('clearInterval(interval);');
    expect(liveEffect).toContain('candleStream.close();');
    expect(liveEffect).toContain('getTimeframePeriodSeconds(');
    expect(liveEffect).toContain('return currentPeriod.startTime;');
    expect(liveEffect).toContain('if (!synchronizedMarketClockRef.current || liveMarketDataFrozenRef.current) return null;');
    expect(liveEffect).toContain('scheduleBoundaryTimerRef.current = reconcileSynchronizedCandleBoundary;');
    expect(liveEffect).toContain("document.addEventListener('visibilitychange', handleSynchronizedClockVisibilityChange)");
    expect(liveEffect).toContain("document.removeEventListener('visibilitychange', handleSynchronizedClockVisibilityChange)");
    expect(liveEffect).toContain('getSynchronizedChartMarketNowMs');
    expect(liveEffect).toContain('synchronizeChartMarketClock');
    expect(source).toContain('enabled: visibleRuntime.history');
    expect(source).toContain('scopeRevision: brokerAccountSessionScope');
    expect(source).toContain('enabled: visibleRuntime.status');
    expect(source).toContain('useQuoteSubscription(symbol ? [symbol] : [], chartQuoteSourceId, { enabled: visibleRuntime.quote })');
    expect(source).toContain('enabled: isActive && crosshairEnabled');
    expect(source).toContain("commandBus.subscribe('TOGGLE_CROSSHAIR'");
    expect(source).toContain('if (!isChartCommandTarget(payload)) return;');
  });

  it('renders the candle countdown only beneath the right-scale live price', () => {
    const hudStart = source.indexOf('{/* Chart HUD uses shared size and weight roles');
    const hudEnd = source.indexOf('Chart Container - must have explicit dimensions', hudStart);
    const hudMarkup = source.slice(hudStart, hudEnd);
    const badgeStart = source.indexOf('ref={livePriceBadgeRef}');
    const badgeEnd = source.indexOf('{/* Drawing Context Menu', badgeStart);
    const badgeMarkup = source.slice(badgeStart, badgeEnd);
    const hideStart = livePriceOverlaySource.indexOf('const hideLivePriceOverlay = useCallback');
    const hideEnd = livePriceOverlaySource.indexOf('const syncSupplementalPriceLines = useCallback', hideStart);
    const hide = livePriceOverlaySource.slice(hideStart, hideEnd);
    const paintStart = livePriceOverlaySource.indexOf('const paintLivePriceOverlay = useCallback');
    const paintEnd = livePriceOverlaySource.indexOf('const repaintLivePriceOverlayFromCurrentPrice = useCallback', paintStart);
    const paint = livePriceOverlaySource.slice(paintStart, paintEnd);
    const countdownStart = source.indexOf('// Keep the active candle countdown inside the right price-scale badge');
    const countdownEnd = source.indexOf('// Charts initialised inside an invisible tab', countdownStart);
    const countdownEffect = source.slice(countdownStart, countdownEnd);

    expect(hudStart).toBeGreaterThan(-1);
    expect(hudEnd).toBeGreaterThan(hudStart);
    expect(hudMarkup).not.toContain('livePriceCountdownRef');
    expect(hudMarkup).not.toContain('data-live-price-countdown');
    expect(source).not.toContain('countdownTextRef');

    expect(badgeStart).toBeGreaterThan(-1);
    expect(badgeEnd).toBeGreaterThan(badgeStart);
    expect(badgeMarkup.indexOf('ref={livePriceValueRef}')).toBeGreaterThan(-1);
    expect(badgeMarkup.indexOf('ref={livePriceCountdownRef}'))
      .toBeGreaterThan(badgeMarkup.indexOf('ref={livePriceValueRef}'));
    expect(badgeMarkup).toContain('data-live-price-countdown');
    expect(badgeMarkup).toContain('aria-hidden="true"');
    expect(badgeMarkup).toContain('lineHeight: \'16px\'');
    expect(badgeMarkup).toContain('lineHeight: \'14px\'');
    expect(badgeMarkup).toContain("fontSize: 'var(--rtx-ui-font-size, 14px)'");
    expect(badgeMarkup).toContain("opacity: 1");
    expect(badgeMarkup).toContain("textAlign: 'center'");
    expect(badgeMarkup).toContain("transform: 'translateY(-50%)'");

    expect(paint).toContain('livePriceValueRef.current.textContent = formatChartAxisPrice(livePrice, digits)');
    expect(paint).not.toContain('badge.textContent =');
    expect(hide).not.toContain('livePriceBadgeRef.current.textContent =');
    expect(hide).toContain("livePriceCountdownRef.current.style.display = 'none'");

    expect(countdownStart).toBeGreaterThan(-1);
    expect(countdownEnd).toBeGreaterThan(countdownStart);
    expect(countdownEffect.match(/useActiveChartRuntimeEffect\(visibleRuntime\.interval/g)).toHaveLength(1);
    expect(countdownEffect).toContain('getChartCandleCountdownText(');
    expect(countdownEffect).toContain('getSynchronizedChartMarketNowMs()');
    expect(countdownEffect).toContain('brokerTimeOffsetSecRef.current');
    expect(countdownEffect).toContain("livePriceBadgeRef.current?.style.display === 'block'");
    expect(countdownEffect).toContain('window.setInterval(updateLivePriceCountdown, 1000)');
    expect(countdownEffect).toContain('window.clearInterval(interval)');
    expect(countdownEffect).toContain("document.addEventListener('visibilitychange', handleCountdownVisibilityChange)");
    expect(countdownEffect).toContain("document.removeEventListener('visibilitychange', handleCountdownVisibilityChange)");
    expect(countdownEffect).toContain('}, [activeTimeframe, getSynchronizedChartMarketNowMs, symbol]);');
    expect(source).toContain('synchronizedMarketClockRef.current = null;\n  }, [symbol]);');
  });

  it('owns loading and trade-overlay subscriptions only while active', () => {
    const loadingStart = loadingPresentationSource.indexOf('// Keep the surface mounted through its CSS fade');
    const loadingEnd = loadingPresentationSource.indexOf('return {', loadingStart);
    const loadingEffects = loadingPresentationSource.slice(loadingStart, loadingEnd);
    const overlayStart = source.indexOf('useActiveChartRuntimeEffect(visibleRuntime.overlay, () => {', source.indexOf('// ─── Trade Annotations on Chart'));
    const overlayEnd = source.indexOf('}, [brokerTimeOffsetSec,', overlayStart);
    const overlayEffect = source.slice(overlayStart, overlayEnd);

    expect(loadingEffects.match(/useActiveChartRuntimeEffect\(intervalEnabled/g)).toHaveLength(2);
    expect(loadingEffects).toContain('window.clearTimeout(timer)');
    expect(loadingEffects).toContain('window.clearInterval(interval)');
    expect(overlayStart).toBeGreaterThan(-1);
    expect(overlayEnd).toBeGreaterThan(overlayStart);
    expect(overlayEffect).toContain('return bindTradeOverlayRuntimeSubscriptions({');
    expect(tradeSubscriptionsSource).toContain('subscribeVisibleLogicalRangeChange(timeScaleHandler)');
    expect(tradeSubscriptionsSource).toContain('useAppStore.subscribe(');
    expect(tradeSubscriptionsSource).toContain('useChartSettingsStore.subscribe(');
    expect(tradeSubscriptionsSource).toContain("window.addEventListener('rtx:force-refresh-positions'");
    expect(tradeSubscriptionsSource).toContain("window.addEventListener('rtx:new-trade-placed'");
    expect(tradeSubscriptionsSource).toContain('clearTradeOverlayVisualRuntime();');
  });

  it('promotes an urgent first paint over an already queued idle render', () => {
    const schedulerStart = source.indexOf('const scheduleQueuedChartRenderFlush = useCallback');
    const schedulerEnd = source.indexOf('const requestChartDataRender = useCallback', schedulerStart);
    const scheduler = source.slice(schedulerStart, schedulerEnd);
    const frameGuard = scheduler.indexOf('if (chartRenderFrameRef.current !== null) return;');
    const urgentIdlePromotion = scheduler.indexOf('if (immediate && chartRenderIdleRef.current !== null)');
    const idleCancellation = scheduler.indexOf('cancelBrowserIdleCallback(chartRenderIdleRef.current)', urgentIdlePromotion);
    const idleGuard = scheduler.indexOf('if (chartRenderIdleRef.current !== null) return;', idleCancellation);

    expect(schedulerStart).toBeGreaterThan(-1);
    expect(schedulerEnd).toBeGreaterThan(schedulerStart);
    expect(frameGuard).toBeGreaterThan(-1);
    expect(urgentIdlePromotion).toBeGreaterThan(frameGuard);
    expect(idleCancellation).toBeGreaterThan(urgentIdlePromotion);
    expect(scheduler).toContain('chartRenderIdleRef.current = null;');
    expect(idleGuard).toBeGreaterThan(idleCancellation);
    expect(scheduler).toContain('window.requestAnimationFrame(() => {');
    expect(scheduler).toContain('requestBrowserIdleCallback(');
    expect(scheduler).toContain('HISTORY_RENDER_IDLE_TIMEOUT_MS');
  });

  it('finishes loading only after loader-owned candles reach the chart series', () => {
    const flushStart = source.indexOf('const flushQueuedChartRender = useCallback');
    const flushEnd = source.indexOf('const scheduleQueuedChartRenderFlush = useCallback', flushStart);
    const flush = source.slice(flushStart, flushEnd);
    const setData = flush.indexOf('series.setData(seriesData);');
    const finishLoading = flush.indexOf('if (pending.finishLoadingAfterRender && seriesData.length > 0)', setData);
    const releaseLivePaint = flush.indexOf('releaseChartSelectionLivePaint(', finishLoading);
    const markReady = flush.indexOf('markCandlesReady();', finishLoading);
    const requestStart = source.indexOf('const requestChartDataRender = useCallback');
    const requestEnd = source.indexOf('const consumeDeferredVisibleRangeHistory = useCallback', requestStart);
    const request = source.slice(requestStart, requestEnd);

    expect(flushStart).toBeGreaterThan(-1);
    expect(flushEnd).toBeGreaterThan(flushStart);
    expect(setData).toBeGreaterThan(-1);
    expect(finishLoading).toBeGreaterThan(setData);
    expect(releaseLivePaint).toBeGreaterThan(finishLoading);
    expect(markReady).toBeGreaterThan(releaseLivePaint);
    expect(flush).toContain('markCandlesReady, rememberVisibleLogicalRange');
    expect(chartRuntimeContractsSource).toContain('finishLoadingAfterRender?: boolean;');
    expect(request).toContain('finishLoadingAfterRender: request.finishLoadingAfterRender === true || existing?.finishLoadingAfterRender === true');

    const cacheStart = historyCacheSource.indexOf('const hydrateHistoryFromCache = useCallback');
    const cacheEnd = historyCacheSource.indexOf('const restoreProtectedDisplayedHistory = useCallback', cacheStart);
    const restoreEnd = historyCacheSource.indexOf('const fetchOlderHistoryPage = useCallback', cacheEnd);
    const initialStart = historyLoadingSource.indexOf('// Update chart - live data');
    const initialEnd = historyLoadingSource.indexOf('} catch (err: unknown)', initialStart);
    const snapshotStart = source.indexOf('onSnapshot: (snapshot) => {');
    const snapshotEnd = source.indexOf('onCandle: (candle) =>', snapshotStart);
    const resetStart = source.indexOf('const renderResetCandles = (candles: Candle[], reason: string): boolean => {');
    const resetEnd = source.indexOf('if (activeSymbol) {', resetStart);
    const authoritativeLoaderSections = [
      historyCacheSource.slice(cacheStart, cacheEnd),
      historyCacheSource.slice(cacheEnd, restoreEnd),
      historyLoadingSource.slice(initialStart, initialEnd),
      source.slice(resetStart, resetEnd),
    ];

    for (const section of authoritativeLoaderSections) {
      expect(section).toContain('finishLoadingAfterRender: true');
      expect(section).not.toContain("setLoadingPhase('ready')");
      expect(section).not.toContain("setLoadingPhase('hidden')");
    }
    const snapshotSection = source.slice(snapshotStart, snapshotEnd);
    expect(snapshotSection).toContain('immediate: true');
    expect(snapshotSection).toContain('releaseLivePaintAfterRender: true');
    expect(snapshotSection).toContain('finishLoadingAfterRender: !initialHistoryLoadPendingRef.current');
    expect(snapshotSection).not.toContain("setLoadingPhase('ready')");
    expect(snapshotSection).not.toContain("setLoadingPhase('hidden')");
    expect(source).not.toContain("setLoadingPhase('ready')");
  });

  it('buffers live candles per selection while allowing a first-live baseline setData commit', () => {
    const flushStart = source.indexOf('const flushQueuedChartRender = useCallback');
    const flushEnd = source.indexOf('const scheduleQueuedChartRenderFlush = useCallback', flushStart);
    const flush = source.slice(flushStart, flushEnd);
    const liveStart = source.indexOf('const canPaintLiveChart =');
    const liveEnd = source.indexOf('// The primary tick aggregation interval', liveStart);
    const liveEffect = source.slice(liveStart, liveEnd);
    const correctionStart = liveEffect.indexOf("reason: 'server-candle-history-correction'");
    const correctionRequestStart = liveEffect.lastIndexOf('updateChartData(', correctionStart);
    const correctionRequestEnd = liveEffect.indexOf('});', correctionStart);
    const correctionRequest = liveEffect.slice(correctionRequestStart, correctionRequestEnd);

    expect(flush).toContain('pending.selectionKey !== chartSelectionPresentationRef.current.selectionKey');
    expect(flush.indexOf('series.setData(seriesData);')).toBeLessThan(
      flush.indexOf('releaseChartSelectionLivePaint('),
    );
    expect(liveEffect).toContain('isChartSelectionLivePaintAllowed(');
    expect(liveEffect).not.toContain('markCandlesReady();');
    expect(liveEffect).toContain('shouldCommitFirstLiveSelectionBaseline({');
    expect(liveEffect).not.toContain('isDesktopShell');
    expect(liveEffect).toContain("reason: 'first-live-selection-baseline'");
    expect(liveEffect).toContain('immediate: true');
    expect(liveEffect).toContain('releaseLivePaintAfterRender: true');
    expect(liveEffect).toContain('finishLoadingAfterRender: !initialHistoryLoadPendingRef.current');
    expect(liveEffect).toContain('pendingLiveChartPaint && currentCandleRef.current && canPaintLiveChart()');
    expect(liveEffect).toContain('repaintLivePriceOverlayOrDefer(currentCandleRef.current);');
    expect(correctionStart).toBeGreaterThan(-1);
    expect(correctionRequest).not.toContain('finishLoadingAfterRender: true');
    expect(liveEffect).toContain("reason: 'stream-snapshot'");
    expect(liveEffect.match(/releaseLivePaintAfterRender: true/g)).toHaveLength(2);
    expect(liveEffect.match(/finishLoadingAfterRender: !initialHistoryLoadPendingRef\.current/g)).toHaveLength(2);
  });

  it('defers server-candle and snapshot overlay paints through the interaction policy', () => {
    const helperStart = source.indexOf('const repaintLivePriceOverlayOrDefer =');
    const helperEnd = source.indexOf('const refreshMarketGapSeriesForCandle =', helperStart);
    const helper = source.slice(helperStart, helperEnd);
    const serverCandleStart = source.indexOf('const applyServerCandle =');
    const serverCandleEnd = source.indexOf("const streamTimeframe: AggTimeframe = 'M1';", serverCandleStart);
    const serverCandle = source.slice(serverCandleStart, serverCandleEnd);
    const snapshotStart = source.indexOf('onSnapshot: (snapshot) => {', serverCandleEnd);
    const snapshotEnd = source.indexOf('onCandle: (candle) =>', snapshotStart);
    const snapshot = source.slice(snapshotStart, snapshotEnd);

    expect(helperStart).toBeGreaterThan(-1);
    expect(helperEnd).toBeGreaterThan(helperStart);
    expect(helper).toContain('if (!canPaintLiveChart())');
    expect(helper).toContain('requestDeferredLivePaint()');
    expect(helper).toContain('repaintLivePriceOverlayFromCurrentPrice(c)');
    expect(serverCandleStart).toBeGreaterThan(-1);
    expect(serverCandleEnd).toBeGreaterThan(serverCandleStart);
    expect(serverCandle.match(/repaintLivePriceOverlayOrDefer\(/g)).toHaveLength(4);
    expect(serverCandle).not.toContain('repaintLivePriceOverlayFromCurrentPrice(');
    expect(snapshotStart).toBeGreaterThan(-1);
    expect(snapshotEnd).toBeGreaterThan(snapshotStart);
    expect(snapshot).toContain('repaintLivePriceOverlayOrDefer(currentCandleRef.current)');
    expect(snapshot).not.toContain('repaintLivePriceOverlayFromCurrentPrice(');
  });

  it('protects the active candle envelope from narrower same-time server updates', () => {
    const quoteTickStart = source.indexOf('const aggregationUpdates = candleAggregationService.processTick');
    const quoteTickEnd = source.indexOf('const applyServerCandle =', quoteTickStart);
    const quoteTickPath = source.slice(quoteTickStart, quoteTickEnd);
    const serverCandleStart = source.indexOf('const applyServerCandle =');
    const serverCandleEnd = source.indexOf('const streamTimeframe:', serverCandleStart);
    const serverCandle = source.slice(serverCandleStart, serverCandleEnd);
    const snapshotStart = source.indexOf('onSnapshot: (snapshot) => {', serverCandleEnd);
    const snapshotEnd = source.indexOf('onCandle: (candle) =>', snapshotStart);
    const snapshot = source.slice(snapshotStart, snapshotEnd);

    expect(quoteTickStart).toBeGreaterThan(-1);
    expect(quoteTickEnd).toBeGreaterThan(quoteTickStart);
    expect(
      quoteTickPath.match(
        /currentCandleRef\.current = mergeFormingCandleEnvelope\(\s*currentCandleRef\.current,\s*derivedCurrentCandle,\s*\)/g,
      ),
    ).toHaveLength(2);
    expect(quoteTickPath).not.toContain('currentCandleRef.current = derivedCurrentCandle;');
    expect(serverCandle).toContain(
      'currentCandleRef.current = mergeFormingCandleEnvelope(currentCandleRef.current, c)',
    );
    const canonicalAssignment = serverCandle.indexOf(
      'c = resolveCanonicalServerCandle(currentCandleRef.current, c)',
    );
    const explicitFinalBranch = serverCandle.indexOf('if (c.closed === true)');
    expect(canonicalAssignment).toBeGreaterThan(-1);
    expect(explicitFinalBranch).toBeGreaterThan(canonicalAssignment);
    expect(serverCandle).toContain('[c]');
    expect(snapshot).toContain('const activeFormingCandle = currentCandleRef.current');
    expect(snapshot).toContain('resolveCanonicalServerCandle(activeFormingCandle, snapshotCandle)');
    expect(snapshot).toContain('mergeAuthoritativeCandleHistory(candlesRef.current, protectedSnapshot');
    expect(snapshot).toContain('formingLiveCandle: activeFormingCandle');
    expect(snapshot).toContain('hasNewerLiveMutation: hasNewerLiveSnapshotMutation');
  });

  it.each(['pointerup', 'pointercancel'])('ends and cleans up window-captured %s gestures', (eventName) => {
    expect(source).toContain(`window.addEventListener('${eventName}', handlePointerInteractionEnd, true)`);
    expect(source).toContain(`window.removeEventListener('${eventName}', handlePointerInteractionEnd, true)`);
  });

  it.each(['touchend', 'touchcancel'])('ends and cleans up window-captured %s fallbacks', (eventName) => {
    expect(source).toContain(`window.addEventListener('${eventName}', handleTouchInteractionEnd, true)`);
    expect(source).toContain(`window.removeEventListener('${eventName}', handleTouchInteractionEnd, true)`);
  });

  it('matches the live price line and badge to the forming candle direction', () => {
    const directionStart = livePriceOverlaySource.indexOf('const getLivePriceDirectionalColor = useCallback');
    const directionEnd = livePriceOverlaySource.indexOf('const applyLivePriceHorizontalGeometry = useCallback', directionStart);
    const direction = livePriceOverlaySource.slice(directionStart, directionEnd);
    const paintStart = livePriceOverlaySource.indexOf('const paintLivePriceOverlay = useCallback');
    const paintEnd = livePriceOverlaySource.indexOf('const repaintLivePriceOverlayFromCurrentPrice = useCallback', paintStart);
    const paint = livePriceOverlaySource.slice(paintStart, paintEnd);
    const themeSyncStart = source.indexOf('useEffect(() => {\n    livePriceColorPaletteRef.current = chartColors;');
    const themeSyncEnd = source.indexOf('useEffect(() => {\n    chartThemeRef.current = chartTheme;', themeSyncStart);
    const themeSync = source.slice(themeSyncStart, themeSyncEnd);

    expect(directionStart).toBeGreaterThan(-1);
    expect(directionEnd).toBeGreaterThan(directionStart);
    expect(direction).toContain('const fallback = lastLivePriceDirectionalColorRef.current');
    expect(direction).toContain('const color = getLivePriceSeriesColor(');
    expect(direction).toContain("close >= currentCandle.open ? 'up' : 'down'");
    expect(direction).toContain('lastLivePriceDirectionalColorRef.current = color;');
    expect(paintStart).toBeGreaterThan(-1);
    expect(paintEnd).toBeGreaterThan(paintStart);
    expect(paint).toContain('const overlayColors = getLivePriceOverlayColors(');
    expect(paint).toContain('getLivePriceDirectionalColor(activeCandleTime, directionClose),');
    expect(paint).toContain('line.style.borderTopColor = overlayColors.lineColor;');
    expect(paint).toContain('badge.style.background = overlayColors.badgeBackground;');
    expect(paint).toContain('badge.style.color = overlayColors.badgeTextColor;');
    expect(paint).not.toContain('lineColor: chartSettingsRef.current.colors.bidPriceLine');
    expect(themeSyncStart).toBeGreaterThan(-1);
    expect(themeSyncEnd).toBeGreaterThan(themeSyncStart);
    expect(themeSync).toContain('getLivePriceOverlayColors(chartColors, getLivePriceDirectionalColor(), useEnterpriseLightChartPalette)');
    expect(themeSync).toContain('livePriceLineRef.current.style.borderTopColor = overlayColors.lineColor;');
    expect(themeSync).toContain('livePriceBadgeRef.current.style.background = overlayColors.badgeBackground;');
    expect(themeSync).toContain('livePriceBadgeRef.current.style.color = overlayColors.badgeTextColor;');
    expect(themeSync).not.toContain('lineColor: chartSettingsRef.current.colors.bidPriceLine');
  });

  it('keeps the live price badge synchronized to the complete current price scale', () => {
    const geometrySyncStart = livePriceOverlaySource.indexOf('const applyLivePriceHorizontalGeometry = useCallback');
    const paintStart = livePriceOverlaySource.indexOf('const paintLivePriceOverlay = useCallback');
    const geometrySync = livePriceOverlaySource.slice(geometrySyncStart, paintStart);
    const paintEnd = livePriceOverlaySource.indexOf('const repaintLivePriceOverlayFromCurrentPrice = useCallback', paintStart);
    const paint = livePriceOverlaySource.slice(paintStart, paintEnd);
    const geometryStart = source.indexOf('const repaintLivePriceOverlayGeometry = () => {');
    const geometryEnd = source.indexOf('const queuePriceBoundOverlayGeometryRepaint = () => {', geometryStart);
    const geometry = source.slice(geometryStart, geometryEnd);
    const markupStart = source.indexOf('ref={livePriceLineRef}');
    const markupEnd = source.indexOf('ref={livePriceBadgeRef}', markupStart);
    const markup = source.slice(markupStart, markupEnd);
    const relayoutStart = source.indexOf('chartSettingsRef.current.showBidPriceLine', source.indexOf('const updateLabelPositions = useCallback'));
    const relayoutEnd = source.indexOf('repaintTradeOverlayGeometryRef.current =', relayoutStart);
    const relayout = source.slice(relayoutStart, relayoutEnd);

    expect(geometrySyncStart).toBeGreaterThan(-1);
    expect(geometrySync).toContain('const resolvedWidth = resolveLivePriceScaleWidth(');
    expect(geometrySync).toContain('measuredScaleWidth,');
    expect(geometrySync).toContain('livePriceScaleWidthRef.current,');
    expect(geometrySync).toContain('livePriceScaleWidthRef.current = resolvedWidth;');
    expect(geometrySync).toContain('if (line && line.style.right !== right) line.style.right = right;');
    expect(geometrySync).toContain('if (badge && badge.style.width !== right) badge.style.width = right;');
    expect(geometrySync).not.toContain('livePriceScaleWidthRef.current ?? measuredWidth');
    expect(paintStart).toBeGreaterThan(-1);
    expect(paintEnd).toBeGreaterThan(paintStart);
    expect(paint).toContain('line.style.top = `${y}px`;');
    expect(paint).toContain('applyLivePriceHorizontalGeometry(priceScaleWidth);');
    expect(paint).not.toMatch(/line\.style\.(?:left|right|width)\s*=/);
    expect(geometryStart).toBeGreaterThan(-1);
    expect(geometryEnd).toBeGreaterThan(geometryStart);
    expect(geometry).toContain('applyLivePriceHorizontalGeometry(scaleWidth);');
    expect(geometry).not.toMatch(/line\.style\.(?:left|right|width)\s*=/);
    expect(source).toContain('chart.timeScale().subscribeSizeChange(handleTimeScaleSizeChange);');
    expect(source).toContain('chart.timeScale().unsubscribeSizeChange(handleTimeScaleSizeChange);');
    expect(markupStart).toBeGreaterThan(-1);
    expect(markupEnd).toBeGreaterThan(markupStart);
    expect(markup).toContain('right: LIVE_PRICE_SCALE_WIDTH_FALLBACK_PX');
    expect(markup).toContain('borderTop: `0.5px solid ${initialLivePriceOverlayColors.lineColor}`');
    expect(relayoutStart).toBeGreaterThan(-1);
    expect(relayoutEnd).toBeGreaterThan(relayoutStart);
    expect(relayout).toContain('applyLivePriceHorizontalGeometry(priceScaleWidth);');
    expect(relayout).not.toMatch(/livePriceLineRef\.current\.style\.(?:left|right|width)\s*=/);
    expect(source).not.toMatch(/livePriceLineRef\.current\.style\.(?:left|right|width)\s*=/);
  });

  it('repaints cached live-price and trade geometry during held plot and price-scale drags', () => {
    const dragStart = source.indexOf('let heldChartPointerId: number | null = null;');
    const dragEnd = source.indexOf('const handleLostPointerCapture =', dragStart);
    const drag = source.slice(dragStart, dragEnd);
    const heldMoveStart = drag.indexOf('const handleHeldChartPointerMove = (event: PointerEvent) => {');
    const heldMoveEnd = drag.indexOf('const handlePointerInteractionEnd =', heldMoveStart);
    const heldMove = drag.slice(heldMoveStart, heldMoveEnd);

    expect(dragStart).toBeGreaterThan(-1);
    expect(dragEnd).toBeGreaterThan(dragStart);
    expect(drag).toContain("chart.priceScale('right').width()");
    expect(drag).toContain('chart.timeScale().height()');
    expect(drag).toContain('event.clientX >= axisLeft');
    expect(drag).toContain('window.requestAnimationFrame(');
    expect(drag).toContain('series.priceToCoordinate(livePrice)');
    expect(drag).toContain('line.style.top');
    expect(drag).toContain('badge.style.top');
    expect(drag).toContain('repaintTradeOverlayGeometryRef.current();');
    expect(drag).toContain('queuePriceBoundOverlayGeometryRepaint()');
    expect(drag).toContain('rightPriceScalePointerId !== event.pointerId');
    expect(drag).toContain('heldChartPointerId = event.pointerId;');
    expect(drag).toContain('heldChartPointerId = null;');
    expect(drag).toContain('rightPriceScalePointerId = null;');
    expect(drag).not.toContain('currentCandleRef.current');
    expect(drag).not.toContain('renderTradeOverlay');
    expect(drag).not.toContain('repaintLivePriceOverlayFromCurrentPrice');
    expect(drag).not.toContain('flushPostInteractionWork');
    expect(tradeRuntimeSource).toContain('const repaintTradeOverlayGeometry = () => updateLabelPositions(false);');
    expect(tradeRuntimeSource).toContain('repaintTradeOverlayGeometryRef.current = repaintTradeOverlayGeometry;');
    expect(source).toContain('if (refreshMetrics) {');

    expect(heldMoveStart).toBeGreaterThan(-1);
    expect(heldMoveEnd).toBeGreaterThan(heldMoveStart);
    expect(heldMove).toContain('if (isDisposedRef.current || !isActiveRef.current) return;');
    expect(heldMove).toContain('if (heldChartPointerId !== event.pointerId || (event.buttons & 1) === 0) return;');
    expect(heldMove.indexOf('handleRightPriceScalePointerMove(event);')).toBeGreaterThan(-1);
    expect(heldMove.indexOf('queuePriceBoundOverlayGeometryRepaint();')).toBeGreaterThan(
      heldMove.indexOf('handleRightPriceScalePointerMove(event);'),
    );

    expect(source).toContain("window.addEventListener('pointermove', handleHeldChartPointerMove, { passive: true })");
    expect(source).toContain("window.removeEventListener('pointermove', handleHeldChartPointerMove)");
    expect(source).toContain("window.addEventListener('blur', forceSettleLocalPointerInteraction)");
    expect(source).toContain("window.removeEventListener('blur', forceSettleLocalPointerInteraction)");
    expect(source).toContain('clearLocalChartPointerStateRef.current();');
    expect(source).toContain('clearLocalChartPointerStateRef.current = clearLocalChartPointerState;');
    expect(source).toContain('const forceSettleLocalPointerInteraction = () => {');
    expect(source).toContain('window.cancelAnimationFrame(priceBoundOverlayGeometryRepaintFrame)');
  });

  it('smooths plot wheels without overriding the price range, native axes, or touch gestures', () => {
    const startStart = source.indexOf('const handleWheelInteractionStart =');
    const startEnd = source.indexOf('const repaintLivePriceOverlayGeometry =', startStart);
    const start = source.slice(startStart, startEnd);
    const wheelStart = source.indexOf('const handleWheelInteraction = (event: WheelEvent) => {');
    const wheelEnd = source.indexOf('const clearLocalChartPointerState =', wheelStart);
    const wheel = source.slice(wheelStart, wheelEnd);

    expect(startStart).toBeGreaterThan(-1);
    expect(startEnd).toBeGreaterThan(startStart);
    expect(start).toContain('!event.cancelable || !isChartPaneWheel(event)');
    expect(start).toContain('wheelSmoothing.handleWheel(event, event.clientX - rect.left)');
    expect(start).toContain('target.closest(');
    expect(start).toContain('event.preventDefault();');
    expect(start).toContain('event.stopPropagation();');
    expect(source).toContain('const wheelSmoothing = createChartWheelSmoothing({');
    expect(source).toContain('visibleRangeHistoryUserInitiatedRef.current = true;');
    expect(source).toContain('interactionOwnership.noteWheelActivity();');
    expect(source).toContain('onFrame: queuePriceBoundOverlayGeometryRepaint');
    expect(source).toContain('wheelSmoothing.cancel();');
    expect(source).toContain('wheelSmoothing.dispose();');
    expect(wheelStart).toBeGreaterThan(-1);
    expect(wheelEnd).toBeGreaterThan(wheelStart);
    expect(wheel).toContain('if (!isChartPaneWheel(event)) return;');
    expect(wheel).toContain('queuePriceBoundOverlayGeometryRepaint()');
    // A wheel must not force autoscale off or resize the manually chosen Y range.
    // Repainting also runs for deltaX, so horizontal trackpad pans keep labels aligned.
    for (const handler of [start, wheel]) {
      expect(handler).not.toContain('setVisibleRange');
      expect(handler).not.toContain('applyOptions');
      expect(handler).not.toContain('autoScale');
      expect(handler).not.toContain('barSpacing');
      expect(handler).not.toContain('deltaY === 0');
      expect(handler).not.toContain('isDesktopBackendTarget');
    }

    expect(source).not.toContain('wheelTimeScaleBarSpacingBefore');
    expect(source).not.toContain('captureChartWheelTimeScaleState');
    expect(source).toContain("chartContainer.addEventListener('wheel', handleWheelInteractionStart, { passive: false, capture: true })");
    expect(source).toContain("chartContainer.addEventListener('wheel', handleWheelInteraction, { passive: true })");
    expect(source).toContain("chartContainer.removeEventListener('wheel', handleWheelInteractionStart, true)");
    expect(source).toContain("chartContainer.removeEventListener('wheel', handleWheelInteraction)");
  });

  it('preserves the right-axis label-density zoom floor without applying it to plot wheels', () => {
    const floorStart = source.indexOf('const getMinimumVisiblePriceSpan = (): number => {');
    const floorEnd = source.indexOf('const isRightPriceScalePointer =', floorStart);
    const floor = source.slice(floorStart, floorEnd);
    const axisStart = source.indexOf('const handleRightPriceScalePointerMove =');
    const axisEnd = source.indexOf('const handleHeldChartPointerMove =', axisStart);
    const axis = source.slice(axisStart, axisEnd);
    const wheelStart = source.indexOf('const handleWheelInteraction = (event: WheelEvent) => {');
    const wheelEnd = source.indexOf('const clearLocalChartPointerState =', wheelStart);
    const wheel = source.slice(wheelStart, wheelEnd);

    expect(floorStart).toBeGreaterThan(-1);
    expect(floorEnd).toBeGreaterThan(floorStart);
    expect(floor).toContain('seriesRef.current?.options().priceFormat');
    expect(floor).toContain("chart.priceScale('right').options().scaleMargins");
    expect(floor).toContain('chart.timeScale().height()');
    expect(floor).toContain('computeMinimumVisiblePriceSpan({');
    expect(source).toContain('minSpan: getMinimumVisiblePriceSpan()');
    expect(axis).toContain('...rightPriceScaleDragGeometry,');
    expect(axis).toContain("chart.priceScale('right').setVisibleRange(nextRange)");
    expect(wheel).not.toContain('getMinimumVisiblePriceSpan');
    expect(wheel).not.toContain('setVisibleRange');
  });

  it('keeps held-pointer ownership authoritative across sparse range events', () => {
    expect(source).toContain("chartContainer.addEventListener('pointerdown', handlePointerInteractionStart, true)");
    expect(source).toContain("chartContainer.addEventListener('pointerleave', interactionOwnership.notePointerLeave)");
    expect(source).toContain('interactionOwnership.noteRangeActivity();');
    expect(source).toContain('interactionOwnership.dispose();');
    expect(source).not.toContain("chartContainer.addEventListener('pointerleave', handleInteractionEnd)");
  });

  it('force-settles missed releases and clears stale post-interaction work', () => {
    const settleStart = source.indexOf('const forceSettleInteraction = useCallback(() => {');
    const settleEnd = source.indexOf('}, []);', settleStart);
    const settle = source.slice(settleStart, settleEnd);

    expect(settleStart).toBeGreaterThan(-1);
    expect(settle).toContain('isChartUserInteractingRef.current = false;');
    expect(settle).toContain('chartInteractionOwnershipRef.current?.forceSettle();');
    expect(settle).toContain('isChartInteractionActiveRef.current = false;');
    expect(settle).toContain('settleAutoScrollPolicyRef.current();');
    expect(source.match(/\.forceSettle\(\)/g)).toHaveLength(1);
    expect(source).toContain("window.addEventListener('blur', forceSettleLocalPointerInteraction)");
    expect(source).toContain("window.removeEventListener('blur', forceSettleLocalPointerInteraction)");
    expect(source).toContain("document.addEventListener('visibilitychange', handleDocumentVisibilityChange)");
    expect(source).toContain("document.removeEventListener('visibilitychange', handleDocumentVisibilityChange)");
    expect(source).toContain('if (!isActive) {\n      clearLocalChartPointerStateRef.current();\n      forceSettleInteraction();');
    expect(source).toContain("|| document.visibilityState === 'hidden'");
    expect(source).toContain('settleAutoScrollPolicyRef.current = resetAutoScrollTimer;');
    expect(source).toContain('postInteractionCoordinatorRef.current?.clear();');
  });

  it('routes settled chart, live, separator, and overlay work through one coordinator', () => {
    expect(source).toContain('createChartPostInteractionCoordinator({');
    expect(source).toContain('postInteractionCallbacksRef.current.paintModel = () => flushQueuedChartRender(true)');
    expect(source).toContain('postInteractionCallbacksRef.current.paintSeparators = renderPeriodSeparators');
    expect(source).toContain('callbacks.layoutOverlay = layoutPostInteractionOverlays');
    expect(source).toContain('postInteractionCoordinatorRef.current?.request({ model: true })');
    expect(source).toContain('postInteractionCoordinatorRef.current?.request({ live: true })');
    expect(source).toContain('postInteractionCoordinatorRef.current?.request({ separators: true })');
    expect(source).toContain('postInteractionCoordinatorRef.current?.request({ overlay: true })');
    expect(source).not.toContain('CHART_INTERACTION_IDLE_EVENT');
  });

  it('does no drawing-preview work for cursor-mode crosshair moves', () => {
    const drawingSetupStart = source.indexOf('let isDrawingContinuous = false;');
    const handlerStart = source.indexOf('const crosshairHandler = (param: ChartMouseParam) => {', drawingSetupStart);
    const handlerEnd = source.indexOf('chart.subscribeCrosshairMove(crosshairHandler);', handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);

    expect(drawingSetupStart).toBeGreaterThan(-1);
    expect(handlerStart).toBeGreaterThan(drawingSetupStart);
    expect(handlerEnd).toBeGreaterThan(handlerStart);

    const earlyReturn = handler.indexOf('if (!needsDrawingPreview) return;');
    expect(earlyReturn).toBeGreaterThan(-1);
    expect(handler).toContain('activeDrawing');
    expect(handler).toContain('activeToolRef.current');
    expect(handler).toContain('isDrawingContinuous');
    expect(earlyReturn).toBeLessThan(handler.indexOf("querySelectorAll('canvas')"));
    expect(earlyReturn).toBeLessThan(handler.indexOf('coordinateToLogical('));
    expect(earlyReturn).toBeLessThan(handler.indexOf('coordinateToPrice('));
    expect(earlyReturn).toBeLessThan(handler.indexOf('bindDrawingManagerToChart()'));
    expect(handler).toContain('drawingManager.updatePreviewPointWithLogical(');
    expect(handler).toContain('drawingManager.updatePreviewPoint(');
    expect(handler).toContain('drawingManager.addPoint(');
  });

  it('keeps the arrow cursor while drawing, matching TradingView arrow mode', () => {
    const selectToolStart = drawingCommandsSource.indexOf("commandBus.subscribe('SELECT_TOOL'");
    const selectToolEnd = drawingCommandsSource.indexOf('\n\n    return () => {', selectToolStart);
    const selectToolSource = drawingCommandsSource.slice(selectToolStart, selectToolEnd);
    const drawingModeStart = selectToolSource.indexOf('// Drawing mode:');
    const drawingModeSource = selectToolSource.slice(drawingModeStart);

    expect(selectToolStart).toBeGreaterThan(-1);
    expect(selectToolEnd).toBeGreaterThan(selectToolStart);
    expect(drawingModeStart).toBeGreaterThan(-1);
    expect(drawingModeSource).toContain('vertLine: { visible: false, labelVisible: false }');
    expect(drawingModeSource).toContain('horzLine: { visible: false, labelVisible: false }');
    expect(drawingModeSource).toContain("containerRef.current.style.cursor = 'default'");
    expect(drawingModeSource).toContain("wrapper.setAttribute('data-cursor', 'select')");
    expect(drawingModeSource).not.toContain("containerRef.current.style.cursor = 'crosshair'");
    expect(drawingModeSource).not.toContain("wrapper.setAttribute('data-cursor', 'draw')");
  });

  it('does not relayout the main trade overlay for crosshair-only movement', () => {
    const overlayStart = tradeRuntimeSource.indexOf('const queueTradeOverlayRelayout =');
    const overlayEnd = tradeRuntimeSource.indexOf('const normalizeUnixSeconds =', overlayStart);
    const overlayRelayout = tradeRuntimeSource.slice(overlayStart, overlayEnd);

    expect(overlayStart).toBeGreaterThan(-1);
    expect(overlayEnd).toBeGreaterThan(overlayStart);
    expect(overlayRelayout).not.toContain('subscribeCrosshairMove(');
    expect(overlayRelayout).not.toContain('unsubscribeCrosshairMove(');
    expect(tradeSubscriptionsSource).toContain('subscribeVisibleLogicalRangeChange(timeScaleHandler)');
    expect(tradeSubscriptionsSource).toContain('useAppStore.subscribe(');
    expect(tradeSubscriptionsSource).toContain('currentTick !== previousTick');
    expect(tradeSubscriptionsSource).toContain('isActiveRef.current');
    expect(tradeSubscriptionsSource).toContain('queueTradeOverlayRelayout()');
  });

  it('does not retain the unreachable legacy position-label overlay', () => {
    expect(source).not.toContain('// Subscribe to positions from the store and render price lines');
    expect(source).not.toContain('const renderPositionLines =');
    expect(source).not.toContain('const createExecutionPin =');
  });

  it('keeps captured trade drags synchronous and moves idle hover scans off the pan path', () => {
    const effectStart = source.indexOf('const interactionRoot = container.parentElement ?? container;');
    const effectEnd = source.indexOf('\n  ]);', effectStart);
    const effect = source.slice(effectStart, effectEnd);
    const hoverStart = effect.indexOf('const queueTradeHover =');
    const hoverEnd = effect.indexOf('const handlePointerDown =', hoverStart);
    const hover = effect.slice(hoverStart, hoverEnd);
    const moveStart = effect.indexOf('const handlePointerMove =');
    const moveEnd = effect.indexOf('const handlePointerUp =', moveStart);
    const move = effect.slice(moveStart, moveEnd);

    expect(effectStart).toBeGreaterThan(-1);
    expect(effectEnd).toBeGreaterThan(effectStart);
    expect(hoverStart).toBeGreaterThan(-1);
    expect(hoverEnd).toBeGreaterThan(hoverStart);
    expect(moveStart).toBeGreaterThan(-1);
    expect(moveEnd).toBeGreaterThan(moveStart);

    expect(effect).toContain('if (dragCursorActive || active === tradeHoverCursorActive) return;');
    expect(hover).toContain('window.requestAnimationFrame(');
    expect(hover.match(/container\.getBoundingClientRect\(\)/g)).toHaveLength(1);
    expect(hover).toContain('isChartInteractionActiveRef.current');
    expect(hover).toContain('findClosestTradeLevel(y, TRADE_LEVEL_HIT_AREA_PX / 2)');
    expect(move.indexOf('if (dragState)')).toBeLessThan(move.indexOf('if (isChartInteractionActiveRef.current)'));
    expect(move.indexOf('if (isChartInteractionActiveRef.current)')).toBeLessThan(move.indexOf('queueTradeHover(e)'));
    expect(move).not.toContain('findClosestTradeLevel(');
    expect(effect).toContain('cancelQueuedTradeHover();');
  });

  it('deduplicates an exact raw quote before price compatibility validation', () => {
    const tickLoopStart = source.indexOf('const interval = setInterval(() => {');
    const tickLoopEnd = source.indexOf('}, LIVE_CHART_UPDATE_INTERVAL_MS);', tickLoopStart);
    const tickLoop = source.slice(tickLoopStart, tickLoopEnd);
    const timestampIndex = tickLoop.indexOf('const rawTickTimestamp = Number(tick.sourceTimestamp ?? tick.timestamp);');
    // The key uses the raw feed sides (not the spread-markup widened quote).
    const keyIndex = tickLoop.indexOf('const tickKey = `${rawTickTimestamp}:${candleQuote.bid}:${candleQuote.ask ?? candleQuote.bid}:${price}`;');
    const reconciliationIndex = tickLoop.indexOf('validateRenderedCandlesAgainstLivePrice(price, activeTf)');

    expect(timestampIndex).toBeGreaterThan(-1);
    expect(keyIndex).toBeGreaterThan(timestampIndex);
    expect(reconciliationIndex).toBeGreaterThan(keyIndex);
    expect(tickLoop).toContain('if (tickKey === lastTickKey) return;');
    expect(tickLoop).toContain('let ts = rawTickTimestamp;');
    expect(tickLoop).not.toContain('price.toFixed(5)');
  });

  it('coalesces legend writes to the latest frame and skips identical strings', () => {
    const legendStart = source.indexOf('const updateLegendDOM = useCallback');
    const legendEnd = source.indexOf("type LoadingPhase =", legendStart);
    const legend = source.slice(legendStart, legendEnd);

    expect(legend).toContain('pendingLegendRenderRef.current = pending;');
    expect(legend).toContain('window.requestAnimationFrame(flushLegendDOM)');
    expect(legend).toContain('renderedLegendSignatureRef.current === next.signature');
    expect(legend).toContain('window.cancelAnimationFrame(legendRenderFrameRef.current)');
    expect(legend).toContain('renderedLegendSignatureRef.current = next.signature;');
  });

  it('forces an autoSize-safe repaint after a Theme change without rebuilding chart data', () => {
    const layoutRefreshStart = source.indexOf('const refreshVisibleChartLayout = useCallback');
    const layoutRefreshEnd = source.indexOf('const resetLiveQuotePriceGuard', layoutRefreshStart);
    const layoutRefresh = source.slice(layoutRefreshStart, layoutRefreshEnd);
    const transitionStart = source.indexOf('if (previousAdvancedUntitledLightRef.current === isAdvancedUntitledLight) return;');
    const transitionEnd = source.indexOf('// getTimeframeSeconds is imported', transitionStart);
    const transition = source.slice(transitionStart, transitionEnd);

    expect(layoutRefreshStart).toBeGreaterThan(-1);
    expect(layoutRefresh).toContain('refreshLightweightChartSurface(chart, offsetWidth, offsetHeight)');
    expect(layoutRefresh).not.toContain('chart.applyOptions({ width: offsetWidth, height: offsetHeight })');
    expect(transitionStart).toBeGreaterThan(-1);
    expect(transition).toContain('scheduleChartThemeTransition({');
    expect(transition).toContain('refreshVisibleChartLayout();');
    expect(transition).not.toContain('removeSeries(');
    expect(transition).not.toContain('setData([])');
  });
});

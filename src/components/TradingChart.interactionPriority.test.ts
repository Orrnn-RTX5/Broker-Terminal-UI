import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Normalize CRLF so the multi-line anchors keep matching on Windows checkouts
// (core.autocrlf=true materializes the working tree with \r\n).
const source = readFileSync(
  resolve(process.cwd(), 'src/components/TradingChart.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('TradingChart interaction-priority contract', () => {
  it('keeps tick ingestion running while chart painting is deferred', () => {
    const tickLoopStart = source.indexOf('const interval = setInterval(() => {');
    const tickLoopEnd = source.indexOf('}, LIVE_CHART_UPDATE_INTERVAL_MS);', tickLoopStart);
    const tickLoop = source.slice(tickLoopStart, tickLoopEnd);

    expect(tickLoopStart).toBeGreaterThan(-1);
    expect(tickLoopEnd).toBeGreaterThan(tickLoopStart);
    expect(tickLoop).toContain('Model ingestion must never pause for a pan');
    expect(tickLoop).not.toMatch(/if\s*\([^)]*isChartInteractionActiveRef\.current[^)]*\)\s*return/);
    expect(tickLoop).not.toMatch(/if\s*\([^)]*!isActiveRef\.current[^)]*\)\s*return/);
    expect(tickLoop).toContain('currentCandleRef.current.high = Math.max');
    expect(tickLoop).toContain('currentCandleRef.current.low = Math.min');
    expect(tickLoop).toContain('currentCandleRef.current.tickVolume =');
    expect(tickLoop).toContain("window.dispatchEvent(new Event('rtx:force-refresh-positions'))");
    expect(tickLoop).toContain('candleAggregationService.processTick');
    expect(tickLoop).toContain('repaintLivePriceOverlayOrDefer(currentCandleRef.current)');
  });

  it('releases hidden-tab runtime and restores only visible chart work', () => {
    const liveEffectStart = source.indexOf('// ─── Live tick subscription + candle rollover');
    const liveEffectEnd = source.indexOf('// ── Candle Countdown Timer', liveEffectStart);
    const liveEffect = source.slice(liveEffectStart, liveEffectEnd);
    const countdownEnd = source.indexOf('// The primary tick aggregation interval', liveEffectEnd);
    const countdownEffect = source.slice(liveEffectEnd, countdownEnd);

    expect(liveEffect).toContain('useActiveChartRuntimeEffect(visibleRuntime.candle');
    expect(liveEffect).toContain('if (!isActive || !symbol) return;');
    expect(liveEffect).toContain('chartDataService.subscribeCandles({');
    expect(liveEffect).toContain('clearInterval(interval);');
    expect(liveEffect).toContain('candleStream.close();');
    expect(liveEffect).toContain('[symbol, activeTimeframe, authToken, brokerAccountSessionScope, markCandlesReady]');
    expect(countdownEffect).toContain('useActiveChartRuntimeEffect(visibleRuntime.interval');
    expect(countdownEffect).toContain('if (!isActive || !symbol) return;');
    expect(countdownEffect).toContain('updateCountdown();');
    expect(countdownEffect).toContain("countdownTextRef.current.textContent = '';");
    expect(countdownEffect).toContain('[symbol, timeframe]');
    expect(source).toContain('enabled: visibleRuntime.history');
    expect(source).toContain('scopeRevision: brokerAccountSessionScope');
    expect(source).toContain('enabled: visibleRuntime.status');
    expect(source).toContain('useQuoteSubscription(symbol ? [symbol] : [], chartQuoteSourceId, { enabled: visibleRuntime.quote })');
    expect(source).toContain('enabled: isActive && crosshairEnabled');
    expect(source).not.toContain("commandBus.subscribe('TOGGLE_CROSSHAIR'");
  });

  it('owns loading and trade-overlay subscriptions only while active', () => {
    const loadingStart = source.indexOf('// Fade the loading overlay out after candles arrive.');
    const loadingEnd = source.indexOf('// Load more historical data', loadingStart);
    const loadingEffects = source.slice(loadingStart, loadingEnd);
    const overlayStart = source.indexOf('useActiveChartRuntimeEffect(visibleRuntime.overlay, () => {', source.indexOf('// ─── Trade Annotations on Chart'));
    const overlayEnd = source.indexOf('}, [brokerTimeOffsetSec,', overlayStart);
    const overlayEffect = source.slice(overlayStart, overlayEnd);

    expect(loadingEffects.match(/useActiveChartRuntimeEffect\(visibleRuntime\.interval/g)).toHaveLength(2);
    expect(loadingEffects).toContain('window.clearTimeout(timer)');
    expect(loadingEffects).toContain('window.clearInterval(interval)');
    expect(overlayStart).toBeGreaterThan(-1);
    expect(overlayEnd).toBeGreaterThan(overlayStart);
    expect(overlayEffect).toContain('subscribeVisibleLogicalRangeChange(timeScaleHandler)');
    expect(overlayEffect).toContain('useAppStore.subscribe(');
    expect(overlayEffect).toContain('useChartSettingsStore.subscribe(');
    expect(overlayEffect).toContain("window.addEventListener('rtx:force-refresh-positions'");
    expect(overlayEffect).toContain('clearTradeOverlayVisualRuntime();');
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
    const markReady = flush.indexOf('markCandlesReady();', finishLoading);
    const requestStart = source.indexOf('const requestChartDataRender = useCallback');
    const requestEnd = source.indexOf('const consumeDeferredVisibleRangeHistory = useCallback', requestStart);
    const request = source.slice(requestStart, requestEnd);

    expect(flushStart).toBeGreaterThan(-1);
    expect(flushEnd).toBeGreaterThan(flushStart);
    expect(setData).toBeGreaterThan(-1);
    expect(finishLoading).toBeGreaterThan(setData);
    expect(markReady).toBeGreaterThan(finishLoading);
    expect(flush).toContain('markCandlesReady, rememberVisibleLogicalRange');
    expect(source).toContain('finishLoadingAfterRender?: boolean;');
    expect(request).toContain('finishLoadingAfterRender: request.finishLoadingAfterRender === true || existing?.finishLoadingAfterRender === true');

    const cacheStart = source.indexOf('const hydrateHistoryFromCache = useCallback');
    const cacheEnd = source.indexOf('const restoreProtectedDisplayedHistory = useCallback', cacheStart);
    const restoreEnd = source.indexOf('const fetchOlderHistoryPage = useCallback', cacheEnd);
    const initialStart = source.indexOf('// Update chart - live data');
    const initialEnd = source.indexOf('} catch (err: unknown)', initialStart);
    const snapshotStart = source.indexOf('onSnapshot: (snapshot) => {');
    const snapshotEnd = source.indexOf('onCandle: (candle) =>', snapshotStart);
    const resetStart = source.indexOf('const renderResetCandles = (candles: Candle[], reason: string): boolean => {');
    const resetEnd = source.indexOf('if (activeSymbol) {', resetStart);
    const loaderOwnedSections = [
      source.slice(cacheStart, cacheEnd),
      source.slice(cacheEnd, restoreEnd),
      source.slice(initialStart, initialEnd),
      source.slice(snapshotStart, snapshotEnd),
      source.slice(resetStart, resetEnd),
    ];

    for (const section of loaderOwnedSections) {
      expect(section).toContain('finishLoadingAfterRender: true');
      expect(section).not.toContain("setLoadingPhase('ready')");
      expect(section).not.toContain("setLoadingPhase('hidden')");
    }
    expect(source.slice(snapshotStart, snapshotEnd)).toContain('immediate: true');
    expect(source).not.toContain("setLoadingPhase('ready')");
  });

  it('defers server-candle and snapshot overlay paints through the interaction policy', () => {
    const helperStart = source.indexOf('const repaintLivePriceOverlayOrDefer =');
    const helperEnd = source.indexOf('const refreshMarketGapSeriesForCandle =', helperStart);
    const helper = source.slice(helperStart, helperEnd);
    const serverCandleStart = source.indexOf('const applyServerCandle =');
    const serverCandleEnd = source.indexOf('const streamTimeframe =', serverCandleStart);
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
    expect(serverCandle.match(/repaintLivePriceOverlayOrDefer\(/g)).toHaveLength(3);
    expect(serverCandle).not.toContain('repaintLivePriceOverlayFromCurrentPrice(');
    expect(snapshotStart).toBeGreaterThan(-1);
    expect(snapshotEnd).toBeGreaterThan(snapshotStart);
    expect(snapshot).toContain('repaintLivePriceOverlayOrDefer(currentCandleRef.current)');
    expect(snapshot).not.toContain('repaintLivePriceOverlayFromCurrentPrice(');
  });

  it.each(['pointerup', 'pointercancel'])('ends and cleans up window-captured %s gestures', (eventName) => {
    expect(source).toContain(`window.addEventListener('${eventName}', handlePointerInteractionEnd, true)`);
    expect(source).toContain(`window.removeEventListener('${eventName}', handlePointerInteractionEnd, true)`);
  });

  it.each(['touchend', 'touchcancel'])('ends and cleans up window-captured %s fallbacks', (eventName) => {
    expect(source).toContain(`window.addEventListener('${eventName}', handleTouchInteractionEnd, true)`);
    expect(source).toContain(`window.removeEventListener('${eventName}', handleTouchInteractionEnd, true)`);
  });

  it('keeps live price horizontal geometry stable while candle ticks repaint it', () => {
    const stableGeometryStart = source.indexOf('const applyStableLivePriceHorizontalGeometry = useCallback');
    const paintStart = source.indexOf('const paintLivePriceOverlay = useCallback');
    const stableGeometry = source.slice(stableGeometryStart, paintStart);
    const paintEnd = source.indexOf('const repaintLivePriceOverlayFromCurrentPrice = useCallback', paintStart);
    const paint = source.slice(paintStart, paintEnd);
    const geometryStart = source.indexOf('const repaintLivePriceOverlayGeometry = () => {');
    const geometryEnd = source.indexOf('const queuePriceBoundOverlayGeometryRepaint = () => {', geometryStart);
    const geometry = source.slice(geometryStart, geometryEnd);
    const markupStart = source.indexOf('ref={livePriceLineRef}');
    const markupEnd = source.indexOf('ref={livePriceBadgeRef}', markupStart);
    const markup = source.slice(markupStart, markupEnd);
    const relayoutStart = source.indexOf('if (livePriceRef.current !== null', source.indexOf('const updateLabelPositions = useCallback'));
    const relayoutEnd = source.indexOf('}, [applyStableLivePriceHorizontalGeometry]);', relayoutStart);
    const relayout = source.slice(relayoutStart, relayoutEnd);

    expect(stableGeometryStart).toBeGreaterThan(-1);
    expect(stableGeometry).toContain('const stableWidth = livePriceScaleWidthRef.current ?? measuredWidth;');
    expect(stableGeometry).toContain('livePriceScaleWidthRef.current = stableWidth;');
    expect(stableGeometry).toContain('if (line && line.style.right !== right) line.style.right = right;');
    expect(stableGeometry).toContain('if (badge && badge.style.width !== right) badge.style.width = right;');
    expect(paintStart).toBeGreaterThan(-1);
    expect(paintEnd).toBeGreaterThan(paintStart);
    expect(paint).toContain('line.style.top = `${y}px`;');
    expect(paint).toContain('applyStableLivePriceHorizontalGeometry(priceScaleWidth);');
    expect(paint).not.toMatch(/line\.style\.(?:left|right|width)\s*=/);
    expect(geometryStart).toBeGreaterThan(-1);
    expect(geometryEnd).toBeGreaterThan(geometryStart);
    expect(geometry).toContain('applyStableLivePriceHorizontalGeometry(scaleWidth);');
    expect(geometry).not.toMatch(/line\.style\.(?:left|right|width)\s*=/);
    expect(markupStart).toBeGreaterThan(-1);
    expect(markupEnd).toBeGreaterThan(markupStart);
    expect(markup).toContain('right: LIVE_PRICE_SCALE_WIDTH_FALLBACK_PX');
    expect(markup).toContain('borderTop: `1px solid ${initialLivePriceOverlayColors.lineColor}`');
    expect(relayoutStart).toBeGreaterThan(-1);
    expect(relayoutEnd).toBeGreaterThan(relayoutStart);
    expect(relayout).toContain('applyStableLivePriceHorizontalGeometry(priceScaleWidth);');
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
    expect(source).toContain('repaintTradeOverlayGeometryRef.current = updateLabelPositions;');

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

  it('adds cursor-anchored price zoom to plot wheels while preserving native time zoom', () => {
    const wheelStart = source.indexOf('const handleWheelInteraction = (event: WheelEvent) => {');
    const wheelEnd = source.indexOf('const handleDocumentVisibilityChange =', wheelStart);
    const wheel = source.slice(wheelStart, wheelEnd);

    expect(wheelStart).toBeGreaterThan(-1);
    expect(wheelEnd).toBeGreaterThan(wheelStart);
    expect(wheel).toContain('chart.timeScale().options().barSpacing');
    expect(wheel).toContain('barSpacingBefore / barSpacingAfter');
    expect(wheel).toContain('priceScale.getVisibleRange()');
    expect(wheel).toContain('series.coordinateToPrice((event.clientY - rect.top) as any)');
    expect(wheel).toContain('const minimumSpan = getMinimumVisiblePriceSpan();');
    expect(wheel).toContain('anchorPrice + (from - anchorPrice) * priceSpanFactor');
    expect(wheel).toContain('priceScale.setVisibleRange({ from: nextFrom, to: nextTo })');
    expect(wheel).toContain('queuePriceBoundOverlayGeometryRepaint()');
    expect(wheel).not.toContain('preventDefault');

    expect(source).toContain('if (event.deltaY === 0 || !isChartPaneWheel(event)) return;');
    expect(source).toContain('visibleRangeHistoryUserInitiatedRef.current = true;');
    expect(source).toContain('interactionOwnership.noteWheelActivity();');
    expect(source).toContain("chartContainer.addEventListener('wheel', captureChartWheelTimeScaleState, { passive: true, capture: true })");
    expect(source).toContain("chartContainer.addEventListener('wheel', handleWheelInteraction, { passive: true })");
    expect(source).toContain("chartContainer.removeEventListener('wheel', captureChartWheelTimeScaleState, true)");
    expect(source).toContain("chartContainer.removeEventListener('wheel', handleWheelInteraction)");
  });

  it('shares the one-point label-density zoom floor between axis and plot gestures', () => {
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
    expect(axis).toContain('minSpan: getMinimumVisiblePriceSpan()');
    expect(wheel).toContain('const minimumSpan = getMinimumVisiblePriceSpan();');
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
    expect(source).toContain('postInteractionCallbacksRef.current.layoutOverlay = layoutPostInteractionOverlays');
    expect(source).toContain('postInteractionCoordinatorRef.current?.request({ model: true })');
    expect(source).toContain('postInteractionCoordinatorRef.current?.request({ live: true })');
    expect(source).toContain('postInteractionCoordinatorRef.current?.request({ separators: true })');
    expect(source).toContain('postInteractionCoordinatorRef.current?.request({ overlay: true })');
    expect(source).not.toContain('CHART_INTERACTION_IDLE_EVENT');
  });

  it('does no drawing-preview work for cursor-mode crosshair moves', () => {
    const drawingSetupStart = source.indexOf('let isDrawingFreehand = false;');
    const handlerStart = source.indexOf('const crosshairHandler = (param: any) => {', drawingSetupStart);
    const handlerEnd = source.indexOf('chart.subscribeCrosshairMove(crosshairHandler);', handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);

    expect(drawingSetupStart).toBeGreaterThan(-1);
    expect(handlerStart).toBeGreaterThan(drawingSetupStart);
    expect(handlerEnd).toBeGreaterThan(handlerStart);

    const earlyReturn = handler.indexOf('if (!needsDrawingPreview) return;');
    expect(earlyReturn).toBeGreaterThan(-1);
    expect(handler).toContain('activeDrawing');
    expect(handler).toContain('activeToolRef.current');
    expect(handler).toContain('isDrawingFreehand');
    expect(earlyReturn).toBeLessThan(handler.indexOf("querySelectorAll('canvas')"));
    expect(earlyReturn).toBeLessThan(handler.indexOf('coordinateToLogical('));
    expect(earlyReturn).toBeLessThan(handler.indexOf('coordinateToPrice('));
    expect(earlyReturn).toBeLessThan(handler.indexOf('drawingManager.setChart('));
    expect(handler).toContain('drawingManager.updatePreviewPointWithLogical(');
    expect(handler).toContain('drawingManager.updatePreviewPoint(');
    expect(handler).toContain('drawingManager.addPoint(time, price)');
  });

  it('does not relayout the main trade overlay for crosshair-only movement', () => {
    const overlayStart = source.indexOf('const queueTradeOverlayRelayout =');
    const overlayEnd = source.indexOf('}, [brokerTimeOffsetSec,', overlayStart);
    const overlayEffect = source.slice(overlayStart, overlayEnd);

    expect(overlayStart).toBeGreaterThan(-1);
    expect(overlayEnd).toBeGreaterThan(overlayStart);
    expect(overlayEffect).not.toContain('subscribeCrosshairMove(');
    expect(overlayEffect).not.toContain('unsubscribeCrosshairMove(');
    expect(overlayEffect).toContain('subscribeVisibleLogicalRangeChange(timeScaleHandler)');
    expect(overlayEffect).toContain('useAppStore.subscribe(');
    expect(overlayEffect).toContain('currentTick !== previousTick');
    expect(overlayEffect).toContain('isActiveRef.current');
    expect(overlayEffect).toContain('queueTradeOverlayRelayout()');
  });

  it('does not relayout position labels for crosshair-only movement', () => {
    const positionsEffectStart = source.indexOf('// Subscribe to positions from the store and render price lines');
    const positionsEffectEnd = source.indexOf('// ── Context menu handlers', positionsEffectStart);
    const positionsEffect = source.slice(positionsEffectStart, positionsEffectEnd);

    expect(positionsEffectStart).toBeGreaterThan(-1);
    expect(positionsEffectEnd).toBeGreaterThan(positionsEffectStart);
    expect(positionsEffect).not.toContain('crosshairLabelUpdater');
    expect(positionsEffect).not.toContain('subscribeCrosshairMove(');
    expect(positionsEffect).not.toContain('unsubscribeCrosshairMove(');
    expect(positionsEffect).toContain('subscribeVisibleLogicalRangeChange(timeScaleHandler)');
    expect(positionsEffect).toContain('useAppStore.subscribe(');
    expect(positionsEffect).toContain('postInteractionCoordinatorRef.current?.request({ overlay: true })');
    expect(positionsEffect).toContain('renderPositionLines()');
  });

  it('keeps captured trade drags synchronous and moves idle hover scans off the pan path', () => {
    const effectStart = source.indexOf('const interactionRoot = container.parentElement ?? container;');
    const effectEnd = source.indexOf('}, [isActive, persistTradeLevelOverrides, tradeAllowed]);', effectStart);
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

  it('deduplicates an exact raw quote before expensive scale reconciliation', () => {
    const tickLoopStart = source.indexOf('const interval = setInterval(() => {');
    const tickLoopEnd = source.indexOf('}, LIVE_CHART_UPDATE_INTERVAL_MS);', tickLoopStart);
    const tickLoop = source.slice(tickLoopStart, tickLoopEnd);
    const timestampIndex = tickLoop.indexOf('const rawTickTimestamp = Number(tick.timestamp);');
    const keyIndex = tickLoop.indexOf('const tickKey = `${rawTickTimestamp}:${tick.bid}:${tick.ask ?? tick.bid}:${price}`;');
    const reconciliationIndex = tickLoop.indexOf('normalizeRenderedCandlesToLivePrice(price, activeTf)');

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
    const layoutRefreshEnd = source.indexOf('const hideLivePriceOverlay', layoutRefreshStart);
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

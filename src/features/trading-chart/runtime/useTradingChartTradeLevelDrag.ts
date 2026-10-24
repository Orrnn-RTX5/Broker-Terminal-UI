import { useEffect, type RefObject } from 'react';
import type { Coordinate, IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import { isTrendDrawingInputActive } from '../../../drawing-tools/drawingInteractionPriority';
import api from '../../../services/api';
import { useAppStore } from '../../../store/useAppStore';
import { rememberTradeHistoryPositionLevels } from '../../../utils/tradeHistoryLevelCache';
import { describeProtectionRefusal, formatOrderError } from '../../../utils/orderError';
import {
  handleStalePositionRefusal,
  isPositionKnownClosed,
  refuseSendForClosedPosition,
  requestPositionsRefresh,
} from '../../../utils/stalePositionRefusal';
import type { ChartProperties } from '../../../store/useChartSettingsStore';
import {
  applyTradeLevelDragUpdate,
  getTradeLevelStateKeys,
  getTradeLevelDragMinDistance,
  normalizeTradeLevelDragPrice,
  pendingOrderPriceViolation,
  protectionClosePrice,
  protectionLevelViolation,
  resolveDropPriceForRole,
  resolveTradeLevelDragRole,
  roundProtectionLevelToGrid,
  selectNearestTradeLevel,
  tradeLevelModifyPatch,
} from '../../../utils/tradeLevelDrag';
import { readTradeValidationQuote } from '../../../services/tradeValidationQuote';
import { readRegisteredSymbolPriceSpec, readRegisteredSymbolStopsLevel } from '../../../services/dailyChangePriceModeRegistry';
import {
  bindChartUiTranslation,
  dispatchChartPositionModify,
  estimateTradeLevelMoney,
  formatMoneyLabel,
  hasChartTradeLevelGestureDragged,
} from '../../../utils/chartTradeControls';
import {
  DRAWING_LOCK_HANDLE_SCALE,
  DRAWING_LOCK_HANDLE_SCROLL,
  TRADING_VIEW_HANDLE_SCALE,
  TRADING_VIEW_HANDLE_SCROLL,
} from './chartInteractionOptions';
import {
  CHART_LEVEL_MODIFY_DOUBLE_CLICK_MS,
  getTradeOverlayCardPalette,
  getTradeControlDragY,
  TRADE_LEVEL_BADGE_LEFT_INSET_PX,
  TRADE_LEVEL_HIT_AREA_PX,
  TRADE_LEVEL_MIN_DRAG_PX,
  TRADE_LEVEL_OPTIMISTIC_GRACE_MS,
} from '../presentation/tradeOverlayPresentation';
import type {
  ActiveTradeSnapshot,
  TradeLevelModifyRequestId,
  TradeLevelOverride,
  TradeLevelRole,
  TradePositionRecord,
} from './tradeRuntimeContracts';

interface UseTradingChartTradeLevelDragOptions {
  activeToolRef: RefObject<string | null>;
  activeTradeSnapshotsRef: RefObject<Map<string, ActiveTradeSnapshot>>;
  brokerAccountSessionScope: string;
  chartRef: RefObject<IChartApi | null>;
  chartSettingsRef: RefObject<ChartProperties>;
  containerRef: RefObject<HTMLDivElement | null>;
  isActive: boolean;
  isChartInteractionActiveRef: RefObject<boolean>;
  isChartSurfaceLight: () => boolean;
  overlayRef: RefObject<HTMLDivElement | null>;
  pendingTradeLevelModifyRequestsRef: RefObject<Map<string, TradeLevelModifyRequestId>>;
  persistTradeLevelOverrides: () => void;
  resolvedPriceDigitsRef: RefObject<number>;
  seriesRef: RefObject<ISeriesApi<SeriesType> | null>;
  tr: <T>(source: T, values?: Record<string, unknown>) => T;
  tradeAllowed: boolean;
  tradeLevelLastKnownLevelsRef: RefObject<Map<string, TradeLevelOverride>>;
  tradeLevelModifyRequestSeqRef: RefObject<TradeLevelModifyRequestId>;
  tradeLevelOptimisticGraceUntilRef: RefObject<Map<string, number>>;
  tradeLevelOverridesRef: RefObject<Map<string, TradeLevelOverride>>;
}

/**
 * SL/TP price geometry and validation quote for a drag. Geometry is the symbol's
 * own broker catalog data only (scoped instrument registry): unknown precision
 * keeps the raw dragged number (digits null). The quote is the same fresh
 * Market Watch tick every pre-send check uses; null (missing or stale) means
 * the drag must not be validated or sent.
 */
const readDragPriceSpec = (symbol: string): {
  digits: number | null;
  tickSize: number | null;
  quote: { bid: number; ask: number } | null;
} => {
  const registered = readRegisteredSymbolPriceSpec(symbol);
  return { digits: registered.digits, tickSize: registered.tickSize, quote: readTradeValidationQuote(symbol) };
};

export const useTradingChartTradeLevelDrag = ({
  activeToolRef,
  activeTradeSnapshotsRef,
  brokerAccountSessionScope,
  chartRef,
  chartSettingsRef,
  containerRef,
  isActive,
  isChartSurfaceLight,
  overlayRef,
  pendingTradeLevelModifyRequestsRef,
  persistTradeLevelOverrides,
  resolvedPriceDigitsRef,
  seriesRef,
  tr,
  tradeAllowed,
  tradeLevelLastKnownLevelsRef,
  tradeLevelModifyRequestSeqRef,
  tradeLevelOptimisticGraceUntilRef,
  tradeLevelOverridesRef,
}: UseTradingChartTradeLevelDragOptions): void => {
  // â”€â”€ Drag to Spawn MT5 Trade Levels â”€â”€
  useEffect(() => {
    if (!isActive) return;

    const container = containerRef.current;
    if (!container) return;
    const interactionRoot = container.parentElement ?? container;

    let dragLineOverlay: HTMLDivElement | null = null;
    let dragBadgeOverlay: HTMLDivElement | null = null;
    let dragZoneOverlay: HTMLDivElement | null = null;
    let dragState: {
      tradeObj: ActiveTradeSnapshot;
      grabbedType: 'ENTRY' | 'SL' | 'TP';
      entryAnchorY: number;
      pointerDownY: number;
      controlOffsetY: number;
      didDrag: boolean;
      pointerId: number;
      /**
       * What pointermove last showed. Release sends only a VALID painted level, exactly
       * as painted (price and role). A refused (red) paint sends nothing and repeats its reason.
       */
      painted:
        | { kind: 'valid'; price: number; role: 'SL' | 'TP' }
        | { kind: 'refused'; reason: string }
        | null;
    } | null = null;
    let lastLevelClick: { tradeKey: string; role: 'SL' | 'TP'; at: number } | null = null;
    // Level bars hidden while their level is being dragged (the live preview
    // replaces them); restored on release/cancel, and rebuilt on flush anyway.
    let hiddenDragControlBars: HTMLElement[] = [];

    const hideDraggedLevelControls = (tradeKey: string, role: 'SL' | 'TP') => {
      const overlayHost = overlayRef.current?.parentElement ?? overlayRef.current;
      overlayHost?.querySelectorAll<HTMLElement>(
        `.rtx-trade-controls[data-trade-key="${tradeKey}"][data-role="${role}"]`,
      ).forEach((node) => {
        node.style.visibility = 'hidden';
        hiddenDragControlBars.push(node);
      });
    };

    const restoreDraggedLevelControls = () => {
      hiddenDragControlBars.forEach((node) => {
        try { node.style.visibility = ''; } catch { /* node may be detached */ }
      });
      hiddenDragControlBars = [];
    };
    let capturedPointerElement: HTMLElement | null = null;
    let capturedPointerId: number | null = null;
    let previousRootCursor = '';
    let previousContainerCursor = '';
    let previousBodyCursor = '';
    let previousUserSelect = '';
    let dragCursorActive = false;

    const getChartY = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      return e.clientY - rect.top;
    };

    const getEntryDragDirection = (y: number, startY: number): 1 | -1 | null => {
      if (Math.abs(y - startY) < TRADE_LEVEL_MIN_DRAG_PX) return null;
      return y < startY ? 1 : -1;
    };

    const getFinitePriceCoordinate = (price: number): number | null => {
      if (!seriesRef.current || !(price > 0)) return null;
      const coordinate = seriesRef.current.priceToCoordinate(price);
      return coordinate !== null && Number.isFinite(coordinate) ? (coordinate as number) : null;
    };

    const getPriceScaleOffset = () => seriesRef.current?.priceScale().width() ?? 52;

    const isInsideTradePlot = (
      point: { clientX: number; clientY: number },
      rect: DOMRect,
    ): boolean => (
      point.clientX >= rect.left
      && point.clientX < rect.left + Math.max(0, rect.width - getPriceScaleOffset())
      && point.clientY >= rect.top
      && point.clientY <= rect.bottom
    );

    const getTradeLevelState = (
      state: Map<string, TradeLevelOverride>,
      trade: ActiveTradeSnapshot,
    ): TradeLevelOverride | undefined => {
      for (const key of getTradeLevelStateKeys(trade)) {
        const levels = state.get(key);
        if (!levels) continue;
        if (key !== trade.key) state.set(trade.key, levels);
        return levels;
      }
      return undefined;
    };

    const setTradeLevelState = (
      state: Map<string, TradeLevelOverride>,
      trade: ActiveTradeSnapshot,
      levels: TradeLevelOverride,
    ) => {
      getTradeLevelStateKeys(trade).forEach((key) => state.set(key, levels));
    };

    const deleteTradeLevelState = (
      state: Map<string, TradeLevelOverride>,
      trade: ActiveTradeSnapshot,
    ) => {
      getTradeLevelStateKeys(trade).forEach((key) => state.delete(key));
    };

    const getCurrentTradeLevels = (trade: ActiveTradeSnapshot): TradeLevelOverride => {
      const override = getTradeLevelState(tradeLevelOverridesRef.current, trade);
      const lastKnown = getTradeLevelState(tradeLevelLastKnownLevelsRef.current, trade);
      const now = Date.now();
      const hasActiveModifyWindow = getTradeLevelStateKeys(trade).some((key) => (
        pendingTradeLevelModifyRequestsRef.current.has(key)
        || (tradeLevelOptimisticGraceUntilRef.current.get(key) ?? 0) > now
      ));
      const resolve = (role: 'sl' | 'tp') => {
        // Match the renderer: zero is an explicit removal only while the
        // modify request is pending or its optimistic grace is still active.
        if (override && (override[role] > 0 || hasActiveModifyWindow)) return override[role] || 0;
        return lastKnown && lastKnown[role] > 0 ? lastKnown[role] : trade[role];
      };
      return { sl: resolve('sl'), tp: resolve('tp') };
    };

    const blockPendingTradeLevelChange = (trade: ActiveTradeSnapshot): boolean => {
      if (!getTradeLevelStateKeys(trade).some(key => pendingTradeLevelModifyRequestsRef.current.has(key))) return false;
      window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
        detail: { message: `${tr('Modify Position')}: ${tr('Processing...')}`, type: 'error' },
      }));
      return true;
    };

    const getDragRoleColor = (role: 'SL' | 'TP') => role === 'TP' ? '#00a256' : '#eb415c';

    // Red preview with the reason; nothing is submitted while it is shown.
    const paintBlockedDrag = (reason: string, y: number) => {
      if (!dragLineOverlay || !dragBadgeOverlay) return;
      dragLineOverlay.style.borderTopColor = '#ef4444';
      dragLineOverlay.title = reason;
      dragBadgeOverlay.style.opacity = '1';
      dragBadgeOverlay.style.borderColor = '#ef4444';
      dragBadgeOverlay.title = reason;
      dragLineOverlay.style.transform = `translate3d(0, ${y}px, 0)`;
      dragBadgeOverlay.style.transform = `translateY(calc(-50% + ${y}px))`;
      if (dragZoneOverlay) dragZoneOverlay.style.display = 'none';
    };

    const findClosestLevelForTrade = (
      trade: ActiveTradeSnapshot,
      y: number,
      maxDistance: number,
    ): { grabbedType: 'ENTRY' | 'SL' | 'TP'; distance: number } | null => {
      if (!seriesRef.current) return null;

      const levels = getCurrentTradeLevels(trade);
      const getLevelY = (price: number | undefined) => (
        price && price > 0 && seriesRef.current
          ? seriesRef.current.priceToCoordinate(price)
          : null
      );

      return selectNearestTradeLevel([
        { grabbedType: 'ENTRY', y: getLevelY(trade.entryPrice) },
        { grabbedType: 'SL', y: getLevelY(levels.sl) },
        { grabbedType: 'TP', y: getLevelY(levels.tp) },
      ], y, maxDistance);
    };

    const findClosestTradeLevel = (
      y: number,
      maxDistance: number,
    ): { tradeObj: ActiveTradeSnapshot; grabbedType: 'ENTRY' | 'SL' | 'TP'; distance: number } | null => {
      let closest: { tradeObj: ActiveTradeSnapshot; grabbedType: 'ENTRY' | 'SL' | 'TP'; distance: number } | null = null;
      const entryPriceCounts = new Map<number, number>();

      for (const trade of activeTradeSnapshotsRef.current.values()) {
        entryPriceCounts.set(trade.entryPrice, (entryPriceCounts.get(trade.entryPrice) ?? 0) + 1);
        const nearestLevel = findClosestLevelForTrade(trade, y, closest?.distance ?? maxDistance);
        if (nearestLevel) {
          closest = {
            tradeObj: trade,
            grabbedType: nearestLevel.grabbedType,
            distance: nearestLevel.distance,
          };
        }
      }

      // A shared line has no ticket ownership. Use its explicit ticket bar;
      // do not fall through to a more distant level after rejecting this one.
      if (closest?.grabbedType === 'ENTRY' && (entryPriceCounts.get(closest.tradeObj.entryPrice) ?? 0) > 1) return null;
      return closest;
    };

    const beginPointerCapture = (pointerId: number) => {
      // Level nodes can be replaced by live overlay refreshes during a drag.
      capturedPointerElement = interactionRoot;
      capturedPointerId = pointerId;
      try {
        capturedPointerElement.setPointerCapture(pointerId);
      } catch {
        capturedPointerElement = null;
        // Window listeners still own this pointer when capture is unavailable.
      }
    };

    const releasePointerCapture = () => {
      if (capturedPointerElement && capturedPointerId !== null) {
        try {
          if (capturedPointerElement.hasPointerCapture(capturedPointerId)) {
            capturedPointerElement.releasePointerCapture(capturedPointerId);
          }
        } catch {
          // Pointer capture can already be released by the browser on pointercancel.
        }
      }
      capturedPointerElement = null;
      capturedPointerId = null;
    };

    const beginDragCursor = () => {
      previousRootCursor = interactionRoot.style.cursor;
      previousContainerCursor = container.style.cursor;
      previousBodyCursor = document.body.style.cursor;
      previousUserSelect = document.body.style.userSelect;
      interactionRoot.style.cursor = 'grabbing';
      container.style.cursor = 'grabbing';
      container.querySelectorAll('canvas').forEach((canvas) => {
        (canvas as HTMLElement).style.cursor = 'grabbing';
      });
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      dragCursorActive = true;
    };

    const endDragCursor = () => {
      if (!dragCursorActive) return;
      interactionRoot.style.cursor = previousRootCursor;
      container.style.cursor = previousContainerCursor;
      container.querySelectorAll('canvas').forEach((canvas) => {
        (canvas as HTMLElement).style.cursor = 'default';
      });
      document.body.style.cursor = previousBodyCursor;
      document.body.style.userSelect = previousUserSelect;
      dragCursorActive = false;
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (dragState) {
        if (e.pointerId !== dragState.pointerId) return;
        // A fresh down from this pointer means the previous release was lost.
        handlePointerCancel();
      }

      // Drawing clicks belong to the canvas, including clicks near a trade
      // level whose DOM hit target is temporarily disabled by scoped CSS.
      if (isTrendDrawingInputActive(container)) return;

      // Trade levels get first priority when the pointer is actually on/near one.
      if (e.button !== 0 || !seriesRef.current) return;
      // Position control buttons (reverse/double/close/remove) handle their own
      // clicks; this capture-phase handler must never turn them into drags.
      if (e.target instanceof Element && e.target.closest('.rtx-trade-control-btn')) return;
      // Overlaid chart UI (one-click trading panel, menus, popovers) shares the
      // interaction root, so a BUY/SELL press must never become a level drag or
      // a Modify Position request. Only the chart surface and the trade-level
      // controls themselves may start the gesture.
      if (e.target instanceof Element
        && !e.target.closest('.rtx-trade-controls, .rtx-trade-level-badge, .rtx-trade-level-hit-area, .rtx-trade-level-line')
        && !container.contains(e.target)) return;
      if (!tradeAllowed) return;
      if (chartSettingsRef.current.showTradeLevels === false) return;

      let y = getChartY(e);
      let closestTrade: ActiveTradeSnapshot | null = null;
      let grabbedType: 'ENTRY' | 'SL' | 'TP' = 'ENTRY';

      const targetBadge = e.target instanceof Element
        ? e.target.closest('.rtx-trade-level-badge') as HTMLElement | null
        : null;
      const targetLevel = e.target instanceof Element
        ? e.target.closest('.rtx-trade-level-badge, .rtx-trade-level-hit-area') as HTMLElement | null
        : null;
      const targetTradeKey = targetLevel?.dataset.tradeKey;
      const targetRole = targetLevel?.dataset.role as TradeLevelRole | undefined;
      const offsetOwner = targetBadge?.closest<HTMLElement>('[data-price-anchor-offset-y]');
      const controlAnchorY = Number(offsetOwner?.dataset.priceAnchorY);
      // Capture the grab point once, including wrapped bars and bracket chips.
      // Clicking any part of the control starts at its unchanged price anchor.
      const controlOffsetY = offsetOwner && Number.isFinite(controlAnchorY)
        ? y - controlAnchorY
        : Number(offsetOwner?.dataset.priceAnchorOffsetY) || 0;
      y = getTradeControlDragY(y, controlOffsetY);
      if (targetTradeKey && (targetRole === 'ENTRY' || targetRole === 'SL' || targetRole === 'TP')) {
        const directTrade = activeTradeSnapshotsRef.current.get(targetTradeKey);
        if (directTrade) {
          closestTrade = directTrade;
          grabbedType = targetRole;
        } else {
          // The target belongs to a retained trade whose position data is
          // refreshing; it is not draggable right now and the press must not
          // fall through to another trade's nearby level.
          return;
        }
      }

      if (!closestTrade) {
        // The right price axis owns scale gestures, even at a trade's Y.
        // Explicit ticket controls above are separate, intentional targets.
        if (!isInsideTradePlot(e, container.getBoundingClientRect())) return;
        const nearestTradeLevel = findClosestTradeLevel(y, TRADE_LEVEL_HIT_AREA_PX / 2);
        if (nearestTradeLevel) {
          closestTrade = nearestTradeLevel.tradeObj;
          grabbedType = nearestTradeLevel.grabbedType;
        }
      }

      if (!closestTrade && activeToolRef.current !== null) return;

      if (closestTrade) {
        e.preventDefault();
        e.stopPropagation();
        if (blockPendingTradeLevelChange(closestTrade)) return;
        beginPointerCapture(e.pointerId);
        beginDragCursor();
        if (chartRef.current) {
          chartRef.current.applyOptions({
            handleScroll: DRAWING_LOCK_HANDLE_SCROLL,
            handleScale: DRAWING_LOCK_HANDLE_SCALE,
          });
        }

        const entryAnchorY = grabbedType === 'ENTRY'
          ? getFinitePriceCoordinate(closestTrade.entryPrice) ?? y
          : y;
        const initialOverlayY = grabbedType === 'ENTRY' ? entryAnchorY : y;
        dragState = { tradeObj: closestTrade, grabbedType, entryAnchorY, pointerDownY: y, controlOffsetY, didDrag: false, pointerId: e.pointerId, painted: null };

        dragLineOverlay = document.createElement('div');
        dragLineOverlay.style.cssText = `position:absolute;left:0;right:${getPriceScaleOffset()}px;top:0;height:0;border-top:1px dashed transparent;z-index:999;pointer-events:none;transform:translate3d(0, ${initialOverlayY}px, 0);will-change:transform;`;

        dragBadgeOverlay = document.createElement('div');
        dragBadgeOverlay.className = 'rtx-trade-drag-price-badge';
        const initialPalette = getTradeOverlayCardPalette(grabbedType === 'TP' ? 'TP' : 'SL', isChartSurfaceLight());
        dragBadgeOverlay.style.cssText = `position:absolute;left:${TRADE_LEVEL_BADGE_LEFT_INSET_PX}px;top:0;padding:1px 5px;background:${initialPalette.background};border:1px solid ${initialPalette.border};color:${initialPalette.text};font-size:var(--rtx-ui-font-size, 14px);font-family:Consolas,monospace;font-weight:var(--rtx-font-weight-control, 400);z-index:1000;pointer-events:none;border-radius:2px;transform:translateY(calc(-50% + ${initialOverlayY}px));will-change:transform;opacity:0;${initialPalette.shadow}`;

        overlayRef.current?.appendChild(dragLineOverlay);
        overlayRef.current?.appendChild(dragBadgeOverlay);
        dragZoneOverlay = document.createElement('div');
        dragZoneOverlay.className = 'rtx-trade-drag-zone';
        dragZoneOverlay.style.cssText = `position:absolute;left:0;right:${getPriceScaleOffset()}px;display:none;z-index:10;pointer-events:none;`;
        overlayRef.current?.appendChild(dragZoneOverlay);
        dragBadgeOverlay.style.left = 'auto';
        dragBadgeOverlay.style.right = `${getPriceScaleOffset() + 16}px`;
        dragBadgeOverlay.style.fontFamily = 'Arial, sans-serif';
        dragBadgeOverlay.style.fontSize = '11px';
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      // A captured trade-level drag must stay synchronous even if the generic
      // chart-interaction flag is still active from an earlier pan gesture.
      if (dragState) {
        if (!dragLineOverlay || !dragBadgeOverlay || !seriesRef.current) return;
        if (capturedPointerId !== null && e.pointerId !== capturedPointerId) return;
        e.preventDefault();
        e.stopPropagation();
        const y = getTradeControlDragY(getChartY(e), dragState.controlOffsetY);
        const wasDragging = dragState.didDrag;
        dragState.didDrag = hasChartTradeLevelGestureDragged(
          dragState.pointerDownY,
          y,
          dragState.didDrag,
        );
        if (!wasDragging && dragState.didDrag && dragState.grabbedType !== 'ENTRY') {
          hideDraggedLevelControls(dragState.tradeObj.key, dragState.grabbedType);
        }
        const rawPrice = seriesRef.current.coordinateToPrice(y as Coordinate);
        if (rawPrice === null) return;

        const { tradeObj, grabbedType, entryAnchorY } = dragState;
        const moveSpec = readDragPriceSpec(tradeObj.symbol);
        const digits = moveSpec.digits;
        // No minimum distance: the gateway enforces side + grid only, so the
        // clamp keeps a level just one tick past the close (minStopDistance
        // 0). The entry-line dead zone below is a gesture threshold, not a
        // stops rule.
        const minStopDistance = 0;
        const minEntryDistance = getTradeLevelDragMinDistance(digits, moveSpec.tickSize);
        // Validation quote = the Market Watch tick, only when fresh; otherwise null,
        // which means "not validated here" (the server decides on release).
        const moveQuote = moveSpec.quote;
        const moveClose = moveQuote ? protectionClosePrice(tradeObj.side, moveQuote.bid, moveQuote.ask) : null;
        const liveCurrentPrice = moveClose ?? tradeObj.currentPrice;
        const entryDragDirection = grabbedType === 'ENTRY' ? getEntryDragDirection(y, entryAnchorY) : null;

        // Entry-line clicks are ignored, but any real vertical drag should create SL/TP.
        // Existing SL/TP levels remain freely repositionable.
        const hasRealEntryDrag = entryDragDirection !== null;
        const showPreview = grabbedType === 'ENTRY' ? hasRealEntryDrag : dragState.didDrag;
        if (tradeObj.kind === 'pending' && grabbedType === 'ENTRY') {
          if (!showPreview) {
            dragLineOverlay.style.borderTopColor = 'transparent';
            dragBadgeOverlay.style.opacity = '0';
            if (dragZoneOverlay) dragZoneOverlay.style.display = 'none';
            return;
          }
          const nextEntryPrice = normalizeTradeLevelDragPrice(
            roundProtectionLevelToGrid(rawPrice, digits, moveSpec.tickSize),
            digits,
          );
          const moveTick = moveQuote;
          const moveBid = Number(moveTick?.bid) || liveCurrentPrice;
          const moveAsk = Number(moveTick?.ask) || liveCurrentPrice;
          const moveSide = tradeObj.side === 'SELL' ? 'SELL' : 'BUY';
          const violation = pendingOrderPriceViolation({
            orderType: tradeObj.orderType || (moveSide === 'SELL' ? 'sell_limit' : 'buy_limit'),
            side: moveSide,
            price: nextEntryPrice,
            limitPrice: tradeObj.limitPrice,
            sl: tradeObj.sl,
            tp: tradeObj.tp,
            bid: moveBid,
            ask: moveAsk,
            digits,
            tickSize: moveSpec.tickSize,
          });
          const color = violation ? '#ef4444' : (moveSide === 'SELL' ? '#f59e0b' : '#0ea5e9');
          dragLineOverlay.style.borderTopColor = color;
          dragLineOverlay.title = violation ?? '';
          dragBadgeOverlay.style.opacity = '1';
          dragBadgeOverlay.style.borderColor = color;
          dragBadgeOverlay.title = violation ?? '';
          dragBadgeOverlay.textContent = `${(tradeObj.orderType || moveSide).replace(/_/g, ' ').toUpperCase()} ${digits === null ? String(nextEntryPrice) : nextEntryPrice.toFixed(digits)}`;
          dragLineOverlay.style.transform = `translate3d(0, ${y}px, 0)`;
          dragBadgeOverlay.style.transform = `translateY(calc(-50% + ${y}px))`;
          if (dragZoneOverlay) dragZoneOverlay.style.display = 'none';
          return;
        }
        const levelsNow = getCurrentTradeLevels(tradeObj);
        const isNewLevel = (grabbedType === 'SL' && !(levelsNow.sl > 0)) || (grabbedType === 'TP' && !(levelsNow.tp > 0));
        const dropPrice = showPreview
          ? resolveDropPriceForRole({
            side: tradeObj.side,
            grabbedType,
            price: rawPrice,
            quote: moveQuote,
            digits,
            tickSize: moveSpec.tickSize,
            stopsLevel: readRegisteredSymbolStopsLevel(tradeObj.symbol),
            isNewLevel,
            entryPrice: tradeObj.entryPrice,
          })
          : null;
        const previewUpdate = dropPrice !== null
          ? applyTradeLevelDragUpdate({
            side: tradeObj.side,
            grabbedType,
            entryPrice: tradeObj.entryPrice,
            finalPrice: dropPrice,
            currentSl: tradeObj.sl,
            currentTp: tradeObj.tp,
            digits,
            tickSize: moveSpec.tickSize,
            currentPrice: moveClose ?? undefined,
            minStopDistance,
            minEntryDistance: grabbedType === 'ENTRY' ? minEntryDistance : undefined,
            snapEntryToMinDistance: grabbedType === 'ENTRY',
            entryDragDirection: entryDragDirection ?? undefined,
          })
          : null;

        if (!previewUpdate || !Number.isFinite(previewUpdate.price) || previewUpdate.price <= 0) {
          dragState.painted = null;
          const idleY = grabbedType === 'ENTRY' ? entryAnchorY : y;
          dragLineOverlay.style.borderTopColor = 'transparent';
          dragBadgeOverlay.style.opacity = '0';
          if (dragZoneOverlay) dragZoneOverlay.style.display = 'none';
          dragLineOverlay.style.transform = `translate3d(0, ${idleY}px, 0)`;
          dragBadgeOverlay.style.transform = `translateY(calc(-50% + ${idleY}px))`;
          dragLineOverlay.title = '';
          dragBadgeOverlay.title = '';
          return;
        }

        const price = previewUpdate.price;
        const role = previewUpdate.role;
        // A fresh quote validates the dropped level locally: a broker-invalid side is
        // painted red with the reason and is not submitted (see pointerup). Without
        // a fresh quote nothing is refused here; the painted level is what release sends.
        const moveSide = tradeObj.side === 'SELL' ? 'SELL' : 'BUY';
        // Checked on the dropped price (before clamp for SL/TP) and the painted price.
        const droppedPrice = grabbedType === 'ENTRY' ? price : (dropPrice ?? price);
        const droppedRole = grabbedType === 'ENTRY'
          ? role
          : resolveTradeLevelDragRole(tradeObj.side, grabbedType, tradeObj.entryPrice, droppedPrice, moveClose);
        const moveViolation = moveQuote
          ? (
            protectionLevelViolation({
              side: moveSide,
              role: droppedRole,
              price: droppedPrice,
              bid: moveQuote.bid,
              ask: moveQuote.ask,
              digits,
              tickSize: moveSpec.tickSize,
            })
            ?? protectionLevelViolation({
              side: moveSide,
              role,
              price,
              bid: moveQuote.bid,
              ask: moveQuote.ask,
              digits,
              tickSize: moveSpec.tickSize,
            })
          )
          : null;
        if (moveViolation) {
          dragState.painted = { kind: 'refused', reason: moveViolation };
          paintBlockedDrag(moveViolation, y);
          return;
        }
        // The release submits exactly this painted price (M4); no silent drift.
        dragState.painted = { kind: 'valid', price, role };
        // A chip with no fresh quote has no close to snap to: say so in the preview.
        const unsnappedChip = !moveQuote && isNewLevel;
        dragLineOverlay.title = unsnappedChip ? tr('Price updating, please retry') : '';
        dragBadgeOverlay.title = dragLineOverlay.title;
        const color = getDragRoleColor(role);
        const palette = getTradeOverlayCardPalette(role, isChartSurfaceLight());

        // Draw at the clamped price coordinate so the level sticks to the broker-valid
        // boundary instead of following the pointer into a zone the broker would reject.
        const clampedY = seriesRef.current.priceToCoordinate(price);
        const drawY = clampedY === null || !Number.isFinite(clampedY) ? y : (clampedY as number);

        dragLineOverlay.style.borderTopColor = color;
        dragBadgeOverlay.style.opacity = '1';
        dragLineOverlay.style.transform = `translate3d(0, ${drawY}px, 0)`;
        if (dragZoneOverlay) {
          const entryY = seriesRef.current.priceToCoordinate(tradeObj.entryPrice);
          if (entryY !== null && Number.isFinite(entryY)) {
            dragZoneOverlay.style.display = 'block';
            dragZoneOverlay.style.top = `${Math.min(entryY, drawY)}px`;
            dragZoneOverlay.style.height = `${Math.abs(drawY - entryY)}px`;
            dragZoneOverlay.style.backgroundColor = role === 'TP' ? 'rgba(38,166,154,0.16)' : 'rgba(255,167,38,0.18)';
          }
        }

        dragBadgeOverlay.style.background = palette.background;
        dragBadgeOverlay.style.borderColor = palette.border;
        dragBadgeOverlay.style.color = palette.text;
        dragBadgeOverlay.style.boxShadow = palette.shadow.replace(/^box-shadow:/, '').replace(/;$/, '');
        // Show projected money while dragging to match the level label.
        const previewState = useAppStore.getState();
        const previewTicket = Number(tradeObj.key.replace(/^trade:/, ''));
        const previewPosition = Array.isArray(previewState.positions)
          ? previewState.positions.find((candidate) => (
            Number(candidate.id ?? (candidate as TradePositionRecord).ticket) === previewTicket
          ))
          : null;
        const previewPositionRaw = previewPosition as unknown as Record<string, unknown> | null;
        const previewBackendPnl = Number(previewPosition?.unrealizedPnL ?? previewPosition?.profit ?? previewPosition?.unrealized_pl);
        const previewMoney = estimateTradeLevelMoney({
          symbol: tradeObj.symbol,
          side: tradeObj.side,
          volume: tradeObj.volume,
          entryPrice: tradeObj.entryPrice,
          levelPrice: price,
          digits: resolvedPriceDigitsRef.current,
          backendPnl: Number.isFinite(previewBackendPnl) ? previewBackendPnl : null,
          currentPrice: liveCurrentPrice,
          contractSize: Number(previewPositionRaw?.contractSize ?? previewPositionRaw?.contract_size) || undefined,
        });
        const previewCurrency = String(previewState.account?.currency || 'USD').trim().toUpperCase() || 'USD';
        const previewBadge = dragBadgeOverlay;
        bindChartUiTranslation(previewBadge, () => {
          previewBadge.textContent = `${tr(role)} ${digits === null ? String(price) : price.toFixed(digits)}  ${previewCurrency}: ${formatMoneyLabel(previewMoney)}`;
        });
        dragBadgeOverlay.style.transform = `translateY(calc(-50% + ${drawY}px))`;
        return;
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!dragState) return;
      if (capturedPointerId !== null && e.pointerId !== capturedPointerId) return;
      e.preventDefault();
      e.stopPropagation();

      try {
        if (seriesRef.current) {
          const y = getTradeControlDragY(getChartY(e), dragState.controlOffsetY);
          const rawFinalPrice = seriesRef.current.coordinateToPrice(y as Coordinate);
          const { tradeObj, grabbedType, entryAnchorY, pointerDownY } = dragState;

          const didLevelDrag = hasChartTradeLevelGestureDragged(pointerDownY, y, dragState.didDrag);
          const isLevelClick = grabbedType !== 'ENTRY' && !didLevelDrag;

          if (isLevelClick) {
            const role = grabbedType as 'SL' | 'TP';
            const clickedAt = Date.now();
            const isDoubleLevelClick = lastLevelClick !== null
              && lastLevelClick.tradeKey === tradeObj.key
              && lastLevelClick.role === role
              && clickedAt - lastLevelClick.at <= CHART_LEVEL_MODIFY_DOUBLE_CLICK_MS;
            lastLevelClick = isDoubleLevelClick
              ? null
              : { tradeKey: tradeObj.key, role, at: clickedAt };
            if (isDoubleLevelClick) {
              const ticket = Number.parseInt(tradeObj.key.replace(/^(trade|order):/, ''), 10);
              dispatchChartPositionModify({
                ticket,
                symbol: tradeObj.symbol,
                sessionScope: brokerAccountSessionScope,
                kind: tradeObj.kind === 'pending' ? 'pending-order' : 'position',
              });
            }
          } else if (rawFinalPrice !== null) {
            lastLevelClick = null;
            const entryDragDirection = grabbedType === 'ENTRY' ? getEntryDragDirection(y, entryAnchorY) : null;
            const hasRealEntryDrag = entryDragDirection !== null;
            if (!(grabbedType === 'ENTRY' && !hasRealEntryDrag)) {
              // A cross-button action can start while this gesture is active.
              if (blockPendingTradeLevelChange(tradeObj)) return;
              const { sl: currentSl, tp: currentTp } = getCurrentTradeLevels(tradeObj);
              if (tradeObj.kind === 'pending') {
                const pendingSpec = readDragPriceSpec(tradeObj.symbol);
                const pendingDigits = pendingSpec.digits;
                const submitFinalPrice = roundProtectionLevelToGrid(rawFinalPrice, pendingDigits, pendingSpec.tickSize);
                const liveCurrentPrice = activeTradeSnapshotsRef.current.get(tradeObj.key)?.currentPrice ?? tradeObj.currentPrice;
                const submitSide = tradeObj.side === 'SELL' ? 'SELL' : 'BUY';
                const submitRaw = normalizeTradeLevelDragPrice(submitFinalPrice, pendingDigits);
                const submitTick = pendingSpec.quote;
                const ticket = Number(tradeObj.key.replace(/^(trade|order):/, ''));
                if (!ticket) return;
                const nextPrice = grabbedType === 'ENTRY' ? submitRaw : tradeObj.entryPrice;
                const nextSl = grabbedType === 'SL' ? submitRaw : (currentSl || 0);
                const nextTp = grabbedType === 'TP' ? submitRaw : (currentTp || 0);
                const pendingViolation = pendingOrderPriceViolation({
                  orderType: tradeObj.orderType || (submitSide === 'SELL' ? 'sell_limit' : 'buy_limit'),
                  side: submitSide,
                  price: nextPrice,
                  limitPrice: tradeObj.limitPrice,
                  sl: nextSl,
                  tp: nextTp,
                  bid: Number(submitTick?.bid) || liveCurrentPrice,
                  ask: Number(submitTick?.ask) || liveCurrentPrice,
                  digits: pendingDigits,
                  tickSize: pendingSpec.tickSize,
                });
                if (pendingViolation) {
                  window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
                    detail: { message: pendingViolation, type: 'error' },
                  }));
                  return;
                }
                const prevEntryPrice = tradeObj.entryPrice;
                const prevLevels = { sl: currentSl || 0, tp: currentTp || 0 };
                tradeObj.entryPrice = nextPrice;
                setTradeLevelState(tradeLevelOverridesRef.current, tradeObj, { sl: nextSl, tp: nextTp });
                setTradeLevelState(tradeLevelLastKnownLevelsRef.current, tradeObj, { sl: nextSl, tp: nextTp });
                window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
                api.orders.modifyPendingOrder(ticket, {
                  price: nextPrice,
                  ...(tradeObj.limitPrice ? { price_limit: tradeObj.limitPrice } : {}),
                  price_sl: nextSl,
                  price_tp: nextTp,
                  ...(tradeObj.stateVersion ? { state_version: tradeObj.stateVersion } : {}),
                })
                  .then(() => {
                    const loginId = Number.parseInt(String(useAppStore.getState().accountId ?? ''), 10);
                    if (Number.isFinite(loginId) && loginId > 0) {
                      void api.orders.getPendingOrders(loginId)
                        .then((orders) => useAppStore.getState().setOrders(orders as any))
                        .catch(() => undefined);
                    }
                    window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
                      detail: { message: `Order #${ticket} modified`, type: 'success' },
                    }));
                  })
                  .catch((err) => {
                    tradeObj.entryPrice = prevEntryPrice;
                    setTradeLevelState(tradeLevelOverridesRef.current, tradeObj, prevLevels);
                    setTradeLevelState(tradeLevelLastKnownLevelsRef.current, tradeObj, prevLevels);
                    window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
                    window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
                      detail: { message: formatOrderError(err), type: 'error' },
                    }));
                  });
                return;
              }
              // Only the level the user saw painted can be sent. No paint: nothing to send
              // (a click). A refused (red) paint: nothing is sent; its shown reason is repeated.
              const paint = dragState.painted;
              if (!paint) return;
              if (paint.kind === 'refused') {
                window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
                  detail: { message: paint.reason, type: 'error' },
                }));
                return;
              }
              const submitSpec = readDragPriceSpec(tradeObj.symbol);
              const digits = submitSpec.digits;
              // Fresh quote: the painted price AND role must still be valid for the live close.
              // Otherwise (stale or missing quote): send the painted level exactly, server-final.
              const submitQuote = submitSpec.quote;
              if (submitQuote) {
                const submitClose = protectionClosePrice(tradeObj.side, submitQuote.bid, submitQuote.ask);
                const submitSide = tradeObj.side === 'SELL' ? 'SELL' : 'BUY';
                const roleNow = resolveTradeLevelDragRole(tradeObj.side, grabbedType, tradeObj.entryPrice, paint.price, submitClose);
                const violation = protectionLevelViolation({
                  side: submitSide,
                  role: paint.role,
                  price: paint.price,
                  bid: submitQuote.bid,
                  ask: submitQuote.ask,
                  digits,
                  tickSize: submitSpec.tickSize,
                });
                if (violation || roleNow !== paint.role) {
                  window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
                    detail: { message: tr('Price moved, drag again'), type: 'error' },
                  }));
                  return;
                }
              }
              // The sent level is the painted level, with the painted role (no re-derivation, no re-clamp).
              const update = {
                role: paint.role,
                price: paint.price,
                sl: paint.role === 'SL' ? paint.price : currentSl || 0,
                tp: paint.role === 'TP' ? paint.price : currentTp || 0,
              };

              if (update) {
                const ticket = Number(tradeObj.key.replace('trade:', ''));
                if (ticket) {
                  // Pre-send check: a line whose position already closed must not reach the modify API.
                  if (isPositionKnownClosed(ticket)) {
                    window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
                      detail: { message: refuseSendForClosedPosition(ticket, { refresh: requestPositionsRefresh, tr }), type: 'error' },
                    }));
                    return;
                  }
                  const { sl, tp } = update;
                  const previousLevels = {
                    sl: currentSl || 0,
                    tp: currentTp || 0,
                  };
                  const requestId = tradeLevelModifyRequestSeqRef.current + 1;
                  const requestKeys = getTradeLevelStateKeys(tradeObj);
                  tradeLevelModifyRequestSeqRef.current = requestId;
                  const optimisticGraceUntil = Date.now() + TRADE_LEVEL_OPTIMISTIC_GRACE_MS;
                  requestKeys.forEach((key) => pendingTradeLevelModifyRequestsRef.current.set(key, requestId));
                  requestKeys.forEach((key) => tradeLevelOptimisticGraceUntilRef.current.set(key, optimisticGraceUntil));
                  const isCurrentRequest = () => requestKeys.some((key) => (
                    pendingTradeLevelModifyRequestsRef.current.get(key) === requestId
                  ));
                  const clearCurrentRequest = () => {
                    requestKeys.forEach((key) => {
                      if (pendingTradeLevelModifyRequestsRef.current.get(key) === requestId) {
                        pendingTradeLevelModifyRequestsRef.current.delete(key);
                      }
                    });
                  };

                  // Optimistically set UI level overrides immediately
                  setTradeLevelState(tradeLevelOverridesRef.current, tradeObj, { sl: sl || 0, tp: tp || 0 });
                  setTradeLevelState(tradeLevelLastKnownLevelsRef.current, tradeObj, { sl: sl || 0, tp: tp || 0 });
                  persistTradeLevelOverrides();
                  rememberTradeHistoryPositionLevels([
                    {
                      id: ticket,
                      symbol: tradeObj.symbol,
                      side: tradeObj.side,
                      volume: tradeObj.volume,
                      entryPrice: tradeObj.entryPrice,
                      entryTime: tradeObj.entryTime,
                      sl: sl || 0,
                      tp: tp || 0,
                      price_sl: sl || 0,
                      price_tp: tp || 0,
                    },
                  ], useAppStore.getState().accountId);
                  window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay')); // flush instantly
                  window.dispatchEvent(new CustomEvent('rtx:trade-modified', {
                    detail: {
                      id: ticket,
                      symbol: tradeObj.symbol,
                      sl: sl || 0,
                      tp: tp || 0,
                      sessionScope: brokerAccountSessionScope,
                    },
                  }));

                  api.positions.modifyPosition(ticket, tradeLevelModifyPatch(update.role, update.price))
                    .then(() => {
                      if (!isCurrentRequest()) return;
                      clearCurrentRequest();
                      window.setTimeout(() => window.dispatchEvent(new Event('rtx:force-refresh-positions')), 250);
                    })
                    .catch(err => {
                      if (!isCurrentRequest()) return;
                      clearCurrentRequest();
                      requestKeys.forEach((key) => tradeLevelOptimisticGraceUntilRef.current.delete(key));
                      console.error('[Chart] Failed to modify SL/TP:', err);
                      if ((previousLevels.sl || 0) > 0 || (previousLevels.tp || 0) > 0) {
                        setTradeLevelState(tradeLevelOverridesRef.current, tradeObj, previousLevels);
                        setTradeLevelState(tradeLevelLastKnownLevelsRef.current, tradeObj, previousLevels);
                      } else {
                        deleteTradeLevelState(tradeLevelOverridesRef.current, tradeObj);
                      deleteTradeLevelState(tradeLevelLastKnownLevelsRef.current, tradeObj);
                    }
                    persistTradeLevelOverrides();
                    window.dispatchEvent(new CustomEvent('rtx:trade-modified', {
                      detail: {
                        id: ticket,
                        symbol: tradeObj.symbol,
                        sl: previousLevels.sl,
                        tp: previousLevels.tp,
                        sessionScope: brokerAccountSessionScope,
                      },
                    }));
                    window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
                    // Name the offending level against the live quote when the
                    // server refused the geometry (never a bare "Failed").
                    // Broker spec digits only; unknown precision degrades
                    // the naming to side-only â€” never guessed.
                    const staleMessage = handleStalePositionRefusal(err, ticket, { refresh: requestPositionsRefresh, tr });
                    if (staleMessage) {
                      window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
                        detail: { message: staleMessage, type: 'error' },
                      }));
                      return;
                    }
                    const refusalSpec = readDragPriceSpec(tradeObj.symbol);
                    const dragTick = refusalSpec.quote;
                    const dragRefusal = describeProtectionRefusal(err, {
                      side: String(tradeObj.side).toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
                      sl,
                      tp,
                      // Same fresh quote as the send path; no quote means no side naming (server text).
                      bid: dragTick?.bid ?? 0,
                      ask: dragTick?.ask ?? 0,
                      digits: refusalSpec.digits,
                    });
                    window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
                      detail: { message: dragRefusal ?? formatOrderError(err), type: 'error' },
                    }));
                    });
                }
              }
            }
          }
        }
      } finally {
        if (dragLineOverlay) dragLineOverlay.remove();
        if (dragBadgeOverlay) dragBadgeOverlay.remove();
        dragZoneOverlay?.remove();
        dragZoneOverlay = null;
        dragLineOverlay = null;
        dragBadgeOverlay = null;
        dragState = null;
        restoreDraggedLevelControls();
        releasePointerCapture();
        endDragCursor();

        if (chartRef.current) {
          chartRef.current.applyOptions({
            handleScroll: TRADING_VIEW_HANDLE_SCROLL,
            handleScale: TRADING_VIEW_HANDLE_SCALE,
          });
        }
      }
    };

    const handlePointerCancel = (event?: PointerEvent) => {
      if (event && dragState && event.pointerId !== dragState.pointerId) return;
      if (!dragState && !dragLineOverlay && !dragBadgeOverlay) return;
      if (dragLineOverlay) dragLineOverlay.remove();
      if (dragBadgeOverlay) dragBadgeOverlay.remove();
      dragZoneOverlay?.remove();
      dragZoneOverlay = null;
      dragLineOverlay = null;
      dragBadgeOverlay = null;
      dragState = null;
      lastLevelClick = null;
      restoreDraggedLevelControls();
      releasePointerCapture();
      endDragCursor();
      if (chartRef.current) {
        chartRef.current.applyOptions({
          handleScroll: TRADING_VIEW_HANDLE_SCROLL,
          handleScale: TRADING_VIEW_HANDLE_SCALE,
        });
      }
    };

    const handleWindowBlur = () => handlePointerCancel();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') handlePointerCancel();
    };

    interactionRoot.addEventListener('pointerdown', handlePointerDown, true);
    interactionRoot.addEventListener('lostpointercapture', handlePointerCancel);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      interactionRoot.removeEventListener('pointerdown', handlePointerDown, true);
      interactionRoot.removeEventListener('lostpointercapture', handlePointerCancel);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      // A tab can deactivate mid-drag. Reuse the normal cancellation path so
      // capture, overlays, cursors, and chart scroll options are restored.
      handlePointerCancel();
    };
  }, [
    activeToolRef,
    activeTradeSnapshotsRef,
    brokerAccountSessionScope,
    chartRef,
    chartSettingsRef,
    containerRef,
    isActive,
    isChartSurfaceLight,
    overlayRef,
    pendingTradeLevelModifyRequestsRef,
    persistTradeLevelOverrides,
    resolvedPriceDigitsRef,
    seriesRef,
    tr,
    tradeAllowed,
    tradeLevelLastKnownLevelsRef,
    tradeLevelModifyRequestSeqRef,
    tradeLevelOptimisticGraceUntilRef,
    tradeLevelOverridesRef,
  ]);
};

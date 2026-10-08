import { isInvestorSession } from '../../../services/investorSession';
import { useEffect, type RefObject } from 'react';
import type { Coordinate, IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import { isTrendDrawingInputActive } from '../../../drawing-tools/drawingInteractionPriority';
import api from '../../../services/api';
import { useAppStore } from '../../../store/useAppStore';
import { rememberTradeHistoryPositionLevels } from '../../../utils/tradeHistoryLevelCache';
import type { ChartProperties } from '../../../store/useChartSettingsStore';
import {
  applyTradeLevelDragUpdate,
  createTradeLevelOverrideFingerprint,
  getTradeLevelDragMinDistance,
  selectNearestTradeLevel,
  tradeLevelModifyPatch,
} from '../../../utils/tradeLevelDrag';
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

export const useTradingChartTradeLevelDrag = ({
  activeToolRef,
  activeTradeSnapshotsRef,
  brokerAccountSessionScope,
  chartRef,
  chartSettingsRef,
  containerRef,
  isActive,
  isChartInteractionActiveRef,
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
  // ── Drag to Spawn MT5 Trade Levels ──
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
    let tradeHoverCursorActive = false;
    let tradeHoverFrame: number | null = null;
    let pendingTradeHoverPoint: { clientX: number; clientY: number } | null = null;

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

    const getTradeLevelStateKeys = (trade: ActiveTradeSnapshot): string[] => {
      const digits = resolvedPriceDigitsRef.current;
      const fingerprint = createTradeLevelOverrideFingerprint({
        symbol: trade.symbol,
        side: trade.side,
        volume: trade.volume,
        entryPrice: trade.entryPrice,
        entryTime: trade.entryTime,
        digits,
      });
      return Array.from(new Set([trade.key, fingerprint]));
    };

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

    const getDragRoleColor = (role: 'SL' | 'TP') => role === 'TP' ? '#00a256' : '#eb415c';

    const findClosestLevelForTrade = (
      trade: ActiveTradeSnapshot,
      y: number,
      maxDistance: number,
    ): { grabbedType: 'ENTRY' | 'SL' | 'TP'; distance: number } | null => {
      if (!seriesRef.current) return null;

      const override = getTradeLevelState(tradeLevelOverridesRef.current, trade);
      const lastKnown = getTradeLevelState(tradeLevelLastKnownLevelsRef.current, trade);
      const getLevelY = (price: number | undefined) => (
        price && price > 0 && seriesRef.current
          ? seriesRef.current.priceToCoordinate(price)
          : null
      );

      const sl = override && override.sl > 0
        ? override.sl
        : lastKnown && lastKnown.sl > 0
          ? lastKnown.sl
          : trade.sl;
      const tp = override && override.tp > 0
        ? override.tp
        : lastKnown && lastKnown.tp > 0
          ? lastKnown.tp
          : trade.tp;

      return selectNearestTradeLevel([
        { grabbedType: 'ENTRY', y: getLevelY(trade.entryPrice) },
        { grabbedType: 'SL', y: getLevelY(sl) },
        { grabbedType: 'TP', y: getLevelY(tp) },
      ], y, maxDistance);
    };

    const findClosestTradeLevel = (
      y: number,
      maxDistance: number,
    ): { tradeObj: ActiveTradeSnapshot; grabbedType: 'ENTRY' | 'SL' | 'TP'; distance: number } | null => {
      let closest: { tradeObj: ActiveTradeSnapshot; grabbedType: 'ENTRY' | 'SL' | 'TP'; distance: number } | null = null;

      activeTradeSnapshotsRef.current.forEach((trade) => {
        const nearestLevel = findClosestLevelForTrade(trade, y, closest?.distance ?? maxDistance);
        if (nearestLevel) {
          closest = {
            tradeObj: trade,
            grabbedType: nearestLevel.grabbedType,
            distance: nearestLevel.distance,
          };
        }
      });

      return closest;
    };

    const beginPointerCapture = (target: HTMLElement | null, pointerId: number) => {
      capturedPointerElement = target ?? interactionRoot;
      capturedPointerId = pointerId;
      try {
        capturedPointerElement.setPointerCapture(pointerId);
      } catch {
        capturedPointerElement = null;
        capturedPointerId = null;
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

    const setTradeHoverCursor = (active: boolean) => {
      if (dragCursorActive || active === tradeHoverCursorActive) return;
      tradeHoverCursorActive = active;
      const cursor = active ? 'grab' : 'default';
      interactionRoot.style.cursor = active ? cursor : '';
      container.style.cursor = active ? cursor : '';
      container.querySelectorAll('canvas').forEach((canvas) => {
        (canvas as HTMLElement).style.cursor = cursor;
      });
    };

    const cancelQueuedTradeHover = () => {
      pendingTradeHoverPoint = null;
      if (tradeHoverFrame === null) return;
      window.cancelAnimationFrame(tradeHoverFrame);
      tradeHoverFrame = null;
    };

    const queueTradeHover = (e: PointerEvent) => {
      pendingTradeHoverPoint = { clientX: e.clientX, clientY: e.clientY };
      if (tradeHoverFrame !== null) return;

      tradeHoverFrame = window.requestAnimationFrame(() => {
        tradeHoverFrame = null;
        const point = pendingTradeHoverPoint;
        pendingTradeHoverPoint = null;

        if (
          !point
          || dragState
          || isChartInteractionActiveRef.current
          || !seriesRef.current
          || activeToolRef.current !== null
          || chartSettingsRef.current.showTradeLevels === false
        ) {
          setTradeHoverCursor(false);
          return;
        }

        // Read chart geometry once for this coalesced hover frame. The actual
        // trade-level scan is deliberately outside the active pan path.
        const rect = container.getBoundingClientRect();
        const isInside = (
          point.clientX >= rect.left
          && point.clientX <= rect.right
          && point.clientY >= rect.top
          && point.clientY <= rect.bottom
        );
        if (!isInside) {
          setTradeHoverCursor(false);
          return;
        }

        const y = point.clientY - rect.top;
        setTradeHoverCursor(Boolean(findClosestTradeLevel(y, TRADE_LEVEL_HIT_AREA_PX / 2)));
      });
    };

    const handlePointerDown = (e: PointerEvent) => {
      cancelQueuedTradeHover();
      setTradeHoverCursor(false);

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
      if (!tradeAllowed || isInvestorSession()) return;
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
      const targetTradeKey = targetBadge?.dataset.tradeKey;
      const targetRole = targetBadge?.dataset.role as TradeLevelRole | undefined;
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
          // The badge belongs to a retained trade whose position data is
          // refreshing; it is not draggable right now and the press must not
          // fall through to another trade's nearby level.
          return;
        }
      }

      if (!closestTrade) {
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
        setTradeHoverCursor(false);
        beginPointerCapture(targetLevel, e.pointerId);
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
        dragState = { tradeObj: closestTrade, grabbedType, entryAnchorY, pointerDownY: y, controlOffsetY, didDrag: false };
        if (grabbedType !== 'ENTRY') {
          hideDraggedLevelControls(closestTrade.key, grabbedType);
        }

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
        dragState.didDrag = hasChartTradeLevelGestureDragged(
          dragState.pointerDownY,
          y,
          dragState.didDrag,
        );
        const rawPrice = seriesRef.current.coordinateToPrice(y as Coordinate);
        if (rawPrice === null) return;

        const { tradeObj, grabbedType, entryAnchorY } = dragState;
        const digits = resolvedPriceDigitsRef.current;
        const minStopDistance = getTradeLevelDragMinDistance(digits);
        const liveCurrentPrice = activeTradeSnapshotsRef.current.get(tradeObj.key)?.currentPrice ?? tradeObj.currentPrice;
        const entryDragDirection = grabbedType === 'ENTRY' ? getEntryDragDirection(y, entryAnchorY) : null;

        // Entry-line clicks are ignored, but any real vertical drag should create SL/TP.
        // Existing SL/TP levels remain freely repositionable.
        const hasRealEntryDrag = entryDragDirection !== null;
        const showPreview = grabbedType !== 'ENTRY' || hasRealEntryDrag;
        const previewUpdate = showPreview
          ? applyTradeLevelDragUpdate({
            side: tradeObj.side,
            grabbedType,
            entryPrice: tradeObj.entryPrice,
            finalPrice: rawPrice,
            currentSl: tradeObj.sl,
            currentTp: tradeObj.tp,
            digits,
            currentPrice: liveCurrentPrice,
            minStopDistance,
            minEntryDistance: grabbedType === 'ENTRY' ? minStopDistance : undefined,
            snapEntryToMinDistance: grabbedType === 'ENTRY',
            entryDragDirection: entryDragDirection ?? undefined,
          })
          : null;

        if (!previewUpdate || !Number.isFinite(previewUpdate.price) || previewUpdate.price <= 0) {
          const idleY = grabbedType === 'ENTRY' ? entryAnchorY : y;
          dragLineOverlay.style.borderTopColor = 'transparent';
          dragBadgeOverlay.style.opacity = '0';
          if (dragZoneOverlay) dragZoneOverlay.style.display = 'none';
          dragLineOverlay.style.transform = `translate3d(0, ${idleY}px, 0)`;
          dragBadgeOverlay.style.transform = `translateY(calc(-50% + ${idleY}px))`;
          return;
        }

        const price = previewUpdate.price;
        const role = previewUpdate.role;
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
          digits,
          backendPnl: Number.isFinite(previewBackendPnl) ? previewBackendPnl : null,
          currentPrice: liveCurrentPrice,
          contractSize: Number(previewPositionRaw?.contractSize ?? previewPositionRaw?.contract_size) || undefined,
        });
        const previewCurrency = String(previewState.account?.currency || 'USD').trim().toUpperCase() || 'USD';
        const previewBadge = dragBadgeOverlay;
        bindChartUiTranslation(previewBadge, () => {
          previewBadge.textContent = `${tr(role)} ${price.toFixed(digits)}  ${previewCurrency}: ${formatMoneyLabel(previewMoney)}`;
        });
        dragBadgeOverlay.style.transform = `translateY(calc(-50% + ${drawY}px))`;
        return;
      }

      if (isChartInteractionActiveRef.current) {
        cancelQueuedTradeHover();
        setTradeHoverCursor(false);
        return;
      }

      if (
        !seriesRef.current
        || activeToolRef.current !== null
        || chartSettingsRef.current.showTradeLevels === false
      ) {
        cancelQueuedTradeHover();
        setTradeHoverCursor(false);
        return;
      }

      queueTradeHover(e);
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!dragState) return;
      if (capturedPointerId !== null && e.pointerId !== capturedPointerId) return;
      e.preventDefault();
      e.stopPropagation();

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
            const ticket = Number.parseInt(tradeObj.key.replace(/^trade:/, ''), 10);
            dispatchChartPositionModify({
              ticket,
              symbol: tradeObj.symbol,
              sessionScope: brokerAccountSessionScope,
            });
          }
        } else if (rawFinalPrice !== null) {
          lastLevelClick = null;
          const entryDragDirection = grabbedType === 'ENTRY' ? getEntryDragDirection(y, entryAnchorY) : null;
          const hasRealEntryDrag = entryDragDirection !== null;
          if (!(grabbedType === 'ENTRY' && !hasRealEntryDrag)) {
            const existingOverrides = getTradeLevelState(tradeLevelOverridesRef.current, tradeObj);
            const lastKnownLevels = getTradeLevelState(tradeLevelLastKnownLevelsRef.current, tradeObj);
            const currentSl = existingOverrides && existingOverrides.sl > 0
              ? existingOverrides.sl
              : lastKnownLevels && lastKnownLevels.sl > 0
                ? lastKnownLevels.sl
                : tradeObj.sl;
            const currentTp = existingOverrides && existingOverrides.tp > 0
              ? existingOverrides.tp
              : lastKnownLevels && lastKnownLevels.tp > 0
                ? lastKnownLevels.tp
                : tradeObj.tp;
            const digits = resolvedPriceDigitsRef.current;
            const liveCurrentPrice = activeTradeSnapshotsRef.current.get(tradeObj.key)?.currentPrice ?? tradeObj.currentPrice;
            const update = applyTradeLevelDragUpdate({
              side: tradeObj.side,
              grabbedType,
              entryPrice: tradeObj.entryPrice,
              finalPrice: rawFinalPrice,
              currentSl,
              currentTp,
              digits,
              currentPrice: liveCurrentPrice,
              minStopDistance: getTradeLevelDragMinDistance(digits),
              minEntryDistance: grabbedType === 'ENTRY' ? getTradeLevelDragMinDistance(digits) : undefined,
              snapEntryToMinDistance: grabbedType === 'ENTRY',
              entryDragDirection: entryDragDirection ?? undefined,
            });

            if (update) {
              const ticket = Number(tradeObj.key.replace('trade:', ''));
              if (ticket) {
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
                    window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
                  });
              }
            }
          }
        }
      }

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
      setTradeHoverCursor(false);

      if (chartRef.current) {
        chartRef.current.applyOptions({
          handleScroll: TRADING_VIEW_HANDLE_SCROLL,
          handleScale: TRADING_VIEW_HANDLE_SCALE,
        });
      }
    };

    const handlePointerCancel = () => {
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
      setTradeHoverCursor(false);
      if (chartRef.current) {
        chartRef.current.applyOptions({
          handleScroll: TRADING_VIEW_HANDLE_SCROLL,
          handleScale: TRADING_VIEW_HANDLE_SCALE,
        });
      }
    };

    interactionRoot.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      interactionRoot.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      cancelQueuedTradeHover();
      // A tab can deactivate mid-drag. Reuse the normal cancellation path so
      // capture, overlays, cursors, and chart scroll options are restored.
      handlePointerCancel();
      setTradeHoverCursor(false);
    };
  }, [
    activeToolRef,
    activeTradeSnapshotsRef,
    brokerAccountSessionScope,
    chartRef,
    chartSettingsRef,
    containerRef,
    isActive,
    isChartInteractionActiveRef,
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

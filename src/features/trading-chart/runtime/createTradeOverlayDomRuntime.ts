import type { RefObject } from 'react';
import type { ISeriesApi, SeriesType } from 'lightweight-charts';
import api from '../../../services/api';
import { useAppStore } from '../../../store/useAppStore';
import { getPricePointFromDigits } from '../../../utils/chartPriceScale';
import { rememberTradeHistoryPositionLevels } from '../../../utils/tradeHistoryLevelCache';
import {
  bindChartUiTranslation,
  bindTradeLevelHoverTarget,
  computeSignedPips,
  createDockedLevelChip,
  createEntryTradeControlBar,
  createTradeLevelControlBar,
  DARK_CHART_TRADE_COLORS,
  LIGHT_CHART_TRADE_COLORS,
  estimateTradeLevelMoney,
  estimateTradeMoneyAtPrice,
} from '../../../utils/chartTradeControls';
import { buildTradeHistoryBadgeText, formatTradeHistoryGmtTime } from '../../../utils/chartTradeHistoryPresentation';
import { buildTradeShareUrl, copyTextToClipboard } from '../../../utils/tradeShareLink';
import {
  normalizeTradeLevelDragPrice,
  protectionLevelViolation,
  roundProtectionLevelToGrid,
  tradeLevelModifyPatch,
} from '../../../utils/tradeLevelDrag';
import { readRegisteredSymbolPriceSpec } from '../../../services/dailyChangePriceModeRegistry';
import { readTradeValidationQuote } from '../../../services/tradeValidationQuote';
import { describeProtectionRefusal, formatOrderError } from '../../../utils/orderError';
import {
  handleStalePositionRefusal,
  isPositionKnownClosed,
  refuseSendForClosedPosition,
  requestPositionsRefresh,
} from '../../../utils/stalePositionRefusal';
import type { Timeframe, TradingViewChartTheme } from '../../../types/chart';
import { CHART_AXIS_FONT_FAMILY, clampAlpha, colorWithAlpha } from '../presentation/chartTheme';
import {
  getTradeOverlayCardPalette,
  getTradePlotClipLayer,
  placeTradeMarkerTooltip,
  TRADE_LEVEL_BADGE_LEFT_INSET_PX,
  TRADE_LEVEL_BADGE_STACK_OFFSET_PX,
  TRADE_LEVEL_HIT_AREA_PX,
  TRADE_LEVEL_OPTIMISTIC_GRACE_MS,
  type TradeOverlayCardTone,
  type TradeSide,
} from '../presentation/tradeOverlayPresentation';
import type { createTradeOverlayModelRuntime } from './createTradeOverlayModelRuntime';
import {
  getEntryLineColor,
  TRADE_ENTRY_LINE_BUY_COLOR,
  TRADE_ENTRY_LINE_SELL_COLOR,
  TRADE_PENDING_BUY_LINE_COLOR,
  TRADE_PENDING_SELL_LINE_COLOR,
} from './tradeOverlayRuntimeConstants';
import type {
  ActiveTradeSnapshot,
  EntryTradeControlOptions,
  OverlayNodeData,
  PriceLevelOptions,
  TradeLevelModifyRequestId,
  TradeLevelOverride,
  TradeLevelRole,
  TradeOverlayLayer,
  TradePositionRecord,
} from './tradeRuntimeContracts';

type TradeOverlayModelRuntime = ReturnType<typeof createTradeOverlayModelRuntime>;

type CreateTradeOverlayDomRuntimeOptions = {
  activeOverlayNodeDataRef: RefObject<OverlayNodeData[]>;
  activeOverlayNodesRef: RefObject<HTMLElement[]>;
  activeTradeSnapshotsRef: RefObject<Map<string, ActiveTradeSnapshot>>;
  brokerAccountSessionScope: string;
  chartThemeRef: RefObject<TradingViewChartTheme>;
  digits: number;
  historyOverlayNodeDataRef: RefObject<OverlayNodeData[]>;
  historyOverlayNodesRef: RefObject<HTMLElement[]>;
  isChartSurfaceLight: () => boolean;
  overlayRef: RefObject<HTMLDivElement | null>;
  pendingTradeLevelModifyRequestsRef: RefObject<Map<string, TradeLevelModifyRequestId>>;
  persistTradeLevelOverrides: () => void;
  prevTimeframeRef: RefObject<Timeframe>;
  seriesRef: RefObject<ISeriesApi<SeriesType> | null>;
  timeframe: Timeframe;
  tr: <T>(source: T, values?: Record<string, unknown>) => T;
  tradeControlLiveUpdatersRef: RefObject<Array<() => void>>;
  tradeLevelLastKnownLevelsRef: RefObject<Map<string, TradeLevelOverride>>;
  tradeLevelModifyRequestSeqRef: RefObject<TradeLevelModifyRequestId>;
  tradeLevelOptimisticGraceUntilRef: RefObject<Map<string, number>>;
  tradeLevelOverridesRef: RefObject<Map<string, TradeLevelOverride>>;
} & Pick<TradeOverlayModelRuntime,
  | 'deleteTradeLevelState'
  | 'formatTradeLevelBadgePrice'
  | 'getTradeLevelStateKeys'
  | 'getTradeTicketLabel'
  | 'resolveSymbolTick'
  | 'setTradeLevelState'
>;

export const createTradeOverlayDomRuntime = ({
  activeOverlayNodeDataRef,
  activeOverlayNodesRef,
  activeTradeSnapshotsRef,
  brokerAccountSessionScope,
  chartThemeRef,
  deleteTradeLevelState,
  digits,
  formatTradeLevelBadgePrice,
  getTradeLevelStateKeys,
  getTradeTicketLabel,
  historyOverlayNodeDataRef,
  historyOverlayNodesRef,
  isChartSurfaceLight,
  overlayRef,
  pendingTradeLevelModifyRequestsRef,
  persistTradeLevelOverrides,
  prevTimeframeRef,
  resolveSymbolTick,
  seriesRef,
  setTradeLevelState,
  timeframe,
  tr,
  tradeControlLiveUpdatersRef,
  tradeLevelLastKnownLevelsRef,
  tradeLevelModifyRequestSeqRef,
  tradeLevelOptimisticGraceUntilRef,
  tradeLevelOverridesRef,
}: CreateTradeOverlayDomRuntimeOptions) => {
    const createCollisionOffsetFactory = () => {
      const offsets = new Map<string, number>();

      return (_role: TradeLevelRole, price: number) => {
        const y = seriesRef.current?.priceToCoordinate(price);
        const bucket = y == null || !Number.isFinite(y)
          ? price.toFixed(digits)
          : String(Math.round(y / 18));
        const key = bucket;
        const offsetIndex = offsets.get(key) ?? 0;
        offsets.set(key, offsetIndex + 1);
        return offsetIndex;
      };
    };

    const appendOverlayNode = (element: HTMLElement, node: OverlayNodeData, layer: TradeOverlayLayer) => {
      const nodesRef = layer === 'active' ? activeOverlayNodesRef : historyOverlayNodesRef;
      const dataRef = layer === 'active' ? activeOverlayNodeDataRef : historyOverlayNodeDataRef;
      const overlayEl = overlayRef.current;
      if (overlayEl) {
        const clipsToPlot = node.kind === 'segment' || node.kind === 'marker';
        (clipsToPlot ? getTradePlotClipLayer(overlayEl) : overlayEl).appendChild(element);
      }
      nodesRef.current.push(element);
      dataRef.current.push(node);
    };

    const appendActiveInteractionNode = (element: HTMLElement, node: OverlayNodeData) => {
      const host = overlayRef.current?.parentElement ?? overlayRef.current;
      host?.appendChild(element);
      activeOverlayNodesRef.current.push(element);
      activeOverlayNodeDataRef.current.push(node);
    };

    const appendTradeControls = (control: HTMLElement, price: number) => {
      appendActiveInteractionNode(control, { kind: 'price-badge', price });
    };

    const appendHistoryInteractionNode = (element: HTMLElement, node: OverlayNodeData) => {
      const host = overlayRef.current?.parentElement ?? overlayRef.current;
      if (host) (node.kind === 'marker' ? getTradePlotClipLayer(host) : host).appendChild(element);
      historyOverlayNodesRef.current.push(element);
      historyOverlayNodeDataRef.current.push(node);
    };

    const createArrowSvg = (side: TradeSide) => {
      // MT5-style execution chevrons: blue for BUY fills, red for SELL fills.
      const color = side === 'BUY' ? '#2962ff' : '#f23645';
      const path = side === 'BUY'
        ? 'M3 7 7 3l4 4M3 11l4-4 4 4M7 8v9'
        : 'M3 13l4 4 4-4M3 9l4 4 4-4M7 3v9';
      return `<svg width="14" height="20" viewBox="0 0 14 20" fill="none" aria-hidden="true" style="display:block;overflow:visible"><path d="${path}" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    };

    const createTradeMarker = (side: TradeSide, price: number, time: number, title: string, layer: TradeOverlayLayer, opacity = 1, resolveTime?: () => number | null, lifecycle: 'open' | 'close' = 'open', historyPositionSide: TradeSide = side, executionTime = time) => {
      const marker = document.createElement('div');
      marker.className = `rtx-trade-marker rtx-trade-marker--${layer} rtx-trade-marker--${lifecycle}`;
      marker.dataset.tradeLifecycle = lifecycle;
      if (layer === 'active') marker.title = title;
      const isHistoryMarker = layer === 'history';
      const markerWidth = 14;
      const markerHeight = 20;
      marker.innerHTML = createArrowSvg(side);
      marker.style.cssText = `position:absolute;display:none;width:${markerWidth}px;height:${markerHeight}px;z-index:${isHistoryMarker ? 20 : 16};pointer-events:none;opacity:${opacity};filter:none;`;
      appendOverlayNode(marker, { kind: 'marker', price, time, markerSide: side, resolveTime, markerAnchor: 'candle', pixelOffsetY: side === 'BUY' ? -3 : 3 }, layer);

      if (layer !== 'history') return;

      const lightSurface = isChartSurfaceLight();
      const palette = getTradeOverlayCardPalette(side, lightSurface);
      const lifecycleLabel = lifecycle === 'open' ? 'OPEN' : 'CLOSE';
      const timeLabel = formatTradeHistoryGmtTime(executionTime, { includeSeconds: true });
      const accessibleLabel = buildTradeHistoryBadgeText({
        positionSide: historyPositionSide,
        lifecycle: lifecycleLabel,
        price,
        digits,
        time: executionTime,
        includeSeconds: true,
      });
      const hoverTarget = document.createElement('div');
      hoverTarget.className = `rtx-trade-marker-hover-target rtx-trade-marker-hover-target--${lifecycle}`;
      hoverTarget.dataset.tradeLifecycle = lifecycle;
      hoverTarget.dataset.hoverPrice = title;
      hoverTarget.dataset.hoverTime = timeLabel;
      hoverTarget.dataset.positionSide = historyPositionSide;
      hoverTarget.dataset.historyAccessibleLabel = accessibleLabel;
      hoverTarget.setAttribute('role', 'img');
      hoverTarget.setAttribute('aria-label', accessibleLabel.replace(
        `${historyPositionSide} ${lifecycleLabel}`,
        `${tr(historyPositionSide)} ${tr(lifecycle === 'open' ? 'Open' : 'Close')}`,
      ));
      hoverTarget.tabIndex = 0;
      hoverTarget.style.cssText = 'position:absolute;display:none;width:32px;height:36px;z-index:22;pointer-events:auto;cursor:help;background:transparent;';

      const tooltip = document.createElement('span');
      tooltip.className = 'rtx-trade-marker__price-tooltip';
      const verticalPosition = side === 'BUY'
        ? 'bottom:calc(100% + 7px);'
        : 'top:calc(100% + 7px);';
      const tooltipBackground = lightSurface ? '#ffffff' : '#111827';
      const tooltipText = lightSurface ? '#182230' : '#f8fafc';
      tooltip.style.cssText = `position:absolute;left:50%;${verticalPosition}display:block;min-width:148px;padding:0;border:1px solid ${palette.border};border-radius:6px;background:${tooltipBackground};color:${tooltipText};font-size:var(--rtx-ui-font-size, 14px);font-family:${CHART_AXIS_FONT_FAMILY};font-variant-numeric:tabular-nums;line-height:16px;white-space:nowrap;pointer-events:none;opacity:0;visibility:hidden;transform:translateX(-50%);transition:opacity 90ms ease;box-shadow:0 6px 18px rgba(0,0,0,0.38);overflow:hidden;`;

      const tooltipHeader = document.createElement('span');
      tooltipHeader.className = 'rtx-trade-marker__tooltip-header';
      tooltipHeader.textContent = `${tr(historyPositionSide)} ${tr(lifecycle === 'open' ? 'Open' : 'Close')}`;
      tooltipHeader.style.cssText = `display:block;padding:3px 8px;border-bottom:1px solid ${colorWithAlpha(palette.border, 0.5, palette.border)};background:${palette.background};color:${palette.text};font-size:var(--rtx-ui-font-size, 14px);font-weight:var(--rtx-font-weight-heading, 500);letter-spacing:0.075em;`;

      const tooltipDetails = document.createElement('span');
      tooltipDetails.className = 'rtx-trade-marker__tooltip-details';
      tooltipDetails.style.cssText = 'display:grid;grid-template-columns:auto 1fr;column-gap:10px;row-gap:1px;padding:4px 8px 5px;';
      const detailLabelColor = lightSurface ? '#475569' : '#98a2b3';
      const appendTooltipDetail = (labelText: string, valueText: string) => {
        const label = document.createElement('span');
        label.dataset.chartUiLabel = labelText;
        label.textContent = tr(labelText);
        label.style.cssText = `color:${detailLabelColor};font-weight:var(--rtx-font-weight-control, 400);`;
        const value = document.createElement('span');
        value.textContent = valueText;
        value.style.cssText = `color:${tooltipText};font-weight:var(--rtx-font-weight-body, 400);text-align:right;`;
        tooltipDetails.append(label, value);
      };
      appendTooltipDetail('Price', title);
      appendTooltipDetail('Time', timeLabel);
      tooltip.append(tooltipHeader, tooltipDetails);

      const setPriceTooltipVisible = (visible: boolean) => {
        if (visible) placeTradeMarkerTooltip(hoverTarget, tooltip);
        tooltip.style.opacity = visible ? '1' : '0';
        tooltip.style.visibility = visible ? 'visible' : 'hidden';
      };
      hoverTarget.addEventListener('pointerenter', () => setPriceTooltipVisible(true));
      hoverTarget.addEventListener('pointerleave', () => setPriceTooltipVisible(false));
      hoverTarget.addEventListener('focus', () => setPriceTooltipVisible(true));
      hoverTarget.addEventListener('blur', () => setPriceTooltipVisible(false));
      hoverTarget.appendChild(tooltip);
      appendHistoryInteractionNode(
        hoverTarget,
        { kind: 'marker', price, time, markerSide: side, resolveTime, markerAnchor: 'candle', pixelOffsetY: side === 'BUY' ? -3 : 3 },
      );
    };

    const createTradeHistoryLine = (
      price: number,
      time: number,
      endPrice: number,
      endTime: number,
      color: string,
      opacity: number,
      arrowSides?: { start: TradeSide; end: TradeSide },
    ) => {
      const line = document.createElement('div');
      line.className = 'rtx-trade-history-line';
      line.style.cssText = `position:absolute;display:none;height:1px;background:${color};border:0;border-radius:999px;z-index:17;pointer-events:none;opacity:${clampAlpha(opacity)};transform-origin:0 50%;will-change:transform,width;`;
      appendOverlayNode(line, {
        kind: 'segment',
        price,
        time,
        endPrice,
        endTime,
        startMarkerSide: arrowSides?.start,
        endMarkerSide: arrowSides?.end,
      }, 'history');
    };

    const createPriceLevel = (labelText: string, price: number, color: string, options: PriceLevelOptions = {}) => {
      if (!(price > 0)) return;

      const line = document.createElement('div');
      line.className = options.role ? `rtx-trade-level-line rtx-trade-level-line--${options.role.toLowerCase()}` : 'rtx-trade-level-line';
      if (options.tradeKey) line.dataset.tradeKey = options.tradeKey;
      if (options.role) line.dataset.role = options.role;
      const lineColor = options.lineColor ?? color;
      const lineWidth = options.lineWidthPx ?? 1;
      const lineOpacity = options.role === 'SL' || options.role === 'TP' ? 0.9 : 1;
      line.style.cssText = `position:absolute;display:none;height:0;border-top:${lineWidth}px dashed ${lineColor};z-index:12;pointer-events:none;opacity:${lineOpacity};`;
      appendOverlayNode(line, { kind: 'horizontal-line', price }, 'active');

      if (options.tradeKey && options.role) {
        const hitArea = document.createElement('div');
        hitArea.className = 'rtx-trade-level-hit-area';
        hitArea.dataset.tradeKey = options.tradeKey;
        hitArea.dataset.role = options.role;
        bindChartUiTranslation(hitArea, () => {
          const title = options.getTitle?.() ?? options.title ?? '';
          if (options.role === 'SL' || options.role === 'TP') {
            hitArea.setAttribute('aria-label', title);
          } else hitArea.title = title;
        });
        hitArea.style.cssText = `position:absolute;display:none;height:${TRADE_LEVEL_HIT_AREA_PX}px;transform:translateY(-50%);z-index:15;pointer-events:auto;background:transparent;touch-action:none;`;
        hitArea.style.cursor = 'default';
        appendActiveInteractionNode(hitArea, { kind: 'price-hit-area', price });
      }

      // 'none' keeps the line + drag hit-area but hands labelling over to the
      // cTrader-style control bars built alongside.
      if (options.labelVariant === 'none') return;

      const badge = document.createElement('div');
      bindChartUiTranslation(badge, () => {
        const text = options.getLabel?.() ?? labelText;
        const roleLabel = options.role === 'SL' || options.role === 'TP' ? tr(options.role) : '';
        if (options.tradeKey && roleLabel && text.startsWith(roleLabel)) {
          const dragLabel = document.createElement('span');
          dragLabel.className = 'rtx-trade-level-drag-label';
          dragLabel.style.cursor = 'grab';
          dragLabel.textContent = roleLabel;
          badge.replaceChildren(dragLabel, document.createTextNode(text.slice(roleLabel.length)));
        } else {
          badge.textContent = text;
        }
        badge.title = options.getTitle?.() ?? options.title ?? '';
      });
      badge.className = 'rtx-trade-level-badge';
      if (options.tradeKey && options.role) {
        badge.dataset.tradeKey = options.tradeKey;
        badge.dataset.role = options.role;
      }
      const upperLabel = labelText.trim().toUpperCase();
      const tone: TradeOverlayCardTone = options.role === 'TP' || upperLabel.startsWith('TP')
        ? 'TP'
        : options.role === 'SL' || upperLabel.startsWith('SL')
          ? 'SL'
          : upperLabel.startsWith('SELL')
            ? 'SELL'
            : 'BUY';
      const palette = getTradeOverlayCardPalette(tone, isChartSurfaceLight());
      const offsetIndex = options.badgeOffsetIndex ?? 0;
      const offsetX = offsetIndex * TRADE_LEVEL_BADGE_STACK_OFFSET_PX;
      const leftInset = TRADE_LEVEL_BADGE_LEFT_INSET_PX + offsetX;
      const canDrag = Boolean(options.tradeKey && options.role);
      const isLineTextLabel = options.labelVariant === 'lineText';
      if (isLineTextLabel) badge.classList.add('rtx-trade-level-badge--line-text');
      badge.dataset.leftInset = String(leftInset);
      badge.dataset.display = isLineTextLabel ? 'block' : 'inline-flex';
      badge.style.cssText = isLineTextLabel
        ? `position:absolute;left:${leftInset}px;display:none;padding:0 2px;background:transparent;border:0;color:${color};font-size:var(--rtx-ui-font-size, 14px);font-family:Consolas,'Courier New',monospace;font-weight:var(--rtx-font-weight-control, 400);line-height:14px;white-space:nowrap;z-index:21;pointer-events:${canDrag ? 'auto' : 'none'};border-radius:0;transform:none;width:max-content;max-width:calc(100% - ${leftInset + 12}px);box-sizing:border-box;text-align:left;touch-action:none;letter-spacing:0;text-shadow:none;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;`
        : `position:absolute;left:${leftInset}px;display:none;align-items:center;justify-content:center;padding:1px 6px;background:${palette.background};border:1px solid ${palette.border};color:${palette.text};font-size:var(--rtx-ui-font-size, 14px);font-family:Consolas,'Courier New',monospace;font-weight:var(--rtx-font-weight-control, 400);white-space:nowrap;z-index:21;pointer-events:${canDrag ? 'auto' : 'none'};border-radius:2px;transform:translateY(-50%);width:max-content;min-width:52px;max-width:calc(100% - ${leftInset + 12}px);box-sizing:border-box;text-align:center;touch-action:none;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;${palette.shadow}`;
      badge.style.cursor = 'default';
      appendOverlayNode(badge, { kind: 'price-badge', price }, 'active');
    };

    // â”€â”€ cTrader-style position controls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const getAccountCurrencyLabel = (): string => {
      const currency = String(useAppStore.getState().account?.currency || '').trim().toUpperCase();
      return currency || 'USD';
    };

    const getLocalizedTradeTitle = (trade: ActiveTradeSnapshot, role?: 'SL' | 'TP', price?: number) => [
      tr(trade.side),
      tr('{{value0}} lots', { value0: trade.volume }),
      tr('Ticket: {{value0}}', { value0: getTradeTicketLabel(trade.key) || trade.key }),
      role
        ? tr(role === 'SL' ? 'Stop Loss: {{value0}}' : 'Take Profit: {{value0}}', { value0: price ? formatTradeLevelBadgePrice(price) : 'â€”' })
        : tr('Open price: {{value0}}', { value0: formatTradeLevelBadgePrice(trade.entryPrice) }),
      tr(role ? 'Modify Position' : 'Add stop loss and take profit'),
    ].join(' Â· ');

    const getTradeTicket = (tradeKey: string): number => {
      const raw = tradeKey.replace(/^(trade|order):/, '');
      if (!/^\d+$/.test(raw)) return 0;
      const ticket = Number(raw);
      return Number.isSafeInteger(ticket) && ticket > 0 ? ticket : 0;
    };

    const findStorePosition = (ticket: number): TradePositionRecord | null => {
      if (!ticket) return null;
      const positions = useAppStore.getState().positions;
      if (!Array.isArray(positions)) return null;
      return positions.find((position) => (
        Number(position.id ?? (position as TradePositionRecord).ticket) === ticket
      )) ?? null;
    };

    const getTradeClosePrice = (trade: ActiveTradeSnapshot): number => {
      const tick = resolveSymbolTick(useAppStore.getState().ticks);
      const closeQuote = trade.side === 'BUY' ? Number(tick?.bid) : Number(tick?.ask);
      if (Number.isFinite(closeQuote) && closeQuote > 0) return closeQuote;
      const live = activeTradeSnapshotsRef.current.get(trade.key)?.currentPrice ?? trade.currentPrice;
      return Number.isFinite(live) && live > 0 ? live : trade.entryPrice;
    };

    // Projected money at a level. Prefers scaling the backend-reported live
    // profit (keeps account-currency conversion authoritative); falls back to
    // a contract-size estimate when the live P/L baseline is too small.
    const estimateMoneyAtLevel = (trade: ActiveTradeSnapshot, levelPrice: number): number | null => {
      const position = findStorePosition(getTradeTicket(trade.key));
      const backendPnl = Number(position?.unrealizedPnL ?? position?.profit ?? position?.unrealized_pl);
      return estimateTradeLevelMoney({
        symbol: trade.symbol,
        side: trade.side,
        volume: trade.volume,
        entryPrice: trade.entryPrice,
        levelPrice,
        digits,
        backendPnl: Number.isFinite(backendPnl) ? backendPnl : null,
        currentPrice: getTradeClosePrice(trade),
        contractSize: Number(position?.contractSize ?? position?.contract_size) || undefined,
      });
    };

    const addTradeAxisPriceLine = (key: string, price: number, color: string) => {
      if (!(price > 0) || !seriesRef.current) return;
      const badge = document.createElement('div');
      badge.className = 'rtx-trade-axis-price-badge';
      badge.dataset.tradeAxisKey = key;
      badge.textContent = seriesRef.current.priceFormatter().format(price);
      const lightSurface = isChartSurfaceLight();
      const lightEntryColors: Record<string, string> = {
        [TRADE_ENTRY_LINE_BUY_COLOR]: LIGHT_CHART_TRADE_COLORS.buy,
        [TRADE_ENTRY_LINE_SELL_COLOR]: LIGHT_CHART_TRADE_COLORS.sell,
        [TRADE_PENDING_BUY_LINE_COLOR]: LIGHT_CHART_TRADE_COLORS.pendingBuy,
        [TRADE_PENDING_SELL_LINE_COLOR]: LIGHT_CHART_TRADE_COLORS.pendingSell,
      };
      const axisColor = lightSurface ? (lightEntryColors[color] ?? color) : color;
      const borderColor = colorWithAlpha(axisColor, lightSurface ? 0.38 : 0.48, axisColor);
      const background = chartThemeRef.current.background ?? (lightSurface ? '#fafbfc' : '#000000');
      badge.style.cssText = `position:absolute;display:none;right:0;height:18px;align-items:center;justify-content:flex-end;padding:0 6px;box-sizing:border-box;border:1px solid ${borderColor};border-radius:3px;background-color:${background};background-image:none;color:${axisColor};font-family:${CHART_AXIS_FONT_FAMILY};font-size:12px;font-weight:600;line-height:16px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;transform:translateY(-50%);pointer-events:none;z-index:8;`;
      badge.style.setProperty('--rtx-type-size', '12px');
      badge.style.setProperty('--rtx-type-weight', '600');
      badge.style.setProperty('--rtx-type-family', CHART_AXIS_FONT_FAMILY);
      appendActiveInteractionNode(badge, { kind: 'axis-price-badge', price });
    };

    // Presentation groups use the exact entry price, never a rounded label or
    // screen coordinate. They never own a ticket's SL/TP or trading actions.
    const createEntryPriceLevels = (
      trades: readonly ActiveTradeSnapshot[],
      liveTradeKeys: ReadonlySet<string>,
    ) => {
      const groups = new Map<number, ActiveTradeSnapshot[]>();
      for (const trade of trades) {
        if (!Number.isFinite(trade.entryPrice) || !(trade.entryPrice > 0)) continue;
        const group = groups.get(trade.entryPrice) ?? [];
        group.push(trade);
        groups.set(trade.entryPrice, group);
      }
      for (const [price, group] of groups) {
        const first = group[0];
        const sameSideAndKind = group.every(
          trade => trade.side === first.side && (trade.kind === 'pending') === (first.kind === 'pending'),
        );
        const color = sameSideAndKind
          ? getEntryLineColor(first.side, first.kind)
          : chartThemeRef.current.axisText || (isChartSurfaceLight() ? '#475569' : '#b9bcc6');
        const owner = group.length === 1 && liveTradeKeys.has(first.key) ? first : undefined;
        createPriceLevel('', price, color, {
          role: 'ENTRY',
          // A shared price line cannot choose which position to modify.
          tradeKey: owner?.key,
          getTitle: () => group.map(trade => getLocalizedTradeTitle(trade)).join('\n'),
          labelVariant: 'none',
          lineColor: color,
        });
        addTradeAxisPriceLine(`entry-price:${price}`, price, color);
      }
    };

    // Optimistic SL/TP submission used by the level-bar âœ• buttons. Mirrors the
    // drag-release flow: override immediately, then reconcile or roll back.
    const submitTradeLevelChange = (
      tradeObj: ActiveTradeSnapshot,
      nextLevels: TradeLevelOverride,
      previousLevels: TradeLevelOverride,
      role: 'SL' | 'TP',
    ) => {
      const ticket = getTradeTicket(tradeObj.key);
      if (!ticket) return;
      // Pre-send check: a level whose position already closed must not reach the modify API.
      if (isPositionKnownClosed(ticket)) {
        window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
          detail: { message: refuseSendForClosedPosition(ticket, { refresh: requestPositionsRefresh, tr }), type: 'error' },
        }));
        return;
      }
      if (getTradeLevelStateKeys(tradeObj).some(key => pendingTradeLevelModifyRequestsRef.current.has(key))) {
        window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
          detail: { message: `${tr('Modify Position')}: ${tr('Processing...')}`, type: 'error' },
        }));
        return;
      }
      // Normalize to the symbol grid, then block broker-invalid levels
      // before sending (same rule as the drag path; the server stays final
      // authority for race cases). Broker catalog spec only: never the
      // chart's name-table digits, quote digits (the tick normalizer may
      // fill them from the name table) or a default. Unknown precision sends
      // the level unrounded and the check degrades to side-only.
      const submitSpec = readRegisteredSymbolPriceSpec(tradeObj.symbol);
      const submitDigits = submitSpec.digits;
      const submitTickSize = submitSpec.tickSize;
      const submitPrice = normalizeTradeLevelDragPrice(
        roundProtectionLevelToGrid(role === 'SL' ? nextLevels.sl || 0 : nextLevels.tp || 0, submitDigits, submitTickSize),
        submitDigits,
      );
      nextLevels = {
        ...nextLevels,
        ...(role === 'SL' ? { sl: submitPrice } : { tp: submitPrice }),
      };
      // Validated locally only against a fresh Market Watch quote (same source as the
      // chart and Market Watch rows). Without one the request is sent and the server decides.
      const submitQuote = submitPrice > 0 ? readTradeValidationQuote(tradeObj.symbol) : null;
      const submitViolation = submitQuote
        ? protectionLevelViolation({
          side: String(tradeObj.side).toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
          role,
          price: submitPrice,
          bid: submitQuote.bid,
          ask: submitQuote.ask,
          digits: submitDigits,
          tickSize: submitTickSize,
        })
        : null;
      if (submitViolation) {
        window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
          detail: { message: submitViolation, type: 'error' },
        }));
        return;
      }
      // Mark the request pending only once it will really be sent, so a
      // refused level never leaves the trade stuck in "Processing...".
      const requestId = tradeLevelModifyRequestSeqRef.current + 1;
      tradeLevelModifyRequestSeqRef.current = requestId;
      const requestKeys = getTradeLevelStateKeys(tradeObj);
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

      setTradeLevelState(tradeLevelOverridesRef.current, tradeObj, { sl: nextLevels.sl || 0, tp: nextLevels.tp || 0 });
      setTradeLevelState(tradeLevelLastKnownLevelsRef.current, tradeObj, { sl: nextLevels.sl || 0, tp: nextLevels.tp || 0 });
      persistTradeLevelOverrides();
      rememberTradeHistoryPositionLevels([
        {
          id: ticket,
          symbol: tradeObj.symbol,
          side: tradeObj.side,
          volume: tradeObj.volume,
          entryPrice: tradeObj.entryPrice,
          entryTime: tradeObj.entryTime,
          sl: nextLevels.sl || 0,
          tp: nextLevels.tp || 0,
          price_sl: nextLevels.sl || 0,
          price_tp: nextLevels.tp || 0,
        },
      ], useAppStore.getState().accountId);
      window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
      window.dispatchEvent(new CustomEvent('rtx:trade-modified', {
        detail: {
          id: ticket,
          symbol: tradeObj.symbol,
          sl: nextLevels.sl || 0,
          tp: nextLevels.tp || 0,
          sessionScope: brokerAccountSessionScope,
        },
      }));

      const submitPromise = tradeObj.kind === 'pending'
        ? api.orders.modifyPendingOrder(ticket, {
            price: tradeObj.entryPrice,
            ...(role === 'SL' ? { price_sl: nextLevels.sl || 0 } : { price_tp: nextLevels.tp || 0 }),
          })
        : api.positions.modifyPosition(ticket, tradeLevelModifyPatch(role, role === 'SL' ? nextLevels.sl || 0 : nextLevels.tp || 0));

      submitPromise
        .then(() => {
          if (!isCurrentRequest()) return;
          clearCurrentRequest();
          if (tradeObj.kind === 'pending') {
            const loginId = Number.parseInt(String(useAppStore.getState().accountId ?? ''), 10);
            if (Number.isFinite(loginId) && loginId > 0) {
              void api.orders.getPendingOrders(loginId)
                .then((orders) => useAppStore.getState().setOrders(orders as any))
                .catch(() => undefined);
            }
          } else {
            window.setTimeout(() => window.dispatchEvent(new Event('rtx:force-refresh-positions')), 250);
          }
        })
        .catch((err) => {
          if (!isCurrentRequest()) return;
          clearCurrentRequest();
          requestKeys.forEach((key) => tradeLevelOptimisticGraceUntilRef.current.delete(key));
          console.error('[Chart] Failed to update SL/TP from level bar:', err);
          if ((previousLevels.sl || 0) > 0 || (previousLevels.tp || 0) > 0) {
            setTradeLevelState(tradeLevelOverridesRef.current, tradeObj, previousLevels);
            setTradeLevelState(tradeLevelLastKnownLevelsRef.current, tradeObj, previousLevels);
          } else {
            deleteTradeLevelState(tradeLevelOverridesRef.current, tradeObj);
            deleteTradeLevelState(tradeLevelLastKnownLevelsRef.current, tradeObj);
          }
          persistTradeLevelOverrides();
          window.dispatchEvent(new CustomEvent('rtx:flush-trade-overlay'));
          window.dispatchEvent(new CustomEvent('rtx:trade-modified', {
            detail: {
              id: ticket,
              symbol: tradeObj.symbol,
              sl: previousLevels.sl || 0,
              tp: previousLevels.tp || 0,
              sessionScope: brokerAccountSessionScope,
            },
          }));
          // Name the offending level against the live quote when the server
          // refused the geometry (never a bare "Failed").
          const staleMessage = handleStalePositionRefusal(err, ticket, { refresh: requestPositionsRefresh, tr });
          if (staleMessage) {
            window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
              detail: { message: staleMessage, type: 'error' },
            }));
            return;
          }
          const domQuote = readTradeValidationQuote(tradeObj.symbol);
          const domRefusal = describeProtectionRefusal(err, {
            side: String(tradeObj.side).toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
            sl: nextLevels.sl || 0,
            tp: nextLevels.tp || 0,
            bid: domQuote?.bid ?? 0,
            ask: domQuote?.ask ?? 0,
            digits: submitDigits,
          });
          window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
            detail: { message: domRefusal ?? formatOrderError(err), type: 'error' },
          }));
        });
    };

    const createEntryControlsForTrade = (
      trade: ActiveTradeSnapshot,
      levels: TradeLevelOverride,
      options: EntryTradeControlOptions = {},
    ) => {
      const ticket = getTradeTicket(trade.key);
      if (!ticket) return;
      const lightSurface = isChartSurfaceLight();
      const ticketLabel = getTradeTicketLabel(trade.key);
      const entryPriceLabel = formatTradeLevelBadgePrice(trade.entryPrice);
      const currencyLabel = getAccountCurrencyLabel();

      const controlBar = createEntryTradeControlBar({
        tradeKey: trade.key,
        ticket,
        symbol: trade.symbol,
        side: trade.side,
        kind: trade.kind,
        orderTypeLabel: trade.orderType ? trade.orderType.replace(/_/g, ' ').toUpperCase() : undefined,
        volume: trade.volume,
        isLightSurface: lightSurface,
        plainLabel: true,
        chartBackground: chartThemeRef.current.background,
        leftInset: TRADE_LEVEL_BADGE_LEFT_INSET_PX,
        currencyLabel,
        title: `${trade.side} ${trade.volume} ${ticketLabel} @ ${entryPriceLabel}. Drag above/below to create TP or SL.`,
        onAction: (action) => {
          if (trade.kind === 'pending' && action === 'close') {
            void api.orders.cancelOrder(String(ticket))
              .then(() => {
                const loginId = Number.parseInt(String(useAppStore.getState().accountId ?? ''), 10);
                if (Number.isFinite(loginId) && loginId > 0) {
                  return api.orders.getPendingOrders(loginId).then((orders) => {
                    useAppStore.getState().setOrders(orders as any);
                  });
                }
              })
              .catch((err) => {
                window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
                  detail: { message: formatOrderError(err), type: 'error' },
                }));
              });
          }
        },
        onShare: () => {
          const shareUrl = buildTradeShareUrl({
            version: 1,
            ticket,
            symbol: trade.symbol,
            timeframe: String(prevTimeframeRef.current || timeframe),
            side: trade.side,
            volume: trade.volume,
            entryPrice: trade.entryPrice,
            entryTime: trade.entryTime,
            sl: levels.sl || 0,
            tp: levels.tp || 0,
          });
          void copyTextToClipboard(shareUrl).then((copied) => {
            window.dispatchEvent(new CustomEvent('rtx:order-feedback', {
              detail: copied
                ? { message: `${tr('Copied')} Â· ${tr('Trade')} URL: ${ticketLabel || trade.symbol}`, type: 'success' }
                : { message: `${tr('Copy')} Â· ${tr('Failed')}`, type: 'error' },
            }));
          });
        },
      });
      controlBar.root.dataset.entryPrice = String(trade.entryPrice);
      bindChartUiTranslation(controlBar.root, () => { controlBar.root.title = getLocalizedTradeTitle(trade); });
      // Entry controls retain their actual price for placement centered on the line.
      appendTradeControls(controlBar.root, trade.entryPrice);

      const refreshLiveMetrics = () => {
        const closePrice = getTradeClosePrice(trade);
        const pips = computeSignedPips(trade.side, trade.entryPrice, closePrice, digits);
        const position = findStorePosition(ticket);
        const backendPnl = Number(position?.unrealizedPnL ?? position?.profit ?? position?.unrealized_pl);
        const money = position && Number.isFinite(backendPnl)
          ? backendPnl
          : estimateTradeMoneyAtPrice({
            symbol: trade.symbol,
            side: trade.side,
            volume: trade.volume,
            entryPrice: trade.entryPrice,
            price: closePrice,
          });
        controlBar.setLiveMetrics(pips, money);
      };
      tradeControlLiveUpdatersRef.current.push(refreshLiveMetrics);
      refreshLiveMetrics();

      if (options.showAxisPriceLine !== false) {
        addTradeAxisPriceLine(`${trade.key}:entry`, trade.entryPrice, getEntryLineColor(trade.side, trade.kind));
      }

      // Keep both levels reachable from the entry strip, including when an
      // existing level's price is outside the visible chart scale.
      const appendDockChip = (chip: HTMLElement, role: 'SL' | 'TP') => {
        const accent = role === 'TP'
          ? (lightSurface ? LIGHT_CHART_TRADE_COLORS.tp : DARK_CHART_TRADE_COLORS.tp)
          : (lightSurface ? LIGHT_CHART_TRADE_COLORS.sl : DARK_CHART_TRADE_COLORS.sl);
        const restingBorderColor = `${accent}d9`;
        Object.assign(chip.style, {
          position: 'static', display: 'inline-flex', transform: 'none',
          fontWeight: '600', fontFamily: 'var(--rtx-ui-font-family, "Segoe UI", Tahoma, Arial, sans-serif)', fontSize: '10.5px', letterSpacing: '0.02em',
          color: accent, padding: '0 4px', height: '14px', lineHeight: '12px', boxSizing: 'border-box',
          minWidth: '22px', justifyContent: 'center', flex: '0 0 auto',
          backgroundColor: lightSurface
            ? (role === 'TP' ? '#e1f2ed' : '#fff0cc')
            : (role === 'TP' ? '#143825' : '#3b2814'),
          border: `1px solid ${restingBorderColor}`, borderRadius: '2px', textShadow: 'none',
        });
        chip.style.setProperty('--rtx-type-size', '10.5px');
        chip.style.setProperty('--rtx-type-weight', '600');
        const dragLabel = chip.querySelector<HTMLElement>('.rtx-trade-level-drag-label');
        if (dragLabel) {
          dragLabel.style.fontSize = '10.5px';
          dragLabel.style.fontWeight = '600';
          dragLabel.style.letterSpacing = '0.02em';
          dragLabel.style.setProperty('--rtx-type-size', '10.5px');
          dragLabel.style.setProperty('--rtx-type-weight', '600');
        }
        chip.addEventListener('mouseenter', () => {
          chip.style.borderColor = accent;
          chip.style.borderStyle = 'solid';
        });
        chip.addEventListener('mouseleave', () => {
          chip.style.borderColor = restingBorderColor;
        });
        const brackets = controlBar.root.querySelector<HTMLElement>('.rtx-trade-brackets')
          ?? controlBar.root.querySelector<HTMLElement>('.rtx-trade-control-actions')
          ?? controlBar.root;
        const before = role === 'TP' ? brackets.querySelector('.rtx-trade-dock-chip--sl') : null;
        brackets.insertBefore(chip, before);
      };
      if (!(levels.sl > 0)) {
        const slChip = createDockedLevelChip({
          tradeKey: trade.key,
          role: 'SL',
          label: 'SL',
          isLightSurface: lightSurface,
          leftInset: TRADE_LEVEL_BADGE_LEFT_INSET_PX,
          title: `Drag to set Stop Loss for ${ticketLabel || trade.key}`,
        });
        bindChartUiTranslation(slChip, () => { slChip.title = getLocalizedTradeTitle(trade, 'SL'); });
        appendDockChip(slChip, 'SL');
      }
      if (!(levels.tp > 0)) {
        const tpChip = createDockedLevelChip({
          tradeKey: trade.key,
          role: 'TP',
          label: 'TP',
          isLightSurface: lightSurface,
          leftInset: TRADE_LEVEL_BADGE_LEFT_INSET_PX,
          title: `Drag to set Take Profit for ${ticketLabel || trade.key}`,
        });
        bindChartUiTranslation(tpChip, () => { tpChip.title = getLocalizedTradeTitle(trade, 'TP'); });
        appendDockChip(tpChip, 'TP');
      }
      const brackets = controlBar.root.querySelector<HTMLElement>('.rtx-trade-brackets');
      if (brackets && brackets.childElementCount === 0) {
        brackets.style.display = 'none';
      }
    };

    const createLevelControlsForTrade = (
      trade: ActiveTradeSnapshot,
      role: 'SL' | 'TP',
      levels: TradeLevelOverride,
    ) => {
      const levelPrice = role === 'SL' ? levels.sl : levels.tp;
      if (!(levelPrice > 0)) return;
      const lightSurface = isChartSurfaceLight();
      const ticketLabel = getTradeTicketLabel(trade.key);
      const levelNodes = activeOverlayNodesRef.current.filter(node => (
        node.dataset.tradeKey === trade.key && node.dataset.role === role
      ));
      const levelBar = createTradeLevelControlBar({
        tradeKey: trade.key,
        role,
        side: trade.side,
        label: role,
        pips: computeSignedPips(trade.side, trade.entryPrice, levelPrice, digits),
        money: estimateMoneyAtLevel(trade, levelPrice),
        hoverDetails: {
          entryPrice: trade.entryPrice,
          levelPrice,
          digits,
          tickSize: getPricePointFromDigits(digits),
        },
        chartBackground: chartThemeRef.current.background,
        onHoverChange: active => {
          for (const node of levelNodes) {
            if (node.classList.contains('rtx-trade-level-line')) node.style.opacity = active ? '1' : '0.9';
          }
        },
        isLightSurface: lightSurface,
        leftInset: TRADE_LEVEL_BADGE_LEFT_INSET_PX,
        currencyLabel: getAccountCurrencyLabel(),
        title: `${role === 'SL' ? 'Stop Loss' : 'Take Profit'} for ${ticketLabel || trade.key} @ ${formatTradeLevelBadgePrice(levelPrice)}. Drag to move.`,
        onRemove: () => submitTradeLevelChange(
          trade,
          role === 'SL' ? { sl: 0, tp: levels.tp || 0 } : { sl: levels.sl || 0, tp: 0 },
          { sl: levels.sl || 0, tp: levels.tp || 0 },
          role,
        ),
      });
      bindChartUiTranslation(levelBar, () => {
        const title = getLocalizedTradeTitle(trade, role, levelPrice);
        levelBar.setAttribute('aria-label', title);
      });
      // Match the line hit-area's host so the bar's z-index can put its
      // remove button above that full-width drag target. The drawing overlay
      // creates a lower stacking context, regardless of the bar's z-index.
      appendTradeControls(levelBar, levelPrice);
      for (const node of levelNodes) {
        if (node.classList.contains('rtx-trade-level-hit-area')) bindTradeLevelHoverTarget(levelBar, node);
      }
      addTradeAxisPriceLine(
        `${trade.key}:${role.toLowerCase()}`,
        levelPrice,
        role === 'TP'
          ? (lightSurface ? LIGHT_CHART_TRADE_COLORS.tp : DARK_CHART_TRADE_COLORS.tp)
          : (lightSurface ? LIGHT_CHART_TRADE_COLORS.sl : DARK_CHART_TRADE_COLORS.sl),
      );
    };

    // â”€â”€ end cTrader-style position controls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


  return {
    createCollisionOffsetFactory,
    createTradeMarker,
    createTradeHistoryLine,
    createPriceLevel,
    getLocalizedTradeTitle,
    getTradeTicket,
    addTradeAxisPriceLine,
    createEntryPriceLevels,
    createEntryControlsForTrade,
    createLevelControlsForTrade,
  };
};

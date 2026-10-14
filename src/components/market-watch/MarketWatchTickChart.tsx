import { type MouseEvent, useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import { formatBrokerServerDate, formatBrokerServerTime } from '../../services/brokerServerClock';
import { type Tick, useMarketDataStore } from '../../store/useMarketDataStore';
import { getCanonicalTickTimestamp } from '../../utils/liveTickSemantics';
import { readMarketWatchSymbolSpecification } from './marketWatchSymbolDetailsModel';
import './market-watch-views.css';

import {
  buildTickChartCrosshair,
  buildTickChartGeometry,
  MARKET_WATCH_TICK_CHART_LIMIT,
  type TickChartPoint,
} from './tickChartGeometry';
import { useMarketWatchTickHistory } from './useMarketWatchTickHistory';

const EMPTY_TICKS: readonly Tick[] = Object.freeze([]);
const EMPTY_SOURCES: readonly unknown[] = Object.freeze([]);
/** Layout used until the container reports its size (and in non-layout test DOMs). */
const FALLBACK_SIZE = { width: 320, height: 240, fontSize: 12 };
const AXIS_FONT_OFFSET_PX = 2;
const MINIMUM_AXIS_FONT_PX = 10;

export interface MarketWatchTickChartProps {
  symbol: string;
  className?: string;
  /** Catalogue rows for the symbol, most authoritative first; they supply broker digits. */
  instrumentSources?: readonly unknown[];
  /** Broker/account scope that owns the tick history request; null skips it. */
  historyScopeKey?: string | null;
}

const normalizeSymbol = (value: string): string => value.trim().toUpperCase();

const toChartPoint = (tick: Tick): TickChartPoint | null => {
  const timestamp = getCanonicalTickTimestamp(tick);
  return timestamp !== null
    && Number.isFinite(tick.bid) && tick.bid > 0
    && Number.isFinite(tick.ask) && tick.ask > 0
    ? { timestamp, bid: tick.bid, ask: tick.ask }
    : null;
};

const formatServerTime = (epochMs: number): string => formatBrokerServerTime(epochMs).time;
const formatServerDate = (epochMs: number): string => formatBrokerServerDate(epochMs);

/** Axis text follows the user's interface size, a step smaller like MT5. */
const readAxisFontSize = (): number => {
  const uiSize = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--rtx-ui-font-size'),
  );
  return Number.isFinite(uiSize)
    ? Math.max(MINIMUM_AXIS_FONT_PX, uiSize - AXIS_FONT_OFFSET_PX)
    : FALLBACK_SIZE.fontSize;
};

const useChartSize = () => {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState(FALLBACK_SIZE);

  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      if (width <= 0 || height <= 0) return;
      const fontSize = readAxisFontSize();
      setSize((current) => (
        current.width === width && current.height === height && current.fontSize === fontSize
          ? current
          : { width, height, fontSize }
      ));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [setElement, size] as const;
};

/**
 * MT5 Market Watch "Ticks" view: Bid and Ask step lines for the latest ticks,
 * on a broker-digit price axis and a broker-server-time axis. Recent backend
 * history precedes the ticks received in this session.
 */
export function MarketWatchTickChart({
  symbol,
  className = '',
  instrumentSources = EMPTY_SOURCES,
  historyScopeKey = null,
}: MarketWatchTickChartProps) {
  const tr = useUiTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const normalizedSymbol = normalizeSymbol(symbol);
  const [setCanvas, size] = useChartSize();
  const [hoverState, setHoverState] = useState<{
    symbol: string;
    pointer: { x: number; y: number };
  } | null>(null);
  const pointer = hoverState?.symbol === normalizedSymbol ? hoverState.pointer : null;
  const tickBuffer = useMarketDataStore(state => (
    state.symbolData[normalizedSymbol]?.tickBuffer ?? EMPTY_TICKS
  ));
  const history = useMarketWatchTickHistory(normalizedSymbol, historyScopeKey);
  const digits = useMemo(
    () => readMarketWatchSymbolSpecification(...instrumentSources).digits,
    [instrumentSources],
  );
  const points = useMemo(() => {
    const live = tickBuffer
      .slice(-MARKET_WATCH_TICK_CHART_LIMIT)
      .map(toChartPoint)
      .filter((point): point is TickChartPoint => point !== null);
    const firstLiveTime = live[0]?.timestamp ?? Number.POSITIVE_INFINITY;
    const earlier = history.filter(point => point.timestamp < firstLiveTime);
    return [...earlier, ...live].slice(-MARKET_WATCH_TICK_CHART_LIMIT);
  }, [history, tickBuffer]);
  const geometry = useMemo(() => buildTickChartGeometry(points, {
    ...size,
    digits,
    formatDate: formatServerDate,
    formatTime: formatServerTime,
  }), [digits, points, size]);
  const crosshair = useMemo(() => (
    geometry
      ? buildTickChartCrosshair(geometry, pointer, {
        fontSize: size.fontSize,
        digits,
        formatDate: formatServerDate,
        formatTime: formatServerTime,
      })
      : null
  ), [digits, geometry, pointer, size.fontSize]);

  const handleMouseMove = useCallback((event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scaleX = rect.width > 0 ? size.width / rect.width : 1;
    const scaleY = rect.height > 0 ? size.height / rect.height : 1;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    setHoverState({ symbol: normalizedSymbol, pointer: { x, y } });
  }, [normalizedSymbol, size.height, size.width]);

  const handleMouseLeave = useCallback(() => {
    setHoverState(null);
  }, []);

  const chartName = normalizedSymbol || tr('Selected symbol');
  const rootClassName = ['rtx-market-tick-chart', className].filter(Boolean).join(' ');
  const tagLeadPx = Math.max(0, geometry ? geometry.tickLength - 1 : 0);

  return (
    <section className={rootClassName} aria-label={chartName}>
      <div ref={setCanvas} className="rtx-market-tick-chart__canvas">
        {geometry ? (
          <svg
            width={size.width}
            height={size.height}
            viewBox={`0 0 ${size.width} ${size.height}`}
            role="img"
            aria-labelledby={`${titleId} ${descriptionId}`}
            data-tick-count={geometry.visibleCount}
            style={{ fontSize: size.fontSize }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <title id={titleId}>{chartName}</title>
            <desc id={descriptionId}>
              {tr('{{value0}} live tick chart with {{value1}} recent broker quotes. Bid {{value2}}, Ask {{value3}}.', {
                value0: chartName,
                value1: geometry.visibleCount,
                value2: geometry.bidTag.label,
                value3: geometry.askTag.label,
              })}
            </desc>
            <rect
              className="rtx-market-tick-chart__plot"
              x={geometry.plot.left}
              y={geometry.plot.top}
              width={geometry.plot.right - geometry.plot.left}
              height={geometry.plot.bottom - geometry.plot.top}
            />
            <g className="rtx-market-tick-chart__grid" aria-hidden="true">
              {geometry.priceTicks.map(tick => (
                <line key={`price-${tick.label}`} x1={geometry.plot.left} x2={geometry.plot.right} y1={tick.y} y2={tick.y} />
              ))}
              {geometry.timeTicks.slice(1).map(tick => (
                <line key={`time-${tick.x}`} x1={tick.x} x2={tick.x} y1={geometry.plot.top} y2={geometry.plot.bottom} />
              ))}
            </g>
            <g className="rtx-market-tick-chart__separators" aria-hidden="true">
              {geometry.separators.map(x => (
                <line key={x} x1={x} x2={x} y1={geometry.plot.top} y2={geometry.plot.bottom} />
              ))}
            </g>
            <path data-testid="market-tick-ask-line" className="rtx-market-tick-chart__line rtx-market-tick-chart__line--ask" d={geometry.askPath} />
            <path data-testid="market-tick-bid-line" className="rtx-market-tick-chart__line rtx-market-tick-chart__line--bid" d={geometry.bidPath} />
            {crosshair && (
              <g className="rtx-market-tick-chart__crosshair" data-testid="market-tick-crosshair" aria-hidden="true">
                <line
                  data-testid="market-tick-crosshair-x"
                  x1={crosshair.x}
                  x2={crosshair.x}
                  y1={geometry.plot.top}
                  y2={geometry.plot.bottom}
                />
                <line
                  data-testid="market-tick-crosshair-y"
                  x1={geometry.plot.left}
                  x2={geometry.plot.right}
                  y1={crosshair.y}
                  y2={crosshair.y}
                />
                <g className="rtx-market-tick-chart__quote-pill" data-testid="market-tick-crosshair-pill">
                  <rect
                    x={crosshair.quotePill.x}
                    y={crosshair.quotePill.y}
                    width={crosshair.quotePill.width}
                    height={crosshair.quotePill.height}
                  />
                  <text
                    x={crosshair.quotePill.x + crosshair.quotePill.width / 2}
                    y={crosshair.quotePill.y + crosshair.quotePill.height / 2 + size.fontSize * 0.35}
                    textAnchor="middle"
                  >
                    {crosshair.quotePill.label}
                  </text>
                </g>
              </g>
            )}
            <rect
              className="rtx-market-tick-chart__frame"
              x={geometry.plot.left}
              y={geometry.plot.top}
              width={geometry.plot.right - geometry.plot.left}
              height={geometry.plot.bottom - geometry.plot.top}
            />
            <text className="rtx-market-tick-chart__symbol" x={geometry.plot.left + 4} y={geometry.plot.top + size.fontSize + 3}>
              {chartName}
            </text>
            <g className="rtx-market-tick-chart__axis" aria-hidden="true">
              {geometry.priceTicks
                .filter(tick => tick.y > geometry.plot.top + size.fontSize / 2 && tick.y < geometry.plot.bottom - size.fontSize / 2)
                .map(tick => (
                  <g key={`price-label-${tick.label}`}>
                    <line x1={geometry.plot.right} x2={geometry.plot.right + geometry.tickLength} y1={tick.y} y2={tick.y} />
                    <text x={geometry.plot.right + geometry.tickLength + 3} y={tick.y + size.fontSize * 0.35}>{tick.label}</text>
                  </g>
                ))}
              {geometry.timeTicks.map(tick => (
                <g key={`time-label-${tick.x}`}>
                  <line x1={tick.x} x2={tick.x} y1={geometry.plot.bottom} y2={geometry.plot.bottom + geometry.tickLength} />
                  <text x={tick.x + 2} y={geometry.plot.bottom + geometry.tickLength + size.fontSize}>{tick.label}</text>
                </g>
              ))}
            </g>
            {([['ask', geometry.askTag], ['bid', geometry.bidTag]] as const).map(([side, tag]) => (
              <g key={side} className={`rtx-market-tick-chart__tag rtx-market-tick-chart__tag--${side}`} data-testid={`market-tick-${side}-tag`}>
                <line
                  x1={geometry.plot.right}
                  x2={geometry.plot.right + tagLeadPx}
                  y1={tag.y}
                  y2={tag.y}
                />
                <rect
                  x={geometry.plot.right + tagLeadPx}
                  y={tag.y - geometry.tagHeight / 2}
                  width={Math.max(0, geometry.axisWidth - tagLeadPx)}
                  height={geometry.tagHeight}
                />
                <text x={geometry.plot.right + geometry.tickLength + 3} y={tag.y + size.fontSize * 0.35}>{tag.label}</text>
              </g>
            ))}
            {crosshair && (
              <>
                <g
                  className="rtx-market-tick-chart__tag rtx-market-tick-chart__tag--crosshair"
                  data-testid="market-tick-crosshair-price-tag"
                  aria-hidden="true"
                >
                  <line
                    x1={geometry.plot.right}
                    x2={geometry.plot.right + tagLeadPx}
                    y1={crosshair.priceTag.y}
                    y2={crosshair.priceTag.y}
                  />
                  <rect
                    x={geometry.plot.right + tagLeadPx}
                    y={crosshair.priceTag.y - geometry.tagHeight / 2}
                    width={Math.max(0, geometry.axisWidth - tagLeadPx)}
                    height={geometry.tagHeight}
                  />
                  <text
                    x={geometry.plot.right + geometry.tickLength + 3}
                    y={crosshair.priceTag.y + size.fontSize * 0.35}
                  >
                    {crosshair.priceTag.label}
                  </text>
                </g>
                <g
                  className="rtx-market-tick-chart__tag rtx-market-tick-chart__tag--crosshair"
                  data-testid="market-tick-crosshair-time-tag"
                  aria-hidden="true"
                >
                  <rect
                    x={crosshair.timeTag.x}
                    y={crosshair.timeTag.y}
                    width={crosshair.timeTag.width}
                    height={crosshair.timeTag.height}
                  />
                  <text
                    x={crosshair.timeTag.x + crosshair.timeTag.width / 2}
                    y={crosshair.timeTag.y + crosshair.timeTag.height / 2 + size.fontSize * 0.35}
                    textAnchor="middle"
                  >
                    {crosshair.timeTag.label}
                  </text>
                </g>
              </>
            )}
          </svg>
        ) : (
          <div className="rtx-market-tick-chart__empty" role="status">
            <strong>{tr('Waiting for live ticks')}</strong>
            <span>{tr('The chart will appear when the broker publishes a quote for {{value0}}.', { value0: chartName })}</span>
          </div>
        )}
      </div>
    </section>
  );
}

export default MarketWatchTickChart;

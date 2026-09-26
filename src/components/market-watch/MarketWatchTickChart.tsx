import { useId, useMemo } from 'react';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import { useTick } from '../../store/useAppStore';
import { type Tick, useMarketDataStore } from '../../store/useMarketDataStore';
import { getCanonicalTickTimestamp } from '../../utils/liveTickSemantics';
import { getSymbolDigits } from '../../utils/symbolUtils';
import { PriceDisplay } from '../ui/PriceDisplay';
import './market-watch-views.css';

import {
  buildTickChartGeometry,
  MARKET_WATCH_TICK_CHART_LIMIT,
  type TickChartPoint,
} from './tickChartGeometry';

const VIEWBOX_WIDTH = 1_000;
const VIEWBOX_HEIGHT = 260;
const PLOT_LEFT = 18;
const PLOT_RIGHT = 18;
const PLOT_TOP = 16;
const PLOT_BOTTOM = 18;
const EMPTY_TICKS: readonly Tick[] = Object.freeze([]);

export interface MarketWatchTickChartProps {
  symbol: string;
  className?: string;
}

const normalizeSymbol = (value: string): string => value.trim().toUpperCase();

const isUsableTick = (tick: Tick): boolean => (
  getCanonicalTickTimestamp(tick) !== null
  && Number.isFinite(tick.bid)
  && Number.isFinite(tick.ask)
  && tick.bid > 0
  && tick.ask > 0
);

export function MarketWatchTickChart({ symbol, className = '' }: MarketWatchTickChartProps) {
  const tr = useUiTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const normalizedSymbol = normalizeSymbol(symbol);
  const brokerTick = useTick(normalizedSymbol);
  const tickBuffer = useMarketDataStore(state => (
    state.symbolData[normalizedSymbol]?.tickBuffer ?? EMPTY_TICKS
  ));
  const ticks = useMemo(
    () => tickBuffer.slice(-MARKET_WATCH_TICK_CHART_LIMIT).filter(isUsableTick),
    [tickBuffer],
  );
  const points = useMemo<TickChartPoint[]>(() => ticks.map(tick => ({
    timestamp: getCanonicalTickTimestamp(tick) ?? tick.timestamp,
    bid: tick.bid,
    ask: tick.ask,
  })), [ticks]);
  const geometry = useMemo(() => buildTickChartGeometry(points), [points]);
  const latestTick = ticks.at(-1);
  const digits = Number.isInteger(brokerTick?.digits) && Number(brokerTick?.digits) >= 0 && Number(brokerTick?.digits) <= 10
    ? Number(brokerTick?.digits)
    : getSymbolDigits(normalizedSymbol);
  const chartName = normalizedSymbol || tr('Selected symbol');
  const rootClassName = ['rtx-market-tick-chart', className].filter(Boolean).join(' ');

  return (
    <section className={rootClassName} aria-labelledby={titleId}>
      <header className="rtx-market-tick-chart__header">
        <div className="rtx-market-tick-chart__identity">
          <strong id={titleId}>{chartName}</strong>
          <span>{tr('Tick Chart')}</span>
        </div>
        <div className="rtx-market-tick-chart__quotes" aria-label={tr('{{value0}} latest bid and ask', { value0: chartName })}>
          <div
            className="rtx-market-tick-chart__quote rtx-market-tick-chart__quote--bid"
            aria-label={`${tr('Bid')} ${latestTick ? latestTick.bid.toFixed(digits) : tr('unavailable')}`}
          >
            <span>{tr('Bid')}</span>
            <span aria-hidden="true">
              {latestTick
                ? <PriceDisplay price={latestTick.bid} symbol={normalizedSymbol} digits={digits} size="sm" />
                : '—'}
            </span>
          </div>
          <div
            className="rtx-market-tick-chart__quote rtx-market-tick-chart__quote--ask"
            aria-label={`${tr('Ask')} ${latestTick ? latestTick.ask.toFixed(digits) : tr('unavailable')}`}
          >
            <span>{tr('Ask')}</span>
            <span aria-hidden="true">
              {latestTick
                ? <PriceDisplay price={latestTick.ask} symbol={normalizedSymbol} digits={digits} size="sm" />
                : '—'}
            </span>
          </div>
          <button
            type="button"
            className="rtx-market-tick-chart__clear"
            onClick={() => useMarketDataStore.getState().clearTickBuffer(normalizedSymbol)}
            disabled={!normalizedSymbol || tickBuffer.length === 0}
          >
            {tr('Clear')}
          </button>
        </div>
      </header>

      {geometry && latestTick ? (
        <div className="rtx-market-tick-chart__plot">
          <svg
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-labelledby={`${titleId} ${descriptionId}`}
            data-tick-count={ticks.length}
          >
            <desc id={descriptionId}>
              {tr('{{value0}} live tick chart with {{value1}} recent broker quotes. Bid {{value2}}, Ask {{value3}}.', {
                value0: chartName,
                value1: ticks.length,
                value2: latestTick.bid.toFixed(digits),
                value3: latestTick.ask.toFixed(digits),
              })}
            </desc>
            <g className="rtx-market-tick-chart__grid" aria-hidden="true">
              {[0.25, 0.5, 0.75].map(position => (
                <line
                  key={`horizontal-${position}`}
                  x1={PLOT_LEFT}
                  x2={VIEWBOX_WIDTH - PLOT_RIGHT}
                  y1={PLOT_TOP + position * (VIEWBOX_HEIGHT - PLOT_TOP - PLOT_BOTTOM)}
                  y2={PLOT_TOP + position * (VIEWBOX_HEIGHT - PLOT_TOP - PLOT_BOTTOM)}
                />
              ))}
              {[0.25, 0.5, 0.75].map(position => (
                <line
                  key={`vertical-${position}`}
                  x1={PLOT_LEFT + position * (VIEWBOX_WIDTH - PLOT_LEFT - PLOT_RIGHT)}
                  x2={PLOT_LEFT + position * (VIEWBOX_WIDTH - PLOT_LEFT - PLOT_RIGHT)}
                  y1={PLOT_TOP}
                  y2={VIEWBOX_HEIGHT - PLOT_BOTTOM}
                />
              ))}
            </g>
            <path className="rtx-market-tick-chart__spread" d={geometry.spreadPath} aria-hidden="true" />
            <path data-testid="market-tick-bid-line" className="rtx-market-tick-chart__line rtx-market-tick-chart__line--bid" d={geometry.bidPath} />
            <path data-testid="market-tick-ask-line" className="rtx-market-tick-chart__line rtx-market-tick-chart__line--ask" d={geometry.askPath} />
            <circle className="rtx-market-tick-chart__point rtx-market-tick-chart__point--bid" cx={geometry.latestBid.x} cy={geometry.latestBid.y} r={4} />
            <circle className="rtx-market-tick-chart__point rtx-market-tick-chart__point--ask" cx={geometry.latestAsk.x} cy={geometry.latestAsk.y} r={4} />
          </svg>
          <div className="rtx-market-tick-chart__legend" aria-hidden="true">
            <span data-series="bid">{tr('Bid')}</span>
            <span data-series="ask">{tr('Ask')}</span>
            <span>{tr('{{value0}} recent ticks', { value0: ticks.length })}</span>
          </div>
        </div>
      ) : (
        <div className="rtx-market-tick-chart__empty" role="status">
          <span className="rtx-market-tick-chart__empty-mark" aria-hidden="true" />
          <strong>{tr('Waiting for live ticks')}</strong>
          <span>{tr('The chart will appear when the broker publishes a quote for {{value0}}.', { value0: chartName })}</span>
        </div>
      )}
    </section>
  );
}

export default MarketWatchTickChart;

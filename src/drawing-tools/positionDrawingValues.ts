import type { ForecastingBar, PositionSizing } from './model/drawing';

export type { PositionSizing } from './model/drawing';

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;

export function calculatePositionSizing(entry: number, target: number, stop: number, settings?: PositionSizing) {
  const riskDistance = Math.abs(entry - stop);
  const rewardDistance = Math.abs(target - entry);
  const ratio = riskDistance > 0 ? rewardDistance / riskDistance : null;
  const unavailable = { ratio, quantity: null, targetAmount: null, stopAmount: null };
  if (!settings || !positive(settings.accountSize) || !positive(settings.risk)
    || !positive(settings.pointValue) || !positive(settings.lotSize) || !positive(riskDistance)) return unavailable;
  const risk = settings.riskMode === 'amount' ? settings.risk : settings.accountSize * settings.risk / 100;
  const multiplier = settings.pointValue * settings.lotSize;
  const riskQuantity = risk / (riskDistance * multiplier);
  // Leverage constrains notional exposure. Omitted leverage leaves risk sizing uncapped.
  const leverageQuantity = positive(settings.leverage) && entry !== 0
    ? settings.accountSize * settings.leverage / (Math.abs(entry) * multiplier)
    : Infinity;
  const quantity = Math.min(riskQuantity, leverageQuantity);
  if (!finite(quantity)) return unavailable;
  return {
    ratio, quantity,
    targetAmount: settings.accountSize + rewardDistance * quantity * multiplier,
    stopAmount: settings.accountSize - riskDistance * quantity * multiplier,
  };
}

export function positionQuantityText(quantity: number | null, precision = 2): string {
  if (quantity === null) return '—';
  const digits = Math.max(0, Math.min(8, Math.trunc(precision)));
  // Display rounding must never force a minimum unit or affect the underlying amounts.
  const scale = 10 ** digits;
  return (Math.floor(quantity * scale + Number.EPSILON) / scale).toFixed(digits).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

export function calculatePositionPnl(input: {
  long: boolean; entry: number; target: number; stop: number;
  startTime: number; endTime?: number; series?: readonly ForecastingBar[]; latestPrice?: number;
}): { status: 'open' | 'closed' | 'unavailable' | 'ambiguous'; value: number | null } {
  const direction = input.long ? 1 : -1;
  const series = (input.series ?? []).filter(bar => finite(bar.time)).slice().sort((a, b) => a.time - b.time);
  const end = finite(input.endTime) ? input.endTime : Infinity;
  let entered = false;
  for (const bar of series) {
    if (bar.time < input.startTime || bar.time > end || !finite(bar.high) || !finite(bar.low)) continue;
    if (!entered) entered = bar.low <= input.entry && bar.high >= input.entry;
    if (!entered) continue;
    const targetHit = input.long ? bar.high >= input.target : bar.low <= input.target;
    const stopHit = input.long ? bar.low <= input.stop : bar.high >= input.stop;
    // OHLC cannot reveal which level was first when both occur in one candle.
    if (targetHit && stopHit) return { status: 'ambiguous', value: null };
    if (targetHit || stopHit) return { status: 'closed', value: direction * ((targetHit ? input.target : input.stop) - input.entry) };
  }
  const lastTime = series.at(-1)?.time;
  const historical = finite(lastTime) && end <= lastTime;
  const rightBar = series.slice().reverse().find(bar => bar.time <= end && finite(bar.close ?? bar.value));
  const close = historical ? (rightBar?.close ?? rightBar?.value)
    : input.latestPrice ?? rightBar?.close ?? rightBar?.value;
  return finite(close) ? { status: 'open', value: direction * (close - input.entry) }
    : { status: 'unavailable', value: null };
}

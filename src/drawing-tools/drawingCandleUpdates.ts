/** Keep the drawing provider on the same accepted candle revision as the chart. */
export function updateDrawingCandle<T extends { time: number }>(candles: T[], candle: T): void {
  const last = candles.at(-1);
  if (!last || candle.time > last.time) candles.push({ ...candle });
  else if (candle.time === last.time) candles[candles.length - 1] = { ...candle };
}

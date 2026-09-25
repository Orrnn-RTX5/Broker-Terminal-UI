import { getPositionId, normalizePosition, POSITION_CLOSED_EVENTS, readPositionStreamBatch, readPositionStreamEvent, reconcilePositionStreamBatch } from './positionStream';

// The Trade tab renders wire-shaped rows rather than the chart's normalized rows.
// Keep one lifecycle/version reducer, then adapt only presentation aliases.
const wireRow = (row: any) => ({
  ...row,
  ticket: row.id,
  side: String(row.side).toLowerCase(),
  time_create: Date.parse(row.openTime) / 1000 || 0,
  price_sl: row.sl,
  price_tp: row.tp,
});

export function reconcilePanelPositions(current: any[], message: any, login: number, closed: Set<number>) {
  let batch = readPositionStreamBatch(message);
  if (!batch) {
    const { event, position } = readPositionStreamEvent(message);
    if (!position) return current;
    batch = { mode: 'delta', positions: [POSITION_CLOSED_EVENTS.has(event) ? { ...position, closed: true } : position] };
  }
  const rows = batch.positions.filter(row => !closed.has(getPositionId(row))
    && (row.account_login === undefined || Number(row.account_login) === login));
  const result = reconcilePositionStreamBatch(current.map(normalizePosition), { ...batch, positions: rows });
  result.closedTickets.forEach(ticket => closed.add(ticket));
  return result.positions.filter(row => !closed.has(row.id)).map(wireRow);
}

export function reconcilePanelSnapshot(current: any[], rows: any[], login: number, closed: Set<number>, changedDuringRequest: boolean) {
  const filtered = rows.filter(row => !closed.has(getPositionId(row))
    && (row.account_login === undefined || Number(row.account_login) === login));
  if (!changedDuringRequest && filtered.length === 0) return [];
  return reconcilePanelPositions(current, {
    type: changedDuringRequest ? 'position_update' : 'positions_snapshot', positions: filtered,
  }, login, closed);
}

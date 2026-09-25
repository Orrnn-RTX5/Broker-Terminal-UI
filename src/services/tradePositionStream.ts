type PositionRecord = Record<string, any>;

export interface DecodedPositionStreamMessage {
  /** A snapshot replaces the open set; a structural row snapshot is a patch. */
  kind: 'snapshot' | 'patch';
  /** REST provenance survives a snapshot's admission as a non-replacing patch. */
  source?: 'rest' | 'stream';
  rows: PositionRecord[];
  event: string;
  /** Candidates only: ordering checks still apply before accepting a close. */
  closedTickets: number[];
}

const record = (value: unknown): value is PositionRecord => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const firstOwn = (value: PositionRecord, keys: readonly string[]): string | undefined => (
  keys.find(key => Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined)
);

export const getPositionStreamTicket = (value: PositionRecord): number | null => {
  const ticket = Number(value.ticket ?? value.position_id ?? value.position_ticket ?? value.id);
  return Number.isSafeInteger(ticket) && ticket > 0 ? ticket : null;
};

/** Versions are decimal strings: converting them to Number loses close ordering. */
export const getPositionStreamVersion = (value: PositionRecord): string | null => {
  const version = value.state_version_text ?? value.state_version;
  if (typeof version === 'number' && !Number.isSafeInteger(version)) return null;
  if (typeof version !== 'number' && typeof version !== 'string') return null;
  const text = String(version).trim();
  return /^\d+$/.test(text) ? BigInt(text).toString() : null;
};

const isCloseEvent = (event: string): boolean => (
  ['close', 'closed', 'position_close', 'position_closed', 'sl_hit', 'tp_hit', 'stop_out'].includes(event)
);

const isClosed = (row: PositionRecord, event: string): boolean => (
  isCloseEvent(event)
  || ['close', 'closed'].includes(String(row.status ?? row.state ?? '').toLowerCase())
);

/** Accept both gateway {channel,data:{type,data}} and older channel envelopes. */
export function decodePositionStreamMessage(message: unknown): DecodedPositionStreamMessage | null {
  let payload = message;
  let event = '';
  let listSnapshot = false;
  const inherited: PositionRecord = {};

  for (let depth = 0; depth < 10; depth += 1) {
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch { return null; }
      continue;
    }
    if (Array.isArray(payload)) {
      const rows = payload.filter(record).map(row => ({ ...inherited, ...row }));
      const isDelta = rows.some(row => row.update_kind === 'pnl')
        || (!listSnapshot && /^(position_(update|opened|modified|closed)|update|patch|open|close|closed)$/.test(event))
        // An incomplete row collection has no authority to delete omitted
        // tickets. Empty arrays remain valid authoritative empty snapshots.
        || payload.length !== rows.length
        || rows.some(row => !hasStructuralPositionFields(row));
      const kind = isDelta ? 'patch' : 'snapshot';
      return {
        kind,
        rows,
        event,
        closedTickets: rows.filter(row => isClosed(row, event))
          .map(getPositionStreamTicket).filter((id): id is number => id !== null),
      };
    }
    if (!record(payload)) return null;

    const nextEvent = [payload.event, payload.type, payload.action]
      .find(value => typeof value === 'string' && value.trim()
        && !['channel_message', 'subscribed', 'unsubscribed'].includes(value.trim().toLowerCase()));
    if (typeof nextEvent === 'string') event = nextEvent.trim().toLowerCase();
    for (const key of ['account_login', 'broker_id', 'state_version', 'state_version_text']) {
      if (payload[key] !== undefined) inherited[key] = payload[key];
    }

    if (getPositionStreamTicket(payload)) {
      const row = { ...inherited, ...payload };
      return {
        kind: 'patch', rows: [row], event,
        closedTickets: isClosed(row, event) ? [getPositionStreamTicket(row)!] : [],
      };
    }
    if (Array.isArray(payload.positions)) {
      payload = payload.positions;
      listSnapshot = true;
    } else if (record(payload.position) || record(payload.closed_position)) {
      payload = payload.position ?? payload.closed_position;
    } else if (payload.data !== undefined) {
      payload = payload.data;
    } else if (payload.payload !== undefined) {
      payload = payload.payload;
    } else {
      return null;
    }
  }
  return null;
}

type FieldGroup = {
  aliases: string[];
  canonical: string;
  outputs: string[];
  numeric?: boolean;
  clearable?: boolean;
  display?: boolean;
};

const fields: FieldGroup[] = [
  { aliases: ['symbol'], canonical: 'symbol', outputs: ['symbol'] },
  { aliases: ['side', 'action'], canonical: 'side', outputs: ['side'] },
  { aliases: ['volume_lots', 'lots', 'quantity', 'volume'], canonical: 'volume_lots', outputs: ['volume', 'quantity'], numeric: true },
  { aliases: ['price_open', 'open_price', 'openPrice', 'entryPrice', 'chartEntryPrice', 'price'], canonical: 'price_open', outputs: ['openPrice', 'open_price', 'price_open'], numeric: true },
  { aliases: ['price_current', 'current_price', 'currentPrice', 'livePrice'], canonical: 'price_current', outputs: ['currentPrice', 'current_price', 'price_current'], numeric: true, display: true },
  { aliases: ['profit', 'unrealized_pl', 'unrealizedPnL', 'unrealized_pnl'], canonical: 'profit', outputs: ['profit', 'unrealizedPnL'], numeric: true, display: true },
  { aliases: ['margin', 'used_margin'], canonical: 'margin', outputs: ['margin'], numeric: true, display: true },
  { aliases: ['price_sl', 'sl', 'stopLoss', 'stop_loss'], canonical: 'price_sl', outputs: ['sl'], numeric: true, clearable: true },
  { aliases: ['price_tp', 'tp', 'takeProfit', 'take_profit'], canonical: 'price_tp', outputs: ['tp'], numeric: true, clearable: true },
  { aliases: ['swap', 'storage'], canonical: 'swap', outputs: ['swap'], numeric: true },
  { aliases: ['commission'], canonical: 'commission', outputs: ['commission'], numeric: true },
  { aliases: ['time_create', 'time_create_ms', 'time_create_msc', 'time_open', 'opened_at', 'open_time', 'openTime', 'time_ms', 'time_msc', 'timestamp_ms', 'timestamp', 'time'], canonical: 'time_create', outputs: ['openTime', 'open_time', 'time_create', 'time'] },
  { aliases: ['chartEntryTime', 'chart_entry_time'], canonical: 'chartEntryTime', outputs: ['chartEntryTime'] },
];

const finiteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const candidate = record(value) ? value.amount : value;
  if (typeof candidate !== 'number' && typeof candidate !== 'string') return null;
  if (typeof candidate === 'string' && !candidate.trim()) return null;
  const n = Number(candidate);
  return Number.isFinite(n) ? n : null;
};

const quoteTime = (row: PositionRecord): number | null => {
  const time = finiteNumber(row.price_time_msc);
  return time !== null && time >= 0 ? time : null;
};

const validSide = (value: unknown): 'BUY' | 'SELL' | null => {
  if (value === 0 || value === '0') return 'BUY';
  if (value === 1 || value === '1') return 'SELL';
  const side = String(value ?? '').toLowerCase();
  if (side === 'buy' || side === 'long') return 'BUY';
  if (side === 'sell' || side === 'short') return 'SELL';
  return null;
};

function hasStructuralPositionFields(row: PositionRecord): boolean {
  return getPositionStreamTicket(row) !== null
    && typeof row.symbol === 'string' && row.symbol.trim().length > 0
    && validSide(row.side ?? row.action) !== null
    && (finiteNumber(row.volume_lots ?? row.lots ?? row.quantity ?? row.volume) ?? 0) > 0
    && (finiteNumber(row.price_open ?? row.open_price ?? row.openPrice ?? row.entryPrice ?? row.chartEntryPrice ?? row.price) ?? 0) > 0;
}

function mergePosition<T extends { id: number }>(
  previous: T | undefined,
  raw: PositionRecord,
  normalize: (row: PositionRecord) => T | undefined,
  unclockedSnapshotSource: boolean,
): T | undefined {
  const old = previous as PositionRecord | undefined;
  const version = getPositionStreamVersion(raw);
  const oldVersion = old ? getPositionStreamVersion(old) : null;
  const pnlOnly = raw.update_kind === 'pnl';
  if (version !== null && oldVersion !== null && BigInt(version) < BigInt(oldVersion)) return previous;
  if (pnlOnly && (!old || (version !== null && version !== oldVersion))) return previous;

  const time = quoteTime(raw);
  const oldTime = old ? quoteTime(old) : null;
  // REST/legacy snapshots have no quote clock. For the same structural version,
  // they cannot supersede a display patch whose quote clock is already known.
  const stalePrice = (time !== null && oldTime !== null && time < oldTime)
    || (unclockedSnapshotSource && time === null && oldTime !== null && version === oldVersion);
  if (pnlOnly && stalePrice) return previous;

  const canonical: PositionRecord = { ticket: getPositionStreamTicket(raw) };
  const present: FieldGroup[] = [];
  for (const group of fields) {
    if ((pnlOnly && !group.display) || (stalePrice && group.display)) continue;
    const key = firstOwn(raw, group.aliases);
    if (!key) continue;
    let value = raw[key];
    if (group.numeric) {
      value = value === null && group.clearable ? 0 : finiteNumber(value);
      if (value === null) continue;
    }
    if (group.canonical === 'side') {
      value = validSide(value);
      if (value === null) continue;
    }
    if (group.canonical === 'symbol' && (typeof value !== 'string' || !value.trim())) continue;
    if (value === null || value === '') continue;
    canonical[group.canonical] = value;
    present.push(group);
  }

  // An unknown display patch cannot manufacture a zero-volume position.
  if (!old && (!canonical.symbol || !canonical.side
    || !(canonical.volume_lots > 0) || !(canonical.price_open > 0))) return undefined;
  const normalized = normalize(canonical);
  if (!normalized) return previous;
  const next: PositionRecord = old ? { ...old } : { ...normalized };
  for (const group of present) {
    for (const output of group.outputs) {
      // Margin is carried by display patches even if the UI normalizer omits it.
      next[output] = (normalized as PositionRecord)[output] ?? canonical[group.canonical];
    }
  }
  for (const key of ['account_login', 'broker_id', 'update_kind', 'status', 'pnl_available', 'time_update', 'comment']) {
    if (raw[key] !== undefined) next[key] = raw[key];
  }
  if (version !== null) {
    next.state_version = version;
    if (raw.state_version_text !== undefined) next.state_version_text = version;
    else delete next.state_version_text;
  }
  if (time !== null && !stalePrice) next.price_time_msc = time;

  const structureChanged = version !== null && oldVersion !== null && version !== oldVersion;
  const invalidatedDisplay = (raw.pnl_available === false && (!old || version === null || version !== oldVersion))
    || (structureChanged && !pnlOnly);
  if (invalidatedDisplay) {
    next.hasBackendProfit = false;
    next.hasBackendCurrentPrice = false;
  } else if (raw.pnl_available === false && old?.pnl_available === true) {
    next.pnl_available = true;
  }
  if (canonical.profit !== undefined && raw.pnl_available !== false) {
    next.hasBackendProfit = raw.hasBackendProfit !== false;
  }
  if (canonical.price_current !== undefined && raw.pnl_available !== false) {
    next.hasBackendCurrentPrice = raw.hasBackendCurrentPrice !== false;
  }
  if (pnlOnly && (canonical.profit !== undefined || canonical.price_current !== undefined)) next.pnl_available = true;
  return next as T;
}

/** Merge broker deltas without turning omitted position fields into zeros. */
export function applyPositionStreamUpdate<T extends { id: number }>(
  current: readonly T[],
  message: DecodedPositionStreamMessage,
  normalize: (row: PositionRecord) => T | undefined,
): T[] {
  const previousById = new Map(current.map(position => [position.id, position]));
  const nextById = message.kind === 'snapshot' ? new Map<number, T>() : new Map(previousById);
  for (const row of message.rows) {
    const ticket = getPositionStreamTicket(row);
    if (ticket === null) continue;
    const previous = nextById.get(ticket) ?? previousById.get(ticket);
    const old = previous as PositionRecord | undefined;
    if (old?.account_login !== undefined && row.account_login !== undefined
      && String(old.account_login) !== String(row.account_login)) continue;
    if (old?.broker_id !== undefined && row.broker_id !== undefined
      && String(old.broker_id) !== String(row.broker_id)) continue;
    if (isClosed(row, message.event)) {
      const version = getPositionStreamVersion(row);
      const oldVersion = old ? getPositionStreamVersion(old) : null;
      if (version !== null && oldVersion !== null && BigInt(version) < BigInt(oldVersion)) {
        if (previous) nextById.set(ticket, previous);
      } else {
        nextById.delete(ticket);
      }
      continue;
    }
    const next = mergePosition(previous, row, normalize, message.kind === 'snapshot' || message.source === 'rest');
    if (next) nextById.set(ticket, next);
  }
  return Array.from(nextById.values());
}

/** A structural reconciliation is needed before these quote patches can apply. */
export function positionStreamNeedsReconciliation<T extends { id: number }>(
  current: readonly T[],
  message: DecodedPositionStreamMessage,
): boolean {
  const byId = new Map(current.map(position => [position.id, position]));
  return message.rows.some(row => {
    if (row.update_kind !== 'pnl') return false;
    const ticket = getPositionStreamTicket(row);
    if (ticket === null) return false;
    const previous = byId.get(ticket);
    if (!previous) return true;
    const version = getPositionStreamVersion(row);
    const oldVersion = getPositionStreamVersion(previous as PositionRecord);
    return version !== null && (oldVersion === null || BigInt(version) > BigInt(oldVersion));
  });
}

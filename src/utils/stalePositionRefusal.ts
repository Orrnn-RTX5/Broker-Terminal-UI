/**
 * A modify or close aimed at a position the broker no longer holds open (stop
 * loss or take profit hit, stop-out, a close elsewhere) is refused with
 * 409 POSITION_ALREADY_CLOSED and the close details, or with 404 NOT_FOUND for
 * a ticket the account does not hold. Every SL/TP and close path uses this one
 * helper: it drops the ticket from the store, triggers one positions refresh
 * and returns a plain-words message. Any other refusal is left untouched.
 */

import { isConfirmedClosedBySnapshot, isConfirmedClosedPosition, markPositionsClosed, useAppStore } from '../store/useAppStore';

export type StalePositionTranslator = (source: string, values?: Record<string, unknown>) => string;

export type StalePositionRefusal =
  | { kind: 'closed'; ticket: number | null; reason: string | null; price: string | null }
  | { kind: 'not_open'; ticket: number | null };

export interface StalePositionOptions {
  /** One positions refresh through the app's existing refresh path. */
  refresh: () => void;
  tr: StalePositionTranslator;
}

// Wire values of close_reason. Any other value reads as a plain "closed".
const CLOSE_REASON_LABELS: Record<string, string> = {
  sl: 'SL',
  tp: 'TP',
  manual: 'closed manually',
  stop_out: 'stop out',
  close_by: 'close by',
  close_all: 'close all',
  admin: 'by the broker',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const readText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text : null;
};

const readTicket = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const ticket = Number(value);
  return Number.isSafeInteger(ticket) && ticket > 0 ? ticket : null;
};

const readCloseReason = (value: unknown): string | null => {
  const reason = readText(value);
  return reason !== null && Object.prototype.hasOwnProperty.call(CLOSE_REASON_LABELS, reason) ? reason : null;
};

/** Parses the refusal envelope. The code sits under "error" (gateway shape); "code" is accepted too. */
export const readStalePositionRefusal = (err: unknown): StalePositionRefusal | null => {
  if (!isRecord(err) || typeof err.status !== 'number') return null;
  const body = isRecord(err.data) ? err.data : {};
  const code = readText(body.error) ?? readText(body.code) ?? '';
  if (err.status === 404 && code === 'NOT_FOUND') {
    return { kind: 'not_open', ticket: readTicket(body.ticket) };
  }
  if (err.status === 409 && code === 'POSITION_ALREADY_CLOSED') {
    // close_price is a decimal string at the symbol's digits: shown verbatim, never parsed.
    return {
      kind: 'closed',
      ticket: readTicket(body.ticket),
      reason: readCloseReason(body.close_reason),
      price: readText(body.close_price),
    };
  }
  return null;
};

const formatStalePositionMessage = (
  ticket: number,
  refusal: StalePositionRefusal | null,
  tr: StalePositionTranslator,
): string => {
  if (refusal?.kind === 'not_open') {
    return tr('Position {{ticket}} is no longer open', { ticket });
  }
  const reason = refusal?.kind === 'closed' && refusal.reason ? tr(CLOSE_REASON_LABELS[refusal.reason]) : null;
  const price = refusal?.kind === 'closed' ? refusal.price : null;
  if (reason && price) {
    return tr('Position {{ticket}} already closed ({{reason}}) at {{price}}', { ticket, reason, price });
  }
  if (reason) return tr('Position {{ticket}} already closed ({{reason}})', { ticket, reason });
  if (price) return tr('Position {{ticket}} already closed at {{price}}', { ticket, price });
  return tr('Position {{ticket}} already closed', { ticket });
};

/** The app's positions refresh (the same event the trade panels use after an order). */
export const requestPositionsRefresh = (): void => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('rtx:force-refresh-positions'));
};

const removeTicketFromStore = (ticket: number, closed: boolean): void => {
  const store = useAppStore.getState();
  store.setPositions(
    store.positions.filter((position) => Number(position.id) !== ticket),
    closed ? { removedTickets: [ticket], closedTickets: [ticket] } : { removedTickets: [ticket] },
  );
};

/**
 * Handles a refused modify or close. Returns the user-facing message when the
 * refusal means the position is no longer open, or null (with no side effects)
 * for every other error, which the caller keeps handling as before.
 */
export const handleStalePositionRefusal = (
  err: unknown,
  ticket: number,
  options: StalePositionOptions,
): string | null => {
  const refusal = readStalePositionRefusal(err);
  if (!refusal) return null;
  const refusedTicket = refusal.ticket ?? ticket;
  // The broker confirmed closure (409): hide the line at once. A 404 is not proof
  // of closure (it can race a fresh fill), so only the store and a refresh move.
  if (refusal.kind === 'closed') markPositionsClosed([refusedTicket]);
  removeTicketFromStore(refusedTicket, refusal.kind === 'closed');
  options.refresh();
  return formatStalePositionMessage(refusedTicket, refusal, options.tr);
};

/**
 * Pre-send check for chart SL/TP and drag. Refuse only a ticket known to be closed (a 409
 * close tombstone or a confirmed-then-absent close). A ticket merely missing from the store
 * is sent: the broker answers it, and a 404/409 then goes through handleStalePositionRefusal.
 */
export const isPositionKnownClosed = (ticket: number): boolean =>
  isConfirmedClosedPosition(ticket) || isConfirmedClosedBySnapshot(ticket);

/** Message for a chart send refused by the pre-send check. Nothing is sent; one refresh is triggered. */
export const refuseSendForClosedPosition = (ticket: number, options: StalePositionOptions): string => {
  options.refresh();
  return formatStalePositionMessage(ticket, null, options.tr);
};

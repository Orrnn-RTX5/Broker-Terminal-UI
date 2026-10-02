import { calculateDailyChange, type DailyChangeInput, type DailyChangePriceMode, type DailyChangeValues } from './dailyChange';

export interface DailyChangeReference {
  price: number;
  kind: 'close' | 'settlement';
  sessionId?: string;
  sessionStart?: number;
  sessionEnd?: number;
  provider?: string;
  mode: DailyChangePriceMode;
  adjustment?: string;
  asOf: number;
}

export type DailyChangeIssue = 'reference-unavailable' | 'session-unavailable' | 'price-mode-unavailable'
  | 'price-unavailable' | 'provider-mismatch' | 'price-basis-mismatch' | 'adjustment-mismatch'
  | 'outside-session' | 'reference-session-mismatch' | 'zero-reference' | 'negative-reference-convention-unavailable';

export interface DailyChangeSnapshot extends DailyChangeValues {
  asOf: number;
  valuesAsOf?: number;
  price?: number;
  priceAsOf?: number;
  reference?: DailyChangeReference;
  sessionId?: string;
  sessionStart?: number;
  sessionEnd?: number;
  provider?: string;
  mode?: DailyChangePriceMode;
  adjustment?: string;
  negativeConvention?: 'signed' | 'absolute';
  status?: DailyChangeInput['status'];
  issue?: DailyChangeIssue;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const owns = (input: DailyChangeInput, key: keyof DailyChangeInput) => Object.prototype.hasOwnProperty.call(input, key);
const hasSession = (value: { sessionId?: string; sessionStart?: number; sessionEnd?: number }) => Boolean(
  value.sessionId || (value.sessionStart !== undefined && value.sessionEnd !== undefined),
);
const inSession = (time: number, value: { sessionStart?: number; sessionEnd?: number }) => (
  (value.sessionStart === undefined || time >= value.sessionStart)
  && (value.sessionEnd === undefined || time < value.sessionEnd)
);

/**
 * Only broker event times and explicit session IDs/bounds establish ownership.
 * Overnight sessions, holidays and DST are handled by the provider's supplied
 * IDs/bounds, never by the user's date or chart timezone. A sparse unscoped
 * quote cannot reuse a reference whose applicable session is unknown.
 */
export const advanceDailyChange = (
  previous: DailyChangeSnapshot | undefined,
  input: DailyChangeInput,
  eventTime: number,
): DailyChangeSnapshot | undefined => {
  if (!finite(eventTime) || eventTime <= 0 || (previous && eventTime < previous.asOf)) return previous;
  const identityChanged = Boolean(previous && (
    (input.provider !== undefined && previous.provider !== input.provider)
    || (input.mode !== undefined && previous.mode !== input.mode)
    || (input.adjustment !== undefined && previous.adjustment !== input.adjustment)
    || (input.sessionId !== undefined && previous.sessionId !== input.sessionId)
    || (input.sessionStart !== undefined && previous.sessionStart !== input.sessionStart)
    || (input.sessionEnd !== undefined && previous.sessionEnd !== input.sessionEnd)
  ));
  const prior = identityChanged ? undefined : previous;
  const sessionId = input.sessionId ?? prior?.sessionId;
  const sessionStart = input.sessionStart ?? prior?.sessionStart;
  const sessionEnd = input.sessionEnd ?? prior?.sessionEnd;
  const provider = input.provider ?? previous?.provider;
  const mode = input.mode === null ? undefined : input.mode ?? previous?.mode;
  const adjustment = input.adjustment ?? previous?.adjustment;
  const session = { sessionId, sessionStart, sessionEnd };
  const freshPrice = finite(input.bid) || finite(input.last);
  const transientStatus = prior?.status === 'stale' || prior?.status === 'disconnected';
  const status = input.status ?? (freshPrice && transientStatus ? 'live' : prior?.status) ?? 'live';
  const closed = status === 'closed';
  const eligible = mode === 'last' ? input.last : mode === 'bid' ? input.bid : undefined;
  const canReuse = hasSession(session) && inSession(eventTime, session);
  const price = finite(eligible) ? eligible : canReuse ? prior?.price : undefined;
  const priceAsOf = finite(eligible) ? eventTime : canReuse ? prior?.priceAsOf : undefined;
  const negativeConvention = input.negativeConvention ?? prior?.negativeConvention;
  const next: DailyChangeSnapshot = {
    asOf: eventTime, price, priceAsOf, provider, mode, adjustment,
    ...session, negativeConvention, status,
  };

  if (!inSession(eventTime, session) && !closed) {
    return { ...next, issue: 'outside-session' };
  }
  if (input.referenceSessionId !== undefined && input.referenceSessionId !== sessionId) {
    return { ...next, issue: 'reference-session-mismatch' };
  }
  if (input.referenceProvider !== undefined && input.referenceProvider !== provider) {
    return { ...next, issue: 'provider-mismatch' };
  }
  if (input.referenceMode !== undefined && input.referenceMode !== mode) {
    return { ...next, issue: 'price-basis-mismatch' };
  }
  if (input.referenceAdjustment !== undefined && input.referenceAdjustment !== adjustment) {
    return { ...next, issue: 'adjustment-mismatch' };
  }

  const explicitReference = owns(input, 'previousClose') || owns(input, 'settlement');
  let reference = canReuse || (closed && hasSession(session)) ? prior?.reference : undefined;
  if (explicitReference && mode && (input.referenceAsOf === undefined || !reference || input.referenceAsOf >= reference.asOf)) {
    const settlement = owns(input, 'settlement')
      ? finite(input.settlement) && input.settlement !== 0 ? input.settlement : undefined
      : reference?.kind === 'settlement' ? reference.price : undefined;
    const close = finite(input.previousClose) ? input.previousClose : undefined;
    const value = settlement ?? close;
    reference = value === undefined ? undefined : {
      price: value, kind: settlement !== undefined ? 'settlement' : 'close', mode, provider,
      ...session, adjustment, asOf: input.referenceAsOf ?? eventTime,
    };
  }
  next.reference = reference;

  // A closed-state update can retain the final value even after session_end.
  // It never promotes an old quote into a new session or executable price.
  if (closed && !finite(eligible) && !explicitReference && prior) {
    return { ...prior, asOf: eventTime, status: 'closed' };
  }
  const computed = reference ? calculateDailyChange(price, reference.price, negativeConvention) : {};
  next.change = finite(input.upstreamChange) ? input.upstreamChange : computed.change;
  next.percent = finite(input.upstreamPercent) ? input.upstreamPercent : computed.percent;
  next.valuesAsOf = next.change !== undefined || next.percent !== undefined
    ? finite(eligible) || explicitReference || finite(input.upstreamPercent) || finite(input.upstreamChange)
      ? eventTime : prior?.valuesAsOf
    : undefined;
  // Retain source-supplied measures only as last-known values, never update
  // their timestamp or recompute them from an incompatible sparse quote.
  if (!explicitReference && next.change === undefined && next.percent === undefined && prior
    && !owns(input, 'upstreamChange') && !owns(input, 'upstreamPercent') && !identityChanged) {
    next.change = prior.change;
    next.percent = prior.percent;
    next.valuesAsOf = prior.valuesAsOf;
    if (!reference) next.status = status === 'closed' ? 'closed' : 'stale';
  }
  if (!mode && next.change === undefined && next.percent === undefined) next.issue = 'price-mode-unavailable';
  else if (!reference && next.change === undefined && next.percent === undefined) next.issue = 'reference-unavailable';
  else if (price === undefined && next.change === undefined && next.percent === undefined) next.issue = 'price-unavailable';
  else if (reference?.price === 0 && next.percent === undefined) next.issue = 'zero-reference';
  else if (reference && reference.price < 0 && !negativeConvention && next.percent === undefined) next.issue = 'negative-reference-convention-unavailable';
  else if (!hasSession(session)) next.issue = 'session-unavailable';
  return next;
};

export const dailyChangeDescription = (value: DailyChangeSnapshot | undefined): string => {
  if (!value) return 'Loading daily reference';
  const parts = [value.status, value.sessionId ? `Session ${value.sessionId}` : undefined,
    value.reference ? `Reference ${value.reference.price} (${value.reference.kind}, ${value.reference.mode})` : undefined,
    value.issue ? `Daily change: ${value.issue.replaceAll('-', ' ')}` : undefined,
    `As of ${new Date(value.valuesAsOf ?? value.priceAsOf ?? value.asOf).toISOString()}`];
  return parts.filter(Boolean).join(' · ');
};

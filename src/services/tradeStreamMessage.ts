/** Subscription confirmations without trade data do not invalidate REST history. */
export const isTradeSubscriptionControlFrame = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const frame = value as Record<string, unknown>;
  const eventType = typeof frame.type === 'string' && frame.type.trim()
    ? frame.type
    : frame.action;
  if (typeof eventType !== 'string') return false;
  const normalizedType = eventType.trim().toLowerCase();
  if (normalizedType !== 'subscribed' && normalizedType !== 'unsubscribed') return false;

  // Some gateways attach an initial snapshot to their acknowledgement. Keep
  // those, and every unknown/data event, on the existing reconciliation path.
  return !['data', 'payload', 'order', 'orders', 'deal', 'deals']
    .some(key => frame[key] !== undefined && frame[key] !== null);
};

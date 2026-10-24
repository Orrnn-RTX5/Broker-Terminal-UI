import { describe, expect, it } from 'vitest';
import { formatOrderError } from './orderError';
import { ApiError } from '../api/client';
import { OrderCommandTerminalError } from '../services/orderCommandLifecycle';

describe('formatOrderError', () => {
  it('preserves an async command backend code and message verbatim', () => {
    expect(formatOrderError({
      preserveBackendOrderError: true,
      code: 'SOURCE_MISMATCH',
      backendMessage: 'Execution source does not match quote source.',
    })).toBe('SOURCE_MISMATCH: Execution source does not match quote source.');
  });

  it('shows the busy message for a structured 429 POST rejection carrying TOO_MANY_ORDERS', () => {
    expect(formatOrderError(new ApiError(429, 'Too many orders are already in flight for this account', {
      error: 'TOO_MANY_ORDERS',
      message: 'Too many orders are already in flight for this account',
    }))).toBe('Account busy — previous orders are still processing. Please retry.');
  });

  it('shows the busy message for the trade WebSocket rejection shape (no HTTP status)', () => {
    const wsRejection = new OrderCommandTerminalError({
      status: 'rejected',
      terminal: true,
      clientOrderId: 'cid-1',
      error: { code: 'TOO_MANY_ORDERS', message: 'Too many orders are already in flight for this account' },
      raw: {},
    }, 'cid-1');
    expect(formatOrderError(wsRejection)).toBe('Account busy — previous orders are still processing. Please retry.');
  });

  it('shows the busy message for an expired WebSocket command carrying TOO_MANY_ORDERS', () => {
    const expired = new OrderCommandTerminalError({
      status: 'expired',
      terminal: true,
      clientOrderId: 'cid-2',
      error: { code: 'TOO_MANY_ORDERS', message: 'busy' },
      raw: {},
    }, 'cid-2');
    expect(formatOrderError(expired)).toBe('Account busy — previous orders are still processing. Please retry.');
  });

  it('keeps other WebSocket rejection codes on their existing copy', () => {
    const invalidVolume = new OrderCommandTerminalError({
      status: 'rejected',
      terminal: true,
      clientOrderId: 'cid-3',
      error: { code: 'INVALID_VOLUME', message: 'Volume below minimum' },
      raw: {},
    }, 'cid-3');
    expect(formatOrderError(invalidVolume)).toBe('INVALID_VOLUME: Volume below minimum');
  });

  it('shows a plain busy message for a 429 TOO_MANY_ORDERS refusal (code under "error")', () => {
    expect(formatOrderError(new ApiError(429, 'Too many orders are already in flight for this account', {
      error: 'TOO_MANY_ORDERS',
      message: 'Too many orders are already in flight for this account',
    }))).toBe('Account busy — previous orders are still processing. Please retry.');
  });

  it('shows the same busy message when the code sits under "code"', () => {
    expect(formatOrderError(new ApiError(429, 'busy', { code: 'TOO_MANY_ORDERS', message: 'busy' })))
      .toBe('Account busy — previous orders are still processing. Please retry.');
  });

  it('shows the busy message for a 429 TOO_MANY_ORDERS carried on a plain error code', () => {
    expect(formatOrderError(Object.assign(new Error('Too many orders'), { status: 429, code: 'TOO_MANY_ORDERS' })))
      .toBe('Account busy — previous orders are still processing. Please retry.');
  });

  it('keeps other 429 codes on their existing copy', () => {
    expect(formatOrderError(new ApiError(429, 'Slow down', { error: 'RATE_LIMITED' })))
      .toBe('Order failed: too many requests. Please slow down and try again.');
    expect(formatOrderError(new ApiError(429, 'Slow down')))
      .toBe('Order failed: too many requests. Please slow down and try again.');
  });

  it('leaves TOO_MANY_ORDERS unchanged on statuses other than 429', () => {
    expect(formatOrderError(new ApiError(400, 'limit', { error: 'TOO_MANY_ORDERS', message: 'limit' })))
      .toBe('TOO_MANY_ORDERS: limit');
    expect(formatOrderError(new ApiError(503, 'limit', { error: 'TOO_MANY_ORDERS' })))
      .toBe('Order failed: the trading server reported an error. Please try again shortly.');
  });

  it('maps a network-level ApiError (status 0) to a connection message', () => {
    const msg = formatOrderError(new ApiError(0, 'fetch failed at http://10.0.0.5:8091/api/orders?token=abc'));
    expect(msg).toBe('Order failed: cannot reach the trading server. Check your connection and try again.');
    expect(msg).not.toContain('10.0.0.5');
    expect(msg).not.toContain('token');
  });

  it('maps auth failures to a re-login message without leaking detail', () => {
    expect(formatOrderError(new ApiError(401, 'Unauthorized / Session Expired')))
      .toBe('Order failed: your session is no longer authorized. Please sign in again.');
    expect(formatOrderError(new ApiError(403, 'Forbidden http://broker/x')))
      .toBe('Order failed: your session is no longer authorized. Please sign in again.');
  });

  it('maps 5xx to a generic server message', () => {
    expect(formatOrderError(new ApiError(503, 'upstream http://103.91.186.142:8091 down')))
      .toBe('Order failed: the trading server reported an error. Please try again shortly.');
  });

  it('surfaces a clean 4xx business message but scrubs URLs/IPs', () => {
    const msg = formatOrderError(new ApiError(400, 'Insufficient margin at https://services.example.com/orders?token=xyz'));
    expect(msg).toContain('Insufficient margin');
    expect(msg).toContain('[server]');
    expect(msg).not.toContain('services.example.com');
    expect(msg).not.toContain('token');
  });

  it('scrubs a bare host:port from a 4xx detail', () => {
    const msg = formatOrderError(new ApiError(409, 'conflict from 103.91.186.142:8091'));
    expect(msg).not.toContain('103.91.186.142');
    expect(msg).toContain('[server]');
  });

  it('handles a plain Error with a fetch failure', () => {
    expect(formatOrderError(new Error('Failed to fetch')))
      .toBe('Order failed: cannot reach the trading server. Check your connection and try again.');
  });

  it('handles a plain Error with a usable, URL-free message', () => {
    expect(formatOrderError(new Error('Volume below minimum')))
      .toBe('Order failed: Volume below minimum');
  });

  it('warns against resubmission when a sent order has an unknown outcome', () => {
    const error = Object.assign(new Error('Timed out while confirming the order status'), {
      code: 'ORDER_STATUS_TIMEOUT',
      orderWasSent: true,
      retryable: false,
    });

    expect(formatOrderError(error)).toBe(
      'Order status unknown: the request was sent, but the server did not confirm the final result. Do not place it again; check open positions and order history.',
    );
  });

  it('handles non-error / empty input gracefully', () => {
    expect(formatOrderError(undefined)).toBe('Order failed: cannot reach the trading server. Check your connection and try again.');
    expect(formatOrderError(null)).toBe('Order failed: cannot reach the trading server. Check your connection and try again.');
    expect(formatOrderError('Order rejected')).toBe('Order failed: Order rejected');
  });

  it('maps trading error codes from API payloads to trader-safe copy', () => {
    expect(formatOrderError(new ApiError(400, 'MARKET_CLOSED', { error: 'MARKET_CLOSED', message: 'MARKET_CLOSED' })))
      .toBe('Order failed: the market is currently closed for this symbol.');
    expect(formatOrderError(new ApiError(400, 'Required: 120.00, Available: 10.00', { error: 'INSUFFICIENT_MARGIN' })))
      .toBe('Order failed: not enough free margin to open this order.');
    expect(formatOrderError(new Error('Missing account login for /api/v2/orders')))
      .toBe('Order failed: no trading account is selected. Please sign in again.');
  });
});

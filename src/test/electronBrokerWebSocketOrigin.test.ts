import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  isBrokerWebSocketRequest,
  registerBrokerWebSocketOriginPolicy,
  sanitizeBrokerWebSocketHeaders,
} = require('../../electron-network.cjs') as {
  isBrokerWebSocketRequest: (details: Record<string, unknown>) => boolean;
  registerBrokerWebSocketOriginPolicy: (webRequest: {
    onBeforeSendHeaders: (filter: unknown, listener: (details: unknown, callback: (response: unknown) => void) => void) => void;
  }) => void;
  sanitizeBrokerWebSocketHeaders: (details: Record<string, unknown>) => Record<string, string>;
};

describe('Electron broker WebSocket Origin policy', () => {
  it.each(['/ws/feed', '/ws/v2?token=jwt'])('removes Origin only from broker socket %s', (path) => {
    const details = {
      resourceType: 'webSocket',
      url: `wss://broker.example${path}`,
      requestHeaders: {
        Origin: 'file://',
        Authorization: 'Bearer jwt',
        'Sec-WebSocket-Protocol': 'json',
      },
    };

    expect(isBrokerWebSocketRequest(details)).toBe(true);
    expect(sanitizeBrokerWebSocketHeaders(details)).toEqual({
      Authorization: 'Bearer jwt',
      'Sec-WebSocket-Protocol': 'json',
    });
  });

  it('preserves Origin for unrelated sockets and non-WebSocket requests', () => {
    const unrelatedSocket = {
      resourceType: 'webSocket',
      url: 'wss://broker.example/notifications',
      requestHeaders: { origin: 'file://' },
    };
    const apiRequest = {
      resourceType: 'xhr',
      url: 'https://broker.example/ws/feed',
      requestHeaders: { Origin: 'file://' },
    };

    expect(isBrokerWebSocketRequest(unrelatedSocket)).toBe(false);
    expect(sanitizeBrokerWebSocketHeaders(unrelatedSocket)).toEqual({ origin: 'file://' });
    expect(sanitizeBrokerWebSocketHeaders(apiRequest)).toEqual({ Origin: 'file://' });
  });

  it('registers a WebSocket-only request filter', () => {
    const onBeforeSendHeaders = vi.fn();
    registerBrokerWebSocketOriginPolicy({ onBeforeSendHeaders });

    expect(onBeforeSendHeaders).toHaveBeenCalledWith(
      { urls: ['<all_urls>'], types: ['webSocket'] },
      expect.any(Function),
    );
  });
});

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WS_ENDPOINTS, updateDynamicUrls } from './api';

type RuntimeWindow = Window & {
  RUNTIME_CONFIG?: Record<string, unknown>;
  __RTX_RUNTIME_CONFIG__?: Record<string, unknown>;
};

const runtimeWindow = window as RuntimeWindow;

describe('dynamic authenticated WebSocket endpoint', () => {
  beforeEach(() => {
    localStorage.clear();
    delete runtimeWindow.RUNTIME_CONFIG;
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__;
    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: { window: {} },
    });
  });

  afterEach(() => {
    localStorage.clear();
    delete window.electron;
    updateDynamicUrls();
  });

  it('returns the broker selected after the config module was initialized', () => {
    localStorage.setItem('broker_id', 'achiever-financials');
    localStorage.setItem('server_url', 'https://service.achieverfinancials.com');
    localStorage.setItem('ws_url', 'wss://service.achieverfinancials.com/ws/v2');

    updateDynamicUrls();

    expect(WS_ENDPOINTS.general).toBe('wss://service.achieverfinancials.com/ws/v2');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { buildApiV2WsUrl } from '../config/api';
import { buildBrokerWsV2Uri, getBrokerWsHost } from './brokerSession';

describe('broker websocket URL builder', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('builds wss /ws/v2 URLs from saved HTTPS broker server_url', () => {
    localStorage.setItem('server_url', 'https://testbrokerbackend.orrnn.com:443');
    localStorage.setItem('auth_token', 'access-token');

    expect(buildBrokerWsV2Uri()).toBe(
      'wss://testbrokerbackend.orrnn.com:443/ws/v2?token=access-token'
    );
  });

  it('forces wss while preserving host and port from HTTP broker server_url', () => {
    localStorage.setItem('server_url', 'http://69.197.178.27:8090');

    expect(buildBrokerWsV2Uri('jwt-token')).toBe(
      'wss://69.197.178.27:8090/ws/v2?token=jwt-token'
    );
    expect(buildApiV2WsUrl('jwt-token')).toBe(
      'wss://69.197.178.27:8090/ws/v2?token=jwt-token'
    );
  });

  it('extracts only host and port when server_url contains a path', () => {
    expect(getBrokerWsHost('https://broker-domain.com:8443/api/v2')).toBe(
      'broker-domain.com:8443'
    );
  });
});

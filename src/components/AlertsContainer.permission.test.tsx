// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AlertsContainer } from './AlertsContainer';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
beforeEach(() => {
  vi.stubGlobal('Audio', vi.fn(function () {
    return { play: vi.fn().mockResolvedValue(undefined), volume: 0, currentTime: 0 };
  }));
});

it('does not request browser notification permission on startup', () => {
  const requestPermission = vi.fn();
  vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission: 'default', requestPermission }));
  render(<AlertsContainer />);
  expect(requestPermission).not.toHaveBeenCalled();
});

it('uses a granted permission at alert delivery even when permission changed after startup', () => {
  const Notification = Object.assign(vi.fn(), { permission: 'default', requestPermission: vi.fn() });
  vi.stubGlobal('Notification', Notification);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  const connection = new EventTarget();
  render(<AlertsContainer wsConnection={connection as WebSocket} />);
  Notification.permission = 'granted';
  act(() => connection.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
    type: 'alert', id: 'test-alert', severity: 'MEDIUM', message: 'Price alert',
  }) })));
  expect(Notification).toHaveBeenCalledWith('MEDIUM Alert', expect.objectContaining({ body: 'Price alert' }));
  expect(Notification.requestPermission).not.toHaveBeenCalled();
});

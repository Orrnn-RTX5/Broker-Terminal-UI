import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isElectronDrawingToolsRuntime,
  isWebDrawingToolsRuntime,
} from './runtime';

const installRuntime = ({
  electron,
  electronAPI,
  protocol = 'https:',
  userAgent = 'Mozilla/5.0',
}: {
  electron?: { window?: unknown };
  electronAPI?: unknown;
  protocol?: string;
  userAgent?: string;
}) => {
  vi.stubGlobal('window', {
    electron,
    electronAPI,
    location: { protocol },
  });
  vi.stubGlobal('navigator', { userAgent });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('drawing-tools runtime detection', () => {
  it('enables the drawing rail in a regular browser runtime', () => {
    installRuntime({});

    expect(isElectronDrawingToolsRuntime()).toBe(false);
    expect(isWebDrawingToolsRuntime()).toBe(true);
  });

  it.each([
    { name: 'preload window bridge', electron: { window: {} } },
    { name: 'legacy Electron API bridge', electronAPI: {} },
    { name: 'file protocol', protocol: 'file:' },
    { name: 'Electron user agent', userAgent: 'Mozilla/5.0 Electron/40.8.0' },
  ])('keeps the web rail disabled for the $name signal', ({ name: _name, ...runtime }) => {
    installRuntime(runtime);

    expect(isElectronDrawingToolsRuntime()).toBe(true);
    expect(isWebDrawingToolsRuntime()).toBe(false);
  });

  it('does not classify server-side rendering as web', () => {
    vi.stubGlobal('window', undefined);

    expect(isElectronDrawingToolsRuntime()).toBe(false);
    expect(isWebDrawingToolsRuntime()).toBe(false);
  });
});

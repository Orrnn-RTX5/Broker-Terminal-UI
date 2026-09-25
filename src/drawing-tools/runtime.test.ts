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
    { name: 'preload window bridge', runtime: { electron: { window: {} } } },
    { name: 'legacy Electron API bridge', runtime: { electronAPI: {} } },
    { name: 'file protocol', runtime: { protocol: 'file:' } },
    { name: 'Electron user agent', runtime: { userAgent: 'Mozilla/5.0 Electron/40.8.0' } },
  ])('enables the shared rail for the $name signal', ({ runtime }) => {
    installRuntime(runtime);

    expect(isElectronDrawingToolsRuntime()).toBe(true);
    expect(isWebDrawingToolsRuntime()).toBe(true);
  });

  it('does not classify server-side rendering as web', () => {
    vi.stubGlobal('window', undefined);

    expect(isElectronDrawingToolsRuntime()).toBe(false);
    expect(isWebDrawingToolsRuntime()).toBe(false);
  });
});

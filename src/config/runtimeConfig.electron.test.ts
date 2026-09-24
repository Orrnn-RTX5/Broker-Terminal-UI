import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'public/runtime-config.js'), 'utf8');
const runRuntimeConfig = (
  runtimeWindow: Record<string, any>,
  userAgent = 'Mozilla/5.0',
) => new Function('window', 'navigator', source)(runtimeWindow, { userAgent });

describe('deployed runtime configuration', () => {
  it('leaves broker selection to the environment-generated configuration', () => {
    const runtimeWindow = { location: { protocol: 'https:' } };

    runRuntimeConfig(runtimeWindow);

    expect((runtimeWindow as any).RUNTIME_CONFIG).toBeUndefined();
    expect(source).not.toContain('fxtrustbrokerbackend.orrnn.com');
    expect(source).not.toContain('service.achieverfinancials.com');
    expect(source).not.toContain('service.orrnn.com');
    expect(source).not.toContain('superadmin-prod.orrnn.com');
  });

  it.each([
    [{ location: { protocol: 'file:' } }, 'Mozilla/5.0'],
    [{ location: { protocol: 'http:' }, electron: { window: {} } }, 'Mozilla/5.0'],
    [{ location: { protocol: 'http:' } }, 'Mozilla/5.0 Electron/40.8.0'],
  ])('does not overwrite the broker session in Electron', (runtimeWindow, userAgent) => {
    (runtimeWindow as any).RUNTIME_CONFIG = { existing: true };

    runRuntimeConfig(runtimeWindow as Record<string, any>, userAgent as string);

    expect((runtimeWindow as any).RUNTIME_CONFIG).toEqual({ existing: true });
    expect((runtimeWindow as any).__RTX_RUNTIME_CONFIG__).toBeUndefined();
  });
});

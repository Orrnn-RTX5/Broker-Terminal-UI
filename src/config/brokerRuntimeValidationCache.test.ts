import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrokerRuntimeValidationCache } from './brokerRuntimeValidationCache';
import { validateBrokerRuntimeConfig } from './brokerRuntimeConfig';
import { getRuntimeBrokerConfiguration } from './backendTarget.js';

const fixture = (): Record<string, unknown> => ({
  CONFIG_SOURCE: 'deployment', BACKEND_TARGET: 'web', BROKER_ID: 'Broker', DEFAULT_MT5_SERVER: 'Broker Live',
  API_HOST: 'https://broker.example', WS_HOST: 'wss://broker.example', CONFIG_ERRORS: [],
});
const runtime = window as Window & {
  RUNTIME_CONFIG?: Record<string, unknown>; __RTX_RUNTIME_CONFIG__?: Record<string, unknown>;
  __RUNTIME_CONFIG__?: Record<string, unknown>;
};
afterEach(() => {
  delete runtime.RUNTIME_CONFIG; delete runtime.__RTX_RUNTIME_CONFIG__; delete runtime.__RUNTIME_CONFIG__;
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
});

describe('exact-input runtime validation memo', () => {
  it('validates repeated unchanged input once, retains only one entry and isolates returned results', () => {
    const validate = vi.fn(validateBrokerRuntimeConfig), cached = createBrokerRuntimeValidationCache(validate), config = fixture();
    const result = cached(config, { allowLocal: false, desktop: false });
    result.valid = false; result.brokerId = 'poison'; result.errors.push('poison');
    result.allowedOrigins.push('https://poison.example'); result.extraDiscoveryUrls.push('poison');
    for (let n = 0; n < 1000; n++) {
      expect(cached(config, { allowLocal: false, desktop: false })).toEqual(validateBrokerRuntimeConfig(config));
    }
    expect(validate).toHaveBeenCalledTimes(1);
    const second = { ...config, BROKER_ID: 'Other' };
    cached(second, {}); cached(config, {});
    expect(validate).toHaveBeenCalledTimes(3);
  });

  it('compares every own primitive exactly, including missing, undefined, null, NaN, infinities and bigint', () => {
    const validate = vi.fn(validateBrokerRuntimeConfig), cached = createBrokerRuntimeValidationCache(validate), config = fixture();
    cached(config, {});
    const values = [undefined, null, '', NaN, Infinity, -Infinity, 0, -0, 1n, 1, false, Symbol('test')];
    for (const value of values) {
      config.UNUSED_PRESENTATION_FIELD = value;
      cached(config, {}); cached(config, {});
    }
    expect(validate).toHaveBeenCalledTimes(values.length + 1);
    delete config.UNUSED_PRESENTATION_FIELD;
    cached(config, {});
    expect(validate).toHaveBeenCalledTimes(values.length + 2);
    Object.defineProperty(config, 'HIDDEN_FIELD', { value: 'one', configurable: true, enumerable: false });
    cached(config, {});
    Object.defineProperty(config, 'HIDDEN_FIELD', { value: 'two', configurable: true, enumerable: false });
    cached(config, {});
    expect(validate).toHaveBeenCalledTimes(values.length + 4);
  });

  it('preserves empty-primary versus missing/null/undefined fallback aliases', () => {
    const cached = createBrokerRuntimeValidationCache(), config = fixture();
    config.VITE_API_HOST = config.API_HOST;
    expect(cached(config, {}).valid).toBe(true);
    config.API_HOST = '';
    expect(cached(config, {}).valid).toBe(false);
    config.API_HOST = undefined;
    expect(cached(config, {}).valid).toBe(true);
    config.API_HOST = null;
    expect(cached(config, {}).valid).toBe(true);
    delete config.API_HOST;
    expect(cached(config, {}).valid).toBe(true);
    config.VITE_API_HOST = 'http://unsafe.example';
    expect(cached(config, {}).valid).toBe(false);
  });

  it('detects in-place error array content and length changes', () => {
    const validate = vi.fn(validateBrokerRuntimeConfig), cached = createBrokerRuntimeValidationCache(validate), config = fixture();
    const errors = config.CONFIG_ERRORS as string[];
    expect(cached(config, {}).valid).toBe(true);
    errors.push('first'); expect(cached(config, {}).errors).toContain('first');
    errors[0] = 'second'; expect(cached(config, {}).errors).toContain('second');
    errors.length = 0; expect(cached(config, {}).valid).toBe(true);
    expect(validate).toHaveBeenCalledTimes(4);
  });

  it.each(['sparse', 'accessor', 'iterator', 'array-prototype', 'other-array', 'object', 'custom-prototype'])('leaves %s configuration uncached', kind => {
    const validate = vi.fn(validateBrokerRuntimeConfig), cached = createBrokerRuntimeValidationCache(validate);
    const config = fixture();
    if (kind === 'sparse') config.CONFIG_ERRORS = Array(1);
    if (kind === 'accessor') Object.defineProperty(config.CONFIG_ERRORS, '0', { get: () => 'error', enumerable: true });
    if (kind === 'iterator') Object.defineProperty(config.CONFIG_ERRORS, Symbol.iterator, { value: function* () { yield 'custom'; } });
    if (kind === 'array-prototype') Object.setPrototypeOf(config.CONFIG_ERRORS, Object.create(Array.prototype));
    if (kind === 'other-array') config.EXTRA = ['ignored'];
    if (kind === 'object') config.EXTRA = { ignored: true };
    if (kind === 'custom-prototype') Object.setPrototypeOf(config, { inherited: true });
    cached(config, {}); cached(config, {});
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it('does not read accessors while snapshotting and preserves validator errors', () => {
    const config = fixture(), read = vi.fn(() => 'https://broker.example');
    Object.defineProperty(config, 'API_HOST', { get: read, enumerable: true });
    const cached = createBrokerRuntimeValidationCache();
    cached(config, {}); cached(config, {});
    expect(read).toHaveBeenCalledTimes(2);
    const throwing = { ...fixture(), API_HOST: { toString() { throw new Error('conversion failed'); } } };
    expect(() => cached(throwing, {})).toThrow('conversion failed');
  });

  it('falls back when proxy introspection throws without swallowing validator errors', () => {
    const validate = vi.fn(validateBrokerRuntimeConfig), cached = createBrokerRuntimeValidationCache(validate);
    const proxy = new Proxy(fixture(), { ownKeys() { throw new Error('introspection unavailable'); } });
    expect(cached(proxy, {}).valid).toBe(true);
    expect(cached(proxy, {}).valid).toBe(true);
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it('does not reuse descriptors when dynamic reads disagree with their data values', () => {
    const validate = vi.fn(validateBrokerRuntimeConfig), cached = createBrokerRuntimeValidationCache(validate);
    let api = 'https://broker.example';
    const proxy = new Proxy(fixture(), { get(target, key, receiver) {
      return key === 'API_HOST' ? api : Reflect.get(target, key, receiver);
    } });
    expect(cached(proxy, {}).valid).toBe(true);
    api = 'http://unsafe.example';
    expect(cached(proxy, {}).valid).toBe(false);
    expect(validate).toHaveBeenCalledTimes(2);
    const errors = new Proxy(['initial'], { get(target, key, receiver) {
      return key === '0' ? 'dynamic' : Reflect.get(target, key, receiver);
    } });
    const config = { ...fixture(), CONFIG_ERRORS: errors };
    cached(config, {}); cached(config, {});
    expect(validate).toHaveBeenCalledTimes(4);
  });

  it('detects nonenumerable inherited primary aliases introduced after a warm cache', () => {
    const config = fixture(); delete config.API_HOST; config.VITE_API_HOST = 'https://broker.example';
    const validate = vi.fn(validateBrokerRuntimeConfig), cached = createBrokerRuntimeValidationCache(validate);
    expect(cached(config, {}).valid).toBe(true);
    const original = Object.getOwnPropertyDescriptor(Object.prototype, 'API_HOST');
    try {
      Object.defineProperty(Object.prototype, 'API_HOST', { value: '', configurable: true, enumerable: false });
      expect(cached(config, {}).valid).toBe(false);
      expect(cached(config, {}).valid).toBe(false);
      Object.defineProperty(Object.prototype, 'API_HOST', { value: 'https://broker.example', configurable: true, enumerable: false });
      expect(cached(config, {}).valid).toBe(true);
      expect(validate).toHaveBeenCalledTimes(4);
    } finally {
      if (original) Object.defineProperty(Object.prototype, 'API_HOST', original);
      else Reflect.deleteProperty(Object.prototype, 'API_HOST');
    }
    expect(cached(config, {}).valid).toBe(true);
  });

  it('includes context flags and URL constructor identity in validation inputs', () => {
    const config = { ...fixture(), CONFIG_SOURCE: 'runtime', BACKEND_TARGET: 'desktop',
      API_HOST: 'http://localhost:8090', WS_HOST: 'ws://localhost:8090' };
    const validate = vi.fn(validateBrokerRuntimeConfig), cached = createBrokerRuntimeValidationCache(validate);
    expect(cached(config, { allowLocal: false, desktop: false }).valid).toBe(false);
    expect(cached(config, { allowLocal: true, desktop: false }).valid).toBe(true);
    expect(cached(config, { allowLocal: true, desktop: true }).pinned).toBe(false);
    const NativeURL = URL;
    vi.stubGlobal('URL', class extends NativeURL {});
    expect(cached(config, { allowLocal: true, desktop: true }).valid).toBe(true);
    expect(validate).toHaveBeenCalledTimes(4);
  });

  it('distinguishes missing configuration from an empty own-property object', () => {
    const validate = vi.fn(validateBrokerRuntimeConfig), cached = createBrokerRuntimeValidationCache(validate);
    expect(cached(undefined, {}).errors).toContain('Runtime broker configuration is missing. Configure this deployment before using the terminal.');
    expect(cached({}, {}).errors).not.toContain('Runtime broker configuration is missing. Configure this deployment before using the terminal.');
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it('reselects replaced/mutated globals and conflicts before considering a cached result', () => {
    runtime.__RTX_RUNTIME_CONFIG__ = fixture();
    runtime.RUNTIME_CONFIG = runtime.__RTX_RUNTIME_CONFIG__;
    expect(getRuntimeBrokerConfiguration().valid).toBe(true);
    runtime.__RUNTIME_CONFIG__ = { ...fixture(), BROKER_ID: 'Other' };
    expect(getRuntimeBrokerConfiguration().errors).toContain('Conflicting deployment runtime configuration sources.');
    delete runtime.__RUNTIME_CONFIG__;
    expect(getRuntimeBrokerConfiguration().valid).toBe(true);
    runtime.__RTX_RUNTIME_CONFIG__.API_HOST = 'http://unsafe.example';
    expect(getRuntimeBrokerConfiguration().valid).toBe(false);
    runtime.__RTX_RUNTIME_CONFIG__ = fixture();
    delete runtime.RUNTIME_CONFIG;
    expect(getRuntimeBrokerConfiguration().valid).toBe(true);
  });
});

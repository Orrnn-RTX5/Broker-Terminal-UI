import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { selectBrokerRuntimeConfig, validateBrokerRuntimeConfig } from './brokerRuntimeConfig'
import { renderBrokerRuntimeValidator } from '../../viteWebRuntimeConfig'
import {
  getBackendTarget, getPublicWsTarget, getBrokerConfigurationError,
  getRuntimeConfiguredBrokerId, getRuntimeDiscoveryBaseUrl,
  isConfiguredBrokerEndpoint, resolveBrokerBackendUrl, resolveBrokerWsUrl,
} from './backendTarget.js'

const fixture = (api = 'https://service.achiever.orrnn.com') => ({
  CONFIG_SOURCE: 'deployment', PINNED_BROKER: true, BACKEND_TARGET: 'web',
  API_HOST: api, API_HOST_EXT: api, WS_HOST: api.replace(/^https:/, 'wss:'),
  BROKER_ID: 'Achiever', DEFAULT_MT5_SERVER: 'Achiever Trading Server',
  DISCOVERY_BASE_URL: 'https://directory.independent.example',
})
const runtimeWindow = window as Window & { __RTX_RUNTIME_CONFIG__?: Record<string, unknown>; __RUNTIME_CONFIG__?: Record<string, unknown>; RUNTIME_CONFIG?: Record<string, unknown> }
afterEach(() => {
  delete runtimeWindow.__RTX_RUNTIME_CONFIG__
  delete runtimeWindow.__RUNTIME_CONFIG__
  delete runtimeWindow.RUNTIME_CONFIG
  vi.unstubAllEnvs()
})

describe('broker-neutral complete runtime configuration', () => {
  it.each(['BROKER_LOGIN_HERO_URL', 'BROKER_LOGIN_HERO_MOBILE_URL', 'BROKER_TERMS_URL'])('validates public presentation setting %s and its VITE_ alias', key => {
    expect(validateBrokerRuntimeConfig({ ...fixture(), [key]: 'https://cdn.unrelated.example/asset?version=2' }).valid).toBe(true)
    expect(validateBrokerRuntimeConfig({ ...fixture(), [`VITE_${key}`]: 'https://cdn.unrelated.example/asset' }).valid).toBe(true)
    for (const value of ['javascript:alert(1)', 'http://cdn.example/asset', 'https://user:secret@cdn.example/asset', 'not-a-url']) {
      expect(validateBrokerRuntimeConfig({ ...fixture(), [key]: value }).valid).toBe(false)
    }
    expect(validateBrokerRuntimeConfig({ ...fixture(), [key]: '', [`VITE_${key}`]: 'https://old-broker.example/asset' }).valid).toBe(true)
    expect(selectBrokerRuntimeConfig([{ ...fixture(), [key]: 'https://one.example/asset' }, { ...fixture(), [key]: 'https://two.example/asset' }])?.CONFIG_ERRORS).toContain('Conflicting deployment runtime configuration sources.')
  })
  it.each(['https://service.achiever.orrnn.com', 'https://api.independent-finance.example', 'https://previously-unknown.example:8443'])('accepts a configured secure broker without a domain naming restriction: %s', (api) => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = fixture(api)
    expect(getBackendTarget()).toBe(api)
    expect(getBrokerConfigurationError()).toBe('')
    expect(resolveBrokerWsUrl({}, '/ws/v2')).toBe(`${api.replace(/^https:/, 'wss:')}/ws/v2`)
    expect(resolveBrokerWsUrl({}, '/ws/feed')).toBe(`${api.replace(/^https:/, 'wss:')}/ws/feed`)
  })

  it('uses one explicit runtime source instead of mixing any compiled Orrnn fields', () => {
    vi.stubEnv('VITE_API_HOST', 'https://service.orrnn.com')
    vi.stubEnv('VITE_API_HOST_EXT', 'https://service.orrnn.com')
    vi.stubEnv('VITE_WS_HOST', 'wss://service.orrnn.com')
    vi.stubEnv('VITE_BROKER_ID', 'Orrnn')
    vi.stubEnv('VITE_DISCOVERY_BASE_URL', 'https://old-directory.example')
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = fixture()
    expect(getBackendTarget()).toBe('https://service.achiever.orrnn.com')
    expect(getPublicWsTarget()).toBe('wss://service.achiever.orrnn.com')
    expect(getRuntimeConfiguredBrokerId()).toBe('Achiever')
    expect(getRuntimeDiscoveryBaseUrl()).toBe('https://directory.independent.example')
    delete runtimeWindow.__RTX_RUNTIME_CONFIG__.DISCOVERY_BASE_URL
    expect(getRuntimeDiscoveryBaseUrl()).toBe('')
  })

  it('prefers a deployment global over a compiled legacy global without merging fields', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { ...fixture('https://service.orrnn.com'), CONFIG_SOURCE: 'build', BROKER_ID: 'Orrnn' }
    ;runtimeWindow.RUNTIME_CONFIG = fixture()
    expect(getBackendTarget()).toBe('https://service.achiever.orrnn.com')
    expect(getRuntimeConfiguredBrokerId()).toBe('Achiever')
    expect(selectBrokerRuntimeConfig([runtimeWindow.__RTX_RUNTIME_CONFIG__, runtimeWindow.RUNTIME_CONFIG])).toBe(runtimeWindow.RUNTIME_CONFIG)
    ;runtimeWindow.RUNTIME_CONFIG = { ...fixture(), API_HOST: '' }
    expect(getBackendTarget()).toBe('')
    expect(getBrokerConfigurationError()).toContain('API_HOST')
  })

  it('prefers an unmarked explicit runtime global over a compiled global', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { ...fixture('https://service.orrnn.com'), CONFIG_SOURCE: 'build' }
    const explicit = { ...fixture(), CONFIG_SOURCE: undefined }
    runtimeWindow.__RUNTIME_CONFIG__ = explicit
    expect(getBackendTarget()).toBe('https://service.achiever.orrnn.com')
  })

  it.each([
    { BROKER_ID: 'achiever' },
    { API_HOST: undefined, API_URL: undefined, FIX_API_URL: 'https://service.orrnn.com' },
    { WS_HOST: undefined, MARKET_WS_URL: 'wss://service.orrnn.com' },
    { API_HOST_EXT: 'https://other-api.example' },
    { BROKER_ALLOWED_ORIGINS: 'https://other-api.example' },
    { DISCOVERY_BASE_URL: 'https://other-directory.example' },
    { FEED_BROKER_ID: 'other-broker' },
    { DEFAULT_MT5_SERVER: 'other-server' },
    { PUBLIC_MARKET_API: 'mt5-bridge-v1' },
  ])('blocks conflicting deployment globals including secondary routing and aliases: %j', changed => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = fixture()
    ;runtimeWindow.RUNTIME_CONFIG = { ...fixture(), ...changed }
    expect(getBrokerConfigurationError()).toContain('Conflicting deployment runtime configuration sources')
    expect(getBackendTarget()).toBe('')
    expect(getPublicWsTarget()).toBe('')
    expect(isConfiguredBrokerEndpoint('https://service.orrnn.com/api/v2/auth/login')).toBe(false)
  })

  it('accepts equivalent complete deployment aliases and normalized socket origins', () => {
    const primary = fixture()
    const equivalent = { ...primary, API_HOST: undefined, FIX_API_URL: primary.API_HOST, WS_HOST: undefined, MARKET_WS_URL: `${primary.WS_HOST}/ws/v2` }
    expect(validateBrokerRuntimeConfig(selectBrokerRuntimeConfig([primary, equivalent])).valid).toBe(true)
  })

  it.each(['API_HOST', 'WS_HOST', 'BROKER_ID', 'DEFAULT_MT5_SERVER'])('does not fill missing runtime %s from compiled values or stale discovery', (missing) => {
    vi.stubEnv('VITE_API_HOST', 'https://service.orrnn.com')
    vi.stubEnv('VITE_WS_HOST', 'wss://service.orrnn.com')
    vi.stubEnv('VITE_BROKER_ID', 'Orrnn')
    vi.stubEnv('VITE_DEFAULT_MT5_SERVER', 'Orrnn')
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { ...fixture(), [missing]: '' }
    expect(getBackendTarget()).toBe('')
    expect(getPublicWsTarget()).toBe('')
    expect(resolveBrokerBackendUrl({ server_url: 'https://service.orrnn.com' })).toBe('')
    expect(resolveBrokerWsUrl({ ws_url: 'wss://service.orrnn.com/ws/v2' })).toBe('')
    expect(isConfiguredBrokerEndpoint('https://service.orrnn.com/api/v2/auth/login')).toBe(false)
    expect(getBrokerConfigurationError()).toContain(missing)
  })

  it('requires runtime configuration in production even if a broker is compiled into the bundle', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_API_HOST', 'https://service.orrnn.com')
    expect(getBackendTarget()).toBe('')
    expect(getBrokerConfigurationError()).toContain('Runtime broker configuration is missing')
    expect(isConfiguredBrokerEndpoint('https://service.orrnn.com/api/v2/auth/login')).toBe(false)
  })

  it.each(['broker.example', 'http://broker.example', 'https://user:password@broker.example', 'https://broker.example?token=secret', 'https://broker.example/api/v2', 'ftp://broker.example', 'https://127.0.0.1', 'not a url'])('rejects malformed or unsafe production API origin %s', (API_HOST) => {
    const config = validateBrokerRuntimeConfig({ ...fixture(), API_HOST })
    expect(config.valid).toBe(false)
    expect(config.errors.join(' ')).toContain('API_HOST')
  })

  it('rejects stale or inconsistent API/socket authorities and contradictory catalogs', () => {
    for (const changed of [
      { WS_HOST: 'wss://service.orrnn.com' },
      { API_HOST_EXT: 'https://service.orrnn.com' },
      { BROKER_DISCOVERY_URL: 'https://old-directory.example' },
    ]) {
      runtimeWindow.__RTX_RUNTIME_CONFIG__ = { ...fixture(), ...changed }
      expect(getBackendTarget()).toBe('')
      expect(getPublicWsTarget()).toBe('')
      expect(getRuntimeDiscoveryBaseUrl()).toBe('')
    }
  })

  it('allows explicitly configured separate service origins without extending a broker hostname list', () => {
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = {
      ...fixture(), WS_HOST: 'wss://quotes.other-domain.example/ws/v2',
      API_HOST_EXT: 'https://market.third-domain.example',
      BROKER_ALLOWED_ORIGINS: 'https://quotes.other-domain.example,https://market.third-domain.example',
    }
    expect(getBrokerConfigurationError()).toBe('')
    expect(resolveBrokerWsUrl({}, '/ws/feed')).toBe('wss://quotes.other-domain.example/ws/feed')
    expect(isConfiguredBrokerEndpoint('https://market.third-domain.example/api/v2/candles/EURUSD')).toBe(true)
    expect(isConfiguredBrokerEndpoint('https://directory.independent.example/api/v2/auth/login')).toBe(false)
    expect(isConfiguredBrokerEndpoint('https://service.orrnn.com/api/v2/auth/login')).toBe(false)
  })

  it('runs the exact self-contained validator before HTML requests without app modules', () => {
    const context = { window: {} as { __RTX_SELECT_BROKER_CONFIG__: typeof selectBrokerRuntimeConfig; __RTX_VALIDATE_BROKER_CONFIG__: typeof validateBrokerRuntimeConfig }, URL }
    runInNewContext(renderBrokerRuntimeValidator(), context)
    expect(context.window.__RTX_SELECT_BROKER_CONFIG__([{ ...fixture('https://service.orrnn.com'), CONFIG_SOURCE: 'build' }, fixture()])?.API_HOST).toBe('https://service.achiever.orrnn.com')
    expect(context.window.__RTX_VALIDATE_BROKER_CONFIG__(fixture()).valid).toBe(true)
    expect(context.window.__RTX_VALIDATE_BROKER_CONFIG__({ API_HOST: 'https://service.orrnn.com' }).valid).toBe(false)
  })

  it('limits cleartext exceptions to explicit local development', () => {
    const local = fixture('http://localhost:8090')
    local.WS_HOST = 'ws://localhost:8090'
    expect(validateBrokerRuntimeConfig(local).valid).toBe(false)
    expect(validateBrokerRuntimeConfig(local, { allowLocal: true }).valid).toBe(true)
    expect(validateBrokerRuntimeConfig({ ...local, API_HOST: 'http://public-broker.example' }, { allowLocal: true }).valid).toBe(false)
  })

  it('does not revive a compiled desktop broker for an explicit incomplete desktop configuration', () => {
    vi.stubEnv('VITE_API_URL', 'https://service.orrnn.com')
    Reflect.set(window, 'electronAPI', {})
    runtimeWindow.__RTX_RUNTIME_CONFIG__ = { BACKEND_TARGET: 'desktop' }
    expect(getBackendTarget()).toBe('')
    expect(resolveBrokerBackendUrl({ broker_id: 'selected', server_url: 'http://127.0.0.1:8090' })).toBe('http://127.0.0.1:8090')
    Reflect.deleteProperty(window, 'electronAPI')
  })
})

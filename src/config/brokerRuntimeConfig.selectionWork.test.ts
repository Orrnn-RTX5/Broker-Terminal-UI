import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderBrokerRuntimeValidator } from '../../viteWebRuntimeConfig'
import { selectBrokerRuntimeConfig, validateBrokerRuntimeConfig } from './brokerRuntimeConfig'

const fixture = () => ({
  CONFIG_SOURCE: 'deployment', BACKEND_TARGET: 'web',
  API_HOST: 'https://api.broker.example', API_HOST_EXT: 'https://api.broker.example',
  WS_HOST: 'wss://api.broker.example', BROKER_ID: 'Example',
  DEFAULT_MT5_SERVER: 'Example Demo', DISCOVERY_BASE_URL: 'https://directory.example',
})

afterEach(() => vi.unstubAllGlobals())

function countOriginParsing() {
  const NativeURL = URL
  let count = 0
  vi.stubGlobal('URL', class extends NativeURL {
    constructor(input: string | URL, base?: string | URL) {
      count += 1
      super(input, base)
    }
  })
  return () => count
}

describe('runtime source selection work', () => {
  it('does not fingerprint a deployment against itself through repeated aliases', () => {
    const shared = fixture()
    const count = countOriginParsing()
    for (let index = 0; index < 100; index += 1) {
      expect(selectBrokerRuntimeConfig([shared, shared, shared])).toBe(shared)
    }
    expect(count()).toBe(0)
  })

  it('fingerprints each distinct deployment only once in a selection', () => {
    const primary = fixture()
    const equivalent = { ...primary, WS_HOST: primary.WS_HOST + '/ws/feed' }
    const count = countOriginParsing()
    expect(selectBrokerRuntimeConfig([primary, equivalent, primary, equivalent])).toBe(primary)
    // Five origin conversions per identity; repeating the same object adds none.
    expect(count()).toBe(10)
  })

  it('detects in-place changes on each call without caching across selections', () => {
    const primary = fixture()
    const other = fixture()
    expect(selectBrokerRuntimeConfig([primary, other])).toBe(primary)
    other.BROKER_ID = 'Changed'
    expect(selectBrokerRuntimeConfig([primary, other])?.CONFIG_ERRORS)
      .toContain('Conflicting deployment runtime configuration sources.')
    other.BROKER_ID = primary.BROKER_ID
    expect(selectBrokerRuntimeConfig([primary, other])).toBe(primary)
    primary.API_HOST = 'http://invalid.example'
    expect(validateBrokerRuntimeConfig(selectBrokerRuntimeConfig([primary, primary])).valid).toBe(false)
  })

  it('retains conflict errors and precedence when aliases coexist with another deployment', () => {
    const primary = { ...fixture(), CONFIG_ERRORS: ['existing error'] }
    const other = { ...fixture(), FEED_BROKER_ID: 'Different' }
    const compiled = { ...fixture(), CONFIG_SOURCE: 'build', BROKER_ID: 'Compiled' }
    const result = selectBrokerRuntimeConfig([compiled, primary, primary, other])
    expect(result?.BROKER_ID).toBe(primary.BROKER_ID)
    expect(result?.CONFIG_ERRORS).toEqual(['existing error', 'Conflicting deployment runtime configuration sources.'])
    expect(primary.CONFIG_ERRORS).toEqual(['existing error'])
    expect(selectBrokerRuntimeConfig([undefined, null, [], compiled])).toBe(compiled)
    expect(selectBrokerRuntimeConfig([])).toBeUndefined()
  })

  it('keeps the inline pre-request selector self-contained and mutation-sensitive', () => {
    const inline = { window: {} as { __RTX_SELECT_BROKER_CONFIG__: typeof selectBrokerRuntimeConfig }, URL }
    runInNewContext(renderBrokerRuntimeValidator(), inline)
    const primary = fixture()
    const other = fixture()
    const select = inline.window.__RTX_SELECT_BROKER_CONFIG__
    expect(select([primary, primary])).toBe(primary)
    expect(select([primary, other])).toBe(primary)
    other.WS_HOST = 'wss://other.example'
    expect(select([primary, primary, other])?.CONFIG_ERRORS)
      .toContain('Conflicting deployment runtime configuration sources.')
  })
})

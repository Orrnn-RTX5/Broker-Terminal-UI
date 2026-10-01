import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import type { ViteDevServer } from 'vite'
import type { PluginContext } from 'rollup'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  createWebRuntimeConfig,
  renderWebRuntimeConfig,
  webRuntimeConfigPlugin,
} from '../../viteWebRuntimeConfig'

const testEnvironment = {
  VITE_BACKEND_TARGET: 'web',
  VITE_API_URL: 'https://fxtrustbrokerbackend.orrnn.com',
  VITE_WS_URL: 'wss://fxtrustbrokerbackend.orrnn.com/ws/v2',
  VITE_BROKER_DISCOVERY_URL: 'https://fxtrustsuperbackned.orrnn.com',
  VITE_BROKER_ID: 'TEST',
  VITE_DEFAULT_MT5_SERVER: 'TEST',
}

const achieverEnvironment = {
  VITE_BACKEND_TARGET: 'web',
  VITE_BACKEND_URL: 'https://service.achieverfinancials.com',
  VITE_BROKER_DISCOVERY_URL: 'https://superbackend.orrnn.com',
  VITE_BROKER_ID: 'achiever-financials',
  VITE_DEFAULT_MT5_SERVER: 'Achiever Financials',
}

const orrnnEnvironment = {
  VITE_BACKEND_TARGET: 'web',
  VITE_API_HOST: 'https://service.orrnn.com',
  VITE_API_HOST_EXT: 'https://service.orrnn.com',
  VITE_WS_HOST: 'wss://service.orrnn.com',
  VITE_DISCOVERY_BASE_URL: 'https://superadmin-prod.orrnn.com',
  VITE_BROKER_DISCOVERY_URL: 'https://superadmin-prod.orrnn.com',
  VITE_DEFAULT_MT5_SERVER: 'Orrnn',
  VITE_BROKER_ID: 'Orrnn',
  VITE_FEED_BROKER_ID: 'Orrnn',
}

const executeConfig = (source: string, overrides: Record<string, unknown> = {}, userAgent = 'Browser') => {
  const context = {
    window: { location: { protocol: 'http:' }, ...overrides } as Record<string, unknown>,
    navigator: { userAgent },
  }
  runInNewContext(source, context)
  return context.window
}

describe('environment-based web runtime configuration', () => {
  it('gives every unprefixed deployment alias precedence over VITE aliases, including empty values', () => {
    const config = createWebRuntimeConfig({
      ...orrnnEnvironment,
      API_URL: 'https://service.achiever.orrnn.com',
      WS_URL: 'wss://service.achiever.orrnn.com/ws/v2',
      BROKER_ID: 'achiever', DEFAULT_MT5_SERVER: 'Achiever Trading Server',
      DISCOVERY_BASE_URL: '', BROKER_DISCOVERY_URL: '',
    })
    expect(config).toMatchObject({ API_HOST: 'https://service.achiever.orrnn.com', WS_HOST: 'wss://service.achiever.orrnn.com', BROKER_ID: 'achiever', DISCOVERY_BASE_URL: '', BROKER_DISCOVERY_URL: '' })
    // A separately supplied EXT address is contradictory until explicitly replaced.
    expect(config.CONFIG_ERRORS.join(' ')).toContain('API_HOST_EXT')
    expect(createWebRuntimeConfig({ ...orrnnEnvironment, API_HOST: '' }).API_HOST).toBe('')
  })
  it('leaves broker endpoints and identity empty when no configuration is supplied', () => {
    expect(createWebRuntimeConfig({})).toMatchObject({
      API_HOST: '', API_HOST_EXT: '', WS_HOST: '',
      BROKER_ID: '', FEED_BROKER_ID: '', DEFAULT_MT5_SERVER: '',
      DISCOVERY_BASE_URL: '', BROKER_DISCOVERY_URL: '',
    })
  })
  it('maps the complete Orrnn VITE profile to browser runtime fields', () => {
    expect(createWebRuntimeConfig(orrnnEnvironment)).toMatchObject({
      BACKEND_TARGET: 'web',
      API_HOST: 'https://service.orrnn.com',
      API_HOST_EXT: 'https://service.orrnn.com',
      WS_HOST: 'wss://service.orrnn.com',
      DEFAULT_MT5_SERVER: 'Orrnn',
      DISCOVERY_BASE_URL: 'https://superadmin-prod.orrnn.com',
      BROKER_DISCOVERY_URL: 'https://superadmin-prod.orrnn.com',
      BROKER_ID: 'Orrnn',
      VITE_BROKER_ID: 'Orrnn',
      FEED_BROKER_ID: 'Orrnn',
      USE_MOCK_DISCOVERY: false,
    })
  })

  it('retains the explicitly selected same-origin local desktop gateway configuration', () => {
    const runtime = executeConfig(renderWebRuntimeConfig(createWebRuntimeConfig({
      ...achieverEnvironment,
      VITE_BACKEND_TARGET: 'desktop',
    })), {
      location: { protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:5175' },
    })
    expect(runtime.RUNTIME_CONFIG).toEqual(expect.objectContaining({
      BACKEND_TARGET: 'desktop', BROKER_ID: 'achiever-financials',
      API_HOST: 'http://localhost:5175', API_HOST_EXT: 'http://localhost:5175',
      WS_HOST: 'ws://localhost:5175',
    }))
  })

  it('keeps the selected web broker active on localhost', () => {
    const runtime = executeConfig(renderWebRuntimeConfig(createWebRuntimeConfig(achieverEnvironment)), {
      location: { protocol: 'http:', hostname: '127.0.0.1', origin: 'http://127.0.0.1:5173' },
    })
    expect(runtime.RUNTIME_CONFIG).toEqual(expect.objectContaining({
      BACKEND_TARGET: 'web',
      BROKER_ID: 'achiever-financials',
      API_HOST: 'https://service.achieverfinancials.com',
      WS_HOST: 'wss://service.achieverfinancials.com',
    }))
  })

  it.each([
    [testEnvironment, 'TEST', 'https://fxtrustbrokerbackend.orrnn.com'],
    [achieverEnvironment, 'achiever-financials', 'https://service.achieverfinancials.com'],
    [orrnnEnvironment, 'Orrnn', 'https://service.orrnn.com'],
  ])('publishes the selected broker to every supported runtime global', (env, brokerId, apiHost) => {
    const config = createWebRuntimeConfig(env)
    const runtime = executeConfig(renderWebRuntimeConfig(config))

    expect(runtime.RUNTIME_CONFIG).toEqual(expect.objectContaining({ BROKER_ID: brokerId, API_HOST: apiHost }))
    expect(runtime.__RTX_RUNTIME_CONFIG__).toBe(runtime.RUNTIME_CONFIG)
    expect(runtime.__RUNTIME_CONFIG__).toBe(runtime.RUNTIME_CONFIG)
    expect(config.VITE_BROKER_ID).toBe(brokerId)
    expect(config.FEED_BROKER_ID).toBe(brokerId)
  })

  it('can keep the configured desktop broker on localhost instead of the nginx TEST preview', () => {
    const config = createWebRuntimeConfig({
      VITE_BACKEND_TARGET: 'desktop',
      VITE_API_HOST: 'https://trivanta.orrnn.com',
      VITE_BROKER_ID: 'trivanta-markets',
    })
    const location = { protocol: 'http:', hostname: '127.0.0.1', origin: 'http://127.0.0.1:5173' }
    expect(executeConfig(renderWebRuntimeConfig(config, false), { location }).RUNTIME_CONFIG)
      .toEqual(expect.objectContaining({ API_HOST: 'https://trivanta.orrnn.com', BROKER_ID: 'trivanta-markets', BACKEND_TARGET: 'desktop' }))
    expect(executeConfig(renderWebRuntimeConfig(config), { location }).RUNTIME_CONFIG)
      .toEqual(expect.objectContaining({ API_HOST: location.origin, BROKER_ID: 'trivanta-markets' }))
  })

  it('derives all broker endpoints without retaining the prior broker', () => {
    createWebRuntimeConfig(testEnvironment)
    const config = createWebRuntimeConfig(achieverEnvironment)

    expect(config).toMatchObject({
      API_HOST: 'https://service.achieverfinancials.com',
      API_HOST_EXT: 'https://service.achieverfinancials.com',
      WS_HOST: 'wss://service.achieverfinancials.com',
      DEFAULT_MT5_SERVER: 'Achiever Financials',
      DISCOVERY_BASE_URL: 'https://superbackend.orrnn.com',
      FEED_BROKER_ID: 'achiever-financials',
      USE_MOCK_DISCOVERY: false,
    })
    expect(JSON.stringify(config)).not.toContain('TEST')
  })

  it('respects explicit external API, feed identity, websocket, and mock settings', () => {
    const config = createWebRuntimeConfig({
      ...achieverEnvironment,
      VITE_API_HOST_EXT: ' https://external.example.com/ ',
      VITE_WS_HOST: 'wss://feed.example.com/',
      VITE_FEED_BROKER_ID: 'backend-feed-id',
      VITE_USE_MOCK_DISCOVERY: ' TRUE ',
    })
    expect(config).toMatchObject({
      API_HOST_EXT: 'https://external.example.com',
      WS_HOST: 'wss://feed.example.com',
      BROKER_ID: 'achiever-financials',
      FEED_BROKER_ID: 'backend-feed-id',
      USE_MOCK_DISCOVERY: true,
    })
  })

  it('does not export server secrets or arbitrary VITE environment values', () => {
    const source = renderWebRuntimeConfig(createWebRuntimeConfig({
      ...achieverEnvironment,
      DATABASE_PASSWORD: 'database-secret',
      FEED_BROKER_TOKEN: 'server-only-secret',
      VITE_FEED_BROKER_TOKEN: 'retired-feed-secret',
      VITE_UNRELATED_SECRET: 'unrelated-secret',
      PATH: 'private-machine-path',
    }))
    for (const value of ['database-secret', 'server-only-secret', 'retired-feed-secret', 'unrelated-secret', 'private-machine-path']) {
      expect(source).not.toContain(value)
    }
    expect(source).not.toContain('FEED_BROKER_TOKEN')
  })

  it('escapes source text while preserving the exact configured value', () => {
    const server = 'Broker "A" \\ </script>\n\u2028\u2029'
    const source = renderWebRuntimeConfig(createWebRuntimeConfig({
      ...achieverEnvironment,
      VITE_DEFAULT_MT5_SERVER: server,
    }))
    expect(source).not.toContain('</script>')
    expect(source).not.toContain('\u2028')
    expect(source).not.toContain('\u2029')
    expect(executeConfig(source).RUNTIME_CONFIG).toEqual(expect.objectContaining({ DEFAULT_MT5_SERVER: server.trim() }))
  })

  it.each([
    [{ electron: { window: {} } }, 'Browser'],
    [{ electronAPI: {} }, 'Browser'],
    [{ location: { protocol: 'file:' } }, 'Browser'],
    [{}, 'Mozilla/5.0 Electron/40.0.0'],
  ])('preserves the existing Electron broker selection', (overrides, userAgent) => {
    const desktopConfig = { BROKER_ID: 'desktop-selected-broker' }
    const runtime = executeConfig(renderWebRuntimeConfig(createWebRuntimeConfig(achieverEnvironment)), {
      ...overrides,
      __RTX_RUNTIME_CONFIG__: desktopConfig,
      RUNTIME_CONFIG: desktopConfig,
      __RUNTIME_CONFIG__: desktopConfig,
    }, userAgent)
    expect(runtime.RUNTIME_CONFIG).toBe(desktopConfig)
    expect(runtime.__RTX_RUNTIME_CONFIG__).toBe(desktopConfig)
    expect(runtime.__RUNTIME_CONFIG__).toBe(desktopConfig)
  })

  it('serves uncached generated JavaScript before the public development file', () => {
    const plugin = webRuntimeConfigPlugin(achieverEnvironment)
    const use = vi.fn()
    const server = { middlewares: { use } } as unknown as ViteDevServer
    if (typeof plugin.configureServer !== 'function') throw new Error('Missing development hook')
    plugin.configureServer.call({} as never, server)
    const middleware = use.mock.calls[0][0]
    const res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 }
    const next = vi.fn()
    middleware({ url: '/runtime-config.js?t=123', method: 'GET' } as IncomingMessage, res as unknown as ServerResponse, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, max-age=0')
    expect(executeConfig(res.end.mock.calls[0][0]).RUNTIME_CONFIG).toEqual(expect.objectContaining({ BROKER_ID: 'achiever-financials' }))

    middleware({ url: '/api/login', method: 'GET' } as IncomingMessage, res as unknown as ServerResponse, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('emits the selected build configuration without replacing it during preview', () => {
    const plugin = webRuntimeConfigPlugin(achieverEnvironment)
    const emitFile = vi.fn()
    if (typeof plugin.generateBundle !== 'function') throw new Error('Missing build hook')
    plugin.generateBundle.call({ emitFile } as unknown as PluginContext, {} as never, {}, true)

    expect(emitFile).toHaveBeenCalledWith(expect.objectContaining({ type: 'asset', fileName: 'runtime-config.js' }))
    expect(executeConfig(emitFile.mock.calls.find(([asset]) => asset.fileName === 'runtime-config.js')![0].source).RUNTIME_CONFIG).toEqual(expect.objectContaining({ BROKER_ID: 'achiever-financials' }))
    expect(plugin.configurePreviewServer).toBeUndefined()
  })
})

// @vitest-environment node
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, loadEnv, type ViteDevServer } from 'vite'
import { validateWebBrokerEnvironment } from '../../viteWebEnv'
import { webRuntimeConfigPlugin } from '../../viteWebRuntimeConfig'

const repositoryRoot = process.cwd()
const temporaryRoot = realpathSync(tmpdir())
const fixturePrefix = 'rtx-web-broker-integration-'
const directories: string[] = []
const servers: ViteDevServer[] = []

type BrokerFixture = {
  block: string
  brokerId: string
  api: string
  ws: string
  discovery: string
  serverName: string
}

/** A credential-free, committed test contract independent of local ignored env files. */
const renderBrokerEnvironment = (selected: BrokerFixture): string => [
  'BACKEND_TARGET=web',
  'VITE_BACKEND_TARGET=web',
  `VITE_BACKEND_URL=${selected.api}`,
  `VITE_API_HOST=${selected.api}`,
  `VITE_API_HOST_EXT=${selected.api}`,
  `VITE_WS_HOST=${selected.ws}`,
  `VITE_DISCOVERY_BASE_URL=${selected.discovery}`,
  `VITE_BROKER_DISCOVERY_URL=${selected.discovery}`,
  `VITE_DEFAULT_MT5_SERVER=${selected.serverName}`,
  `VITE_BROKER_ID=${selected.brokerId}`,
  `VITE_FEED_BROKER_ID=${selected.brokerId}`,
  'VITE_USE_MOCK_DISCOVERY=false',
].join('\n')

beforeEach(() => {
  // Exercise the chosen file, independently of the developer's shell overrides.
  for (const key of Object.keys(process.env)) {
    if (/^VITE_|^BACKEND_(?:TARGET|MODE)$/.test(key)) vi.stubEnv(key, undefined)
  }
})

afterEach(async () => {
  const closed = await Promise.allSettled(servers.splice(0).map((server) => server.close()))
  for (const directory of directories.splice(0)) {
    const absolute = realpathSync(directory)
    if (
      dirname(absolute) !== temporaryRoot
      || !basename(absolute).startsWith(fixturePrefix)
      || absolute !== resolve(directory)
    ) throw new Error('Refusing to remove an unexpected integration fixture directory')
    rmSync(absolute, { recursive: true, force: true })
  }
  vi.unstubAllEnvs()
  const failure = closed.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
})

describe('web broker environment over Vite HTTP', () => {
  it.each([
    {
      block: 'Orrnn' as const,
      brokerId: 'Orrnn',
      api: 'https://service.orrnn.com',
      ws: 'wss://service.orrnn.com',
      discovery: 'https://superadmin-prod.orrnn.com',
      serverName: 'Orrnn',
    },
    {
      block: 'TEST' as const,
      brokerId: 'TEST',
      api: 'https://fxtrustbrokerbackend.orrnn.com',
      ws: 'wss://fxtrustbrokerbackend.orrnn.com',
      discovery: 'https://fxtrustsuperbackned.orrnn.com',
      serverName: 'TEST',
    },
    {
      block: 'Achiever Financials' as const,
      brokerId: 'achiever-financials',
      api: 'https://service.achieverfinancials.com',
      ws: 'wss://service.achieverfinancials.com',
      discovery: 'https://superbackend.orrnn.com',
      serverName: 'Achiever Financials',
    },
  ])('serves $block when only its broker block is uncommented', async (selected) => {
    const directory = mkdtempSync(join(temporaryRoot, fixturePrefix))
    directories.push(directory)
    writeFileSync(join(directory, '.env.web'), renderBrokerEnvironment(selected), 'utf8')

    const env = loadEnv('web', directory, '')
    validateWebBrokerEnvironment(env, directory)
    const server = await createServer({
      configFile: false,
      mode: 'web',
      envDir: directory,
      root: repositoryRoot,
      publicDir: resolve(repositoryRoot, 'public'),
      cacheDir: join(directory, '.vite'),
      plugins: [webRuntimeConfigPlugin(env)],
      server: { port: 0, host: '127.0.0.1', open: false, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
      logLevel: 'silent',
    })
    servers.push(server)
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('Missing local Vite listening address')

    const response = await fetch(`http://127.0.0.1:${address.port}/runtime-config.js`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/javascript')
    expect(response.headers.get('cache-control')).toContain('no-store')

    const context = {
      window: {
        location: {
          protocol: 'http:',
          hostname: '127.0.0.1',
          origin: `http://127.0.0.1:${address.port}`,
        },
      } as Record<string, unknown>,
      navigator: { userAgent: 'Integration browser' },
    }
    runInNewContext(await response.text(), context)
    expect(context.window.RUNTIME_CONFIG).toMatchObject({
      BACKEND_TARGET: 'web',
      API_HOST: selected.api,
      API_HOST_EXT: selected.api,
      WS_HOST: selected.ws,
      DISCOVERY_BASE_URL: selected.discovery,
      DEFAULT_MT5_SERVER: selected.serverName,
      BROKER_ID: selected.brokerId,
      VITE_BROKER_ID: selected.brokerId,
      FEED_BROKER_ID: selected.brokerId,
    })
    expect(context.window.RUNTIME_CONFIG).not.toHaveProperty('FEED_BROKER_TOKEN')
    expect(context.window.__RTX_RUNTIME_CONFIG__).toBe(context.window.RUNTIME_CONFIG)
    expect(context.window.__RUNTIME_CONFIG__).toBe(context.window.RUNTIME_CONFIG)
  }, 30_000)
})

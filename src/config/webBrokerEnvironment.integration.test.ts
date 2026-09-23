// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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

/** Reproduce editing the real broker blocks without copying their credentials. */
const selectBrokerBlock = (selected: 'TEST' | 'Achiever Financials'): string => {
  let block = 'shared'
  return readFileSync(resolve(repositoryRoot, '.env.web'), 'utf8')
    .split(/\r?\n/)
    .map((line) => {
      if (/^# TEST(?: \(active\))?\s*$/.test(line)) block = 'TEST'
      else if (/^# Achiever Financials\s*$/.test(line)) block = 'Achiever Financials'
      else if (/^# (?:MyProp|Grow Trading Academy|Legacy backend reference|Nexa|Active broker)/.test(line)) block = 'other'

      const assignment = /^\s*(?:#\s*)?(?:export\s+)?([A-Za-z_]\w*)\s*=(.*)$/.exec(line)
      if (!assignment) return line

      const [, key, originalValue] = assignment
      const value = /TOKEN|PASSWORD|SECRET|API_KEY|PRIVATE_KEY/i.test(key) ? '' : originalValue
      const enabled = block === selected || (block === 'shared' && !/^\s*#/.test(line))
      return `${enabled ? '' : '# '}${key}=${value}`
    })
    .join('\n')
}

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

// .env.web is untracked (local-only broker config), so clean CI checkouts skip this suite.
describe.skipIf(!existsSync(resolve(repositoryRoot, '.env.web')))('real .env.web broker selection over Vite HTTP', () => {
  it.each([
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
    writeFileSync(join(directory, '.env.web'), selectBrokerBlock(selected.block), 'utf8')

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
      window: { location: { protocol: 'http:' } } as Record<string, unknown>,
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
      FEED_BROKER_TOKEN: '',
    })
    expect(context.window.__RTX_RUNTIME_CONFIG__).toBe(context.window.RUNTIME_CONFIG)
    expect(context.window.__RUNTIME_CONFIG__).toBe(context.window.RUNTIME_CONFIG)
  }, 30_000)
})

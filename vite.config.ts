import type { Plugin, ProxyOptions } from 'vite'
import { defineConfig, loadEnv } from 'vite'
import { validateWebBrokerEnvironment } from './viteWebEnv'
import { webRuntimeConfigPlugin } from './viteWebRuntimeConfig'
import { terminalPreloadPlugin } from './viteTerminalPreload'
import react from '@vitejs/plugin-react'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import * as http from 'node:http'
import * as https from 'node:https'
import * as net from 'node:net'
import { isIP, type Socket } from 'node:net'
import * as tls from 'node:tls'
import { resolve } from 'node:path'
import {
  createPinnedConnectionOptions,
  normalizeProxyAccessOrigin,
  resolveProxyAddresses,
  type ResolvedProxyAddress,
} from './viteBrokerProxyAddress'

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

type ViteProxyServer = Parameters<NonNullable<ProxyOptions['configure']>>[0]

const EXPECTED_WS_PROXY_ABORT_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'EPIPE',
  'ERR_STREAM_DESTROYED',
])

const getErrorCode = (error: unknown): string => {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : ''
}

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error)
}

const isExpectedWsProxyAbort = (error: unknown): boolean => {
  return EXPECTED_WS_PROXY_ABORT_CODES.has(getErrorCode(error))
}

const endSocketQuietly = (socket: Socket): void => {
  if (!socket.destroyed) {
    socket.end()
  }
}

const replaceSocketErrorLogger = (label: string, socket: Socket): void => {
  queueMicrotask(() => {
    socket.removeAllListeners('error')
    socket.on('error', (error) => {
      if (isExpectedWsProxyAbort(error)) return
      console.warn(`[vite] ${label} proxy socket error: ${getErrorMessage(error)}`)
    })
  })
}

const configureWsProxy = (
  label: string,
  options: { stripOrigin?: boolean } = {}
): NonNullable<ProxyOptions['configure']> => {
  return (proxy: ViteProxyServer) => {
    queueMicrotask(() => {
      proxy.removeAllListeners('error')
      proxy.on('error', (error, req, res) => {
        if (isExpectedWsProxyAbort(error)) {
          if (!('req' in res)) endSocketQuietly(res)
          return
        }

        const requestUrl = req.url ? ` ${req.url}` : ''
        console.warn(`[vite] ${label} proxy error${requestUrl}: ${getErrorMessage(error)}`)
        if ('req' in res) {
          if (!res.headersSent && !res.writableEnded) {
            res.writeHead(500, { 'Content-Type': 'text/plain' }).end()
          }
          return
        }

        endSocketQuietly(res)
      })
    })

    proxy.on('proxyReqWs', (proxyReq, _req, socket) => {
      if (options.stripOrigin) {
        proxyReq.removeHeader('origin')
      }
      replaceSocketErrorLogger(label, socket)
    })
  }
}

const copyProxyHeaders = (headers: IncomingHttpHeaders): IncomingHttpHeaders => {
  const nextHeaders: IncomingHttpHeaders = {}
  for (const [key, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase()) && key.toLowerCase() !== 'host') {
      nextHeaders[key] = value
    }
  }
  return nextHeaders
}

const addOrigin = (origins: Set<string>, value: string): void => {
  const origin = normalizeProxyAccessOrigin(value)
  if (origin) origins.add(origin)
}

const toHttpOnlyBrokerOrigin = (value: string): string | null => {
  const trimmed = String(value || '').trim().replace(/\/+$/, '')
  if (!trimmed) return null

  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (parsed.protocol === 'https:') parsed.protocol = 'http:'
    if (parsed.protocol === 'http:' && parsed.port === '443') parsed.port = ''
    return parsed.origin
  } catch {
    return null
  }
}

const addBrokerOrigin = (origins: Set<string>, value: string): void => {
  addOrigin(origins, value)
  const httpOnlyOrigin = toHttpOnlyBrokerOrigin(value)
  if (httpOnlyOrigin) origins.add(httpOnlyOrigin)
}

const splitAllowlist = (value: string | undefined): string[] => {
  return String(value || '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

const parseDynamicProxyTarget = (requestUrl: string, prefix: string): URL | null => {
  if (!requestUrl.startsWith(`${prefix}/`)) return null

  const pathAfterPrefix = requestUrl.slice(prefix.length + 1)
  const slashIndex = pathAfterPrefix.indexOf('/')
  const encodedOrigin = slashIndex >= 0 ? pathAfterPrefix.slice(0, slashIndex) : pathAfterPrefix
  const targetPath = slashIndex >= 0 ? pathAfterPrefix.slice(slashIndex) : '/'
  if (!encodedOrigin) return null

  try {
    const origin = new URL(decodeURIComponent(encodedOrigin))
    if (origin.protocol !== 'http:' && origin.protocol !== 'https:') return null
    const queryIndex = targetPath.indexOf('?')
    const pathname = queryIndex >= 0 ? targetPath.slice(0, queryIndex) : targetPath
    const search = queryIndex >= 0 ? targetPath.slice(queryIndex) : ''
    const target = new URL(origin.origin)
    target.pathname = pathname || '/'
    target.search = search
    return target
  } catch {
    return null
  }
}

type BrokerProxyAccess = {
  trustedOrigins: Set<string>
  envAllowedOrigins: Set<string>
  discoveredBrokerOrigins: Set<string>
}

const createBrokerProxyAccess = (env: Record<string, string>): BrokerProxyAccess => {
  const trustedOrigins = new Set<string>()
  const envAllowedOrigins = new Set<string>()

    ;[
      'https://backend.orrnn.com',
      'https://superbackend.orrnn.com',
      'https://testsuperbackend.orrnn.com',
      'https://testbrokerbackend.orrnn.com',
      'https://fxtrustsuperbackned.orrnn.com',
      'https://fxtrustbrokerbackend.orrnn.com',
      'https://services.growtradingacademy.com',
      env.VITE_API_URL,
      env.VITE_BACKEND_URL,
      env.VITE_BROKER_DISCOVERY_URL,
      env.VITE_DEV_BROKER_API_URL,
      env.VITE_RTX5_API_URL,
      env.VITE_API_V2_URL,
      env.VITE_FIX_API_URL,
    ].forEach((value) => addOrigin(trustedOrigins, value || ''))

  splitAllowlist(env.VITE_DEV_PROXY_ALLOWED_ORIGINS).forEach((value) => addOrigin(envAllowedOrigins, value))
  splitAllowlist(env.VITE_DEV_BROKER_PROXY_ALLOWED_ORIGINS).forEach((value) => addOrigin(envAllowedOrigins, value))

  return {
    trustedOrigins,
    envAllowedOrigins,
    discoveredBrokerOrigins: new Set<string>(),
  }
}

const validateProxyTarget = async (
  target: URL,
  access: BrokerProxyAccess
): Promise<{ allowed: true; resolvedAddresses: ResolvedProxyAddress[] } | { allowed: false; reason: string }> => {
  const comparableOrigin = normalizeProxyAccessOrigin(target.origin)
  if (!comparableOrigin) {
    return { allowed: false, reason: 'Broker proxy target uses an unsupported protocol' }
  }

  const explicitlyAllowed = access.envAllowedOrigins.has(comparableOrigin)
  const knownOrigin = explicitlyAllowed
    || access.trustedOrigins.has(comparableOrigin)
    || access.discoveredBrokerOrigins.has(comparableOrigin)

  if (!knownOrigin) {
    return { allowed: false, reason: 'Broker proxy target is not in the trusted origin allowlist' }
  }

  const resolvedAddresses = await resolveProxyAddresses(target.hostname, !explicitlyAllowed)
  if (!resolvedAddresses) {
    return {
      allowed: false,
      reason: explicitlyAllowed
        ? 'Broker proxy target could not be resolved'
        : 'Broker proxy target must resolve to a public host',
    }
  }

  return { allowed: true, resolvedAddresses }
}

const learnBrokerOrigins = (body: Buffer, access: BrokerProxyAccess): void => {
  let payload: unknown
  try {
    payload = JSON.parse(body.toString('utf8'))
  } catch {
    return
  }

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }

    if (!value || typeof value !== 'object') return

    const record = value as Record<string, unknown>
    for (const key of [
      'server_url',
      'serverUrl',
      'server',
      'backend_url',
      'backendUrl',
      'market_api_url',
      'marketApiUrl',
      'public_backend_url',
      'publicBackendUrl',
      'public_ext_api_url',
      'publicExtApiUrl',
      'web_backend_url',
      'webBackendUrl',
      'web_ext_api_url',
      'webExtApiUrl',
      'services_url',
      'servicesUrl',
      'API_HOST',
      'API_HOST_EXT',
      'api_host',
      'api_host_ext',
    ]) {
      if (typeof record[key] === 'string') addBrokerOrigin(access.discoveredBrokerOrigins, record[key])
    }

    Object.values(record).forEach(visit)
  }

  visit(payload)
}

const sendProxyError = (res: ServerResponse, statusCode: number, message: string): void => {
  if (res.headersSent) {
    res.end()
    return
  }

  res.statusCode = statusCode
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end(message)
}

const forwardRequest = (
  req: IncomingMessage,
  res: ServerResponse,
  target: URL,
  resolvedAddresses: readonly ResolvedProxyAddress[],
  onResponseBody?: (body: Buffer) => void
): void => {
  const transport = target.protocol === 'https:' ? https : http
  const headers = copyProxyHeaders(req.headers)
  if (onResponseBody) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'accept-encoding') delete headers[key]
    }
  }

  const requestOptions: http.RequestOptions & https.RequestOptions = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    path: `${target.pathname}${target.search}`,
    method: req.method,
    headers,
    ...createPinnedConnectionOptions(resolvedAddresses),
    rejectUnauthorized: false,
  }

  if (target.protocol === 'https:' && !isIP(target.hostname.replace(/^\[|\]$/g, ''))) {
    requestOptions.servername = target.hostname
  }

  const proxyReq = transport.request(requestOptions, (proxyRes) => {
    const responseHeaders = copyProxyHeaders(proxyRes.headers)
    res.writeHead(proxyRes.statusCode || 502, proxyRes.statusMessage, responseHeaders)

    if (!onResponseBody) {
      proxyRes.pipe(res)
      return
    }

    const chunks: Buffer[] = []
    proxyRes.on('data', (chunk: Buffer) => {
      chunks.push(Buffer.from(chunk))
    })
    proxyRes.on('end', () => {
      const body = Buffer.concat(chunks)
      onResponseBody(body)
      res.end(body)
    })
  })

  proxyReq.on('error', (error) => {
    sendProxyError(res, 502, `Broker proxy request failed: ${error.message}`)
  })

  req.pipe(proxyReq)
}

const isBrokerDiscoveryResponse = (prefix: string, target: URL): boolean => {
  return prefix === '/__broker_discovery' && /^\/api\/v\d+\/broker\/servers\/?$/.test(target.pathname)
}

// Vite's static server.proxy cannot route WebSocket upgrades to a per-request
// dynamic origin (the broker is encoded in the path). Bridge the upgrade by
// hand: replay the client's handshake against the decoded broker origin with
// the Origin header stripped (broker backends reject unknown browser origins),
// then pipe raw sockets both ways.
const rewriteUpgradeRequestHead = (req: IncomingMessage, target: URL): Buffer => {
  const lines = [`${req.method || 'GET'} ${target.pathname}${target.search} HTTP/1.1`]
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase()
    if (lower === 'host' || lower === 'origin' || lower === 'connection' || lower === 'upgrade') continue
    if (Array.isArray(value)) {
      value.forEach((item) => lines.push(`${key}: ${item}`))
    } else if (value !== undefined) {
      lines.push(`${key}: ${value}`)
    }
  }
  lines.push(`Host: ${target.host}`)
  lines.push('Connection: Upgrade')
  lines.push('Upgrade: websocket')
  lines.push('', '')
  return Buffer.from(lines.join('\r\n'))
}

const bridgeWebSocketUpgrade = (
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  target: URL,
  resolvedAddresses: readonly ResolvedProxyAddress[],
): void => {
  const useTls = target.protocol === 'wss:'
  const port = target.port ? Number(target.port) : useTls ? 443 : 80
  const requestHead = rewriteUpgradeRequestHead(req, target)
  const connectionOptions = createPinnedConnectionOptions(resolvedAddresses)

  let outbound: Socket | null = null
  const fail = () => {
    socket.destroy()
    outbound?.destroy()
  }
  socket.on('error', fail)

  const startPiping = (out: Socket) => {
    outbound = out
    out.on('error', fail)
    out.write(requestHead)
    if (head.length > 0) out.write(head)
    socket.pipe(out)
    out.pipe(socket)
  }

  if (useTls) {
    const tlsSocket = tls.connect(
      {
        host: target.hostname,
        port,
        servername: target.hostname,
        rejectUnauthorized: false,
        ...connectionOptions,
      },
      () => startPiping(tlsSocket),
    )
    tlsSocket.on('error', fail)
  } else {
    const netSocket = net.connect(
      { host: target.hostname, port, ...connectionOptions },
      () => startPiping(netSocket),
    )
    netSocket.on('error', fail)
  }
}

const dynamicBrokerWsProxyPlugin = (prefix: string, access: BrokerProxyAccess): Plugin => ({
  name: 'rtx5-dynamic-broker-ws-proxy',
  configureServer(server) {
    server.httpServer?.on('upgrade', (req, socket, head) => {
      const requestUrl = req.url || ''
      if (!requestUrl.startsWith(`${prefix}/`)) return

      const pathAfterPrefix = requestUrl.slice(prefix.length + 1)
      const slashIndex = pathAfterPrefix.indexOf('/')
      const encodedOrigin = slashIndex >= 0 ? pathAfterPrefix.slice(0, slashIndex) : pathAfterPrefix
      const targetPath = slashIndex >= 0 ? pathAfterPrefix.slice(slashIndex) : '/'

      let target: URL
      try {
        const origin = new URL(decodeURIComponent(encodedOrigin))
        if (origin.protocol !== 'ws:' && origin.protocol !== 'wss:') throw new Error('unsupported ws protocol')
        const queryIndex = targetPath.indexOf('?')
        origin.pathname = (queryIndex >= 0 ? targetPath.slice(0, queryIndex) : targetPath) || '/'
        origin.search = queryIndex >= 0 ? targetPath.slice(queryIndex) : ''
        target = origin
      } catch {
        ; (socket as Socket).destroy()
        return
      }

      const clientSocket = socket as Socket
      void validateProxyTarget(target, access)
        .then((validation) => {
          if (!validation.allowed) {
            clientSocket.destroy()
            return
          }
          bridgeWebSocketUpgrade(req, clientSocket, head as Buffer, target, validation.resolvedAddresses)
        })
        .catch(() => clientSocket.destroy())
    })
  },
})

const dynamicBrokerProxyPlugin = (prefixes: string[], access: BrokerProxyAccess): Plugin => ({
  name: 'rtx5-dynamic-broker-proxy',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const requestUrl = req.url || ''
      const prefix = prefixes.find((candidate) => requestUrl.startsWith(`${candidate}/`))
      if (!prefix) {
        next()
        return
      }

      const target = parseDynamicProxyTarget(requestUrl, prefix)
      if (!target) {
        sendProxyError(res, 400, 'Invalid broker proxy target')
        return
      }

      void (async () => {
        const validation = await validateProxyTarget(target, access)
        if (!validation.allowed) {
          sendProxyError(res, 403, validation.reason)
          return
        }

        forwardRequest(
          req,
          res,
          target,
          validation.resolvedAddresses,
          isBrokerDiscoveryResponse(prefix, target) ? (body) => learnBrokerOrigins(body, access) : undefined
        )
      })().catch((error) => {
        sendProxyError(res, 502, `Broker proxy validation failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    })
  },
})

const retiredServiceWorkerDevPlugin = (): Plugin => ({
  name: 'rtx5-retired-service-worker',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const pathname = String(req.url || '').split(/[?#]/, 1)[0]
      if (pathname !== '/sw.js') {
        next()
        return
      }

      res.statusCode = 404
      res.setHeader('Cache-Control', 'no-store, max-age=0')
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('Service worker retired')
    })
  },
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  if (mode === 'web') validateWebBrokerEnvironment(env, process.cwd());
  const backendTarget = env.VITE_API_URL || env.VITE_BACKEND_URL || 'https://backend.orrnn.com';
  const discoveryTarget = env.VITE_BROKER_DISCOVERY_URL || 'https://testbrokerbackend.orrnn.com';
  const brokerApiTarget = env.VITE_DEV_BROKER_API_URL || env.VITE_RTX5_API_URL || 'https://testbrokerbackend.orrnn.com';
  const wsTarget = (env.VITE_WS_URL || env.VITE_FIX_WS_URL || 'wss://backend.orrnn.com/ws/v2').replace(/\/ws\/v2$/, '');
  const brokerProxyAccess = createBrokerProxyAccess(env);

  return {
    base: './',
    resolve: {
      alias: mode === 'desktop' || mode === 'electron'
        ? [{ find: './startup/WelcomeTerminalEntry', replacement: resolve(process.cwd(), 'src/startup/DesktopWelcomeTerminal.ts') }]
        : [],
    },
    plugins: [
      ...(mode === 'web' ? [webRuntimeConfigPlugin(env), terminalPreloadPlugin()] : []),
      retiredServiceWorkerDevPlugin(),
      dynamicBrokerProxyPlugin(['/__broker_api', '/__broker_discovery'], brokerProxyAccess),
      dynamicBrokerWsProxyPlugin('/__broker_feed_ws', brokerProxyAccess),
      react(),
    ],
    server: {
      host: '127.0.0.1',
      port: 5173,
      open: true,
      warmup: {
        clientFiles: [
          './src/main.tsx',
          './src/bootstrap.tsx',
          './src/AppShell.tsx',
          './src/components/WelcomeTerminal.tsx',
          './src/App.tsx',
          './src/components/dock/DockWorkspace.tsx',
          './src/components/TradingChart.tsx',
          './src/components/BottomDock.tsx',
          './src/components/layout/TopToolbar.tsx',
        ],
      },
      proxy: {
        '/__broker_discovery': {
          target: discoveryTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/__broker_discovery/, ''),
        },
        '/__broker_api': {
          target: brokerApiTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/__broker_api/, ''),
        },
        '/api': {
          target: backendTarget,
          changeOrigin: true,
          secure: true,
          // NOTE: ws:true removed — it caused 503s by intercepting HTTP requests
          // as WebSocket upgrades. WS connections use /fix-ws proxy below.
        },
        '/fix-ws': {
          target: wsTarget,
          changeOrigin: true,
          secure: false,
          ws: true,
          configure: configureWsProxy('fix-ws'),
        }
        // '/__broker_feed_ws' upgrades are routed by dynamicBrokerWsProxyPlugin,
        // which decodes the per-request broker origin (a static proxy target
        // sent every broker's WebSocket to the .env broker — breaking live data
        // whenever the runtime broker differs).
      }
    },
    optimizeDeps: {
      include: ['lightweight-charts', 'html2canvas-pro'],
    }
  };
})

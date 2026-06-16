import type { Plugin } from 'vite'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { lookup } from 'node:dns/promises'
import * as http from 'node:http'
import * as https from 'node:https'
import { isIP, type LookupFunction } from 'node:net'

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

const copyProxyHeaders = (headers: IncomingHttpHeaders): IncomingHttpHeaders => {
  const nextHeaders: IncomingHttpHeaders = {}
  for (const [key, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase()) && key.toLowerCase() !== 'host') {
      nextHeaders[key] = value
    }
  }
  return nextHeaders
}

const toHttpOrigin = (value: string): string | null => {
  const trimmed = String(value || '').trim().replace(/\/+$/, '')
  if (!trimmed) return null

  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin
  } catch {
    return null
  }
}

const toWsOrigin = (value: string): string | null => {
  const trimmed = String(value || '').trim().replace(/\/+$/, '')
  if (!trimmed) return null

  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `wss://${trimmed}`)
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:' && parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    parsed.protocol = parsed.protocol === 'http:' ? 'ws:' : parsed.protocol === 'https:' ? 'wss:' : parsed.protocol
    parsed.pathname = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

const addOrigin = (origins: Set<string>, value: string): void => {
  const origin = toHttpOrigin(value)
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

const rewriteDynamicWsProxyPath = (path: string): string => {
  const prefix = '/__broker_feed_ws'
  if (!path.startsWith(`${prefix}/`)) return path.replace(/^\/__broker_feed_ws/, '')

  const pathAfterPrefix = path.slice(prefix.length + 1)
  const slashIndex = pathAfterPrefix.indexOf('/')
  if (slashIndex < 0) return '/'

  const encodedOrigin = pathAfterPrefix.slice(0, slashIndex)
  const targetPath = pathAfterPrefix.slice(slashIndex)

  try {
    const origin = new URL(decodeURIComponent(encodedOrigin))
    if (origin.protocol !== 'ws:' && origin.protocol !== 'wss:') return '/'
    const queryIndex = targetPath.indexOf('?')
    const pathname = queryIndex >= 0 ? targetPath.slice(0, queryIndex) : targetPath
    const search = queryIndex >= 0 ? targetPath.slice(queryIndex) : ''
    return `${pathname || '/'}${search}`
  } catch {
    return '/'
  }
}

const isPrivateIPv4 = (address: string): boolean => {
  const parts = address.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true

  const [a, b] = parts
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224
}

const isPrivateIPv6 = (address: string): boolean => {
  const normalized = address.toLowerCase()
  if (normalized === '::' || normalized === '::1') return true

  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIPv4(mapped[1])

  const firstSegment = Number.parseInt(normalized.split(':')[0] || '0', 16)
  return (firstSegment & 0xfe00) === 0xfc00 || (firstSegment & 0xffc0) === 0xfe80
}

const isPrivateAddress = (address: string): boolean => {
  const version = isIP(address)
  if (version === 4) return isPrivateIPv4(address)
  if (version === 6) return isPrivateIPv6(address)
  return true
}

const isInternalHostname = (hostname: string): boolean => {
  const lower = hostname.toLowerCase()
  return lower === 'localhost'
    || lower.endsWith('.localhost')
    || lower.endsWith('.local')
    || lower.endsWith('.internal')
    || lower.endsWith('.lan')
    || lower.endsWith('.home')
    || lower === 'metadata.google.internal'
    || !lower.includes('.')
}

type ResolvedProxyAddress = {
  address: string
  family: 4 | 6
}

const toAddressFamily = (family: number): 4 | 6 | null => {
  return family === 4 || family === 6 ? family : null
}

const normalizeAddressHostname = (hostname: string): string => {
  const lower = hostname.toLowerCase()
  return lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower
}

const resolveProxyAddress = async (
  hostname: string,
  requirePublicAddress: boolean
): Promise<ResolvedProxyAddress | null> => {
  const normalizedHostname = normalizeAddressHostname(hostname)
  const directFamily = toAddressFamily(isIP(normalizedHostname))
  if (directFamily) {
    if (requirePublicAddress && isPrivateAddress(normalizedHostname)) return null
    return { address: normalizedHostname, family: directFamily }
  }

  if (requirePublicAddress && isInternalHostname(normalizedHostname)) return null

  try {
    const addresses = await lookup(normalizedHostname, { all: true, verbatim: true })
    if (!addresses.length) return null
    if (requirePublicAddress && addresses.some((entry) => isPrivateAddress(entry.address))) return null

    const selected = addresses[0]
    const selectedFamily = toAddressFamily(selected.family)
    if (!selectedFamily) return null
    return { address: selected.address, family: selectedFamily }
  } catch {
    return null
  }
}

const createPinnedLookup = (resolvedAddress: ResolvedProxyAddress): LookupFunction => {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [resolvedAddress])
      return
    }

    callback(null, resolvedAddress.address, resolvedAddress.family)
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
): Promise<{ allowed: true; resolvedAddress: ResolvedProxyAddress } | { allowed: false; reason: string }> => {
  const explicitlyAllowed = access.envAllowedOrigins.has(target.origin)
  const knownOrigin = explicitlyAllowed
    || access.trustedOrigins.has(target.origin)
    || access.discoveredBrokerOrigins.has(target.origin)

  if (!knownOrigin) {
    return { allowed: false, reason: 'Broker proxy target is not in the trusted origin allowlist' }
  }

  const resolvedAddress = await resolveProxyAddress(target.hostname, !explicitlyAllowed)
  if (!resolvedAddress) {
    return {
      allowed: false,
      reason: explicitlyAllowed
        ? 'Broker proxy target could not be resolved'
        : 'Broker proxy target must resolve to a public host',
    }
  }

  return { allowed: true, resolvedAddress }
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
  resolvedAddress: ResolvedProxyAddress,
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
    lookup: createPinnedLookup(resolvedAddress),
    rejectUnauthorized: false,
  }

  if (target.protocol === 'https:' && !isIP(normalizeAddressHostname(target.hostname))) {
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
          validation.resolvedAddress,
          isBrokerDiscoveryResponse(prefix, target) ? (body) => learnBrokerOrigins(body, access) : undefined
        )
      })().catch((error) => {
        sendProxyError(res, 502, `Broker proxy validation failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    })
  },
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendTarget = env.VITE_API_URL || env.VITE_BACKEND_URL || 'https://backend.orrnn.com';
  const discoveryTarget = env.VITE_BROKER_DISCOVERY_URL || 'https://testbrokerbackend.orrnn.com';
  const brokerApiTarget = env.VITE_DEV_BROKER_API_URL || env.VITE_RTX5_API_URL || 'https://testbrokerbackend.orrnn.com';
  const wsTarget = (env.VITE_WS_URL || env.VITE_FIX_WS_URL || 'wss://backend.orrnn.com/ws/v2').replace(/\/ws\/v2$/, '');
  const feedWsTarget = toWsOrigin(env.VITE_MARKET_WS_URL || env.VITE_WS_URL || env.VITE_FIX_WS_URL || wsTarget) || wsTarget;
  const brokerProxyAccess = createBrokerProxyAccess(env);

  return {
  base: './',
  plugins: [
    dynamicBrokerProxyPlugin(['/__broker_api', '/__broker_discovery'], brokerProxyAccess),
    react(),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    open: true,
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
      },
      '/__broker_feed_ws': {
        target: feedWsTarget,
        changeOrigin: true,
        secure: false,
        ws: true,
        rewrite: rewriteDynamicWsProxyPath,
        configure: (proxy) => {
          proxy.on('proxyReqWs', (proxyReq) => {
            proxyReq.removeHeader('origin')
          })
        },
      }
    }
  },
  optimizeDeps: {
    include: ['lightweight-charts', 'html2canvas-pro'],
  }
  };
})

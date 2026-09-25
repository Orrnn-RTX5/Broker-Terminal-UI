import type { Plugin } from 'vite'

export type WebRuntimeConfig = {
  BACKEND_TARGET: string
  API_HOST: string
  API_HOST_EXT: string
  WS_HOST: string
  DEFAULT_MT5_SERVER: string
  DISCOVERY_BASE_URL: string
  BROKER_DISCOVERY_URL: string
  BROKER_ID: string
  VITE_BROKER_ID: string
  FEED_BROKER_ID: string
  USE_MOCK_DISCOVERY: boolean
}

const first = (...values: Array<string | undefined>): string => {
  return values.map((value) => String(value || '').trim()).find(Boolean) || ''
}

const withoutTrailingSlash = (value: string): string => value.replace(/\/+$/, '')

/** Only these explicitly public deployment settings may enter the browser. */
export const createWebRuntimeConfig = (env: Record<string, string>): WebRuntimeConfig => {
  const apiHost = withoutTrailingSlash(first(
    env.VITE_API_HOST,
    env.VITE_API_URL,
    env.VITE_BACKEND_URL,
    env.VITE_RTX5_API_URL,
    env.VITE_FIX_API_URL,
    'https://backend.orrnn.com',
  ))
  const brokerId = first(env.VITE_BROKER_ID)
  const discoveryBase = withoutTrailingSlash(first(
    env.VITE_DISCOVERY_BASE_URL,
    env.VITE_BROKER_DISCOVERY_URL,
    'https://superbackend.orrnn.com',
  ))
  const wsHost = withoutTrailingSlash(first(
    env.VITE_WS_HOST,
    env.VITE_WS_URL,
    env.VITE_FIX_WS_URL,
    env.VITE_RTX5_WS_URL,
    env.VITE_MARKET_WS_URL,
    apiHost,
  )).replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:').replace(/\/ws\/v2$/i, '')

  return {
    BACKEND_TARGET: first(env.VITE_BACKEND_TARGET, env.VITE_BACKEND_MODE, 'web'),
    API_HOST: apiHost,
    API_HOST_EXT: withoutTrailingSlash(first(env.VITE_API_HOST_EXT, apiHost)),
    WS_HOST: wsHost,
    DEFAULT_MT5_SERVER: first(env.VITE_DEFAULT_MT5_SERVER, brokerId),
    DISCOVERY_BASE_URL: discoveryBase,
    BROKER_DISCOVERY_URL: withoutTrailingSlash(first(env.VITE_BROKER_DISCOVERY_URL, discoveryBase)),
    BROKER_ID: brokerId,
    VITE_BROKER_ID: brokerId,
    // Only explicitly browser-public deployment settings belong here. Never
    // copy server-only secrets or arbitrary environment entries into the page.
    FEED_BROKER_ID: first(env.VITE_FEED_BROKER_ID, brokerId),
    USE_MOCK_DISCOVERY: first(env.VITE_USE_MOCK_DISCOVERY).toLowerCase() === 'true',
  }
}

export const renderWebRuntimeConfig = (config: WebRuntimeConfig, localNginxPreview = true): string => {
  const serialized = JSON.stringify(config, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')

  return `// Generated from the active Vite environment. Deployment containers may replace this file.
(function () {
  var isElectron = Boolean(
    (window.electron && window.electron.window)
    || window.electronAPI
    || window.location.protocol === 'file:'
    || navigator.userAgent.indexOf('Electron') !== -1
  );
  if (isElectron) return;

  var config = ${serialized};
  // Preserve the local nginx preview while production follows the selected env.
  var hostname = String(window.location.hostname || '');
  var isLocalWeb = (window.location.protocol === 'http:' || window.location.protocol === 'https:')
    && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
      || hostname === '[::1]' || hostname.endsWith('.localhost'));
  if (isLocalWeb && ${localNginxPreview}) {
    var localOrigin = window.location.origin;
    config = Object.assign({}, config, {
      BACKEND_TARGET: 'desktop', BACKEND_MODE: 'desktop',
      API_HOST: localOrigin, API_HOST_EXT: localOrigin,
      WS_HOST: localOrigin.replace(/^http/i, 'ws'),
      DEFAULT_MT5_SERVER: 'TEST', BROKER_ID: 'TEST', VITE_BROKER_ID: 'TEST',
      FEED_BROKER_ID: 'TEST',
      DISCOVERY_BASE_URL: 'https://fxtrustsuperbackned.orrnn.com',
      BROKER_DISCOVERY_URL: 'https://fxtrustsuperbackned.orrnn.com',
      USE_MOCK_DISCOVERY: false
    });
  }
  window.__RTX_RUNTIME_CONFIG__ = config;
  window.RUNTIME_CONFIG = config;
  window.__RUNTIME_CONFIG__ = config;
})();
`
}

/** Serve the same configuration in development and in the resulting build. */
export const webRuntimeConfigPlugin = (env: Record<string, string>): Plugin => {
  const source = renderWebRuntimeConfig(
    createWebRuntimeConfig(env),
    env.VITE_LOCAL_NGINX_PREVIEW?.trim().toLowerCase() !== 'false',
  )

  return {
    name: 'rtx5-web-runtime-config',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = String(req.url || '').split(/[?#]/, 1)[0]
        if (pathname !== '/runtime-config.js' || (req.method !== 'GET' && req.method !== 'HEAD')) {
          next()
          return
        }

        res.statusCode = 200
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store, max-age=0')
        res.end(req.method === 'HEAD' ? undefined : source)
      })
    },
    generateBundle() {
      // Vite copies public/ during renderStart, before emitting this asset.
      // Preview must serve this built file instead of reading another env mode.
      this.emitFile({ type: 'asset', fileName: 'runtime-config.js', source })
    },
  }
}

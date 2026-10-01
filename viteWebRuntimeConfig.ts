import type { Plugin } from 'vite'
import { selectBrokerRuntimeConfig, validateBrokerRuntimeConfig } from './src/config/brokerRuntimeConfig'

export type WebRuntimeConfig = {
  CONFIG_SOURCE: string
  PINNED_BROKER: boolean
  CONFIG_ERRORS: string[]
  BROKER_ALLOWED_ORIGINS: string
  BROKER_NAME: string
  BROKER_LOGO_URL: string
  BROKER_LOGIN_HERO_URL: string
  BROKER_LOGIN_HERO_MOBILE_URL: string
  BROKER_TERMS_URL: string
  PUBLIC_CANDLE_BRIDGE: boolean
  PUBLIC_MARKET_API: string
  EXTRA_BROKER_DISCOVERY_URLS: string
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
  for (const value of values) if (value !== undefined) return String(value).trim()
  return ''
}

const withoutTrailingSlash = (value: string): string => value.replace(/\/+$/, '')

/** Only these explicitly public deployment settings may enter the browser. */
export const createWebRuntimeConfig = (env: Record<string, string>): WebRuntimeConfig => {
  const apiHost = withoutTrailingSlash(first(
    env.API_HOST, env.API_URL, env.BACKEND_URL, env.RTX5_API_URL, env.API_V2_URL, env.FIX_API_URL,
    env.VITE_API_HOST, env.VITE_API_URL, env.VITE_BACKEND_URL, env.VITE_RTX5_API_URL, env.VITE_API_V2_URL, env.VITE_FIX_API_URL,
  ))
  const brokerId = first(env.BROKER_ID, env.VITE_BROKER_ID)
  const discoveryBase = withoutTrailingSlash(first(
    env.DISCOVERY_BASE_URL, env.BROKER_DISCOVERY_URL, env.SHARED_DISCOVERY_BASE_URL,
    env.VITE_DISCOVERY_BASE_URL, env.VITE_BROKER_DISCOVERY_URL, env.VITE_SHARED_DISCOVERY_BASE_URL,
  ))
  const wsHost = withoutTrailingSlash(first(
    env.WS_HOST, env.WS_URL, env.RTX5_WS_URL, env.MARKET_WS_URL, env.FIX_WS_URL,
    env.VITE_WS_HOST, env.VITE_WS_URL, env.VITE_RTX5_WS_URL, env.VITE_MARKET_WS_URL, env.VITE_FIX_WS_URL, apiHost,
  )).replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:').replace(/\/ws\/(v2|feed)$/i, '')
  const target = first(env.BACKEND_TARGET, env.BACKEND_MODE, env.VITE_BACKEND_TARGET, env.VITE_BACKEND_MODE, 'web')
  const truthy = (value: string): boolean => /^(true|1|yes|on)$/i.test(value)
  const config: WebRuntimeConfig = {
    CONFIG_SOURCE: 'build', PINNED_BROKER: !/^(desktop|electron|direct)$/i.test(target), CONFIG_ERRORS: [],
    BACKEND_TARGET: target,
    API_HOST: apiHost,
    API_HOST_EXT: withoutTrailingSlash(first(env.API_HOST_EXT, env.API_URL_EXT, env.BACKEND_URL_EXT, env.VITE_API_HOST_EXT, env.VITE_API_URL_EXT, env.VITE_BACKEND_URL_EXT, apiHost)),
    WS_HOST: wsHost,
    DEFAULT_MT5_SERVER: first(env.DEFAULT_MT5_SERVER, env.VITE_DEFAULT_MT5_SERVER),
    DISCOVERY_BASE_URL: discoveryBase,
    BROKER_DISCOVERY_URL: withoutTrailingSlash(first(env.BROKER_DISCOVERY_URL, env.VITE_BROKER_DISCOVERY_URL, discoveryBase)),
    BROKER_ID: brokerId, VITE_BROKER_ID: brokerId,
    FEED_BROKER_ID: first(env.FEED_BROKER_ID, env.VITE_FEED_BROKER_ID, brokerId),
    BROKER_ALLOWED_ORIGINS: first(env.BROKER_ALLOWED_ORIGINS, env.VITE_BROKER_ALLOWED_ORIGINS),
    BROKER_NAME: first(env.BROKER_NAME, env.VITE_BROKER_NAME),
    BROKER_LOGO_URL: first(env.BROKER_LOGO_URL, env.VITE_BROKER_LOGO_URL),
    BROKER_LOGIN_HERO_URL: first(env.BROKER_LOGIN_HERO_URL, env.VITE_BROKER_LOGIN_HERO_URL),
    BROKER_LOGIN_HERO_MOBILE_URL: first(env.BROKER_LOGIN_HERO_MOBILE_URL, env.VITE_BROKER_LOGIN_HERO_MOBILE_URL),
    BROKER_TERMS_URL: first(env.BROKER_TERMS_URL, env.VITE_BROKER_TERMS_URL),
    EXTRA_BROKER_DISCOVERY_URLS: first(env.EXTRA_BROKER_DISCOVERY_URLS, env.VITE_EXTRA_BROKER_DISCOVERY_URLS),
    PUBLIC_CANDLE_BRIDGE: truthy(first(env.PUBLIC_CANDLE_BRIDGE, env.VITE_PUBLIC_CANDLE_BRIDGE)),
    PUBLIC_MARKET_API: first(env.PUBLIC_MARKET_API, env.VITE_PUBLIC_MARKET_API, 'gateway-v2'),
    USE_MOCK_DISCOVERY: truthy(first(env.USE_MOCK_DISCOVERY, env.VITE_USE_MOCK_DISCOVERY)),
  }
  config.CONFIG_ERRORS = validateBrokerRuntimeConfig(config, { desktop: !config.PINNED_BROKER, allowLocal: !config.PINNED_BROKER }).errors
  return config
}

/** Loaded before any startup requests, including a container-generated runtime config. */
export const renderBrokerRuntimeValidator = (): string =>
  `window.__RTX_SELECT_BROKER_CONFIG__ = ${selectBrokerRuntimeConfig.toString()};\nwindow.__RTX_VALIDATE_BROKER_CONFIG__ = ${validateBrokerRuntimeConfig.toString()};\n`

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
  // Preserve the opt-in local desktop gateway without overriding a web broker
  // selected by .env.web merely because Vite is running on localhost.
  var hostname = String(window.location.hostname || '');
  var isLocalDesktopGateway = String(config.BACKEND_TARGET || '').toLowerCase() === 'desktop'
    && (window.location.protocol === 'http:' || window.location.protocol === 'https:')
    && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
      || hostname === '[::1]' || hostname.endsWith('.localhost'));
  if (isLocalDesktopGateway && ${localNginxPreview}) {
    var localOrigin = window.location.origin;
    config = Object.assign({}, config, {
      BACKEND_TARGET: 'desktop', BACKEND_MODE: 'desktop',
      API_HOST: localOrigin, API_HOST_EXT: localOrigin,
      WS_HOST: localOrigin.replace(/^http/i, 'ws'),
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
  const validatorSource = renderBrokerRuntimeValidator()
  const source = renderWebRuntimeConfig(
    createWebRuntimeConfig(env),
    env.VITE_LOCAL_NGINX_PREVIEW?.trim().toLowerCase() !== 'false',
  )

  return {
    name: 'rtx5-web-runtime-config',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = String(req.url || '').split(/[?#]/, 1)[0]
        if (!['/runtime-config.js', '/runtime-config-validator.js'].includes(pathname) || (req.method !== 'GET' && req.method !== 'HEAD')) {
          next()
          return
        }

        res.statusCode = 200
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store, max-age=0')
        res.end(req.method === 'HEAD' ? undefined : pathname === '/runtime-config-validator.js' ? validatorSource : source)
      })
    },
    generateBundle() {
      // Vite copies public/ during renderStart, before emitting this asset.
      // Preview must serve this built file instead of reading another env mode.
      this.emitFile({ type: 'asset', fileName: 'runtime-config-validator.js', source: validatorSource })
      this.emitFile({ type: 'asset', fileName: 'runtime-config.js', source })
    },
  }
}

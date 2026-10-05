export type BrokerRuntimeConfiguration = {
  source: string
  pinned: boolean
  valid: boolean
  apiHost: string
  apiHostExt: string
  wsHost: string
  brokerId: string
  feedBrokerId: string
  defaultMt5Server: string
  discoveryBaseUrl: string
  brokerName: string
  brokerLogoUrl: string
  brokerLoginHeroUrl: string
  brokerLoginHeroMobileUrl: string
  brokerTermsUrl: string
  extraDiscoveryUrls: string[]
  publicCandleBridge: boolean
  publicMarketApi: string
  allowedOrigins: string[]
  errors: string[]
}

/** Pick a complete source; deployment objects outrank compiled objects across legacy globals. */
export function selectBrokerRuntimeConfig(candidates: unknown[]): Record<string, unknown> | undefined {
  const objects = candidates.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value)))
  const deployments = objects.filter(value => value.CONFIG_SOURCE === 'deployment')
  const selected = deployments[0] || objects.find(value => value.CONFIG_SOURCE !== 'build') || objects[0]
  if (!selected) return undefined
  const identity = (value: Record<string, unknown>): string => {
    const read = (keys: string[]) => {
      for (const key of keys) if (value[key] !== undefined && value[key] !== null) return String(value[key]).trim()
      return ''
    }
    const origin = (url: string) => { try { return new URL(url).origin } catch { return url } }
    const api = read(['API_HOST', 'API_URL', 'BACKEND_URL', 'RTX5_API_URL', 'API_V2_URL', 'FIX_API_URL', 'VITE_API_HOST', 'VITE_API_URL', 'VITE_BACKEND_URL', 'VITE_RTX5_API_URL', 'VITE_API_V2_URL', 'VITE_FIX_API_URL'])
    const brokerId = read(['BROKER_ID', 'VITE_BROKER_ID', 'brokerId', 'broker_id'])
    return JSON.stringify([
      read(['BACKEND_TARGET', 'BACKEND_MODE', 'VITE_BACKEND_TARGET', 'VITE_BACKEND_MODE']).toLowerCase() || 'web',
      brokerId,
      origin(api),
      origin(read(['API_HOST_EXT', 'API_URL_EXT', 'BACKEND_URL_EXT', 'VITE_API_HOST_EXT', 'VITE_API_URL_EXT', 'VITE_BACKEND_URL_EXT']) || api),
      origin(read(['WS_HOST', 'WS_URL', 'RTX5_WS_URL', 'MARKET_WS_URL', 'FIX_WS_URL', 'VITE_WS_HOST', 'VITE_WS_URL', 'VITE_RTX5_WS_URL', 'VITE_MARKET_WS_URL', 'VITE_FIX_WS_URL'])),
      read(['DEFAULT_MT5_SERVER', 'VITE_DEFAULT_MT5_SERVER', 'defaultMt5Server']),
      read(['FEED_BROKER_ID', 'VITE_FEED_BROKER_ID']) || brokerId,
      origin(read(['DISCOVERY_BASE_URL', 'BROKER_DISCOVERY_URL', 'SHARED_DISCOVERY_BASE_URL', 'VITE_DISCOVERY_BASE_URL', 'VITE_BROKER_DISCOVERY_URL', 'VITE_SHARED_DISCOVERY_BASE_URL'])),
      origin(read(['BROKER_DISCOVERY_URL', 'VITE_BROKER_DISCOVERY_URL'])),
      read(['BROKER_ALLOWED_ORIGINS', 'VITE_BROKER_ALLOWED_ORIGINS']).split(/[\s,]+/).filter(Boolean).map(origin).sort(),
      read(['PUBLIC_MARKET_API', 'VITE_PUBLIC_MARKET_API']) || 'gateway-v2',
      read(['BROKER_LOGIN_HERO_URL', 'VITE_BROKER_LOGIN_HERO_URL']),
      read(['BROKER_LOGIN_HERO_MOBILE_URL', 'VITE_BROKER_LOGIN_HERO_MOBILE_URL']),
      read(['BROKER_TERMS_URL', 'VITE_BROKER_TERMS_URL']),
      /^(true|1|yes|on)$/i.test(read(['PUBLIC_CANDLE_BRIDGE', 'VITE_PUBLIC_CANDLE_BRIDGE'])),
      /^(true|1|yes|on)$/i.test(read(['USE_MOCK_DISCOVERY', 'VITE_USE_MOCK_DISCOVERY'])),
      Array.isArray(value.CONFIG_ERRORS) ? value.CONFIG_ERRORS : [],
    ])
  }
  if (deployments.some(value => identity(value) !== identity(selected))) {
    return { ...selected, CONFIG_ERRORS: [...(Array.isArray(selected.CONFIG_ERRORS) ? selected.CONFIG_ERRORS : []), 'Conflicting deployment runtime configuration sources.'] }
  }
  return selected
}

/** Pure and self-contained so the same validator runs before HTML warmups and in SDKs. */
export function validateBrokerRuntimeConfig(
  config: Record<string, unknown> | undefined,
  options: { allowLocal?: boolean; desktop?: boolean } = {},
): BrokerRuntimeConfiguration {
  const read = (...keys: string[]): string => {
    for (const key of keys) {
      const value = config?.[key]
      // A present empty primary key clears lower-priority aliases; it never revives a compiled broker.
      if (value !== undefined && value !== null) return String(value).trim()
    }
    return ''
  }
  const errors: string[] = []
  const source = read('CONFIG_SOURCE') || 'runtime'
  const target = read('BACKEND_TARGET', 'BACKEND_MODE', 'VITE_BACKEND_TARGET', 'VITE_BACKEND_MODE') || 'web'
  if (!/^(web|browser|public|desktop|electron|direct)$/i.test(target)) errors.push('BACKEND_TARGET is not a supported transport mode.')
  if (source === 'deployment' && !/^(web|browser|public)$/i.test(target)) errors.push('Web container deployments must use BACKEND_TARGET=web.')
  const brokerId = read('BROKER_ID', 'VITE_BROKER_ID', 'brokerId', 'broker_id')
  if (Array.from(brokerId).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) errors.push('BROKER_ID must not contain control characters.')
  const defaultMt5Server = read('DEFAULT_MT5_SERVER', 'VITE_DEFAULT_MT5_SERVER', 'defaultMt5Server')
  const apiValue = read('API_HOST', 'API_URL', 'BACKEND_URL', 'RTX5_API_URL', 'API_V2_URL', 'FIX_API_URL', 'VITE_API_HOST', 'VITE_API_URL', 'VITE_BACKEND_URL', 'VITE_RTX5_API_URL', 'VITE_API_V2_URL', 'VITE_FIX_API_URL')
  const extValue = read('API_HOST_EXT', 'API_URL_EXT', 'BACKEND_URL_EXT', 'VITE_API_HOST_EXT', 'VITE_API_URL_EXT', 'VITE_BACKEND_URL_EXT') || apiValue
  const wsValue = read('WS_HOST', 'WS_URL', 'RTX5_WS_URL', 'MARKET_WS_URL', 'FIX_WS_URL', 'VITE_WS_HOST', 'VITE_WS_URL', 'VITE_RTX5_WS_URL', 'VITE_MARKET_WS_URL', 'VITE_FIX_WS_URL')
  const discoveryValue = read('DISCOVERY_BASE_URL', 'BROKER_DISCOVERY_URL', 'SHARED_DISCOVERY_BASE_URL', 'VITE_DISCOVERY_BASE_URL', 'VITE_BROKER_DISCOVERY_URL', 'VITE_SHARED_DISCOVERY_BASE_URL')
  const explicitDiscovery = read('BROKER_DISCOVERY_URL', 'VITE_BROKER_DISCOVERY_URL')
  const parseOrigin = (value: string, label: string, ws = false): string => {
    if (!value) return ''
    try {
      // Schemes are explicit: never repair malformed deployment values into a new destination.
      const url = new URL(value)
      const protocol = ws ? 'wss:' : 'https:'
      const local = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname) || url.hostname.endsWith('.localhost')
      const allowedLocalProtocol = options.allowLocal && local && url.protocol === (ws ? 'ws:' : 'http:')
      if (url.protocol !== protocol && !allowedLocalProtocol) throw new Error(`must use ${protocol.slice(0, -1).toUpperCase()}`)
      if (local && !options.allowLocal) throw new Error('loopback is permitted only in explicit development or desktop mode')
      if (url.username || url.password || url.search || url.hash) throw new Error('must not contain credentials, query strings, or fragments')
      if (url.pathname !== '/' && !(ws && /^\/ws\/(v2|feed)\/?$/.test(url.pathname))) throw new Error('must be an origin without an API path')
      return url.origin
    } catch (error) {
      errors.push(`${label}: ${error instanceof Error ? error.message : 'invalid URL'}`)
      return ''
    }
  }
  if (!config) errors.push('Runtime broker configuration is missing. Configure this deployment before using the terminal.')
  const apiHost = parseOrigin(apiValue, 'API_HOST')
  const apiHostExt = parseOrigin(extValue, 'API_HOST_EXT')
  const wsHost = parseOrigin(wsValue, 'WS_HOST', true)
  const discoveryBaseUrl = parseOrigin(discoveryValue, 'DISCOVERY_BASE_URL')
  if (explicitDiscovery && discoveryValue && explicitDiscovery.replace(/\/+$/, '') !== discoveryValue.replace(/\/+$/, '')) errors.push('DISCOVERY_BASE_URL and BROKER_DISCOVERY_URL must identify the same catalog.')
  for (const [label, value] of [['API_HOST', apiValue], ['WS_HOST', wsValue], ['BROKER_ID', brokerId], ['DEFAULT_MT5_SERVER', defaultMt5Server]]) {
    if (!value) errors.push(`${label} is required for this broker deployment.`)
  }
  const allowedOrigins = [apiHost].filter(Boolean)
  const extraOrigins = read('BROKER_ALLOWED_ORIGINS', 'VITE_BROKER_ALLOWED_ORIGINS').split(/[\s,]+/).filter(Boolean)
  for (const value of extraOrigins) {
    const origin = parseOrigin(value, 'BROKER_ALLOWED_ORIGINS')
    if (origin && !allowedOrigins.includes(origin)) allowedOrigins.push(origin)
  }
  if (apiHostExt && !allowedOrigins.includes(apiHostExt)) errors.push('API_HOST_EXT must belong to API_HOST or explicit BROKER_ALLOWED_ORIGINS.')
  const wsHttpOrigin = wsHost.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')
  if (wsHost && !allowedOrigins.includes(wsHttpOrigin)) errors.push('WS_HOST must belong to API_HOST or explicit BROKER_ALLOWED_ORIGINS.')
  if (Array.isArray(config?.CONFIG_ERRORS)) {
    for (const value of config.CONFIG_ERRORS) if (typeof value === 'string' && value && !errors.includes(value)) errors.push(value)
  }
  if (/^(true|1|yes|on)$/i.test(read('USE_MOCK_DISCOVERY', 'VITE_USE_MOCK_DISCOVERY')) && source === 'deployment') errors.push('Mock discovery is unavailable in production deployments.')
  const brokerLogoUrl = read('BROKER_LOGO_URL', 'VITE_BROKER_LOGO_URL')
  const brokerLoginHeroUrl = read('BROKER_LOGIN_HERO_URL', 'VITE_BROKER_LOGIN_HERO_URL')
  const brokerLoginHeroMobileUrl = read('BROKER_LOGIN_HERO_MOBILE_URL', 'VITE_BROKER_LOGIN_HERO_MOBILE_URL')
  const brokerTermsUrl = read('BROKER_TERMS_URL', 'VITE_BROKER_TERMS_URL')
  const publicMarketApi = read('PUBLIC_MARKET_API', 'VITE_PUBLIC_MARKET_API') || 'gateway-v2'
  if (!['gateway-v2', 'mt5-bridge-v1'].includes(publicMarketApi)) errors.push('PUBLIC_MARKET_API must be gateway-v2 or mt5-bridge-v1.')
  for (const [label, value] of [
    ['BROKER_LOGO_URL', brokerLogoUrl], ['BROKER_LOGIN_HERO_URL', brokerLoginHeroUrl],
    ['BROKER_LOGIN_HERO_MOBILE_URL', brokerLoginHeroMobileUrl], ['BROKER_TERMS_URL', brokerTermsUrl],
  ]) {
    if (!value) continue
    try {
      const asset = new URL(value)
      if (asset.protocol !== 'https:' || asset.username || asset.password) errors.push(`${label} must be a public HTTPS URL without credentials.`)
    } catch { errors.push(`${label} is not a valid HTTPS URL.`) }
  }
  return {
    source, pinned: !options.desktop, valid: errors.length === 0,
    apiHost, apiHostExt, wsHost, brokerId,
    feedBrokerId: read('FEED_BROKER_ID', 'VITE_FEED_BROKER_ID') || brokerId,
    defaultMt5Server, discoveryBaseUrl,
    brokerName: read('BROKER_NAME', 'VITE_BROKER_NAME') || defaultMt5Server || brokerId,
    brokerLogoUrl, brokerLoginHeroUrl, brokerLoginHeroMobileUrl, brokerTermsUrl,
    extraDiscoveryUrls: options.desktop ? read('EXTRA_BROKER_DISCOVERY_URLS', 'VITE_EXTRA_BROKER_DISCOVERY_URLS').split(/[\s,]+/).filter(Boolean) : [],
    publicCandleBridge: /^(true|1|yes|on)$/i.test(read('PUBLIC_CANDLE_BRIDGE', 'VITE_PUBLIC_CANDLE_BRIDGE')),
    publicMarketApi,
    allowedOrigins, errors,
  }
}

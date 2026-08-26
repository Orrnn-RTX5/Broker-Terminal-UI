import { lookup } from 'node:dns/promises'
import { isIP, type LookupFunction } from 'node:net'

export type ResolvedProxyAddress = {
  address: string
  family: 4 | 6
}

type ProxyAddressResolver = (hostname: string) => Promise<ReadonlyArray<{
  address: string
  family: number
}>>

export const BROKER_PROXY_ADDRESS_ATTEMPT_TIMEOUT_MS = 250

export type PinnedConnectionOptions = {
  lookup: LookupFunction
  autoSelectFamily: boolean
  autoSelectFamilyAttemptTimeout: number
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

const toAddressFamily = (family: number): 4 | 6 | null => {
  return family === 4 || family === 6 ? family : null
}

const normalizeAddressHostname = (hostname: string): string => {
  const lower = hostname.toLowerCase()
  return lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower
}

const resolveAllProxyAddresses: ProxyAddressResolver = (hostname) =>
  lookup(hostname, { all: true, verbatim: true })

export const resolveProxyAddresses = async (
  hostname: string,
  requirePublicAddress: boolean,
  resolver: ProxyAddressResolver = resolveAllProxyAddresses
): Promise<ResolvedProxyAddress[] | null> => {
  const normalizedHostname = normalizeAddressHostname(hostname)
  const directFamily = toAddressFamily(isIP(normalizedHostname))
  if (directFamily) {
    if (requirePublicAddress && isPrivateAddress(normalizedHostname)) return null
    return [{ address: normalizedHostname, family: directFamily }]
  }

  if (requirePublicAddress && isInternalHostname(normalizedHostname)) return null

  try {
    const addresses = await resolver(normalizedHostname)
    if (!addresses.length) return null

    const resolvedAddresses: ResolvedProxyAddress[] = []
    const seen = new Set<string>()

    for (const entry of addresses) {
      const address = normalizeAddressHostname(entry.address)
      const family = toAddressFamily(entry.family)
      if (!family || isIP(address) !== family) return null
      if (requirePublicAddress && isPrivateAddress(address)) return null

      const key = `${family}:${address}`
      if (seen.has(key)) continue
      seen.add(key)
      resolvedAddresses.push({ address, family })
    }

    return resolvedAddresses.length ? resolvedAddresses : null
  } catch {
    return null
  }
}

export const createPinnedLookup = (resolvedAddresses: readonly ResolvedProxyAddress[]): LookupFunction => {
  const pinnedAddresses = resolvedAddresses.map((entry) => ({ ...entry }))
  const firstAddress = pinnedAddresses[0]
  if (!firstAddress) {
    throw new Error('At least one validated broker proxy address is required')
  }

  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, pinnedAddresses.map((entry) => ({ ...entry })))
      return
    }

    callback(null, firstAddress.address, firstAddress.family)
  }
}

export const createPinnedConnectionOptions = (
  resolvedAddresses: readonly ResolvedProxyAddress[]
): PinnedConnectionOptions => ({
  lookup: createPinnedLookup(resolvedAddresses),
  autoSelectFamily: resolvedAddresses.length > 1,
  autoSelectFamilyAttemptTimeout: BROKER_PROXY_ADDRESS_ATTEMPT_TIMEOUT_MS,
})

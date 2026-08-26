import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  BROKER_PROXY_ADDRESS_ATTEMPT_TIMEOUT_MS,
  createPinnedConnectionOptions,
  createPinnedLookup,
  resolveProxyAddresses,
  type ResolvedProxyAddress,
} from '../../viteBrokerProxyAddress'

const PUBLIC_ADDRESSES: ResolvedProxyAddress[] = [
  { address: '172.67.162.241', family: 4 },
  { address: '104.21.57.102', family: 4 },
]

describe('Vite broker proxy address resolution', () => {
  it('retains every validated DNS answer in resolver order', async () => {
    const resolver = vi.fn(async () => PUBLIC_ADDRESSES)

    await expect(resolveProxyAddresses('broker.example', true, resolver)).resolves.toEqual(PUBLIC_ADDRESSES)
    expect(resolver).toHaveBeenCalledOnce()
    expect(resolver).toHaveBeenCalledWith('broker.example')
  })

  it('deduplicates identical DNS answers without changing their order', async () => {
    const resolver = async () => [PUBLIC_ADDRESSES[0], PUBLIC_ADDRESSES[0], PUBLIC_ADDRESSES[1]]

    await expect(resolveProxyAddresses('broker.example', true, resolver)).resolves.toEqual(PUBLIC_ADDRESSES)
  })

  it('rejects the entire DNS answer set when a non-explicit target includes a private address', async () => {
    const resolver = async () => [PUBLIC_ADDRESSES[0], { address: '127.0.0.1', family: 4 }]

    await expect(resolveProxyAddresses('broker.example', true, resolver)).resolves.toBeNull()
  })

  it('preserves the existing private-address exception for explicitly allowlisted targets', async () => {
    const addresses = [PUBLIC_ADDRESSES[0], { address: '127.0.0.1', family: 4 as const }]
    const resolver = async () => addresses

    await expect(resolveProxyAddresses('broker.example', false, resolver)).resolves.toEqual(addresses)
  })

  it('handles a literal public IP without performing another DNS lookup', async () => {
    const resolver = vi.fn(async () => PUBLIC_ADDRESSES)

    await expect(resolveProxyAddresses('104.21.57.102', true, resolver)).resolves.toEqual([
      { address: '104.21.57.102', family: 4 },
    ])
    expect(resolver).not.toHaveBeenCalled()
  })

  it('rejects internal hostnames before DNS resolution when a public address is required', async () => {
    const resolver = vi.fn(async () => PUBLIC_ADDRESSES)

    await expect(resolveProxyAddresses('localhost', true, resolver)).resolves.toBeNull()
    expect(resolver).not.toHaveBeenCalled()
  })

  it('fails closed for malformed or unsupported resolver answers', async () => {
    await expect(resolveProxyAddresses('broker.example', true, async () => [])).resolves.toBeNull()
    await expect(resolveProxyAddresses('broker.example', true, async () => [
      { address: '104.21.57.102', family: 0 },
    ])).resolves.toBeNull()
    await expect(resolveProxyAddresses('broker.example', false, async () => [
      { address: 'not-an-ip', family: 4 },
    ])).resolves.toBeNull()
  })
})

describe('Vite broker proxy pinned lookup', () => {
  it('returns the complete vetted set when Node requests all addresses', async () => {
    const pinnedLookup = createPinnedLookup(PUBLIC_ADDRESSES)
    const result = await new Promise<unknown>((resolve, reject) => {
      pinnedLookup('broker.example', { all: true }, (error, addresses) => {
        if (error) reject(error)
        else resolve(addresses)
      })
    })

    expect(result).toEqual(PUBLIC_ADDRESSES)
  })

  it('returns the first vetted address for callers that do not support address lists', async () => {
    const pinnedLookup = createPinnedLookup(PUBLIC_ADDRESSES)
    const result = await new Promise<{ address: unknown; family: unknown }>((resolve, reject) => {
      pinnedLookup('broker.example', { all: false }, (error, address, family) => {
        if (error) reject(error)
        else resolve({ address, family })
      })
    })

    expect(result).toEqual(PUBLIC_ADDRESSES[0])
  })

  it('rejects an empty vetted address set', () => {
    expect(() => createPinnedLookup([])).toThrow('At least one validated broker proxy address is required')
  })

  it('falls through to the second vetted address when the first cannot connect', async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/plain' })
      response.end('broker-directory-ok')
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })

    try {
      const address = server.address() as AddressInfo
      const connectionOptions = createPinnedConnectionOptions([
        { address: '127.0.0.2', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ])

      expect(connectionOptions.autoSelectFamily).toBe(true)
      expect(connectionOptions.autoSelectFamilyAttemptTimeout).toBe(BROKER_PROXY_ADDRESS_ATTEMPT_TIMEOUT_MS)

      const result = await new Promise<{ statusCode?: number; body: string }>((resolve, reject) => {
        const request = http.get({
          hostname: 'broker.test',
          port: address.port,
          path: '/',
          ...connectionOptions,
        }, (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
          response.on('end', () => resolve({
            statusCode: response.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          }))
        })

        request.setTimeout(3_000, () => request.destroy(new Error('test request timed out')))
        request.on('error', reject)
      })

      expect(result).toEqual({ statusCode: 200, body: 'broker-directory-ok' })
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    }
  })
})

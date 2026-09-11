import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Reject overlapping broker blocks before dotenv silently takes the last value. */
export function validateWebBrokerEnvironment(env: Record<string, string>, directory: string): void {
  for (const filename of ['.env.web', '.env.web.local']) {
    const path = resolve(directory, filename)
    if (!existsSync(path)) continue
    const assignments = new Map<string, number>()
    for (const [index, line] of readFileSync(path, 'utf8').split(/\r?\n/).entries()) {
      const match = /^\s*(?:export\s+)?((?:VITE_)?(?:BACKEND|API|RTX5_API|FIX_API|WS|FIX_WS|MARKET_WS|BROKER|DISCOVERY|DEFAULT_MT5|FEED|ADMIN)[A-Z0-9_]*)\s*=/.exec(line)
      if (!match) continue
      const key = match[1]
      const previous = assignments.get(key)
      if (previous !== undefined) {
        throw new Error(`${filename}: ${key} is active on lines ${previous} and ${index + 1}. Uncomment only one broker block and comment out the others.`)
      }
      assignments.set(key, index + 1)
    }
  }
  const brokerId = env.VITE_BROKER_ID
  const backend = env.VITE_API_HOST || env.VITE_API_URL || env.VITE_BACKEND_URL
  if (!brokerId?.trim() || !backend?.trim()) {
    throw new Error('No complete web broker is configured. Uncomment one broker block in .env.web (VITE_BROKER_ID and its backend URL are required).')
  }
}

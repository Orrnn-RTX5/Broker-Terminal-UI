import { getRuntimeBrokerConfiguration } from '../config/backendTarget.js';
import { isBrokerName } from '../services/brokerDisplayName';
import { resolveServerDisplayLabel } from '../services/brokerServerIdentity';

/** Neutral login-title brand when no broker name is known. No vendor string. */
export const NEUTRAL_LOGIN_TITLE_BRAND = 'Broker';

/**
 * Text shown after "Sign in to" when the broker logo is not available: the
 * selected broker's display name, else the configured deployment broker name,
 * else the neutral 'Broker'. Build-fallback server names yield to the
 * broker-published server name, as everywhere else in the terminal.
 */
export function resolveLoginTitleBrandName(brokerName: unknown): string {
  const candidates: unknown[] = [brokerName];
  try {
    const configuration = getRuntimeBrokerConfiguration();
    if (configuration.valid) candidates.push(configuration.brokerName);
  } catch {
    // Invalid or missing deployment config: fall through to the neutral name.
  }
  for (const candidate of candidates) {
    const label = String(resolveServerDisplayLabel(String(candidate ?? '').trim()) || '').trim();
    if (isBrokerName(label)) return label;
  }
  return NEUTRAL_LOGIN_TITLE_BRAND;
}

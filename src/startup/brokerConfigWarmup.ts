import { useEffect } from 'react';
import { api } from '../services/api';
import { normalizeBrokerOperationalConfig } from '../services/brokerOperationalConfig';

/**
 * useBrokerConfigWarmup — prime the broker's own config document on startup.
 *
 * Broker operating values come from the broker's own `/api/v2/broker/config`
 * document (white-label: no per-broker literals in code). The fetch resolves
 * through the shared neutral-fallback normalization — live values on success,
 * neutral values when the document is unavailable — and the result is
 * intentionally discarded: each consumer holds its own normalized read, so
 * this effect owns no UI state. The unmount guard keeps a late settlement
 * from doing work after teardown; rejections never surface.
 */
export function useBrokerConfigWarmup(): void {
  useEffect(() => {
    let active = true;
    api.config.getConfig()
      .then((config) => { if (active) normalizeBrokerOperationalConfig(config); })
      .catch(() => { if (active) normalizeBrokerOperationalConfig(null); });
    return () => { active = false; };
  }, []);
}

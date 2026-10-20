import { useEffect } from 'react';
import { api } from '../services/api';
import { normalizeBrokerOperationalConfig } from '../services/brokerOperationalConfig';
import { recordBrokerServerIdentity } from '../services/brokerServerIdentity';
import { installSavedAccountServerMigration } from '../services/savedAccountServerMigration';
import { getReconnectDelayMs, isServerUnreachableError } from '../services/serverReachability';

/**
 * useBrokerConfigWarmup — prime the broker's own config document on startup.
 *
 * Broker operating values come from the broker's own `/api/v2/broker/config`
 * document (white-label: no per-broker literals in code). The fetch resolves
 * through the shared neutral-fallback normalization — live values on success,
 * neutral values when the document is unavailable. Each consumer holds its
 * own normalized read, so this effect owns no UI state; it only records the
 * broker-published server name (display metadata) for the status bar, title
 * and Navigator. The unmount guard keeps a late settlement
 * from doing work after teardown; rejections never surface.
 */
export function useBrokerConfigWarmup(): void {
  useEffect(() => {
    let active = true;
    // Saved accounts under the build fallback server key join the broker's
    // real key as soon as its config (server_name) is available.
    const stopMigration = installSavedAccountServerMigration();
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      api.config.getConfig()
        .then((config) => {
          if (!active) return;
          normalizeBrokerOperationalConfig(config);
          recordBrokerServerIdentity(config);
        })
        .catch((error: unknown) => {
          if (!active) return;
          if (attempt === 0) normalizeBrokerOperationalConfig(null);
          // An unreachable API (gateway restart) is retried with a capped
          // exponential backoff until it answers; other failures are final.
          if (!isServerUnreachableError(error)) return;
          retryTimer = setTimeout(load, getReconnectDelayMs(attempt));
          attempt += 1;
        });
    };
    load();
    return () => {
      active = false;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      stopMigration();
    };
  }, []);
}

import { useEffect } from 'react';
import { api } from '../services/api';
import { normalizeBrokerOperationalConfig } from '../services/brokerOperationalConfig';
import { recordBrokerServerIdentity } from '../services/brokerServerIdentity';
import { installSavedAccountServerMigration } from '../services/savedAccountServerMigration';

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
    api.config.getConfig()
      .then((config) => {
        if (!active) return;
        normalizeBrokerOperationalConfig(config);
        recordBrokerServerIdentity(config);
      })
      .catch(() => { if (active) normalizeBrokerOperationalConfig(null); });
    return () => {
      active = false;
      stopMigration();
    };
  }, []);
}

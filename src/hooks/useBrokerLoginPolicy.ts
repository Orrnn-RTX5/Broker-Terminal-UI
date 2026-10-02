import { useEffect, useState } from 'react';
import { getBrokerConfigurationError, getRuntimeBrokerConfiguration, isDesktopBackendTarget } from '../config/backendTarget.js';
import { loadBrokerDirectory } from '../services/brokerDirectory';
import { resolveBrokerLoginPolicy, type BrokerLoginPolicy } from '../services/brokerLoginPolicy';

const configurationIdentity = (): string => JSON.stringify(getRuntimeBrokerConfiguration());

export const useBrokerLoginPolicy = (active: boolean): BrokerLoginPolicy | null => {
  const identity = configurationIdentity();
  const [verified, setVerified] = useState<{ identity: string; policy: BrokerLoginPolicy } | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    const accept = (policy: BrokerLoginPolicy) => {
      if (alive && identity === configurationIdentity()) setVerified({ identity, policy });
    };
    const configuration = getRuntimeBrokerConfiguration();
    const configurationError = getBrokerConfigurationError();
    if (configurationError) {
      accept(resolveBrokerLoginPolicy([]));
      return () => { alive = false; };
    }
    if (!configuration.discoveryBaseUrl) {
      // Complete pinned deployment settings are the configured authority when
      // no optional discovery catalog is supplied. Backend authorization still
      // decides whether account login or registration is permitted.
      accept(resolveBrokerLoginPolicy(!isDesktopBackendTarget() && configuration.valid ? [{
        broker_id: configuration.brokerId, broker_name: configuration.brokerName,
      }] : []));
      return () => { alive = false; };
    }
    setVerified(null);
    // An empty preflight directory is pending, not a configuration failure.
    loadBrokerDirectory({ discoveryUrl: configuration.discoveryBaseUrl, forceRefresh: true })
      .then(brokers => accept(resolveBrokerLoginPolicy(brokers)))
      .catch((error: unknown) => accept({
        status: 'error', brokerId: '', displayName: '', locked: true, local: false,
        error: error instanceof Error ? error.message : 'Broker discovery is unavailable.',
      }));
    return () => { alive = false; };
  }, [active, identity]);

  return active && verified?.identity === identity ? verified.policy : null;
};

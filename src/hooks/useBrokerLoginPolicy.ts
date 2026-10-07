import { useEffect, useState } from 'react';
import { getBrokerConfigurationError, getRuntimeBrokerConfiguration, isDesktopBackendTarget } from '../config/backendTarget.js';
import { getCachedBrokerDirectory, loadBrokerDirectory } from '../services/brokerDirectory';
import { resolveBrokerLoginPolicy, type BrokerLoginPolicy } from '../services/brokerLoginPolicy';

const configurationIdentity = (): string => {
  const desktop = isDesktopBackendTarget();
  let sessionBrokerId = '';
  if (desktop && typeof window !== 'undefined') {
    try {
      sessionBrokerId = window.localStorage.getItem('broker_id')
        || window.localStorage.getItem('rtx_broker_id') || '';
    } catch { /* A selected desktop broker must be verified by the directory. */ }
  }
  return JSON.stringify([getRuntimeBrokerConfiguration(), desktop, sessionBrokerId]);
};

export const useBrokerLoginPolicy = (active: boolean): BrokerLoginPolicy | null => {
  const identity = configurationIdentity();
  const [verified, setVerified] = useState<{ identity: string; policy: BrokerLoginPolicy } | null>(null);
  const configuration = getRuntimeBrokerConfiguration();
  const desktop = isDesktopBackendTarget();
  const cachedDirectory = active && configuration.discoveryBaseUrl
    ? getCachedBrokerDirectory(configuration.discoveryBaseUrl) ?? null : null;
  // Web requests are already locked to the complete, validated deployment.
  // Optional directory metadata can revoke access, but need not delay its form.
  const configuredPolicy = !desktop ? resolveBrokerLoginPolicy(configuration.valid ? [{
    broker_id: configuration.brokerId, broker_name: configuration.brokerName,
  }] : []) : null;
  const immediatePolicy = cachedDirectory !== null
    ? resolveBrokerLoginPolicy(cachedDirectory) : configuredPolicy;

  useEffect(() => {
    if (!active) {
      if (desktop) setVerified(null);
      return undefined;
    }
    let alive = true;
    const accept = (policy: BrokerLoginPolicy) => {
      if (alive && identity === configurationIdentity()) setVerified({ identity, policy });
    };
    const configurationError = getBrokerConfigurationError();
    if (configurationError) {
      accept(resolveBrokerLoginPolicy([]));
      return () => { alive = false; };
    }
    if (!configuration.discoveryBaseUrl) {
      accept(resolveBrokerLoginPolicy(!desktop && configuration.valid ? [{
        broker_id: configuration.brokerId, broker_name: configuration.brokerName,
      }] : []));
      return () => { alive = false; };
    }
    if (desktop) setVerified(null);
    const cached = getCachedBrokerDirectory(configuration.discoveryBaseUrl) ?? null;
    if (cached !== null) accept(resolveBrokerLoginPolicy(cached));
    loadBrokerDirectory({ discoveryUrl: configuration.discoveryBaseUrl, forceRefresh: false })
      .then(brokers => accept(resolveBrokerLoginPolicy(brokers)))
      .catch((error: unknown) => accept({
        status: 'error', brokerId: '', displayName: '', locked: true, local: false,
        error: error instanceof Error ? error.message : 'Broker discovery is unavailable.',
      }));
    return () => { alive = false; };
  }, [active, identity]);

  if (!active) return null;
  // Another broker dialog may have refreshed the shared directory since this
  // hook last verified it. Its current authority outranks an older local result.
  if (cachedDirectory !== null) return immediatePolicy;
  return verified?.identity === identity ? verified.policy : immediatePolicy;
};

import { useEffect, useState } from 'react';
import { DEV_BROKER_DISCOVERY_PROXY_PREFIX, toLocalDevProxyUrl } from '../config/api';
import { getRuntimeDiscoveryBaseUrl } from '../config/backendTarget.js';
import { extractBrokerDiscoveryList } from '../services/brokerDiscovery';
import { resolveBrokerLoginPolicy, type BrokerLoginPolicy } from '../services/brokerLoginPolicy';

export const useBrokerLoginPolicy = (active: boolean): BrokerLoginPolicy | null => {
  const [policy, setPolicy] = useState<BrokerLoginPolicy | null>(() => {
    const initial = resolveBrokerLoginPolicy([]);
    return initial.local ? initial : null;
  });

  useEffect(() => {
    if (!active) return undefined;
    const immediate = resolveBrokerLoginPolicy([]);
    setPolicy(immediate);
    const discoveryUrl = getRuntimeDiscoveryBaseUrl();
    if (immediate.local || immediate.status === 'error' || !discoveryUrl) return undefined;
    const controller = new AbortController();
    fetch(toLocalDevProxyUrl(`${discoveryUrl}/api/v2/broker/servers`, DEV_BROKER_DISCOVERY_PROXY_PREFIX), { signal: controller.signal, credentials: 'omit', redirect: 'error' })
      .then((response) => {
        if (!response.ok) throw new Error('Broker discovery is unavailable.');
        return response.json();
      })
      .then((payload: unknown) => setPolicy(resolveBrokerLoginPolicy(extractBrokerDiscoveryList(payload))))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setPolicy({
          status: 'error', brokerId: '', displayName: '', locked: true, local: false,
          error: error instanceof Error ? error.message : 'Broker discovery is unavailable.',
        });
      });
    return () => controller.abort();
  }, [active]);

  return policy;
};

import { useEffect, useState } from 'react';
import { BROKER_DISCOVERY_URL } from '../config/api';
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
    if (immediate.local) return undefined;
    const controller = new AbortController();
    fetch(`${BROKER_DISCOVERY_URL}/api/v2/broker/servers`, { signal: controller.signal })
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

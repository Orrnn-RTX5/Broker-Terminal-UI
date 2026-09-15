export interface BrokerDiscoveryItem {
  broker_id?: string;
  broker_name?: string;
  name?: string;
  id?: string | number;
  server?: string;
  server_url?: string;
  backend_url?: string;
  market_api_url?: string;
  server_ip?: string;
  server_port?: number;
  logo_url?: string;
  region?: string;
  [key: string]: unknown;
}

const arrayFromObjectPayload = (payload: Record<string, unknown>): unknown[] => {
  const candidates = [
    payload.brokers,
    payload.servers,
    payload.data,
    payload.result,
    payload.rows,
    payload.items,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === 'object') {
      const nested = arrayFromObjectPayload(candidate as Record<string, unknown>);
      if (nested.length > 0) return nested;
    }
  }

  return [];
};

export const extractBrokerDiscoveryList = (payload: unknown): BrokerDiscoveryItem[] => {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? arrayFromObjectPayload(payload as Record<string, unknown>)
      : [];

  return rows
    .filter((row): row is BrokerDiscoveryItem => Boolean(row && typeof row === 'object'))
    .map((row) => {
      const brokerId = String(row.broker_id ?? row.id ?? '').trim();
      const brokerName = String(row.broker_name ?? row.name ?? brokerId).trim();

      return {
        ...row,
        broker_id: brokerId,
        broker_name: brokerName || brokerId,
      };
    })
    .filter((row) => Boolean(row.broker_id && row.broker_name));
};

const SUSPENDED_BROKER_STATUSES = new Set(['suspended', 'disabled', 'inactive', 'deleted']);

export const isBrokerSuspended = (broker: BrokerDiscoveryItem | null | undefined): boolean => {
  if (!broker) return false;
  if (broker.active === false || broker.enabled === false) return true;
  const status = String(broker.status ?? '').trim().toLowerCase();
  return SUSPENDED_BROKER_STATUSES.has(status);
};

// Desktop login must use the address published in the directory, never an
// environment fallback or an address reconstructed from the broker name/IP.
export const getDirectoryBrokerServerUrl = (broker: BrokerDiscoveryItem | null | undefined): string => {
  const value = String(broker?.server_url || '').trim().replace(/\/+$/, '');
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '';
    return value;
  } catch {
    return '';
  }
};

export const isDirectoryBrokerSelectable = (broker: BrokerDiscoveryItem | null | undefined): boolean =>
  Boolean(broker && !isBrokerSuspended(broker) && getDirectoryBrokerServerUrl(broker));

export const firstSelectableBroker = <T extends BrokerDiscoveryItem>(
  brokers: T[],
): T | undefined => brokers.find((broker) => !isBrokerSuspended(broker));

export const filterBrokerDirectory = <T extends BrokerDiscoveryItem>(
  brokers: T[],
  query: string,
  selectedBroker: T | null,
): T[] => {
  const normalizedQuery = query.trim().toLowerCase();
  // The login input is pre-filled with the selected broker's name; treating that
  // as a filter would hide the rest of the superadmin directory when the dropdown
  // opens, so an exact self-match lists every broker instead.
  if (selectedBroker && normalizedQuery === String(selectedBroker.broker_name || '').trim().toLowerCase()) {
    const current = brokers.find((broker) => broker.broker_id === selectedBroker.broker_id);
    return current ? [current, ...brokers.filter((broker) => broker !== current)] : brokers;
  }
  if (!normalizedQuery) return brokers;
  return brokers.filter((broker) => (
    String(broker.broker_name || '').toLowerCase().includes(normalizedQuery)
    || String(broker.broker_id || '').toLowerCase().includes(normalizedQuery)
    || String(broker.region || '').toLowerCase().includes(normalizedQuery)
  ));
};

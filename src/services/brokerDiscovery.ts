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

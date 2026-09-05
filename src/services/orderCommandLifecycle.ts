export const ORDER_COMMAND_POLL_INTERVAL_MS = 1_000;
export const ORDER_COMMAND_FALLBACK_DEADLINE_MS = 30_000;

export type OrderCommandStatus =
  | 'accepted'
  | 'processing'
  | 'filled'
  | 'rejected'
  | 'expired';

export type OrderCommandError = {
  code?: string;
  message?: string;
};

export type NormalizedOrderCommand = {
  status: OrderCommandStatus;
  terminal: boolean;
  clientOrderId?: string;
  executeBeforeMs?: number;
  acceptedAtMs?: number;
  error?: OrderCommandError;
  position?: Record<string, unknown>;
  synthetic?: boolean;
  raw: unknown;
};

export class OrderCommandTerminalError extends Error {
  readonly status: Extract<OrderCommandStatus, 'rejected' | 'expired'>;
  readonly code?: string;
  readonly backendMessage?: string;
  readonly clientOrderId: string;
  readonly preserveBackendOrderError = true;

  constructor(command: NormalizedOrderCommand, clientOrderId: string) {
    const code = command.error?.code;
    const backendMessage = command.error?.message;
    super(
      code && backendMessage
        ? `${code}: ${backendMessage}`
        : code || backendMessage || `Order command ${command.status}`,
    );
    this.name = 'OrderCommandTerminalError';
    this.status = command.status === 'rejected' ? 'rejected' : 'expired';
    this.code = code;
    this.backendMessage = backendMessage;
    this.clientOrderId = clientOrderId;
  }
}

export type PollOrderCommandOptions = {
  clientOrderId: string;
  initialResponse: unknown;
  readStatus: (clientOrderId: string) => Promise<unknown>;
  onStatus?: (command: NormalizedOrderCommand) => void;
  onPollError?: (error: unknown) => void;
  startedAtMs?: number;
  pollIntervalMs?: number;
  fallbackDeadlineMs?: number;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
};

const TERMINAL_STATUSES = new Set<OrderCommandStatus>([
  'filled',
  'rejected',
  'expired',
]);

const asRecord = (value: unknown): Record<string, unknown> | undefined => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
);

const nonEmptyString = (value: unknown): string | undefined => (
  typeof value === 'string' && value.trim() ? value : undefined
);

const firstString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    const text = nonEmptyString(value);
    if (text !== undefined) return text;
  }
  return undefined;
};

const normalizeStatusValue = (value: unknown): OrderCommandStatus | undefined => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return undefined;

  if (normalized === 'accepted' || normalized === 'order_accepted') return 'accepted';
  if (
    normalized === 'processing'
    || normalized === 'queued'
    || normalized === 'executing'
    || normalized === 'reconciling'
    || normalized === 'order_processing'
    || normalized === 'order_status'
  ) return 'processing';
  if (
    normalized === 'filled'
    || normalized === 'completed'
    || normalized === 'executed'
    || normalized === 'order_filled'
  ) return 'filled';
  if (
    normalized === 'rejected'
    || normalized === 'failed'
    || normalized === 'not_admitted'
    || normalized === 'order_rejected'
  ) return 'rejected';
  if (
    normalized === 'expired'
    || normalized === 'timed_out'
    || normalized === 'timeout'
    || normalized === 'order_expired'
  ) return 'expired';

  return undefined;
};

export const parseOrderCommandEpochMs = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;

  if (typeof value === 'number' || (typeof value === 'string' && /^\s*\d+(?:\.\d+)?\s*$/.test(value))) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
    return numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
  }

  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const readStatus = (
  record: Record<string, unknown>,
  data: Record<string, unknown> | undefined,
): OrderCommandStatus | undefined => {
  const candidates = [
    record.status,
    record.state,
    data?.state,
    data?.status,
    record.type,
  ];

  for (const candidate of candidates) {
    const status = normalizeStatusValue(candidate);
    if (status) return status;
  }
  return undefined;
};

const readError = (
  record: Record<string, unknown>,
  data: Record<string, unknown> | undefined,
): OrderCommandError | undefined => {
  const topLevelError = asRecord(record.error);
  const dataError = asRecord(data?.error);
  const code = firstString(
    topLevelError?.code,
    record.error_code,
    record.code,
    dataError?.code,
    data?.error_code,
    data?.code,
  );
  const message = firstString(
    topLevelError?.message,
    record.error_message,
    dataError?.message,
    data?.error_message,
    typeof record.error === 'string' ? record.error : undefined,
    typeof data?.error === 'string' ? data.error : undefined,
    record.message,
    data?.message,
  );

  return code || message ? { code, message } : undefined;
};

const readFilledPosition = (
  status: OrderCommandStatus,
  record: Record<string, unknown>,
  data: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (status !== 'filled') return undefined;

  return asRecord(record.position)
    ?? asRecord(data?.position)
    ?? asRecord(record.result)
    ?? asRecord(data?.result)
    ?? data
    ?? record;
};

export const normalizeOrderCommand = (
  response: unknown,
  fallbackClientOrderId?: string,
): NormalizedOrderCommand => {
  const record = asRecord(response);
  if (!record) throw new Error('Order command response must be an object');

  const data = asRecord(record.data);
  const status = readStatus(record, data);
  if (!status) throw new Error('Order command response is missing a recognized status');

  const clientOrderId = firstString(
    record.client_order_id,
    record.clientOrderId,
    data?.client_order_id,
    data?.clientOrderId,
    fallbackClientOrderId,
  );
  const executeBeforeMs = parseOrderCommandEpochMs(
    record.execute_before ?? record.executeBefore ?? data?.execute_before ?? data?.executeBefore,
  );
  const acceptedAtMs = parseOrderCommandEpochMs(
    record.accepted_at ?? record.acceptedAt ?? data?.accepted_at ?? data?.acceptedAt,
  );

  return {
    status,
    terminal: TERMINAL_STATUSES.has(status),
    clientOrderId,
    executeBeforeMs,
    acceptedAtMs,
    error: readError(record, data),
    position: readFilledPosition(status, record, data),
    raw: response,
  };
};

const defaultSleep = (delayMs: number): Promise<void> => (
  new Promise((resolve) => setTimeout(resolve, delayMs))
);

const toPositiveDuration = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const validateCorrelation = (
  command: NormalizedOrderCommand,
  expectedClientOrderId: string,
): void => {
  if (command.clientOrderId && command.clientOrderId !== expectedClientOrderId) {
    throw new Error('Order command response client_order_id does not match the requested command');
  }
};

const createExpiredCommand = (
  previous: NormalizedOrderCommand,
  clientOrderId: string,
  executeBeforeMs: number,
): NormalizedOrderCommand => ({
  ...previous,
  status: 'expired',
  terminal: true,
  clientOrderId,
  executeBeforeMs,
  error: previous.error ?? {
    code: 'ORDER_COMMAND_EXPIRED',
    message: 'No terminal order result arrived before execute_before.',
  },
  synthetic: true,
});

export const pollOrderCommandUntilTerminal = async (
  options: PollOrderCommandOptions,
): Promise<NormalizedOrderCommand> => {
  const clientOrderId = String(options.clientOrderId ?? '').trim();
  if (!clientOrderId) throw new Error('client_order_id is required to poll order status');

  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const initialNow = now();
  const requestedStart = Number(options.startedAtMs);
  const startedAtMs = Number.isFinite(requestedStart) && requestedStart <= initialNow
    ? requestedStart
    : initialNow;
  const pollIntervalMs = Math.max(
    ORDER_COMMAND_POLL_INTERVAL_MS,
    toPositiveDuration(options.pollIntervalMs, ORDER_COMMAND_POLL_INTERVAL_MS),
  );
  const fallbackDeadlineMs = toPositiveDuration(
    options.fallbackDeadlineMs,
    ORDER_COMMAND_FALLBACK_DEADLINE_MS,
  );

  let command = normalizeOrderCommand(options.initialResponse, clientOrderId);
  validateCorrelation(command, clientOrderId);
  options.onStatus?.(command);
  if (command.terminal) return command;

  let executeBeforeMs = command.executeBeforeMs ?? (startedAtMs + fallbackDeadlineMs);

  while (true) {
    const delayMs = Math.max(0, Math.min(pollIntervalMs, executeBeforeMs - now()));
    if (delayMs > 0) await sleep(delayMs);

    let response: unknown;
    try {
      response = await options.readStatus(clientOrderId);
    } catch (error) {
      options.onPollError?.(error);
      if (now() >= executeBeforeMs) {
        const expired = createExpiredCommand(command, clientOrderId, executeBeforeMs);
        options.onStatus?.(expired);
        return expired;
      }
      continue;
    }

    const next = normalizeOrderCommand(response, clientOrderId);
    validateCorrelation(next, clientOrderId);
    command = next;
    if (next.executeBeforeMs !== undefined) executeBeforeMs = next.executeBeforeMs;
    options.onStatus?.(command);

    if (command.terminal) return command;
    if (now() >= executeBeforeMs) {
      const expired = createExpiredCommand(command, clientOrderId, executeBeforeMs);
      options.onStatus?.(expired);
      return expired;
    }
  }
};

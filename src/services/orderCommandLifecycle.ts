export const ORDER_COMMAND_POLL_INTERVAL_MS = 1_000;
export const ORDER_COMMAND_FALLBACK_DEADLINE_MS = 30_000;
export const ORDER_COMMAND_BACKGROUND_RECONCILIATION_MS = 300_000;

export type OrderCommandStatus =
  | 'accepted'
  | 'processing'
  | 'outcome-unknown'
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
  serverTimeMs?: number;
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
    if (!command.terminal || command.synthetic) throw new Error('Only authoritative terminal commands may be rejected');
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

export class OrderCommandOutcomeUnknownError extends Error {
  readonly code = 'ORDER_OUTCOME_UNKNOWN';
  readonly orderWasSent = true;
  constructor(readonly clientOrderId: string) {
    super(`Awaiting confirmation. Check command ${clientOrderId} before placing another order.`);
    this.name = 'OrderCommandOutcomeUnknownError';
  }
}

export type PollOrderCommandOptions = {
  clientOrderId: string;
  initialResponse: unknown;
  readStatus: (clientOrderId: string, signal?: AbortSignal) => Promise<unknown>;
  onStatus?: (command: NormalizedOrderCommand) => void;
  onPollError?: (error: unknown) => void;
  startedAtMs?: number;
  startedAtMonoMs?: number;
  initialResponseReceivedAtMonoMs?: number;
  /** Continue read-only reconciliation after the foreground wait ends. */
  backgroundReconciliationMs?: number;
  isCurrent?: () => boolean;
  pollIntervalMs?: number;
  /** Reconcile an already-sent uncertain order without an extra first-poll delay. */
  pollImmediately?: boolean;
  /** Keep a correlated terminal push authoritative while polling another transport. */
  subscribeTerminal?: (listener: (response: unknown) => void) => (() => void);
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
  const serverTimeMs = parseOrderCommandEpochMs(record.server_time_ms ?? record.server_time ?? data?.server_time_ms ?? data?.server_time);

  return {
    status,
    terminal: TERMINAL_STATUSES.has(status),
    clientOrderId,
    executeBeforeMs,
    acceptedAtMs,
    serverTimeMs,
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

const createUnknownCommand = (
  previous: NormalizedOrderCommand,
  clientOrderId: string,
  executeBeforeMs?: number,
): NormalizedOrderCommand => ({
  ...previous,
  status: 'outcome-unknown',
  terminal: false,
  clientOrderId,
  executeBeforeMs,
  error: {
    code: 'ORDER_OUTCOME_UNKNOWN',
    message: `Awaiting confirmation. Check command ${clientOrderId} before placing another order.`,
  },
  synthetic: true,
});

export const pollOrderCommandUntilTerminal = async (
  options: PollOrderCommandOptions,
): Promise<NormalizedOrderCommand> => {
  const clientOrderId = String(options.clientOrderId ?? '').trim();
  if (!clientOrderId) throw new Error('client_order_id is required to poll order status');

  // Waiting budgets use monotonic time. Never compare a server deadline with the PC clock.
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? defaultSleep;
  const initialNow = now();
  const requestedStart = options.startedAtMonoMs ?? (options.now ? options.startedAtMs : undefined);
  const startedAtMono = typeof requestedStart === 'number' && Number.isFinite(requestedStart) && requestedStart <= initialNow ? requestedStart : initialNow;
  const pollIntervalMs = Math.max(ORDER_COMMAND_POLL_INTERVAL_MS, toPositiveDuration(options.pollIntervalMs, ORDER_COMMAND_POLL_INTERVAL_MS));
  const foregroundBudget = toPositiveDuration(options.fallbackDeadlineMs, ORDER_COMMAND_FALLBACK_DEADLINE_MS);
  const backgroundBudget = Math.min(ORDER_COMMAND_BACKGROUND_RECONCILIATION_MS, Math.max(0, options.backgroundReconciliationMs ?? 0));
  const hardDeadline = Math.max(initialNow, startedAtMono + foregroundBudget) + backgroundBudget;
  let command = normalizeOrderCommand(options.initialResponse, clientOrderId);
  validateCorrelation(command, clientOrderId);
  options.onStatus?.(command);
  if (command.terminal) return command;
  let executeBeforeMs = command.executeBeforeMs;
  let foregroundDeadline = startedAtMono + foregroundBudget;
  const observeDeadline = (next: NormalizedOrderCommand, receivedAtMono: number) => {
    if (next.executeBeforeMs === undefined) return;
    executeBeforeMs = next.executeBeforeMs;
    const serverReference = next.serverTimeMs ?? next.acceptedAtMs;
    if (serverReference === undefined) return;
    const base = next.serverTimeMs === undefined ? startedAtMono : receivedAtMono;
    foregroundDeadline = Math.min(foregroundDeadline, base + Math.max(0, next.executeBeforeMs - serverReference));
  };
  observeDeadline(command, options.initialResponseReceivedAtMonoMs ?? initialNow);
  let uncertain = false;
  const publishUnknown = () => {
    const unknown = createUnknownCommand(command, clientOrderId, executeBeforeMs);
    if (!uncertain) { uncertain = true; options.onStatus?.(unknown); }
    return unknown;
  };
  let readImmediately = options.pollImmediately === true;
  const push = { command: undefined as NormalizedOrderCommand | undefined, closed: false };
  let wakeForTerminal: (() => void) | undefined;
  const terminalSignal = options.subscribeTerminal
    ? new Promise<void>((resolve) => { wakeForTerminal = resolve; })
    : undefined;
  let unsubscribeTerminal: (() => void) | undefined;
  let sleepTimer: ReturnType<typeof setTimeout> | undefined;
  const finishPush = (): NormalizedOrderCommand => {
    const terminal = push.command!;
    options.onStatus?.(terminal);
    return terminal;
  };

  try {
    unsubscribeTerminal = options.subscribeTerminal?.((response) => {
      if (push.closed || push.command) return;
      let next: NormalizedOrderCommand;
      try {
        // A shared event source must provide the actual correlation id. Never
        // fill a missing push id from this poller's expected command.
        next = normalizeOrderCommand(response);
      } catch {
        return;
      }
      if (!next.terminal || next.clientOrderId !== clientOrderId) return;
      push.command = next;
      wakeForTerminal?.();
    });

    while (true) {
      if (push.command) return finishPush();
      if (options.isCurrent?.() === false) return publishUnknown();
      if (now() >= hardDeadline && uncertain) return publishUnknown();
      const delayMs = readImmediately
        ? 0
        : Math.max(0, Math.min(uncertain ? Math.max(5000, pollIntervalMs) : pollIntervalMs, (uncertain ? hardDeadline : foregroundDeadline) - now()));
      readImmediately = false;
      if (delayMs > 0) {
        if (terminalSignal) {
          const delay = options.sleep
            ? sleep(delayMs)
            : new Promise<void>((resolve) => {
              sleepTimer = setTimeout(() => {
                sleepTimer = undefined;
                resolve();
              }, delayMs);
            });
          await Promise.race([delay, terminalSignal]);
          if (push.command) return finishPush();
        } else {
          await sleep(delayMs);
        }
      }

      let response: unknown;
      const readController = new AbortController();
      let readTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const statusRead = options.readStatus(clientOrderId, readController.signal);
        const readTimeout = new Promise<never>((_, reject) => {
          readTimer = setTimeout(() => { readController.abort(); reject(new Error('Order status read timed out')); }, Math.max(1, Math.min(8000, hardDeadline - now())));
        });
        // Promise.race observes both outcomes of an in-flight read even when
        // the terminal push wins, so a later GET failure cannot go unhandled.
        response = terminalSignal
          ? await Promise.race([statusRead, terminalSignal, readTimeout])
          : await Promise.race([statusRead, readTimeout]);
      } catch (error) {
        if (push.command) return finishPush();
        options.onPollError?.(error);
        if (now() >= foregroundDeadline) publishUnknown();
        if (now() >= hardDeadline || (uncertain && backgroundBudget === 0)) return publishUnknown();
        continue;
      } finally {
        if (readTimer !== undefined) clearTimeout(readTimer);
        readController.abort();
      }
      if (push.command) return finishPush();

      let next: NormalizedOrderCommand;
      try {
        next = normalizeOrderCommand(response, clientOrderId);
        validateCorrelation(next, clientOrderId);
      } catch (error) {
        // A bad status read is not evidence that the submitted order failed.
        // Keep reconciling the original UUID and allow its terminal push to win.
        options.onPollError?.(error);
        if (now() >= foregroundDeadline) publishUnknown();
        if (now() >= hardDeadline || (uncertain && backgroundBudget === 0)) return publishUnknown();
        continue;
      }
      command = next;
      observeDeadline(next, now());
      if (!uncertain || command.terminal) options.onStatus?.(command);

      if (command.terminal) return command;
      if (now() >= foregroundDeadline) publishUnknown();
      if (now() >= hardDeadline || (uncertain && backgroundBudget === 0)) return publishUnknown();
    }
  } finally {
    push.closed = true;
    if (sleepTimer !== undefined) clearTimeout(sleepTimer);
    unsubscribeTerminal?.();
  }
};
